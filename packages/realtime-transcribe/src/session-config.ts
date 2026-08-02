import { isRegion } from "./regions";
import {
  DEFAULT_SETTINGS,
  NOISE_REDUCTION_MODES,
  TRANSCRIBE_DELAYS,
  TRANSPORTS,
  type LiveTranscribeSettings,
  type NoiseReductionMode,
  type TranscribeDelay,
  type TransportKind,
} from "./types";

/** Recommended model for low-latency live transcription (GA, July 2026). */
export const LIVE_TRANSCRIBE_MODEL = "gpt-live-transcribe";

/**
 * Endpoint URLs are derived per-region in `regions.ts` — see
 * `clientSecretsUrl()` and `realtimeCallsUrl()`. They are deliberately NOT
 * constants here: a hardcoded host would silently override the selected
 * region at one end of the chain.
 *
 * The calls endpoint takes no query parameters.
 */

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

/**
 * An EMPTY selection is a valid, distinct value meaning "auto-detect" — it
 * must NOT fall back to a default language. Only a missing/absent field (not
 * an array at all) falls back, since that means the caller never chose.
 */
export function normaliseLanguages(input: unknown): string[] {
  if (!Array.isArray(input)) return DEFAULT_SETTINGS.languages;
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const code = raw.trim().toLowerCase();
    if (LANGUAGE_CODE.test(code)) seen.add(code);
    if (seen.size >= MAX_LANGUAGES) break;
  }
  return [...seen];
}

function isDelay(value: unknown): value is TranscribeDelay {
  return TRANSCRIBE_DELAYS.includes(value as TranscribeDelay);
}

function isNoiseReduction(value: unknown): value is NoiseReductionMode {
  return NOISE_REDUCTION_MODES.includes(value as NoiseReductionMode);
}

function isTransport(value: unknown): value is TransportKind {
  return TRANSPORTS.includes(value as TransportKind);
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
    region: isRegion(raw.region) ? raw.region : DEFAULT_SETTINGS.region,
    // The mint payload never uses this, but normalised settings round-trip
    // into cache keys and run records, so it must survive normalisation.
    transport: isTransport(raw.transport)
      ? raw.transport
      : DEFAULT_SETTINGS.transport,
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
          // Auto-detect requires OMITTING the field. Verified against the live
          // API: no `languages` → 200 with languages:null (auto-detect);
          // `languages: []` → 400 "Expected an array with minimum length 1".
          ...(settings.languages.length > 0
            ? { languages: settings.languages }
            : {}),
          delay: settings.delay,
        },
      },
    },
  };
}
