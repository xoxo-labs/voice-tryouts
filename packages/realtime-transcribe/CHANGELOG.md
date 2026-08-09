# @xoxo-labs/realtime-transcribe

## 0.2.0

### Minor Changes

- a9876ba: Default transport is now `ws-preroll` (was `webrtc`): capture starts before
  the connection exists and the local backlog is flushed at `session.created`,
  so nothing said during setup is lost. Pass `transport: "webrtc"` explicitly
  to keep the previous default.

  The package now links its live demo — [transcribe.xoxo-labs.com](https://transcribe.xoxo-labs.com)
  (`homepage` + a Live demo section in the README), with both hooks running
  against the real API.
