"use client";

/**
 * `@xoxo-labs/realtime-transcribe/react` — the React hooks layer.
 *
 * Kept as a separate entry so the core (`.`) stays importable from anywhere —
 * server routes, workers, tests — without pulling React in. The directive
 * above lives on this entry file because esbuild only preserves directives
 * from entry points into the bundled output.
 */

export {
  DEFAULT_CAPTURE,
  DEFAULT_TOKEN_ENDPOINT,
  useLiveTranscribe,
  type UseLiveTranscribeOptions,
  type UseLiveTranscribeResult,
} from "./use-live-transcribe";
export {
  useVoiceInput,
  type UseVoiceInputOptions,
  type UseVoiceInputResult,
} from "./use-voice-input";
