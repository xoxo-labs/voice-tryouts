import type { LiveTranscribeSettings } from "./types";

/**
 * Session settings are baked into the ephemeral client secret when it is
 * minted, so a cached secret is valid ONLY for the exact settings it was
 * created with. Changing `delay`, `noise_reduction` or `languages` must
 * invalidate the cache — hence keying on the settings, not just on time.
 *
 * Languages are sorted so `["en","ro"]` and `["ro","en"]` share a cache entry.
 */
export function settingsKey(settings: LiveTranscribeSettings): string {
  return JSON.stringify([
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
    const [delay, noise, languages] = JSON.parse(key) as [
      string,
      string,
      string[],
    ];
    return `${delay} · ${noise} · ${languages.join("+")}`;
  } catch {
    return key;
  }
}
