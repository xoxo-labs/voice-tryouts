/**
 * realtime-transcribe — transport-agnostic client for OpenAI Realtime
 * transcription sessions (gpt-live-transcribe, GA API).
 *
 * Pure browser TypeScript: no React, no Next, no UI imports. This file is the
 * package's public surface — the app (and any future npm consumer) imports
 * from here and only here.
 *
 * Everything in this module is grounded in empirical verification against the
 * live API, not just documentation; see the per-file notes for specifics
 * (turn_detection rejection, WS `?model=` rejection, pre-roll burst flush,
 * commit semantics on both transports).
 */

// ----------------------------------------------------------------- types
export type {
  AudioStats,
  CaptureSettings,
  ConnectionStatus,
  IcePathInfo,
  LevelMeter,
  LiveTranscribeSettings,
  LoggedEvent,
  NoiseReductionMode,
  Region,
  RunMarkKey,
  RunMarks,
  RunRecord,
  StageResult,
  StageStatus,
  StartMode,
  TokenCacheState,
  TokenSource,
  TranscribeDelay,
  TransportKind,
  Utterance,
} from "./types";
export {
  DEFAULT_CAPTURE,
  DEFAULT_SETTINGS,
  NOISE_REDUCTION_MODES,
  TRANSCRIBE_DELAYS,
  TRANSPORTS,
} from "./types";

// --------------------------------------------------------------- session
export {
  TranscribeSession,
  IDLE_COMMIT_MS,
  type SessionCallbacks,
  type SessionOptions,
  type SessionResult,
} from "./client";
export type {
  Transport,
  TransportCallbacks,
  TransportConnectOptions,
  TransportPrepareOptions,
} from "./transport";
export { WebRtcTransport } from "./transport-webrtc";
export { WsTransport } from "./transport-ws";

// ---------------------------------------------------------------- config
export {
  buildTranscriptionSession,
  CLIENT_SECRET_TTL_SECONDS,
  isValidLanguageCode,
  LIVE_TRANSCRIBE_MODEL,
  MAX_LANGUAGES,
  normaliseLanguages,
  normaliseSettings,
  REALTIME_DATA_CHANNEL,
} from "./session-config";
export {
  ALL_REGION_ORIGINS,
  clientSecretsUrl,
  DEFAULT_REGION,
  isRegion,
  realtimeCallsUrl,
  REGION_INFO,
  REGIONS,
  regionBaseUrl,
} from "./regions";

// ----------------------------------------------------------------- token
export {
  describeKey,
  EXPIRY_SAFETY_MARGIN_MS,
  isUsable,
  settingsKey,
  type CachedToken,
} from "./token-cache";

// --------------------------------------------------------------- analysis
export {
  comparableRuns,
  computeStats,
  deriveStages,
  formatMs,
  headlineMetrics,
  median,
  timeToFirstWord,
  ttfwInvalidReason,
  type HeadlineMetric,
  type MetricStats,
  type TimingStage,
} from "./timings";
export { computeRms, createOnsetDetector, ONSET, type OnsetDetector } from "./onset";
export { readIcePath } from "./ice-stats";

// -------------------------------------------------------------- utilities
export {
  CAPTURE_SAMPLE_RATE,
  PrerollBuffer,
  startPcmCapture,
  type CaptureStats,
  type PcmCapture,
} from "./capture";
export {
  createSyntheticSource,
  renderSyntheticSpeech,
  type SyntheticSource,
} from "./synthetic-audio";
