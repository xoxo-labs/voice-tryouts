# voice-tryouts

Experiments with live voice APIs. Each experiment is a self-contained route under
`/experiments`, instrumented so its latency can actually be measured rather than
guessed at.

## Experiments

### Live transcription over WebRTC

`/experiments/live-transcribe` — streams microphone audio to the OpenAI Realtime
API over a peer connection and times every stage of the handshake, so
time-to-first-word can be compared across settings.

Uses `gpt-live-transcribe` (GA, July 2026). The server mints a short-lived
client secret; the `sk-` key never reaches the browser.

The experiment page links to a **Behaviour** page documenting how the model
actually behaves — verified against the live API, not copied from the docs.
Read that before trusting anything here.

## Getting started

```bash
npm install
cp .env.example .env.local   # then add your OPENAI_API_KEY
npm run dev
```

The key is read at boot, so restart the dev server after editing `.env.local`.

Create a key at
[platform.openai.com](https://platform.openai.com/settings/organization/api-keys).
`gpt-live-transcribe` bills $0.017/min of audio, so the account needs credit —
with a zero balance the mint fails with a 429, which is easy to mistake for an
auth problem.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · shadcn/ui

Note that Next 16 has real breaking changes; `AGENTS.md` points at the copy of
the docs vendored in `node_modules/next/dist/docs/`. Two that bit us: folders
prefixed with `_` are excluded from routing, and `react-hooks/set-state-in-effect`
is now a lint error rather than a warning.
