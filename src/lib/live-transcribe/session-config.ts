import {
  DEFAULT_SETTINGS,
  NOISE_REDUCTION_MODES,
  TRANSCRIBE_DELAYS,
  type LiveTranscribeSettings,
  type NoiseReductionMode,
  type TranscribeDelay,
} from "./types";

/** Recommended model for low-latency live transcription (GA, July 2026). */
export const LIVE_TRANSCRIBE_MODEL = "gpt-live-transcribe";

export const CLIENT_SECRETS_URL =
  "https://api.openai.com/v1/realtime/client_secrets";

/** SDP offers are POSTed here. This endpoint takes NO query parameters. */
export const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

/** The data channel name is load-bearing — it must be exactly this. */
export const REALTIME_DATA_CHANNEL = "oai-events";

/** Ephemeral client-secret TTL, in seconds. Server allows 10..7200. */
export const CLIENT_SECRET_TTL_SECONDS = 600;

export const MAX_LANGUAGES = 8;

/**
 * ISO 639-1 (`en`), selected ISO 639-3 (`yue`, `cmn`) and zh regional
 * (`zh-cn`). The Realtime API rejects malformed codes outright, so we filter
 * client-supplied values before they reach OpenAI.
 */
const LANGUAGE_CODE = /^[a-z]{2,3}(-[a-z]{2})?$/;

/** Shape check only — the API is the authority on which codes it supports. */
export function isValidLanguageCode(value: string): boolean {
  return LANGUAGE_CODE.test(value.trim().toLowerCase());
}

export function normaliseLanguages(input: unknown): string[] {
  if (!Array.isArray(input)) return DEFAULT_SETTINGS.languages;
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const code = raw.trim().toLowerCase();
    if (LANGUAGE_CODE.test(code)) seen.add(code);
    if (seen.size >= MAX_LANGUAGES) break;
  }
  return seen.size > 0 ? [...seen] : DEFAULT_SETTINGS.languages;
}

/** Parse a comma/space separated free-text field into language codes. */
export function parseLanguageInput(value: string): string[] {
  return normaliseLanguages(value.split(/[\s,]+/).filter(Boolean));
}

function isDelay(value: unknown): value is TranscribeDelay {
  return TRANSCRIBE_DELAYS.includes(value as TranscribeDelay);
}

function isNoiseReduction(value: unknown): value is NoiseReductionMode {
  return NOISE_REDUCTION_MODES.includes(value as NoiseReductionMode);
}

/** Coerce untrusted request JSON into settings we are willing to send on. */
export function normaliseSettings(input: unknown): LiveTranscribeSettings {
  const raw = (input ?? {}) as Record<string, unknown>;
  return {
    delay: isDelay(raw.delay) ? raw.delay : DEFAULT_SETTINGS.delay,
    noiseReduction: isNoiseReduction(raw.noiseReduction)
      ? raw.noiseReduction
      : DEFAULT_SETTINGS.noiseReduction,
    languages: normaliseLanguages(raw.languages),
  };
}

/**
 * Build the GA-shaped transcription session config.
 *
 * `turn_detection` is deliberately omitted: `gpt-live-transcribe` rejects it
 * outright ("Turn detection is not supported for this transcription model").
 * The model streams continuously instead of segmenting on turns, so there is
 * no server-side VAD to configure — and consequently no
 * `input_audio_buffer.speech_started` / `speech_stopped` events. Marks that
 * depend on those are optional in the UI.
 */
export function buildTranscriptionSession(settings: LiveTranscribeSettings) {
  return {
    type: "transcription" as const,
    audio: {
      input: {
        format: { type: "audio/pcm" as const, rate: 24000 as const },
        noise_reduction:
          settings.noiseReduction === "off"
            ? null
            : { type: settings.noiseReduction },
        transcription: {
          model: LIVE_TRANSCRIBE_MODEL,
          languages: settings.languages,
          delay: settings.delay,
        },
      },
    },
  };
}
