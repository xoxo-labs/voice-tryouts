# voice-tryouts

Experiments with live voice APIs, as a pnpm + Turborepo monorepo.

## Live demo

Deployed at **[transcribe.xoxo-labs.com](https://transcribe.xoxo-labs.com)**:

| Demo | What it shows |
| --- | --- |
| [live-transcribe](https://transcribe.xoxo-labs.com/experiments/live-transcribe) | `useLiveTranscribe` — the fully instrumented session: transports, timing marks, event log, run history. |
| [voice-prompt-input](https://transcribe.xoxo-labs.com/experiments/voice-prompt-input) | `useVoiceInput` — dictation into an AI Elements composer. |
| [behaviour](https://transcribe.xoxo-labs.com/experiments/live-transcribe/behaviour) | How `gpt-live-transcribe` behaves in practice: text lifecycle, events, expected latencies, troubleshooting. |

The client secrets are minted server-side, so the `OPENAI_API_KEY` never reaches
the browser. Sessions on the hosted demo are capped at 3 minutes and
rate-limited per IP to keep it affordable; running it locally has no such caps.

## Map

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js 16 app hosting the experiment pages (`/experiments/*`) and the token-minting API routes. |
| `packages/realtime-transcribe` | `@xoxo-labs/realtime-transcribe` — transport-agnostic client for OpenAI Realtime transcription (`gpt-live-transcribe`). `.` is the pure core (zero deps, no React); `./react` is the hooks layer (`useLiveTranscribe`, `useVoiceInput`). |
| `packages/typescript-config` | Shared base `tsconfig`. |
| `packages/eslint-config` | Shared ESLint flat configs (`/next` for the app, `/library` for packages). |

## Running

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # then add your OPENAI_API_KEY
pnpm dev                                       # turbo: builds the lib, starts next dev on :3000
```

Also from the root: `pnpm build`, `pnpm lint`, `pnpm check-types` (all via turbo).

The `OPENAI_API_KEY` is read at boot by `apps/web`; restart the dev server after
editing `.env.local`. See `apps/web/README.md` for the experiments themselves
and the model-behaviour notes.

### Editing the library while `pnpm dev` runs

`turbo dev` runs two persistent tasks side by side: `next dev` for the app and
`tsup --watch` for `packages/realtime-transcribe`. Saving a lib source file
rebuilds `dist/` in-place within a second or two (the watcher deliberately does
not clean `dist/` on startup, so the app never sees it missing). The app
resolves the package from `dist/`, not from `src/` — if a change does not seem
to arrive, check the tsup watcher output first, and reload the page; type
changes may additionally need the editor's TS server restarted.

Note: Next.js 16 has real breaking changes — see `AGENTS.md`, which points at
the docs vendored in `apps/web/node_modules/next/dist/docs/`.
