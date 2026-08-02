import type { NextRequest } from "next/server";

import {
  buildTranscriptionSession,
  CLIENT_SECRET_TTL_SECONDS,
  CLIENT_SECRETS_URL,
  normaliseSettings,
} from "@/lib/live-transcribe/session-config";

/**
 * Mints a short-lived Realtime client secret (`ek_...`) for the browser.
 *
 * The standard `sk-` API key never leaves the server. The browser receives
 * only the ephemeral secret, which it uses as the Bearer token on its SDP POST
 * to https://api.openai.com/v1/realtime/calls.
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

  let upstream: Response;
  try {
    upstream = await fetch(CLIENT_SECRETS_URL, {
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
        error: `Could not reach the OpenAI API: ${
          cause instanceof Error ? cause.message : "unknown network error"
        }`,
        code: "upstream_unreachable",
      },
      { status: 502 },
    );
  }

  const payload: unknown = await upstream.json().catch(() => null);

  if (!upstream.ok) {
    const message =
      (payload as { error?: { message?: string } } | null)?.error?.message ??
      `OpenAI returned ${upstream.status} ${upstream.statusText}.`;
    return Response.json(
      { error: message, code: "upstream_error" },
      { status: upstream.status },
    );
  }

  const value = (payload as { value?: unknown } | null)?.value;
  if (typeof value !== "string") {
    return Response.json(
      {
        error: "OpenAI response did not contain a client secret.",
        code: "malformed_upstream_response",
      },
      { status: 502 },
    );
  }

  return Response.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
