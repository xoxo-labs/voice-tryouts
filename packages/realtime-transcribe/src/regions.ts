/**
 * API region selection.
 *
 * The base URL is a SINGLE parameter that must propagate through the whole
 * chain — minting the client secret (server-side) and the SDP POST
 * (client-side). Two independent constants would eventually diverge, and a
 * token minted in one region used against another measures nothing real while
 * looking perfectly healthy.
 *
 * Empirical note: `eu.api.openai.com` ACCEPTS the full chain on a
 * non-approved account — mint 200, SDP 201, data channel opens,
 * session.created arrives, RTP flows — and then transcribes NOTHING.
 * Confirmed with real speech on a physical microphone, not just synthetic
 * audio. The documented enterprise gating evidently applies at inference,
 * not at the door: instead of a 403 you get a perfect handshake and eternal
 * silence. Both hostnames resolve to the same Cloudflare anycast IPs with
 * identical TLS handshake times; ironically the EU media path is *closer*
 * (73-81 ms RTT vs 170-183 ms on US) — and unusable.
 */

export const REGIONS = ["us", "eu"] as const;

export type Region = (typeof REGIONS)[number];

export const DEFAULT_REGION: Region = "us";

interface RegionInfo {
  id: Region;
  label: string;
  host: string;
  baseUrl: string;
  note: string;
}

export const REGION_INFO: Record<Region, RegionInfo> = {
  us: {
    id: "us",
    label: "US — api.openai.com",
    host: "api.openai.com",
    baseUrl: "https://api.openai.com",
    note: "The default endpoint. Always available.",
  },
  eu: {
    id: "eu",
    label: "EU — eu.api.openai.com",
    host: "eu.api.openai.com",
    baseUrl: "https://eu.api.openai.com",
    note: "Data-residency endpoint. Confirmed on a non-approved account: the full handshake succeeds but nothing is ever transcribed — mint and stream look healthy, no deltas arrive. Expect silence unless your org has data-residency approval.",
  },
};

export function isRegion(value: unknown): value is Region {
  return REGIONS.includes(value as Region);
}

export function regionBaseUrl(region: Region): string {
  return REGION_INFO[region].baseUrl;
}

/** Server-side: where client secrets are minted. */
export function clientSecretsUrl(region: Region): string {
  return `${regionBaseUrl(region)}/v1/realtime/client_secrets`;
}

/** Client-side: where the SDP offer is POSTed. */
export function realtimeCallsUrl(region: Region): string {
  return `${regionBaseUrl(region)}/v1/realtime/calls`;
}

/** Every host worth pre-connecting to, so switching region stays cheap. */
export const ALL_REGION_ORIGINS = REGIONS.map((r) => REGION_INFO[r].baseUrl);
