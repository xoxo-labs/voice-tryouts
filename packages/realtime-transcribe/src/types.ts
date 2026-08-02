/**
 * Shared types for the OpenAI Realtime live-transcription experiment.
 *
 * Schema notes (GA Realtime API, verified Aug 2026):
 * - The API is GA. Do NOT send `OpenAI-Beta: realtime=v1`.
 * - Session config is NESTED under `session.audio.input.*`. The old flat beta
 *   shape (`input_audio_format: "pcm16"`, `input_audio_transcription`, ...) is
 *   superseded.
 * - `format` is an object, not a string: `{ type: "audio/pcm", rate: 24000 }`.
 * - `noise_reduction` is an object `{ type: "near_field" | "far_field" }` or
 *   `null`. Sending a bare string is rejected by the server.
 * - `gpt-live-transcribe` uses the plural `languages` array, never `language`.
 *
 * Docs: https://developers.openai.com/api/docs/guides/realtime-transcription
 */

import { DEFAULT_REGION, type Region } from "./regions";

export type { Region };

/** Latency/accuracy dial. Higher = more audio context before emitting text. */
export const TRANSCRIBE_DELAYS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type TranscribeDelay = (typeof TRANSCRIBE_DELAYS)[number];

/** `off` maps to `noise_reduction: null` on the wire. */
export const NOISE_REDUCTION_MODES = ["near_field", "far_field", "off"] as const;

export type NoiseReductionMode = (typeof NOISE_REDUCTION_MODES)[number];

/**
 * How audio reaches the API.
 * - `webrtc`   — peer connection carries the audio; events on a data channel.
 * - `ws`       — WebSocket; the client captures, downsamples and appends
 *                base64 PCM16 manually.
 * - `ws-preroll` — `ws`, plus capture starts the instant `start()` is called
 *                (before the token exists). Everything spoken during setup is
 *                buffered locally and flushed at `session.created`, so no
 *                words are lost and setup becomes perceptually invisible.
 */
export const TRANSPORTS = ["webrtc", "ws", "ws-preroll"] as const;

export type TransportKind = (typeof TRANSPORTS)[number];

export interface LiveTranscribeSettings {
  delay: TranscribeDelay;
  noiseReduction: NoiseReductionMode;
  /** ISO 639-1 (`en`), selected ISO 639-3 (`yue`), or zh regional (`zh-cn`). */
  languages: string[];
  /**
   * Carried inside the settings so it reaches the mint request, the token
   * cache key and the run record automatically. A secret minted in one region
   * must never be used to connect to another.
   */
  region: Region;
  /**
   * Not part of the OpenAI session config (the mint ignores it), but part of
   * the settings object so it flows into the cache key and run records — runs
   * on different transports must never be averaged together.
   */
  transport: TransportKind;
}

export const DEFAULT_SETTINGS: LiveTranscribeSettings = {
  delay: "low",
  noiseReduction: "near_field",
  languages: ["en"],
  region: DEFAULT_REGION,
  transport: "webrtc",
};

/**
 * Milestone timestamps for one connection attempt, in milliseconds relative to
 * `t0` (the moment `start()` was called). `undefined` means "not reached".
 */
export interface RunMarks {
  tokenStart?: number;
  tokenEnd?: number;
  micStart?: number;
  micEnd?: number;
  /** Local SDP offer created and set — runs concurrently with token minting. */
  offerReady?: number;
  sdpStart?: number;
  sdpEnd?: number;
  /** `pc.connectionState === "connected"` */
  connected?: number;
  /** `oai-events` data channel opened */
  dcOpen?: number;
  /** WS transports: local capture pipeline started producing chunks. */
  captureStart?: number;
  /** WS transports: socket open. */
  wsOpen?: number;
  /** `session.created` server event */
  sessionCreated?: number;
  /** ws-preroll: the locally buffered audio finished flushing to the API. */
  prerollFlushed?: number;
  /**
   * First moment local audio rose above the measured silence baseline — i.e.
   * when the user actually started talking. Detected client-side, because the
   * model emits no VAD events. Without it, "time to first word" mostly
   * measures how long someone stared at the screen before speaking.
   */
  speechOnset?: number;
  /** first `conversation.item.input_audio_transcription.delta` */
  firstDelta?: number;
  /** first `input_audio_buffer.commit` we sent (finalises the open item) */
  firstCommit?: number;
  /** first `conversation.item.input_audio_transcription.completed` */
  firstCompleted?: number;
}

export type RunMarkKey = keyof RunMarks;

/**
 * One transcribed utterance, reconciled by `item_id`.
 *
 * `gpt-live-transcribe` does not segment turns for us (no VAD), so a single
 * `item_id` accumulates deltas continuously until we send an explicit
 * `input_audio_buffer.commit`. Every item therefore arrives via `delta` first
 * and is finalised by `completed` — there is no `speech_started` to seed from.
 * Keying on `item_id` still matters: the docs warn `completed` events are not
 * order-guaranteed across items.
 */
export interface Utterance {
  itemId: string;
  /** Accumulated streaming deltas (shown greyed/italic until finalised). */
  delta: string;
  /** Final transcript from the `.completed` event, or `null` while streaming. */
  transcript: string | null;
  /** Error message if `.failed` arrived for this item. */
  error: string | null;
  firstSeenAt: number | null;
  completedAt: number | null;
}

/**
 * One entry in the raw data-channel log. Client-side pseudo-events are
 * prefixed with an arrow so they are distinguishable from server events.
 */
export interface LoggedEvent {
  id: number;
  /** ms from `t0`. */
  at: number;
  type: string;
  payload: string;
  /**
   * False only for events we have never observed before. Everything the API
   * is known to emit is `true`, even when the app takes no action on it —
   * flagging normal traffic as suspicious just trains you to ignore the flag.
   */
  expected: boolean;
}

/**
 * Live microphone level, sampled locally from an `AnalyserNode`.
 *
 * `threshold` is derived from `baseline` rather than hardcoded: a webcam mic
 * can idle around 0.0027 where a headset sits ten times higher, so a fixed
 * number would either never trigger or trigger constantly.
 */
export interface LevelMeter {
  /** Current RMS of the captured signal. */
  rms: number;
  /** Median RMS measured during the initial calibration window. */
  baseline: number | null;
  /** RMS a sample must exceed to count towards speech onset. */
  threshold: number | null;
  /** True once onset has been detected for this run. */
  onsetDetected: boolean;
}

/**
 * Outbound audio counters from `RTCPeerConnection.getStats()`. If
 * `packetsSent` stays flat or `audioLevel` sits at zero, the problem is
 * capture-side, not the API.
 */
export interface AudioStats {
  packetsSent: number;
  bytesSent: number;
  audioLevel: number | null;
  totalAudioEnergy: number | null;
}

/** Which microphone a run used. Not part of the OpenAI session config. */
export interface CaptureSettings {
  /** `null` means "let the browser pick the system default". */
  deviceId: string | null;
  deviceLabel: string;
}

export const DEFAULT_CAPTURE: CaptureSettings = {
  deviceId: null,
  deviceLabel: "System default",
};

/**
 * `cold` mints a fresh client secret at Start, measuring the true first-run
 * cost. `warm` reuses a pre-minted one. Mixing the two in one history would
 * make the p50 tiles meaningless, so every run records which it was.
 */
export type StartMode = "cold" | "warm";

export type TokenSource = "network" | "cache";

export interface RunRecord {
  id: string;
  index: number;
  startedAt: number;
  settings: LiveTranscribeSettings;
  capture: CaptureSettings;
  marks: RunMarks;
  startMode: StartMode;
  tokenSource: TokenSource;
  utteranceCount: number;
  /** ws-preroll: how much audio was buffered locally before the flush. */
  prerollMs: number | null;
  error: string | null;
}

/** What the pre-warmed token cache currently holds, for display. */
export interface TokenCacheState {
  status: "empty" | "minting" | "ready" | "error";
  /** Fingerprint of the settings the cached secret was minted for. */
  key: string | null;
  /** Epoch seconds. */
  expiresAt: number | null;
  error: string | null;
}

export type ConnectionStatus =
  | "idle"
  /** Token mint, mic capture and SDP offer all run concurrently here. */
  | "preparing"
  /** SDP POSTed, waiting for the peer connection to come up. */
  | "connecting"
  | "connected"
  /** Final commit sent, waiting briefly for the last `completed`. */
  | "stopping"
  | "error";

/**
 * Verdict for one connection-test stage.
 *
 * `skip` exists so a stage can never be silently blank — the recurring failure
 * mode this whole test exists to kill is a check that neither passed nor
 * failed and left you guessing.
 */
export type StageStatus = "pending" | "running" | "pass" | "warn" | "fail" | "skip";

export interface StageResult {
  id: string;
  label: string;
  status: StageStatus;
  /** Always populated in plain words, including for skips. Never empty. */
  detail: string;
  /** What to actually do about it, when something went wrong. */
  remedy?: string;
  durationMs?: number;
  data?: Record<string, string | number | boolean | null>;
}

/** Active ICE candidate pair — where the media actually lands. */
export interface IcePathInfo {
  localType: string | null;
  remoteType: string | null;
  remoteAddress: string | null;
  remotePort: number | null;
  protocol: string | null;
  /** The media-path round trip, in ms. The most informative single number. */
  roundTripMs: number | null;
}

