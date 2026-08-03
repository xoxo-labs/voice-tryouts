---
"@xoxo-labs/realtime-transcribe": minor
---

First public release: transport-agnostic client for OpenAI Realtime
transcription sessions (`gpt-live-transcribe`).

- Framework-free core (`.`): single-use `TranscribeSession` over three
  transports — `webrtc`, `ws`, and `ws-preroll` (capture starts before the
  connection exists; the local backlog is flushed at `session.created` so
  nothing said during setup is lost). Injected token acquisition, idle-commit
  segmentation, client-side speech-onset detection, timing marks.
- React layer (`./react`): `useVoiceInput` for dictation into any controlled
  input (exactly-once `onText` per utterance, live `interim`, loss-free
  `stop()` flush) and `useLiveTranscribe`, the fully instrumented session
  hook.
