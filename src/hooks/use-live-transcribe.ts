"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  computeRms,
  createOnsetDetector,
  ONSET,
  type OnsetDetector,
} from "@/lib/live-transcribe/onset";
import { realtimeCallsUrl } from "@/lib/live-transcribe/regions";
import { REALTIME_DATA_CHANNEL } from "@/lib/live-transcribe/session-config";
import {
  isUsable,
  settingsKey,
  type CachedToken,
} from "@/lib/live-transcribe/token-cache";
import type {
  AudioStats,
  CaptureSettings,
  ConnectionStatus,
  LevelMeter,
  LiveTranscribeSettings,
  LoggedEvent,
  RunMarkKey,
  RunMarks,
  RunRecord,
  StartMode,
  TokenCacheState,
  TokenSource,
  Utterance,
} from "@/lib/live-transcribe/types";
import { DEFAULT_CAPTURE, DEFAULT_SETTINGS } from "@/lib/live-transcribe/types";

const TOKEN_ENDPOINT = "/api/realtime/transcription-token";

/** How recently a delta must have arrived for the activity light to be on. */
const ACTIVITY_WINDOW_MS = 900;
/** Delta silence after which we finalise the open item with a commit. */
const IDLE_COMMIT_MS = 1500;
/** How long `stop()` waits for the final `completed` after its commit. */
const FINAL_COMMIT_GRACE_MS = 1500;
/** Cadence of the activity/idle-commit checker. */
const TICK_MS = 250;
/** Poll `getStats()` every Nth tick. */
const STATS_EVERY_N_TICKS = 4;
/** Cap the event log so a long session cannot grow without bound. */
const MAX_LOGGED_EVENTS = 400;
const EMPTY_TOKEN_CACHE: TokenCacheState = {
  status: "empty",
  key: null,
  expiresAt: null,
  error: null,
};

/**
 * Every event type this session is known to emit, whether or not the app acts
 * on it. `committed` / `added` / `done` are normal commit bookkeeping — they
 * were flagged as anomalies until we confirmed empirically that they always
 * follow a commit, and marking routine traffic as suspicious only teaches you
 * to ignore the warning colour.
 */
const EXPECTED_EVENTS = new Set([
  "session.created",
  "session.updated",
  "conversation.item.input_audio_transcription.delta",
  "conversation.item.input_audio_transcription.completed",
  "conversation.item.input_audio_transcription.failed",
  "input_audio_buffer.committed",
  "conversation.item.added",
  "conversation.item.done",
  "error",
]);

/** Loose shape for the JSON events arriving on the `oai-events` data channel. */
interface RealtimeServerEvent {
  type?: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string; code?: string };
}

export interface UseLiveTranscribeResult {
  status: ConnectionStatus;
  isActive: boolean;
  error: string | null;
  /** Utterances in first-seen order, reconciled by `item_id`. */
  utterances: Utterance[];
  /**
   * True while transcript deltas are actively arriving. This model emits no
   * VAD events, so it is derived from delta arrival rather than from
   * `input_audio_buffer.speech_started`.
   */
  isTranscribing: boolean;
  marks: RunMarks;
  /** Every event seen on the data channel, chronological, handled or not. */
  events: LoggedEvent[];
  /** Outbound RTP counters — proves whether audio is actually leaving. */
  audioStats: AudioStats | null;
  /** Local mic level, its calibrated silence baseline, and the onset threshold. */
  levelMeter: LevelMeter | null;
  /** Newest run first. */
  runs: RunRecord[];
  /** State of the pre-warmed ephemeral secret. */
  tokenCache: TokenCacheState;
  /** Where the current/last run's secret came from. */
  tokenSource: TokenSource;
  start: (
    settings: LiveTranscribeSettings,
    capture: CaptureSettings,
    mode?: StartMode,
  ) => Promise<void>;
  stop: () => void;
  clearRuns: () => void;
  /** Mint a secret ahead of Start. No-op if a valid one is already cached. */
  prewarm: (settings: LiveTranscribeSettings) => void;
}

/**
 * Drives one OpenAI Realtime transcription session over WebRTC and instruments
 * every stage of the handshake with `performance.now()` marks.
 *
 * Connection shape (GA API):
 *   browser -> POST /api/realtime/transcription-token   (server mints `ek_...`)
 *   browser -> POST https://api.openai.com/v1/realtime/calls
 *              Authorization: Bearer ek_...
 *              Content-Type: application/sdp
 *   events   <- RTCDataChannel named exactly "oai-events"
 *
 * Turn handling, verified against the live API over WebRTC with a synthetic
 * speech track:
 *  - `gpt-live-transcribe` rejects `turn_detection`, so there are no VAD
 *    events and the server never finalises an item on its own.
 *  - Deltas nonetheless stream continuously as audio arrives — no client event
 *    of any kind is needed to start them.
 *  - `input_audio_buffer.commit` IS honoured on WebRTC and is the only way to
 *    get `conversation.item.input_audio_transcription.completed`. We therefore
 *    run a client-side idle cutoff: once deltas stop for IDLE_COMMIT_MS we
 *    commit, which finalises the open item and lets the next audio open a new
 *    one.
 */
export function useLiveTranscribe(): UseLiveTranscribeResult {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [marks, setMarks] = useState<RunMarks>({});
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [events, setEvents] = useState<LoggedEvent[]>([]);
  const [audioStats, setAudioStats] = useState<AudioStats | null>(null);
  const [levelMeter, setLevelMeter] = useState<LevelMeter | null>(null);
  const [tokenCache, setTokenCache] =
    useState<TokenCacheState>(EMPTY_TOKEN_CACHE);
  // Mirrored as state because the timings table renders from it; the ref keeps
  // a closure-free copy for archiving the run record.
  const [tokenSource, setTokenSource] = useState<TokenSource>("network");

  const cacheRef = useRef<CachedToken | null>(null);
  const prewarmAbortRef = useRef<AbortController | null>(null);
  const prewarmKeyRef = useRef<string | null>(null);
  const startModeRef = useRef<StartMode>("cold");
  const tokenSourceRef = useRef<TokenSource>("network");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Local level analysis, used only for speech-onset detection. */
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const onsetTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const detectorRef = useRef<OnsetDetector | null>(null);

  /** Bumped on every start/stop/unmount so stale async work can bail out. */
  const runIdRef = useRef(0);
  const activeRef = useRef(false);
  const t0Ref = useRef<number | null>(null);
  const marksRef = useRef<RunMarks>({});
  const settingsRef = useRef<LiveTranscribeSettings>(DEFAULT_SETTINGS);
  const captureRef = useRef<CaptureSettings>(DEFAULT_CAPTURE);
  const utterancesRef = useRef<Utterance[]>([]);
  const runCountRef = useRef(0);
  const eventSeqRef = useRef(0);
  /** `performance.now()` of the last delta, or null if nothing is pending. */
  const lastDeltaAtRef = useRef<number | null>(null);

  useEffect(() => {
    utterancesRef.current = utterances;
  }, [utterances]);

  const elapsed = useCallback(() => {
    const t0 = t0Ref.current;
    return t0 == null ? 0 : performance.now() - t0;
  }, []);

  /** Record a milestone. First write wins, so repeat events are ignored. */
  const mark = useCallback((key: RunMarkKey) => {
    if (t0Ref.current == null) return;
    if (marksRef.current[key] != null) return;
    marksRef.current = {
      ...marksRef.current,
      [key]: performance.now() - t0Ref.current,
    };
    setMarks(marksRef.current);
  }, []);

  /** Append to the raw event log, including client-side pseudo-events. */
  const logEvent = useCallback(
    (type: string, payload: unknown, expected: boolean) => {
      const entry: LoggedEvent = {
        id: ++eventSeqRef.current,
        at: elapsed(),
        type,
        expected,
        payload:
          typeof payload === "string"
            ? payload
            : JSON.stringify(payload, null, 2),
      };
      setEvents((prev) => {
        const next = prev.length >= MAX_LOGGED_EVENTS ? prev.slice(1) : prev;
        return [...next, entry];
      });
    },
    [elapsed],
  );

  /**
   * Finalise the currently open item. Returns false if the channel is gone.
   * Clearing `lastDeltaAtRef` is what prevents repeat commits on empty buffers.
   */
  const sendCommit = useCallback(() => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return false;
    try {
      dc.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    } catch {
      return false;
    }
    lastDeltaAtRef.current = null;
    mark("firstCommit");
    logEvent("→ input_audio_buffer.commit", { sentByClient: true }, true);
    return true;
  }, [logEvent, mark]);

  /** Mint a fresh client secret and cache it against its settings key. */
  const mintToken = useCallback(
    async (
      settings: LiveTranscribeSettings,
      signal?: AbortSignal,
    ): Promise<CachedToken> => {
      const key = settingsKey(settings);
      setTokenCache((prev) => ({ ...prev, status: "minting", error: null }));

      const response = await fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
        signal,
      });
      const payload: unknown = await response.json().catch(() => null);

      const reject = (message: string) => {
        setTokenCache({
          status: "error",
          key: null,
          expiresAt: null,
          error: message,
        });
        return new Error(message);
      };

      if (!response.ok) {
        throw reject(
          (payload as { error?: string } | null)?.error ??
            `Token request failed with ${response.status}.`,
        );
      }

      const value = (payload as { value?: unknown } | null)?.value;
      if (typeof value !== "string") {
        throw reject("The token endpoint did not return a client secret.");
      }

      const rawExpiry = (payload as { expires_at?: unknown } | null)?.expires_at;
      const token: CachedToken = {
        value,
        expiresAt:
          typeof rawExpiry === "number"
            ? rawExpiry
            : Math.floor(Date.now() / 1000) + 600,
        key,
      };

      cacheRef.current = token;
      setTokenCache({
        status: "ready",
        key,
        expiresAt: token.expiresAt,
        error: null,
      });
      return token;
    },
    [],
  );

  /**
   * Mint ahead of time so Start does not pay for it. Safe to call on every
   * settings change — a cached secret for different settings is useless, since
   * the session config is baked into the secret itself.
   */
  const prewarm = useCallback(
    (settings: LiveTranscribeSettings) => {
      const key = settingsKey(settings);

      if (cacheRef.current && cacheRef.current.key !== key) {
        cacheRef.current = null;
        setTokenCache(EMPTY_TOKEN_CACHE);
      }
      if (isUsable(cacheRef.current, key)) return;
      if (prewarmKeyRef.current === key) return;

      prewarmAbortRef.current?.abort();
      const controller = new AbortController();
      prewarmAbortRef.current = controller;
      prewarmKeyRef.current = key;

      void mintToken(settings, controller.signal)
        .catch(() => {
          // Pre-warming is best-effort; start() retries and surfaces errors.
        })
        .finally(() => {
          if (prewarmKeyRef.current === key) prewarmKeyRef.current = null;
        });
    },
    [mintToken],
  );

  /**
   * Resolve a usable secret, from cache when warm and still valid.
   *
   * The token source is recorded HERE, at the moment the decision is made —
   * not after the surrounding Promise.allSettled, which also waits on
   * getUserMedia (seconds, on a first permission prompt). Setting it late
   * showed "network · 0 ms" for cache hits in the interim, and a warm run
   * failing before allSettled archived the wrong source permanently.
   */
  const acquireToken = useCallback(
    async (
      settings: LiveTranscribeSettings,
      mode: StartMode,
      signal: AbortSignal,
    ): Promise<{ value: string; source: TokenSource }> => {
      const key = settingsKey(settings);
      mark("tokenStart");

      const cached = cacheRef.current;
      if (mode === "warm" && isUsable(cached, key)) {
        mark("tokenEnd");
        tokenSourceRef.current = "cache";
        setTokenSource("cache");
        return { value: cached.value, source: "cache" };
      }

      tokenSourceRef.current = "network";
      setTokenSource("network");
      const token = await mintToken(settings, signal);
      mark("tokenEnd");
      return { value: token.value, source: "network" };
    },
    [mark, mintToken],
  );

  /** Tear down every transport resource. Safe to call repeatedly. */
  const teardown = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = null;
    if (onsetTimerRef.current) clearInterval(onsetTimerRef.current);
    onsetTimerRef.current = null;
    lastDeltaAtRef.current = null;
    detectorRef.current = null;
    analyserRef.current = null;

    const audioCtx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (audioCtx) {
      void audioCtx.close().catch(() => {
        // already closed
      });
    }

    abortRef.current?.abort();
    abortRef.current = null;

    const dc = dcRef.current;
    dcRef.current = null;
    if (dc) {
      dc.onopen = null;
      dc.onmessage = null;
      dc.onerror = null;
      dc.onclose = null;
      try {
        dc.close();
      } catch {
        // already closed
      }
    }

    const pc = pcRef.current;
    pcRef.current = null;
    if (pc) {
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.ondatachannel = null;
      pc.ontrack = null;
      for (const sender of pc.getSenders()) {
        try {
          sender.track?.stop();
        } catch {
          // track already ended
        }
      }
      try {
        pc.close();
      } catch {
        // already closed
      }
    }

    const stream = streamRef.current;
    streamRef.current = null;
    for (const track of stream?.getTracks() ?? []) {
      try {
        track.stop();
      } catch {
        // track already ended
      }
    }
  }, []);

  /**
   * Close the active run, archive its timings, and reset transport state.
   *
   * `skipPrewarm` is passed when a new start is already in flight ("Run again"
   * during an active session): that start mints its own token, and a prewarm
   * kicked off here would race it — a redundant double mint plus a flickering
   * cache badge.
   */
  const endRun = useCallback(
    (errorMessage: string | null, opts?: { skipPrewarm?: boolean }) => {
      if (!activeRef.current) return;
      activeRef.current = false;
      runIdRef.current += 1;
      teardown();

      if (t0Ref.current != null) {
        runCountRef.current += 1;
        const record: RunRecord = {
          id: `run-${Date.now()}-${runCountRef.current}`,
          index: runCountRef.current,
          startedAt: Date.now(),
          settings: settingsRef.current,
          capture: captureRef.current,
          marks: marksRef.current,
          startMode: startModeRef.current,
          tokenSource: tokenSourceRef.current,
          utteranceCount: utterancesRef.current.length,
          error: errorMessage,
        };
        setRuns((prev) => [record, ...prev]);
      }

      // Re-mint straight away so the next warm run still starts hot.
      if (startModeRef.current === "warm" && !opts?.skipPrewarm) {
        prewarm(settingsRef.current);
      }

      setIsTranscribing(false);
      if (errorMessage) {
        setError(errorMessage);
        setStatus("error");
      } else {
        setStatus("idle");
      }
    },
    [prewarm, teardown],
  );

  const upsertUtterance = useCallback(
    (itemId: string, update: (current: Utterance) => Utterance) => {
      const seenAt = elapsed();
      setUtterances((prev) => {
        const index = prev.findIndex((item) => item.itemId === itemId);
        if (index === -1) {
          const seeded: Utterance = {
            itemId,
            delta: "",
            transcript: null,
            error: null,
            firstSeenAt: seenAt,
            completedAt: null,
          };
          return [...prev, update(seeded)];
        }
        const next = prev.slice();
        next[index] = update(next[index]);
        return next;
      });
    },
    [elapsed],
  );

  const handleServerEvent = useCallback(
    (raw: unknown) => {
      if (typeof raw !== "string") return;

      let event: RealtimeServerEvent;
      try {
        event = JSON.parse(raw) as RealtimeServerEvent;
      } catch {
        logEvent("<unparseable>", String(raw).slice(0, 500), false);
        return;
      }

      const type = event.type ?? "<no type>";
      logEvent(type, event, EXPECTED_EVENTS.has(type));

      switch (event.type) {
        case "session.created":
          mark("sessionCreated");
          break;

        case "conversation.item.input_audio_transcription.delta":
          mark("firstDelta");
          lastDeltaAtRef.current = performance.now();
          setIsTranscribing(true);
          if (event.item_id && typeof event.delta === "string") {
            const chunk = event.delta;
            upsertUtterance(event.item_id, (current) => ({
              ...current,
              delta: current.delta + chunk,
            }));
          }
          break;

        case "conversation.item.input_audio_transcription.completed": {
          mark("firstCompleted");
          if (!event.item_id) break;
          const finalText = event.transcript;
          const completedAt = elapsed();
          upsertUtterance(event.item_id, (current) => ({
            ...current,
            transcript:
              typeof finalText === "string" ? finalText : current.delta,
            completedAt,
          }));
          break;
        }

        case "conversation.item.input_audio_transcription.failed": {
          if (!event.item_id) break;
          const message = event.error?.message ?? "Transcription failed.";
          upsertUtterance(event.item_id, (current) => ({
            ...current,
            error: message,
          }));
          break;
        }

        case "error":
          setError(
            event.error?.message ?? "The Realtime API reported an error.",
          );
          break;

        default:
          // Logged above; nothing else to do.
          break;
      }
    },
    [elapsed, logEvent, mark, upsertUtterance],
  );

  /** Read outbound audio counters so a silent mic is visible, not guessed. */
  const pollAudioStats = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;
    const runId = runIdRef.current;

    let report: RTCStatsReport;
    try {
      report = await pc.getStats();
    } catch {
      return;
    }

    // getStats resolved after the run ended (or a new one started): these
    // counters belong to a dead peer connection — do not display them.
    if (runIdRef.current !== runId || pcRef.current !== pc) return;

    let next: AudioStats = {
      packetsSent: 0,
      bytesSent: 0,
      audioLevel: null,
      totalAudioEnergy: null,
    };

    report.forEach((entry) => {
      const stat = entry as unknown as {
        type?: string;
        kind?: string;
        packetsSent?: number;
        bytesSent?: number;
        audioLevel?: number;
        totalAudioEnergy?: number;
      };
      if (stat.type === "outbound-rtp" && stat.kind === "audio") {
        next = {
          ...next,
          packetsSent: stat.packetsSent ?? 0,
          bytesSent: stat.bytesSent ?? 0,
        };
      }
      if (stat.type === "media-source") {
        next = {
          ...next,
          audioLevel: stat.audioLevel ?? null,
          totalAudioEnergy: stat.totalAudioEnergy ?? null,
        };
      }
    });

    setAudioStats(next);
  }, []);

  const stop = useCallback(() => {
    if (!activeRef.current) return;

    // Flush whatever is still buffered so the last utterance finalises, then
    // give the server a brief window to deliver its `completed` event.
    if (stopTimerRef.current == null && lastDeltaAtRef.current != null) {
      if (sendCommit()) {
        setStatus("stopping");
        stopTimerRef.current = setTimeout(
          () => endRun(null),
          FINAL_COMMIT_GRACE_MS,
        );
        return;
      }
    }

    endRun(null);
  }, [endRun, sendCommit]);

  const start = useCallback(
    async (
      settings: LiveTranscribeSettings,
      capture: CaptureSettings,
      mode: StartMode = "cold",
    ) => {
      // Fast start/stop toggling must never leave an orphaned peer connection.
      if (activeRef.current) endRun(null, { skipPrewarm: true });

      const runId = ++runIdRef.current;
      const isStale = () => runIdRef.current !== runId;

      activeRef.current = true;
      settingsRef.current = settings;
      captureRef.current = capture;
      startModeRef.current = mode;
      tokenSourceRef.current = "network";
      setTokenSource("network");
      t0Ref.current = performance.now();
      marksRef.current = {};
      lastDeltaAtRef.current = null;
      eventSeqRef.current = 0;
      setMarks({});
      setUtterances([]);
      setEvents([]);
      setAudioStats(null);
      setLevelMeter(null);
      setError(null);
      setIsTranscribing(false);

      const abort = new AbortController();
      abortRef.current = abort;

      const fail = (message: string) => {
        if (isStale()) return;
        endRun(message);
      };

      try {
        // Token minting and media capture are independent — the SDP offer
        // needs no secret, only the POST does. Running them concurrently
        // removes the shorter of the two from the critical path entirely.
        setStatus("preparing");

        const tokenPromise = acquireToken(settings, mode, abort.signal);

        const capturePromise = (async () => {
        // Microphone permission, on the requested device.
        mark("micStart");
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "This browser does not expose getUserMedia. A secure context (https or localhost) is required.",
          );
        }

        let stream: MediaStream;
        let fellBackToDefault = false;
        try {
          stream = await navigator.mediaDevices.getUserMedia(
            capture.deviceId
              ? { audio: { deviceId: { exact: capture.deviceId } } }
              : { audio: true },
          );
        } catch (cause) {
          const name = (cause as { name?: string } | null)?.name;
          const deviceGone =
            name === "OverconstrainedError" || name === "NotFoundError";
          if (!capture.deviceId || !deviceGone) throw cause;
          // The chosen mic was unplugged between enumeration and start.
          fellBackToDefault = true;
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }

        if (isStale()) {
          for (const track of stream.getTracks()) track.stop();
          throw new Error("stale");
        }
        streamRef.current = stream;
        mark("micEnd");

        const audioTrack = stream.getAudioTracks()[0];
        if (!audioTrack) {
          throw new Error("No audio track was produced by getUserMedia.");
        }

        // Local level analysis for speech-onset detection. `getStats()` also
        // reports an audio level, but only about once a second — far too
        // coarse for a measurement whose whole point is resolving a few
        // hundred milliseconds. An AnalyserNode samples as fast as we ask.
        try {
          const audioCtx = new AudioContext();
          audioCtxRef.current = audioCtx;
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 1024;
          // Deliberately not connected to the destination: monitoring the mic
          // through the speakers would cause feedback.
          source.connect(analyser);
          analyserRef.current = analyser;

          const detector = createOnsetDetector(performance.now());
          detectorRef.current = detector;
          const buffer = new Float32Array(analyser.fftSize);

          onsetTimerRef.current = setInterval(() => {
            const node = analyserRef.current;
            if (!node || isStale()) return;
            node.getFloatTimeDomainData(buffer);
            const rms = computeRms(buffer);
            const now = performance.now();
            const onsetAt = detector.push(rms, now);
            if (onsetAt != null && t0Ref.current != null) {
              marksRef.current = {
                ...marksRef.current,
                speechOnset: onsetAt - t0Ref.current,
              };
              setMarks(marksRef.current);
              logEvent(
                "→ speech onset detected",
                {
                  rms,
                  baseline: detector.baseline,
                  threshold: detector.threshold,
                },
                true,
              );
            }
            setLevelMeter({
              rms,
              baseline: detector.baseline,
              threshold: detector.threshold,
              onsetDetected: detector.onsetAt != null,
            });
          }, ONSET.sampleMs);
        } catch {
          // Web Audio unavailable — the run still works, but time-to-first-word
          // will be unmeasurable for it.
          logEvent("→ level analysis unavailable", {}, false);
        }

        // Record what we actually captured on — the track label is the real
        // device name, which beats a pre-permission placeholder.
        captureRef.current = {
          deviceId: fellBackToDefault ? null : capture.deviceId,
          deviceLabel: fellBackToDefault
            ? `${capture.deviceLabel} (unavailable → default)`
            : audioTrack.label || capture.deviceLabel,
        };
        logEvent(
          "→ microphone acquired",
          {
            label: captureRef.current.deviceLabel,
            settings: audioTrack.getSettings(),
          },
          true,
        );

        // Peer connection + the `oai-events` data channel.
        //
        // `iceCandidatePoolSize` was measured and deliberately left off: with
        // no STUN/TURN servers only host candidates exist and they gather
        // instantly, so pre-gathering has nothing to do. Over 4 runs each,
        // pool=1 gave a 612 ms ICE/DTLS median against 603 ms for pool=0 —
        // no gain, so the option is not worth carrying.
        const pc = new RTCPeerConnection();
        pcRef.current = pc;
        pc.addTrack(audioTrack, stream);

        const dc = pc.createDataChannel(REALTIME_DATA_CHANNEL);
        dcRef.current = dc;
        dc.onopen = () => {
          if (isStale()) return;
          mark("dcOpen");
          logEvent("→ data channel open", { label: REALTIME_DATA_CHANNEL }, true);

          // Activity light, idle commit, and outbound audio counters.
          if (tickRef.current) clearInterval(tickRef.current);
          let ticks = 0;
          tickRef.current = setInterval(() => {
            const last = lastDeltaAtRef.current;
            const idleFor = last == null ? null : performance.now() - last;
            const active = idleFor != null && idleFor < ACTIVITY_WINDOW_MS;
            setIsTranscribing((prev) => (prev === active ? prev : active));
            if (idleFor != null && idleFor >= IDLE_COMMIT_MS) sendCommit();
            if (ticks++ % STATS_EVERY_N_TICKS === 0) void pollAudioStats();
          }, TICK_MS);
        };
        dc.onmessage = (messageEvent: MessageEvent) => {
          if (isStale()) return;
          handleServerEvent(messageEvent.data);
        };
        dc.onerror = () => {
          if (isStale()) return;
          logEvent("→ data channel error", {}, false);
        };

        pc.onconnectionstatechange = () => {
          if (isStale()) return;
          logEvent(`→ pc.connectionState = ${pc.connectionState}`, {}, true);
          if (pc.connectionState === "connected") {
            mark("connected");
            setStatus("connected");
          } else if (pc.connectionState === "failed") {
            fail("The WebRTC peer connection failed.");
          }
        };

        const offer = await pc.createOffer();
        if (isStale()) throw new Error("stale");
        await pc.setLocalDescription(offer);
        if (isStale()) throw new Error("stale");

        const localSdp = pc.localDescription?.sdp ?? offer.sdp;
        if (!localSdp) {
          throw new Error("Could not generate a local SDP offer.");
        }
        mark("offerReady");
        return { pc, localSdp };
        })();

        // `allSettled`, never `race`: if the token rejects first we still have
        // to wait for capture to finish so its microphone can be released.
        // Racing here would leave the mic light on with nothing owning it.
        const [tokenOutcome, captureOutcome] = await Promise.allSettled([
          tokenPromise,
          capturePromise,
        ]);

        if (isStale()) return;

        if (tokenOutcome.status === "rejected") throw tokenOutcome.reason;
        if (captureOutcome.status === "rejected") throw captureOutcome.reason;

        // Token source was already recorded inside acquireToken, at the
        // moment the cache-vs-network decision was made.
        const { value: ephemeralKey } = tokenOutcome.value;
        const { localSdp } = captureOutcome.value;

        // SDP exchange. The ephemeral key authenticates this request directly
        // from the browser — no query parameters on this URL.
        setStatus("connecting");
        mark("sdpStart");
        // Same region the secret was minted for — see regions.ts.
        const sdpResponse = await fetch(realtimeCallsUrl(settings.region), {
          method: "POST",
          body: localSdp,
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
          signal: abort.signal,
        });
        const answerSdp = await sdpResponse.text();
        if (isStale()) return;

        if (!sdpResponse.ok) {
          fail(
            `SDP exchange failed (${sdpResponse.status}): ${answerSdp.slice(0, 200)}`,
          );
          return;
        }
        mark("sdpEnd");

        await captureOutcome.value.pc.setRemoteDescription({
          type: "answer",
          sdp: answerSdp,
        });
        if (isStale()) return;
      } catch (cause) {
        if (isStale()) return;
        if (abort.signal.aborted) return;
        if (cause instanceof Error && cause.message === "stale") return;
        const name = (cause as { name?: string } | null)?.name;
        if (name === "NotAllowedError" || name === "SecurityError") {
          fail("Microphone permission was denied.");
          return;
        }
        if (name === "NotFoundError") {
          fail("No microphone was found.");
          return;
        }
        fail(
          cause instanceof Error
            ? cause.message
            : "Unexpected error while connecting.",
        );
      }
    },
    [
      acquireToken,
      endRun,
      handleServerEvent,
      logEvent,
      mark,
      pollAudioStats,
      sendCommit,
    ],
  );

  const clearRuns = useCallback(() => setRuns([]), []);

  // Unmount: invalidate in-flight work and release mic/transport. No setState
  // here — the component is already gone.
  useEffect(() => {
    return () => {
      runIdRef.current += 1;
      activeRef.current = false;
      prewarmAbortRef.current?.abort();
      prewarmAbortRef.current = null;
      teardown();
    };
  }, [teardown]);

  return {
    status,
    isActive: status !== "idle" && status !== "error",
    error,
    utterances,
    isTranscribing,
    marks,
    events,
    audioStats,
    levelMeter,
    runs,
    tokenCache,
    tokenSource,
    prewarm,
    start,
    stop,
    clearRuns,
  };
}
