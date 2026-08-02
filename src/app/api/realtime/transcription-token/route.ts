import type { NextRequest } from "next/server";

import { clientSecretsUrl, REGION_INFO } from "@/lib/realtime-transcribe";
import {
  buildTranscriptionSession,
  CLIENT_SECRET_TTL_SECONDS,
  normaliseSettings,
} from "@/lib/realtime-transcribe";

/**
 * Mints a short-lived Realtime client secret (`ek_...`) for the browser.
 *
 * The standard `sk-` API key never leaves the server. The browser receives
 * only the ephemeral secret, which it uses as the Bearer token on its SDP POST
 * to <region base>/v1/realtime/calls.
 *
 * The region travels inside the settings, so the mint and the later SDP POST
 * are guaranteed to target the same base URL. Minting in one region and
 * connecting to another would produce numbers that look fine and mean nothing.
 *
 * Docs: https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create
 */
export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return Response.json(
      {
        error:
          "OPENAI_API_KEY is not set. Copy .env.example to .env.local, add your key, then restart the dev server.",
        code: "missing_api_key",
      },
      { status: 500 },
    );
  }

  let body: unknown = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON.", code: "bad_request" },
      { status: 400 },
    );
  }

  const settings = normaliseSettings(body);
  const { region } = settings;

  let upstream: Response;
  try {
    upstream = await fetch(clientSecretsUrl(region), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expires_after: {
          anchor: "created_at",
          seconds: CLIENT_SECRET_TTL_SECONDS,
        },
        session: buildTranscriptionSession(settings),
      }),
    });
  } catch (cause) {
    return Response.json(
      {
        error: `Could not reach ${REGION_INFO[region].host}: ${
          cause instanceof Error ? cause.message : "unknown network error"
        }`,
        code: "upstream_unreachable",
        region,
      },
      { status: 502 },
    );
  }

  const payload: unknown = await upstream.json().catch(() => null);

  if (!upstream.ok) {
    const upstreamMessage = (payload as { error?: { message?: string } } | null)
      ?.error?.message;

    // A region the account cannot use is a specific, actionable failure.
    // Reporting it as a generic error would be exactly the kind of dead end
    // this project keeps tripping over.
    if (region !== "us" && (upstream.status === 403 || upstream.status === 404)) {
      return Response.json(
        {
          error: `The ${region.toUpperCase()} endpoint (${REGION_INFO[region].host}) returned ${upstream.status} for this account. Data residency endpoints normally require enterprise approval — switch the region back to US.`,
          code: "region_unavailable",
          region,
        },
        { status: upstream.status },
      );
    }

    if (upstream.status === 401) {
      return Response.json(
        {
          error:
            "OpenAI rejected the API key (401). The key in .env.local is missing, malformed, or revoked.",
          code: "invalid_api_key",
          region,
        },
        { status: 401 },
      );
    }

    if (upstream.status === 429) {
      return Response.json(
        {
          error:
            upstreamMessage ??
            "Rate limited or out of quota (429). The key itself is valid, but the account cannot serve this request right now.",
          code: "rate_limited",
          region,
        },
        { status: 429 },
      );
    }

    return Response.json(
      {
        error:
          upstreamMessage ??
          `OpenAI returned ${upstream.status} ${upstream.statusText}.`,
        code: "upstream_error",
        region,
      },
      { status: upstream.status },
    );
  }

  const value = (payload as { value?: unknown } | null)?.value;
  if (typeof value !== "string") {
    return Response.json(
      {
        error: "OpenAI response did not contain a client secret.",
        code: "malformed_upstream_response",
        region,
      },
      { status: 502 },
    );
  }

  return Response.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
