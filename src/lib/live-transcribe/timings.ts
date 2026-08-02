import type { RunMarks, RunRecord, TokenSource } from "./types";

export interface TimingStage {
  key: string;
  label: string;
  description: string;
  /** ms from `t0` (the `start()` call) at which this stage completed. */
  at: number | undefined;
  /** Duration of this stage, or gap since the previous stage. */
  delta: number | undefined;
  /** Whether `delta` is the stage's own duration vs. a gap since the previous. */
  deltaKind: "duration" | "since-previous";
  highlight?: boolean;
  /**
   * Set when this model can never emit the stage, so the UI can say "n/a"
   * instead of "—" (which would imply we are still waiting for it).
   */
  unavailable?: string;
  /**
   * Stage runs concurrently with its neighbours, so reading the `at` column
   * as a sequential waterfall would be wrong.
   */
  parallel?: boolean;
}

function diff(a: number | undefined, b: number | undefined) {
  return a == null || b == null ? undefined : a - b;
}

/**
 * The only honest "time to first word": from the moment the user actually
 * started speaking to the first transcript delta.
 *
 * Measuring from `start()` instead would fold in however long the person spent
 * reading the screen before opening their mouth — seconds of variance that
 * completely bury the few hundred milliseconds separating `delay: "minimal"`
 * from `delay: "high"`.
 *
 * If speech began before the session was ready, the clock starts at
 * `session.created`: audio spoken into a half-open session cannot be
 * transcribed any sooner than the session exists.
 */
export function timeToFirstWord(marks: RunMarks): number | undefined {
  if (marks.firstDelta == null || marks.speechOnset == null) return undefined;
  const from =
    marks.sessionCreated == null
      ? marks.speechOnset
      : Math.max(marks.speechOnset, marks.sessionCreated);
  return marks.firstDelta - from;
}

/**
 * Flatten raw marks into an ordered pipeline. `at` is always relative to `t0`;
 * `delta` is the stage's own duration where we measured start+end, otherwise
 * the gap since the previous stage completed.
 */
export function deriveStages(
  marks: RunMarks,
  tokenSource: TokenSource = "network",
): TimingStage[] {
  const fromCache = tokenSource === "cache";
  return [
    {
      key: "token",
      label: fromCache ? "Ephemeral token (cached)" : "Ephemeral token",
      description: fromCache
        ? "served from the pre-warmed cache — no network call"
        : "POST /api/realtime/transcription-token",
      at: marks.tokenEnd,
      delta: diff(marks.tokenEnd, marks.tokenStart),
      deltaKind: "duration",
      parallel: true,
    },
    {
      key: "mic",
      label: "Mic permission",
      description: "getUserMedia grant",
      at: marks.micEnd,
      delta: diff(marks.micEnd, marks.micStart),
      deltaKind: "duration",
      parallel: true,
    },
    {
      key: "offerReady",
      label: "SDP offer ready",
      description: "createOffer + setLocalDescription",
      at: marks.offerReady,
      delta: diff(marks.offerReady, marks.micEnd),
      deltaKind: "since-previous",
      parallel: true,
    },
    {
      key: "sdp",
      label: "SDP exchange",
      description: "POST /v1/realtime/calls",
      at: marks.sdpEnd,
      delta: diff(marks.sdpEnd, marks.sdpStart),
      deltaKind: "duration",
    },
    {
      key: "connected",
      label: "Peer connected",
      description: "pc.connectionState === 'connected' (ICE/DTLS)",
      at: marks.connected,
      delta: diff(marks.connected, marks.sdpEnd),
      deltaKind: "since-previous",
    },
    {
      key: "dcOpen",
      label: "Data channel open",
      description: "'oai-events' channel ready",
      at: marks.dcOpen,
      delta: diff(marks.dcOpen, marks.connected),
      deltaKind: "since-previous",
    },
    {
      key: "sessionCreated",
      label: "session.created",
      description: "First server event on the channel",
      at: marks.sessionCreated,
      delta: diff(marks.sessionCreated, marks.dcOpen),
      deltaKind: "since-previous",
    },
    {
      key: "firstSpeech",
      label: "First speech detected (server)",
      description: "input_audio_buffer.speech_started",
      at: undefined,
      delta: undefined,
      deltaKind: "since-previous",
      unavailable: "gpt-live-transcribe rejects turn_detection — no VAD events",
    },
    {
      key: "speechOnset",
      label: "Speech onset (local)",
      description: "mic level crossed the calibrated silence threshold",
      at: marks.speechOnset,
      delta: diff(marks.speechOnset, marks.sessionCreated),
      deltaKind: "since-previous",
    },
    {
      key: "firstDelta",
      label: "First transcript delta",
      description: "…transcription.delta — real time to first word",
      at: marks.firstDelta,
      delta: timeToFirstWord(marks),
      deltaKind: "since-previous",
      highlight: true,
    },
    {
      key: "firstCommit",
      label: "First commit sent",
      description: "input_audio_buffer.commit — client-side idle cutoff",
      at: marks.firstCommit,
      delta: diff(marks.firstCommit, marks.firstDelta),
      deltaKind: "since-previous",
    },
    {
      key: "firstCompleted",
      label: "First completed utterance",
      description: "…transcription.completed (only arrives after a commit)",
      at: marks.firstCompleted,
      delta: diff(marks.firstCompleted, marks.firstCommit),
      deltaKind: "since-previous",
    },
  ];
}

/**
 * The numbers worth comparing across runs, most meaningful first.
 *
 * Only the `primary` metric is safe to use when comparing `delay` settings.
 * The `contaminated` ones still include human reaction time and are kept for
 * continuity, but are labelled so nobody reads them as model latency.
 */
export const HEADLINE_METRICS = [
  {
    key: "ttfw",
    label: "Time to first word",
    hint: "speech onset → first delta",
    primary: true,
    contaminated: false,
    select: timeToFirstWord,
  },
  {
    key: "finalise",
    label: "Commit → completed",
    hint: "server finalisation latency",
    primary: false,
    contaminated: false,
    select: (m: RunMarks) => diff(m.firstCompleted, m.firstCommit),
  },
  {
    key: "ready",
    label: "Ready to stream",
    hint: "start() → session.created",
    primary: false,
    contaminated: false,
    select: (m: RunMarks) => m.sessionCreated,
  },
  {
    key: "connect",
    label: "Connection setup",
    hint: "start() → peer connected",
    primary: false,
    contaminated: false,
    select: (m: RunMarks) => m.connected,
  },
  {
    key: "startToDelta",
    label: "start() → first delta",
    hint: "includes how long you waited before speaking",
    primary: false,
    contaminated: true,
    select: (m: RunMarks) => m.firstDelta,
  },
  {
    key: "readyToDelta",
    label: "session.created → first delta",
    hint: "also includes reaction time",
    primary: false,
    contaminated: true,
    select: (m: RunMarks) => diff(m.firstDelta, m.sessionCreated),
  },
] as const;

export type HeadlineMetricKey = (typeof HEADLINE_METRICS)[number]["key"];

export interface MetricStats {
  count: number;
  min: number;
  p50: number;
  max: number;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function computeStats(
  runs: RunRecord[],
  select: (m: RunMarks) => number | undefined,
): MetricStats | null {
  const values = runs
    .map((run) => select(run.marks))
    .filter((value): value is number => typeof value === "number");

  if (values.length === 0) return null;

  return {
    count: values.length,
    min: Math.min(...values),
    p50: median(values),
    max: Math.max(...values),
  };
}

export function formatMs(value: number | undefined): string {
  if (value == null) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}
