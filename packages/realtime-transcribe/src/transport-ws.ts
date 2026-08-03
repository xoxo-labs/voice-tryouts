import { PrerollBuffer, startPcmCapture, type PcmCapture } from "./capture";
import { REGION_INFO } from "./regions";
import type {
  Transport,
  TransportCallbacks,
  TransportConnectOptions,
  TransportPrepareOptions,
} from "./transport";
import type { AudioStats, Region } from "./types";

/**
 * WebSocket transport. Owns the whole capture pipeline: AudioWorklet →
 * 24 kHz PCM16 → base64 → `input_audio_buffer.append` messages.
 *
 * Two empirically verified constraints shape this file:
 * - The URL must carry NO `?model=` parameter. The session config comes from
 *   the transcription client secret; adding the parameter is rejected with
 *   "not supported in transcription mode".
 * - Auth rides in the subprotocol array (browsers cannot set WS headers):
 *   `["realtime", "openai-insecure-api-key.<secret>"]`.
 *
 * `prepare` starts capture immediately — before any token exists. In
 * pre-roll mode every chunk is buffered locally and the whole backlog is
 * flushed at `session.created`; the API absorbs a multi-second burst far
 * faster than realtime and transcribes it from the first word (verified
 * live). In plain ws mode, pre-session chunks are dropped — that mode
 * measures the traditional cost of waiting for setup.
 */
export class WsTransport implements Transport {
  private ws: WebSocket | null = null;
  private capture: PcmCapture | null = null;
  private buffer = new PrerollBuffer();
  private callbacks: TransportCallbacks | null = null;
  private appendedBytes = 0;
  private appendedChunks = 0;
  private appendedMs = 0;
  private sessionReady = false;
  private flushedPrerollMs: number | null = null;

  constructor(private readonly preroll: boolean) {}

  get prerollMs(): number | null {
    return this.flushedPrerollMs;
  }

  /** Exact server-buffer accounting: summed from appends, reset per commit. */
  get appendedMsSinceCommit(): number {
    return this.appendedMs;
  }

  async prepare(options: TransportPrepareOptions): Promise<void> {
    const { stream, onMessage, mark, log, onFatal } = options;
    this.callbacks = { onMessage, mark, log, onFatal };

    this.capture = await startPcmCapture(stream, (base64, durationMs) => {
      if (this.sessionReady) {
        this.append(base64);
      } else if (this.preroll) {
        this.buffer.push(base64, durationMs);
      }
      // plain ws: audio produced before the session exists is discarded.
    });
    mark("captureStart");
    log(
      "→ capture started",
      { sampleRate: this.capture.sampleRate, preroll: this.preroll },
      true,
    );
  }

  async connect(options: TransportConnectOptions): Promise<void> {
    const { secret, region, signal } = options;
    const callbacks = this.callbacks;
    if (!callbacks) {
      throw new Error("WsTransport.connect called before prepare.");
    }

    const url = wsUrl(region);
    const ws = new WebSocket(url, [
      "realtime",
      "openai-insecure-api-key." + secret,
    ]);
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        try {
          ws.close();
        } catch {
          // already closed
        }
        reject(new DOMException("Aborted", "AbortError"));
      };
      const cleanup = () => signal.removeEventListener("abort", onAbort);
      signal.addEventListener("abort", onAbort, { once: true });

      ws.addEventListener("open", () => {
        cleanup();
        callbacks.mark("wsOpen");
        callbacks.log("→ websocket open", { url }, true);
        resolve();
      });
      ws.addEventListener("close", (event) => {
        cleanup();
        reject(
          new Error(
            `WebSocket closed before opening (code ${event.code}${event.reason ? `: ${event.reason}` : ""}).`,
          ),
        );
      });
    });

    ws.addEventListener("message", (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      // The flush keys off session.created: from that moment the backlog is
      // valid input. Peeking here keeps capture details inside the transport.
      if (!this.sessionReady && event.data.includes('"session.created"')) {
        this.sessionReady = true;
        if (this.preroll) {
          const { bufferedMs, droppedMs } = this.buffer.flush((base64) =>
            this.append(base64),
          );
          this.flushedPrerollMs = bufferedMs;
          callbacks.mark("prerollFlushed");
          callbacks.log(
            "→ preroll flushed",
            { bufferedMs: Math.round(bufferedMs), droppedMs },
            true,
          );
        }
      }
      callbacks.onMessage(event.data);
    });
    ws.addEventListener("close", (event) => {
      if (this.ws === ws && this.sessionReady) {
        callbacks.onFatal(
          `The WebSocket closed unexpectedly (code ${event.code}${event.reason ? `: ${event.reason}` : ""}).`,
        );
      }
    });
  }

  private append(base64: string): void {
    const sent = this.send({
      type: "input_audio_buffer.append",
      audio: base64,
    });
    if (sent) {
      this.appendedChunks += 1;
      // base64 length ≈ 4/3 of the raw bytes.
      const bytes = Math.floor((base64.length * 3) / 4);
      this.appendedBytes += bytes;
      // 24 kHz mono PCM16 = 48 bytes per millisecond.
      this.appendedMs += bytes / 48;
    }
  }

  send(event: object): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(event));
      // A commit empties the server-side input buffer; track it here so the
      // accounting stays correct no matter who initiates the commit.
      if ((event as { type?: string }).type === "input_audio_buffer.commit") {
        this.appendedMs = 0;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * WS has no RTP, so "packets" are append messages and "bytes" are decoded
   * PCM bytes handed to the API. Level/energy stay null — the client's level
   * meter covers signal presence.
   */
  async getAudioStats(): Promise<AudioStats | null> {
    if (!this.capture) return null;
    return {
      packetsSent: this.appendedChunks,
      bytesSent: this.appendedBytes,
      audioLevel: null,
      totalAudioEnergy: null,
    };
  }

  async close(): Promise<void> {
    const capture = this.capture;
    this.capture = null;
    if (capture) await capture.stop();

    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close();
      } catch {
        // already closed
      }
    }
  }
}

/**
 * NO `?model=` — verified against the live API: the parameter is actively
 * rejected for transcription sessions ("not supported in transcription
 * mode"); the session config rides in the client secret instead.
 */
function wsUrl(region: Region): string {
  return `wss://${REGION_INFO[region].host}/v1/realtime`;
}
