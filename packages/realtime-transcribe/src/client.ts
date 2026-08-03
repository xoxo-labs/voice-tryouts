import { computeRms, createOnsetDetector, ONSET } from "./onset";
import { WebRtcTransport } from "./transport-webrtc";
import { WsTransport } from "./transport-ws";
import type { Transport } from "./transport";
import type {
  AudioStats,
  CaptureSettings,
  ConnectionStatus,
  LevelMeter,
  LiveTranscribeSettings,
  LoggedEvent,
  RunMarkKey,
  RunMarks,
  TokenSource,
  Utterance,
} from "./types";

/** How recently a delta must have arrived for the activity light to be on. */
const ACTIVITY_WINDOW_MS = 900;
/** Delta silence after which the open item is finalised with a commit. */
export const IDLE_COMMIT_MS = 1500;
/** How long `stop()` waits for the final `completed` after its commit. */
const FINAL_COMMIT_GRACE_MS = 1500;
/**
 * Smallest buffer worth committing. The API rejects commits below 100 ms with
 * `input_audio_buffer_commit_empty` (verified live, Aug 2026); the margin
 * absorbs rounding in the client-side accounting.
 */
const MIN_COMMIT_AUDIO_MS = 120;
/** Cadence of the activity/idle-commit checker. */
const TICK_MS = 250;
/** Poll audio stats every Nth tick. */
const STATS_EVERY_N_TICKS = 4;

/**
 * Every event type this session is known to emit, whether or not the client
 * acts on it. Flagging routine traffic as suspicious only teaches you to
 * ignore the flag, so `committed`/`added`/`done` (normal commit bookkeeping)
 * are all here.
 */
const EXPECTED_EVENTS = new Set([
  "session.created",
  "session.updated",
  "conversation.item.input_audio_transcription.delta",
  "conversation.item.input_audio_transcription.completed",
  "conversation.item.input_audio_transcription.failed",
  "input_audio_buffer.committed",
  "conversation.item.added",
  "conversation.item.done",
  "error",
]);

interface RealtimeServerEvent {
  type?: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string; code?: string };
}

export interface SessionResult {
  marks: RunMarks;
  /** Resolved capture — the actual device label once the track is live. */
  capture: CaptureSettings;
  utteranceCount: number;
  tokenSource: TokenSource;
  prerollMs: number | null;
  error: string | null;
}

export interface SessionCallbacks {
  onStatus?: (status: ConnectionStatus) => void;
  onMarks?: (marks: RunMarks) => void;
  onUtterances?: (utterances: Utterance[]) => void;
  onEvent?: (event: LoggedEvent) => void;
  onLevel?: (meter: LevelMeter) => void;
  onAudioStats?: (stats: AudioStats) => void;
  onTranscribing?: (active: boolean) => void;
  onTokenSource?: (source: TokenSource) => void;
  /** Fires exactly once, when the session is over (success or failure). */
  onEnd?: (result: SessionResult) => void;
}

export interface SessionOptions {
  settings: LiveTranscribeSettings;
  capture: CaptureSettings;
  /**
   * Token acquisition is injected: the library never assumes where secrets
   * come from (an app endpoint, a cache, a test fixture).
   */
  getSecret: (
    settings: LiveTranscribeSettings,
  ) => Promise<{ value: string; source: TokenSource }>;
  callbacks: SessionCallbacks;
}

function makeTransport(settings: LiveTranscribeSettings): Transport {
  switch (settings.transport) {
    case "webrtc":
      return new WebRtcTransport();
    case "ws":
      return new WsTransport(false);
    case "ws-preroll":
      return new WsTransport(true);
  }
}

/**
 * One transcription session, transport-agnostic and framework-free.
 *
 * A session is single-use: construct → `start()` → (`stop()` | failure) →
 * `onEnd` fires once → the instance is dead. This one-shot shape is what
 * makes rapid start/stop cycling safe — a superseded instance is simply
 * disposed, and its late async work checks `this.ended` instead of a shared
 * generation counter.
 */
export class TranscribeSession {
  private readonly settings: LiveTranscribeSettings;
  private readonly requestedCapture: CaptureSettings;
  private readonly getSecret: SessionOptions["getSecret"];
  private readonly cb: SessionCallbacks;

  private transport: Transport | null = null;
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private abort = new AbortController();

  private ended = false;
  private started = false;
  private t0 = 0;
  private marks: RunMarks = {};
  private resolvedCapture: CaptureSettings;
  private tokenSource: TokenSource = "network";
  private utterances = new Map<string, Utterance>();
  private utteranceOrder: string[] = [];
  private eventSeq = 0;
  private lastDeltaAt: number | null = null;
  private connectedAt: number | null = null;
  private lastCommitAt: number | null = null;
  /**
   * Commits sent whose resulting item has not yet resolved. Every commit of a
   * non-empty buffer yields exactly one `completed` or `failed` — verified
   * live even for pure silence (empty transcript). This is what lets
   * `stop()` end the moment the tail is in, instead of always burning the
   * full grace period.
   */
  private pendingCommits = 0;
  private tick: ReturnType<typeof setInterval> | null = null;
  private onsetTimer: ReturnType<typeof setInterval> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private lastError: string | null = null;

  constructor(options: SessionOptions) {
    this.settings = options.settings;
    this.requestedCapture = options.capture;
    this.resolvedCapture = options.capture;
    this.getSecret = options.getSecret;
    this.cb = options.callbacks;
  }

  // ------------------------------------------------------------ helpers

  private elapsed(): number {
    return performance.now() - this.t0;
  }

  private mark = (key: RunMarkKey): void => {
    if (this.ended && key !== "firstCompleted") return;
    if (this.marks[key] != null) return;
    this.marks = { ...this.marks, [key]: this.elapsed() };
    this.cb.onMarks?.(this.marks);
  };

  private log = (type: string, payload: unknown, expected: boolean): void => {
    if (this.ended) return;
    this.cb.onEvent?.({
      id: ++this.eventSeq,
      at: this.elapsed(),
      type,
      expected,
      payload:
        typeof payload === "string"
          ? payload
          : JSON.stringify(payload, null, 2),
    });
  };

  private setStatus(status: ConnectionStatus): void {
    if (this.ended) return;
    this.cb.onStatus?.(status);
  }

  private emitUtterances(): void {
    if (this.ended) return;
    this.cb.onUtterances?.(
      this.utteranceOrder.map((id) => this.utterances.get(id)!),
    );
  }

  private upsertUtterance(
    itemId: string,
    update: (current: Utterance) => Utterance,
  ): void {
    const existing = this.utterances.get(itemId);
    if (existing) {
      this.utterances.set(itemId, update(existing));
    } else {
      this.utterances.set(
        itemId,
        update({
          itemId,
          delta: "",
          transcript: null,
          error: null,
          firstSeenAt: this.elapsed(),
          completedAt: null,
        }),
      );
      this.utteranceOrder.push(itemId);
    }
    this.emitUtterances();
  }

  // ------------------------------------------------------------- events

  private handleServerFrame = (raw: string): void => {
    if (this.ended) return;

    let event: RealtimeServerEvent;
    try {
      event = JSON.parse(raw) as RealtimeServerEvent;
    } catch {
      this.log("<unparseable>", raw.slice(0, 500), false);
      return;
    }

    const type = event.type ?? "<no type>";
    this.log(type, event, EXPECTED_EVENTS.has(type));

    switch (event.type) {
      case "session.created":
        this.mark("sessionCreated");
        break;

      case "conversation.item.input_audio_transcription.delta":
        this.mark("firstDelta");
        this.lastDeltaAt = performance.now();
        this.cb.onTranscribing?.(true);
        if (event.item_id && typeof event.delta === "string") {
          const chunk = event.delta;
          this.upsertUtterance(event.item_id, (current) => ({
            ...current,
            delta: current.delta + chunk,
          }));
        }
        break;

      case "conversation.item.input_audio_transcription.completed": {
        this.mark("firstCompleted");
        this.pendingCommits = Math.max(0, this.pendingCommits - 1);
        if (event.item_id) {
          const finalText = event.transcript;
          const completedAt = this.elapsed();
          this.upsertUtterance(event.item_id, (current) => ({
            ...current,
            transcript:
              typeof finalText === "string" ? finalText : current.delta,
            completedAt,
          }));
        }
        this.maybeFinishStopping();
        break;
      }

      case "conversation.item.input_audio_transcription.failed": {
        this.pendingCommits = Math.max(0, this.pendingCommits - 1);
        if (event.item_id) {
          const message = event.error?.message ?? "Transcription failed.";
          this.upsertUtterance(event.item_id, (current) => ({
            ...current,
            error: message,
          }));
        }
        this.maybeFinishStopping();
        break;
      }

      case "error":
        // A commit that raced an already-empty buffer is benign: the session
        // survives it (verified live) and it means there was nothing left to
        // flush — not a failure worth surfacing to the caller.
        if (event.error?.code === "input_audio_buffer_commit_empty") {
          this.pendingCommits = Math.max(0, this.pendingCommits - 1);
          this.maybeFinishStopping();
          break;
        }
        this.lastError =
          event.error?.message ?? "The Realtime API reported an error.";
        break;

      default:
        break;
    }
  };

  private sendCommit(): boolean {
    const sent = this.transport?.send({ type: "input_audio_buffer.commit" });
    if (!sent) return false;
    this.lastDeltaAt = null;
    this.lastCommitAt = performance.now();
    this.pendingCommits += 1;
    this.mark("firstCommit");
    this.log("→ input_audio_buffer.commit", { sentByClient: true }, true);
    return true;
  }

  /**
   * Whether the server's input buffer holds audio worth flushing at stop.
   * A delta since the last commit proves it. Otherwise fall back to how much
   * audio actually went up since then: exact for WS (the transport counts its
   * own appends), elapsed wall time for WebRTC (RTP streams continuously, so
   * time connected IS audio appended). This is the fix for the classic
   * dictation loss: speak a short phrase, hit stop before the first delta.
   */
  private hasUncommittedAudio(): boolean {
    if (this.lastDeltaAt != null) return true;
    const appended = this.transport?.appendedMsSinceCommit;
    if (appended != null) return appended >= MIN_COMMIT_AUDIO_MS;
    const since = this.lastCommitAt ?? this.connectedAt;
    return since != null && performance.now() - since >= MIN_COMMIT_AUDIO_MS;
  }

  /**
   * While stopping, end as soon as every commit has resolved and no item is
   * still open — the grace timer then only covers the pathological cases
   * (server never answers, connection dies mid-flush).
   */
  private maybeFinishStopping(): void {
    if (this.ended || this.stopTimer == null) return;
    if (this.pendingCommits > 0) return;
    for (const utterance of this.utterances.values()) {
      if (utterance.transcript == null && utterance.error == null) return;
    }
    this.end(null);
  }

  // ------------------------------------------------------------ lifecycle

  async start(): Promise<void> {
    if (this.started) throw new Error("TranscribeSession is single-use.");
    this.started = true;
    this.t0 = performance.now();
    this.setStatus("preparing");

    const fail = (message: string) => {
      if (!this.ended) this.end(message);
    };

    try {
      const transport = makeTransport(this.settings);
      this.transport = transport;

      // Token acquisition and microphone/transport preparation run
      // CONCURRENTLY — neither needs the other. For ws-preroll this is the
      // core of the idea: capture is already buffering audio while the token
      // is still being minted.
      const tokenPromise = (async () => {
        this.mark("tokenStart");
        const secret = await this.getSecret(this.settings);
        this.mark("tokenEnd");
        this.tokenSource = secret.source;
        this.cb.onTokenSource?.(secret.source);
        return secret.value;
      })();

      const preparePromise = (async () => {
        this.mark("micStart");
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "This browser does not expose getUserMedia. A secure context (https or localhost) is required.",
          );
        }

        let stream: MediaStream;
        let fellBackToDefault = false;
        try {
          stream = await navigator.mediaDevices.getUserMedia(
            this.requestedCapture.deviceId
              ? { audio: { deviceId: { exact: this.requestedCapture.deviceId } } }
              : { audio: true },
          );
        } catch (cause) {
          const name = (cause as { name?: string } | null)?.name;
          const deviceGone =
            name === "OverconstrainedError" || name === "NotFoundError";
          if (!this.requestedCapture.deviceId || !deviceGone) throw cause;
          // The chosen mic vanished between enumeration and start.
          fellBackToDefault = true;
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }

        if (this.ended) {
          for (const track of stream.getTracks()) track.stop();
          throw new Error("ended");
        }
        this.stream = stream;
        this.mark("micEnd");

        const audioTrack = stream.getAudioTracks()[0];
        this.resolvedCapture = {
          deviceId: fellBackToDefault ? null : this.requestedCapture.deviceId,
          deviceLabel: fellBackToDefault
            ? `${this.requestedCapture.deviceLabel} (unavailable → default)`
            : audioTrack?.label || this.requestedCapture.deviceLabel,
        };
        this.log(
          "→ microphone acquired",
          {
            label: this.resolvedCapture.deviceLabel,
            settings: audioTrack?.getSettings(),
          },
          true,
        );

        this.startLevelAnalysis(stream);

        await transport.prepare({
          stream,
          onMessage: this.handleServerFrame,
          mark: this.mark,
          log: this.log,
          onFatal: fail,
          signal: this.abort.signal,
        });
      })();

      // `allSettled`, never `race`: if the token rejects first we still must
      // wait for capture so its microphone can be released.
      const [tokenOutcome, prepareOutcome] = await Promise.allSettled([
        tokenPromise,
        preparePromise,
      ]);
      if (this.ended) return;
      if (tokenOutcome.status === "rejected") throw tokenOutcome.reason;
      if (prepareOutcome.status === "rejected") throw prepareOutcome.reason;

      this.setStatus("connecting");
      await transport.connect({
        secret: tokenOutcome.value,
        region: this.settings.region,
        signal: this.abort.signal,
      });
      if (this.ended) return;

      this.setStatus("connected");
      this.connectedAt = performance.now();
      this.startTick();
    } catch (cause) {
      if (this.ended) return;
      if (this.abort.signal.aborted) return;
      if (cause instanceof Error && cause.message === "ended") return;
      const name = (cause as { name?: string } | null)?.name;
      if (name === "AbortError") return;
      if (name === "NotAllowedError" || name === "SecurityError") {
        fail("Microphone permission was denied.");
        return;
      }
      if (name === "NotFoundError") {
        fail("No microphone was found.");
        return;
      }
      fail(
        cause instanceof Error
          ? cause.message
          : "Unexpected error while connecting.",
      );
    }
  }

  /**
   * Graceful stop: flush whatever audio the server is still holding —
   * whether or not it has produced a delta yet — then end as soon as every
   * outstanding commit has resolved, or at the grace deadline, whichever
   * comes first.
   *
   * Known limitation: stopping BEFORE the session is live discards the
   * ws-preroll backlog — flushing it would mean holding the session open
   * through connect + transcribe after the user asked to stop. Post-
   * connection audio is always flushed.
   */
  stop(): void {
    if (this.ended) return;
    if (this.stopTimer != null) return; // already stopping
    const flushed = this.hasUncommittedAudio() && this.sendCommit();
    if (flushed || this.pendingCommits > 0) {
      this.setStatus("stopping");
      this.stopTimer = setTimeout(() => this.end(null), FINAL_COMMIT_GRACE_MS);
      return;
    }
    this.end(null);
  }

  /** Hard teardown, no grace period. Safe to call repeatedly. */
  dispose(): void {
    this.end(null, { silent: true });
  }

  private end(error: string | null, opts?: { silent?: boolean }): void {
    if (this.ended) return;
    this.ended = true;

    this.abort.abort();
    if (this.tick) clearInterval(this.tick);
    if (this.onsetTimer) clearInterval(this.onsetTimer);
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.tick = null;
    this.onsetTimer = null;
    this.stopTimer = null;

    const transport = this.transport;
    this.transport = null;
    void transport?.close();

    const stream = this.stream;
    this.stream = null;
    for (const track of stream?.getTracks() ?? []) {
      try {
        track.stop();
      } catch {
        // already stopped
      }
    }

    const audioCtx = this.audioCtx;
    this.audioCtx = null;
    void audioCtx?.close().catch(() => {});

    if (!opts?.silent) {
      this.cb.onTranscribing?.(false);
      this.cb.onEnd?.({
        marks: this.marks,
        capture: this.resolvedCapture,
        utteranceCount: this.utteranceOrder.length,
        tokenSource: this.tokenSource,
        prerollMs: transport?.prerollMs ?? null,
        error: error ?? this.lastError,
      });
    }
  }

  // --------------------------------------------------- level + onset + tick

  /**
   * Local level analysis for speech-onset detection, shared by all
   * transports. An AnalyserNode samples every 50 ms — `getStats()` only
   * refreshes about once a second, far too coarse for a metric that has to
   * resolve a few hundred milliseconds.
   */
  private startLevelAnalysis(stream: MediaStream): void {
    try {
      const audioCtx = new AudioContext();
      this.audioCtx = audioCtx;
      void audioCtx.resume();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      // Not connected to the destination — monitoring through the speakers
      // would feed back.
      source.connect(analyser);

      const detector = createOnsetDetector(performance.now());
      const buffer = new Float32Array(analyser.fftSize);

      this.onsetTimer = setInterval(() => {
        if (this.ended) return;
        analyser.getFloatTimeDomainData(buffer);
        const rms = computeRms(buffer);
        const now = performance.now();
        const onsetAt = detector.push(rms, now);
        if (onsetAt != null) {
          this.marks = { ...this.marks, speechOnset: onsetAt - this.t0 };
          this.cb.onMarks?.(this.marks);
          this.log(
            "→ speech onset detected",
            {
              rms,
              baseline: detector.baseline,
              threshold: detector.threshold,
            },
            true,
          );
        }
        this.cb.onLevel?.({
          rms,
          baseline: detector.baseline,
          threshold: detector.threshold,
          onsetDetected: detector.onsetAt != null,
        });
      }, ONSET.sampleMs);
    } catch {
      this.log("→ level analysis unavailable", {}, false);
    }
  }

  /** Activity light, idle commit, and audio counters. */
  private startTick(): void {
    if (this.tick) clearInterval(this.tick);
    let ticks = 0;
    this.tick = setInterval(() => {
      if (this.ended) return;
      const last = this.lastDeltaAt;
      const idleFor = last == null ? null : performance.now() - last;
      this.cb.onTranscribing?.(idleFor != null && idleFor < ACTIVITY_WINDOW_MS);
      if (idleFor != null && idleFor >= IDLE_COMMIT_MS) this.sendCommit();
      if (ticks++ % STATS_EVERY_N_TICKS === 0) {
        const transport = this.transport;
        if (transport) {
          void transport.getAudioStats().then((stats) => {
            if (!this.ended && stats && this.transport === transport) {
              this.cb.onAudioStats?.(stats);
            }
          });
        }
      }
    }, TICK_MS);
  }
}
