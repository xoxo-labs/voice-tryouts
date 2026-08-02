import type { LiveTranscribeSettings } from "./types";

/**
 * Session settings are baked into the ephemeral client secret when it is
 * minted, so a cached secret is valid ONLY for the exact settings it was
 * created with. Changing `delay`, `noise_reduction` or `languages` must
 * invalidate the cache — hence keying on the settings, not just on time.
 *
 * Region is part of the key too, and critically so: a secret minted against
 * the US endpoint would otherwise be reused for a connection to the EU one,
 * silently invalidating any region comparison.
 *
 * Languages are sorted so `["en","ro"]` and `["ro","en"]` share a cache entry.
 *
 * Transport is in the key for the benchmark's sake, not the token's: the
 * secret itself is transport-agnostic, but statistics grouped by this key must
 * never average a WebRTC run with a WS one.
 */
export function settingsKey(settings: LiveTranscribeSettings): string {
  return JSON.stringify([
    settings.transport,
    settings.region,
    settings.delay,
    settings.noiseReduction,
    [...settings.languages].sort(),
  ]);
}

export interface CachedToken {
  value: string;
  /** Epoch seconds, straight from the API response. */
  expiresAt: number;
  key: string;
}

/**
 * Re-mint rather than risk a secret expiring mid-handshake. Expiry governs
 * *creating* sessions; a session already established keeps running, so the
 * only exposure is the moment of the SDP POST.
 */
export const EXPIRY_SAFETY_MARGIN_MS = 60_000;

export function isUsable(
  token: CachedToken | null,
  key: string,
  now = Date.now(),
): token is CachedToken {
  if (!token) return false;
  if (token.key !== key) return false;
  return token.expiresAt * 1000 - now > EXPIRY_SAFETY_MARGIN_MS;
}

export function describeKey(key: string | null): string {
  if (!key) return "—";
  try {
    const [transport, region, delay, noise, languages] = JSON.parse(key) as [
      string,
      string,
      string,
      string,
      string[],
    ];
    return `${transport} · ${region} · ${delay} · ${noise} · ${
      languages.length > 0 ? languages.join("+") : "auto"
    }`;
  } catch {
    return key;
  }
}
