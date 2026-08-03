import type { AudioStats, Region, RunMarkKey } from "./types";

/**
 * Common contract between the session client and a transport.
 *
 * Responsibility split:
 * - The CLIENT owns getUserMedia, speech-onset analysis, event semantics
 *   (utterance reconciliation, idle commit) and timing marks.
 * - The TRANSPORT owns moving audio and JSON events: WebRTC hands the raw
 *   MediaStream to a peer connection; WS runs its own capture pipeline and
 *   appends base64 PCM manually.
 *
 * The two-phase shape exists for latency: `prepare` needs only the microphone
 * and runs CONCURRENTLY with token minting (SDP offer creation for WebRTC,
 * capture-pipeline start for WS — which is also where pre-roll buffering
 * begins); `connect` needs the secret and completes the handshake.
 */
export interface TransportCallbacks {
  /** Deliver every raw server frame. */
  onMessage: (raw: string) => void;
  /** Transport-level milestone reporting, in client time. */
  mark: (key: RunMarkKey) => void;
  /** Log a client-side milestone into the event log. */
  log: (type: string, payload: unknown, expected: boolean) => void;
  /** Fatal transport failure after connect resolved. */
  onFatal: (message: string) => void;
}

export interface TransportPrepareOptions extends TransportCallbacks {
  /** The microphone stream. Ownership stays with the client. */
  stream: MediaStream;
  signal: AbortSignal;
}

export interface TransportConnectOptions {
  secret: string;
  region: Region;
  signal: AbortSignal;
}

export interface Transport {
  /** Secret-independent setup. Must be called before `connect`. */
  prepare(options: TransportPrepareOptions): Promise<void>;
  /** Complete the handshake. Resolves once the event path is open. */
  connect(options: TransportConnectOptions): Promise<void>;
  /** Send one client event as JSON. Returns false if the path is gone. */
  send(event: object): boolean;
  /** Outbound audio counters, shape depending on the transport. */
  getAudioStats(): Promise<AudioStats | null>;
  /** ws-preroll: flushed backlog duration in ms; null elsewhere. */
  readonly prerollMs: number | null;
  /**
   * Milliseconds of audio delivered to the server's input buffer since the
   * last `input_audio_buffer.commit` went out — the exact number for WS
   * (which appends every chunk itself), `null` for WebRTC (RTP flows outside
   * the client's accounting; the caller falls back to elapsed wall time,
   * which is equivalent there because the media track streams continuously,
   * silence included).
   */
  readonly appendedMsSinceCommit: number | null;
  /** Idempotent teardown of everything the transport created. */
  close(): Promise<void>;
}
