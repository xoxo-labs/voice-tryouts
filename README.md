# voice-tryouts

Experiments with live voice APIs, as a pnpm + Turborepo monorepo.

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

Note: Next.js 16 has real breaking changes — see `AGENTS.md`, which points at
the docs vendored in `apps/web/node_modules/next/dist/docs/`.
