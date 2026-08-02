import type {
  RunMarks,
  RunRecord,
  TokenSource,
  TransportKind,
} from "./types";

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
  // Onset detected AFTER the first delta means the detector mis-calibrated —
  // typically because the user was already talking during the calibration
  // window, which folds speech into the baseline and pushes the threshold
  // above speaking level. A negative TTFW is not a fast run, it is a broken
  // measurement: discard it rather than clamping to 0, which would fabricate
  // an impossibly good number and silently drag the p50 the other way.
  if (marks.speechOnset > marks.firstDelta) return undefined;
  const from =
    marks.sessionCreated == null
      ? marks.speechOnset
      : Math.max(marks.speechOnset, marks.sessionCreated);
  return marks.firstDelta - from;
}

/** Why a run has no usable TTFW, for honest display instead of a bare "—". */
export function ttfwInvalidReason(marks: RunMarks): string | null {
  if (marks.firstDelta == null) return null; // nothing transcribed yet
  if (marks.speechOnset == null)
    return "no speech onset detected — level analysis unavailable or mic silent";
  if (marks.speechOnset > marks.firstDelta)
    return "onset detected after the first delta — calibration captured speech, measurement discarded";
  return null;
}

/**
 * Flatten raw marks into an ordered pipeline. `at` is always relative to `t0`;
 * `delta` is the stage's own duration where we measured start+end, otherwise
 * the gap since the previous stage completed.
 */
export function deriveStages(
  marks: RunMarks,
  tokenSource: TokenSource = "network",
  transport: TransportKind = "webrtc",
): TimingStage[] {
  const fromCache = tokenSource === "cache";
  const isWs = transport !== "webrtc";

  const shared: TimingStage[] = [
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
  ];

  const transportStages: TimingStage[] = isWs
    ? [
        {
          key: "captureStart",
          label:
            transport === "ws-preroll"
              ? "Capture + buffering started"
              : "Capture started",
          description:
            transport === "ws-preroll"
              ? "AudioWorklet live — audio is being buffered before the session exists"
              : "AudioWorklet live — pre-session audio is discarded in plain ws mode",
          at: marks.captureStart,
          delta: diff(marks.captureStart, marks.micEnd),
          deltaKind: "since-previous",
          parallel: true,
        },
        {
          key: "wsOpen",
          label: "WebSocket open",
          description: "wss://…/v1/realtime — auth via subprotocol",
          at: marks.wsOpen,
          delta: diff(marks.wsOpen, marks.tokenEnd),
          deltaKind: "since-previous",
        },
        {
          key: "sessionCreated",
          label: "session.created",
          description: "First server event on the socket",
          at: marks.sessionCreated,
          delta: diff(marks.sessionCreated, marks.wsOpen),
          deltaKind: "since-previous",
        },
        ...(transport === "ws-preroll"
          ? [
              {
                key: "prerollFlushed",
                label: "Pre-roll flushed",
                description:
                  "entire local backlog appended — nothing said during setup was lost",
                at: marks.prerollFlushed,
                delta: diff(marks.prerollFlushed, marks.sessionCreated),
                deltaKind: "since-previous",
              } satisfies TimingStage,
            ]
          : []),
      ]
    : [
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
      ];

  return [
    ...shared,
    ...transportStages,
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
      description:
        ttfwInvalidReason(marks) ??
        "mic level crossed the calibrated silence threshold",
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

export interface HeadlineMetric {
  key: string;
  label: string;
  hint: string;
  primary: boolean;
  contaminated: boolean;
  select: (m: RunMarks) => number | undefined;
}

/**
 * The numbers worth comparing across runs, most meaningful first — and the
 * meaning depends on the transport.
 *
 * For ws-preroll the headline is PERCEIVED TTFW: button press → first delta.
 * That is exactly the number pre-roll exists to shrink, and because capture
 * starts at the press, speaking immediately makes it a fair measurement
 * rather than a reaction-time contaminated one. On the other transports the
 * same interval mostly measures how long the user waited for setup plus
 * their own reaction, so it stays demoted and flagged noisy.
 */
export function headlineMetrics(transport: TransportKind): HeadlineMetric[] {
  const preroll = transport === "ws-preroll";

  const perceived: HeadlineMetric = {
    key: "perceived",
    label: "Perceived TTFW",
    hint: "button press → first delta",
    primary: preroll,
    contaminated: !preroll,
    select: (m) => m.firstDelta,
  };
  const ttfw: HeadlineMetric = {
    key: "ttfw",
    label: "Time to first word",
    hint: "speech onset → first delta",
    primary: !preroll,
    contaminated: false,
    select: timeToFirstWord,
  };

  return [
    ...(preroll ? [perceived, ttfw] : [ttfw]),
    {
      key: "finalise",
      label: "Commit → completed",
      hint: "server finalisation latency",
      primary: false,
      contaminated: false,
      select: (m) => diff(m.firstCompleted, m.firstCommit),
    },
    {
      key: "ready",
      label: "Ready to stream",
      hint: "start() → session.created",
      primary: false,
      contaminated: false,
      select: (m) => m.sessionCreated,
    },
    transport === "webrtc"
      ? {
          key: "connect",
          label: "Connection setup",
          hint: "start() → peer connected",
          primary: false,
          contaminated: false,
          select: (m) => m.connected,
        }
      : {
          key: "connect",
          label: "Socket open",
          hint: "start() → WebSocket open",
          primary: false,
          contaminated: false,
          select: (m) => m.wsOpen,
        },
    ...(preroll
      ? [
          {
            key: "flushDelay",
            label: "Flush latency",
            hint: "session.created → backlog flushed",
            primary: false,
            contaminated: false,
            select: (m: RunMarks) => diff(m.prerollFlushed, m.sessionCreated),
          },
        ]
      : [perceived]),
    {
      key: "readyToDelta",
      label: "session.created → first delta",
      hint: preroll
        ? "includes chewing through the flushed backlog"
        : "also includes reaction time",
      primary: false,
      contaminated: !preroll,
      select: (m) => diff(m.firstDelta, m.sessionCreated),
    },
  ];
}

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

/**
 * The only run set it is honest to aggregate: successful runs whose settings
 * match the ones currently selected. Averaging a `delay: minimal` run with a
 * `delay: xhigh` one would erase the very difference this tool exists to
 * measure — and errored runs carry partial marks that skew everything.
 */
export function comparableRuns(
  runs: RunRecord[],
  currentKey: string,
  keyOf: (run: RunRecord) => string,
): RunRecord[] {
  return runs.filter((run) => run.error == null && keyOf(run) === currentKey);
}

export function formatMs(value: number | undefined): string {
  if (value == null) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}
