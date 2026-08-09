# @xoxo-labs/realtime-transcribe

Transport-agnostic browser client for OpenAI Realtime transcription sessions
(`gpt-live-transcribe`), with an optional React hooks layer.

Everything in this package is grounded in empirical verification against the
live API — transport constraints, commit semantics, pre-roll flush behaviour —
not just the documentation. Where behaviour was verified rather than assumed,
the source says so.

- **`@xoxo-labs/realtime-transcribe`** — the core: a framework-free
  `TranscribeSession` plus the session-config, region, timing-analysis and
  capture utilities it is built from. Zero runtime dependencies, no React.
- **`@xoxo-labs/realtime-transcribe/react`** — hooks on top of the core:
  `useVoiceInput` (dictation into any controlled input) and
  `useLiveTranscribe` (the full instrumented session: timing marks, event log,
  run history).

ESM-only, by intent. The session itself needs browser APIs (`getUserMedia`,
`AudioContext`, `WebSocket`/`RTCPeerConnection`); the config helpers
(`buildTranscriptionSession`, `normaliseSettings`, region URLs) are pure and
run anywhere, which is what a server token route needs.

## Live demo

Both hooks, running against the live API at
[transcribe.xoxo-labs.com](https://transcribe.xoxo-labs.com):

- [**live-transcribe**](https://transcribe.xoxo-labs.com/experiments/live-transcribe)
  — `useLiveTranscribe`, the fully instrumented session.
- [**voice-prompt-input**](https://transcribe.xoxo-labs.com/experiments/voice-prompt-input)
  — `useVoiceInput` dictating into an AI Elements composer.
- [**How the model behaves**](https://transcribe.xoxo-labs.com/experiments/live-transcribe/behaviour)
  — empirically observed behaviour of `gpt-live-transcribe`: text lifecycle,
  which events arrive, expected latencies, troubleshooting.

The demo mints its client secrets server-side, exactly as described below, so
no API key reaches the browser. Sessions there are capped at 3 minutes and
rate-limited per IP to keep the hosted demo affordable — that cap is the
demo's, not the library's.

## Install

```bash
pnpm add @xoxo-labs/realtime-transcribe
# react is an optional peer dependency — only needed for the /react entry
```

## The token endpoint contract (read this first)

The library never sees your OpenAI API key. The browser asks **your server**
for a short-lived Realtime client secret, and your server mints it with the
real key. The contract:

- **Request**: `POST`, JSON body = the session's `LiveTranscribeSettings`
  (delay, languages, noise reduction, region, transport).
- **Response**: the OpenAI client-secret payload, at minimum
  `{ "value": "ek_...", "expires_at": 1234567890 }`.

`useVoiceInput`/`useLiveTranscribe` default to `POST
/api/realtime/transcription-token` (`DEFAULT_TOKEN_ENDPOINT`). That default is
an app-route convention, not something the library provides — **you implement
the route and/or override `tokenEndpoint`**. A minimal Next.js handler:

```ts
// app/api/realtime/transcription-token/route.ts
import {
  buildTranscriptionSession,
  clientSecretsUrl,
  CLIENT_SECRET_TTL_SECONDS,
  normaliseSettings,
} from "@xoxo-labs/realtime-transcribe";

export async function POST(request: Request) {
  const settings = normaliseSettings(await request.json().catch(() => ({})));
  const upstream = await fetch(clientSecretsUrl(settings.region), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: CLIENT_SECRET_TTL_SECONDS },
      session: buildTranscriptionSession(settings),
    }),
  });
  return Response.json(await upstream.json(), { status: upstream.status });
}
```

The region travels inside the settings so the mint and the later connection
are guaranteed to target the same base URL — a secret minted in one region
must never be used to connect to another.

## Quick start: React dictation (`useVoiceInput`)

Voice-to-text into any controlled input. Completed utterances fire `onText`
exactly once; the in-flight tail is exposed as `interim`. `stop()` flushes
everything the server is still holding — including speech that has not
produced a delta yet — so a short phrase followed by an immediate stop is not
lost.

```tsx
"use client";
import { useState } from "react";
import { useVoiceInput } from "@xoxo-labs/realtime-transcribe/react";

export function VoiceNotes() {
  const [text, setText] = useState("");
  const { listening, interim, error, start, stop } = useVoiceInput({
    onText: (final) => setText((prev) => (prev ? `${prev} ${final}` : final)),
  });

  return (
    <div>
      <textarea
        value={listening && interim ? `${text} ${interim}` : text}
        readOnly={listening}
        onChange={(event) => setText(event.currentTarget.value)}
      />
      <button onClick={() => (listening ? stop() : void start())}>
        {listening ? "Stop" : "Dictate"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
```

This drops straight into an AI Elements `PromptInput` (or any chat composer):
keep the committed text in your controlled value, append `interim` while
`listening`, and pause manual editing during dictation — reconciling user
edits with a machine-appended tail is ambiguous, so don't try.

The default transport is `ws-preroll`: capture starts the instant `start()`
is called, and everything spoken while the connection is still being set up
is buffered locally and flushed once the session is live.

## Quick start: the core, imperatively

```ts
import {
  DEFAULT_CAPTURE,
  DEFAULT_SETTINGS,
  TranscribeSession,
} from "@xoxo-labs/realtime-transcribe";

const session = new TranscribeSession({
  settings: { ...DEFAULT_SETTINGS, transport: "ws-preroll" },
  capture: DEFAULT_CAPTURE, // system-default microphone
  // Token acquisition is injected — the library never assumes where secrets
  // come from (an app endpoint, a cache, a test fixture).
  getSecret: async (settings) => {
    const response = await fetch("/api/realtime/transcription-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    const { value } = await response.json();
    return { value, source: "network" };
  },
  callbacks: {
    onUtterances: (utterances) => {
      // Reconciled by item_id: `delta` accumulates while streaming,
      // `transcript` is set when the item is finalised, `error` on failure.
      console.log(utterances);
    },
    onEnd: (result) => console.log("session over", result),
  },
});

await session.start();
// ...later: flush the tail and end (resolves as soon as the transcript is in)
session.stop();
```

A session is single-use: construct → `start()` → `stop()` → `onEnd` fires
once → the instance is dead. Construct a new one for the next run; rapid
start/stop cycling is safe because a superseded instance is simply disposed.

## Transports

| Transport | Audio path | When to choose it |
| --- | --- | --- |
| `ws-preroll` | WebSocket, client-side PCM16 capture, local pre-roll buffer flushed at `session.created` | **Default for dictation.** The user can speak the instant they press the button; nothing said during connection setup is lost. |
| `ws` | WebSocket, client-side PCM16 capture, no pre-roll | Baseline for measuring what setup time costs; audio before the session exists is dropped. |
| `webrtc` | `RTCPeerConnection` carries the media; events ride the `oai-events` data channel | Lowest ongoing latency; the browser's media stack owns capture, encoding and loss recovery. No pre-roll — audio only flows once the peer connects. |

## Model behaviour worth knowing

Verified against the live API (GA, 2026):

- **No turn detection.** `gpt-live-transcribe` emits no VAD events; a single
  item accumulates deltas until an explicit `input_audio_buffer.commit`. The
  session sends one automatically after 1.5 s of delta silence, and `stop()`
  flushes whatever remains.
- **Commits below 100 ms of buffered audio are rejected** with
  `input_audio_buffer_commit_empty`. The session accounts for appended audio
  and treats that error as benign when it races an empty buffer.
- **No word timestamps and no speaker labels** — the events carry text only.
- `languages` is a plural array (ISO 639-1 style, e.g. `["en", "ro"]`), and
  the accuracy/latency trade-off is the `delay` dial
  (`minimal | low | medium | high | xhigh`).
- **EU/data-residency endpoints accept the handshake but will not transcribe
  without an approved data-residency organisation** — the session connects,
  audio flows, and no deltas ever arrive. If you see exactly that on `eu`,
  switch the region back to `us`.

## License

MIT © xoxo labs
