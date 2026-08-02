import type { NextRequest } from "next/server";

import {
  isRegion,
  REGION_INFO,
  regionBaseUrl,
  type Region,
} from "@xoxo-labs/realtime-transcribe";

/**
 * Server-side half of the connection test: is the key present, and does the
 * selected region accept it?
 *
 * Every branch returns a distinct `code` and a sentence a human can act on.
 * The three failures that look identical from the browser — no key, bad key,
 * no quota — must never collapse into one "request failed".
 */
export async function GET(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  const regionParam = request.nextUrl.searchParams.get("region");
  const region: Region = isRegion(regionParam) ? regionParam : "us";
  const host = REGION_INFO[region].host;

  if (!apiKey) {
    return Response.json({
      ok: false,
      code: "missing_api_key",
      region,
      host,
      detail:
        "The server is running, but OPENAI_API_KEY is not set in its environment.",
      remedy:
        "Copy .env.example to .env.local, put your key in it, then restart the dev server.",
    });
  }

  const startedAt = Date.now();
  let upstream: Response;
  try {
    // /v1/models is the cheapest authenticated call — it validates the key
    // without spending tokens or minting anything.
    upstream = await fetch(`${regionBaseUrl(region)}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (cause) {
    return Response.json({
      ok: false,
      code: "unreachable",
      region,
      host,
      detail: `The server could not reach ${host}: ${
        cause instanceof Error ? cause.message : "unknown network error"
      }`,
      remedy:
        "Check the machine's internet connection, DNS, and any corporate proxy or firewall.",
    });
  }

  const durationMs = Date.now() - startedAt;

  if (upstream.status === 401) {
    return Response.json({
      ok: false,
      code: "invalid_api_key",
      region,
      host,
      durationMs,
      detail:
        "The key was sent and rejected with 401 — it is malformed, revoked, or belongs to a deleted project.",
      remedy: "Issue a fresh key at platform.openai.com and update .env.local.",
    });
  }

  if (upstream.status === 429) {
    return Response.json({
      ok: false,
      code: "rate_limited",
      region,
      host,
      durationMs,
      detail:
        "The key is valid but the account returned 429 — either out of credit or rate limited.",
      remedy:
        "Check billing and usage limits on the OpenAI dashboard. This is an account state, not a code problem.",
    });
  }

  if (upstream.status === 403 || upstream.status === 404) {
    return Response.json({
      ok: false,
      code: region === "us" ? "forbidden" : "region_unavailable",
      region,
      host,
      durationMs,
      detail:
        region === "us"
          ? `${host} returned ${upstream.status}. The key may lack permission for this endpoint.`
          : `${host} returned ${upstream.status} for this account — the ${region.toUpperCase()} endpoint is not enabled on it.`,
      remedy:
        region === "us"
          ? "Check the key's project permissions."
          : "Switch the region back to US.",
    });
  }

  if (!upstream.ok) {
    return Response.json({
      ok: false,
      code: "upstream_error",
      region,
      host,
      durationMs,
      detail: `${host} returned ${upstream.status} ${upstream.statusText}.`,
      remedy: "Check status.openai.com, then retry.",
    });
  }

  return Response.json({
    ok: true,
    code: "ok",
    region,
    host,
    durationMs,
    detail: `Key accepted by ${host} in ${durationMs} ms.`,
  });
}
