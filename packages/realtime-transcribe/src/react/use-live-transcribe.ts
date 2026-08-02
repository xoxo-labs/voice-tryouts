import { useCallback, useEffect, useRef, useState } from "react";

import {
  DEFAULT_CAPTURE,
  DEFAULT_SETTINGS,
  isUsable,
  settingsKey,
  TranscribeSession,
  type AudioStats,
  type CachedToken,
  type CaptureSettings,
  type ConnectionStatus,
  type LevelMeter,
  type LiveTranscribeSettings,
  type LoggedEvent,
  type RunMarks,
  type RunRecord,
  type StartMode,
  type TokenCacheState,
  type TokenSource,
  type Utterance,
} from "../index";

/**
 * Where tokens are minted when the consumer does not say otherwise. A
 * published library cannot hardcode an app route, so this is only a default —
 * override it via `UseLiveTranscribeOptions.tokenEndpoint`.
 */
export const DEFAULT_TOKEN_ENDPOINT = "/api/realtime/transcription-token";

/** Cap the event log so a long session cannot grow without bound. */
const MAX_LOGGED_EVENTS = 400;

const EMPTY_TOKEN_CACHE: TokenCacheState = {
  status: "empty",
  key: null,
  expiresAt: null,
  error: null,
};

export interface UseLiveTranscribeOptions {
  /**
   * POST endpoint that mints a Realtime client secret. It receives the
   * `LiveTranscribeSettings` as JSON and must respond with the OpenAI
   * client-secret payload (`{ value, expires_at }`).
   * Defaults to {@link DEFAULT_TOKEN_ENDPOINT}.
   */
  tokenEndpoint?: string;
}

export interface UseLiveTranscribeResult {
  status: ConnectionStatus;
  isActive: boolean;
  error: string | null;
  utterances: Utterance[];
  isTranscribing: boolean;
  marks: RunMarks;
  events: LoggedEvent[];
  audioStats: AudioStats | null;
  levelMeter: LevelMeter | null;
  runs: RunRecord[];
  tokenCache: TokenCacheState;
  tokenSource: TokenSource;
  start: (
    settings: LiveTranscribeSettings,
    capture: CaptureSettings,
    mode?: StartMode,
  ) => Promise<void>;
  stop: () => void;
  clearRuns: () => void;
  prewarm: (settings: LiveTranscribeSettings) => void;
}

/**
 * Thin React wrapper around the framework-free core
 * (`@xoxo-labs/realtime-transcribe`). All session mechanics — transports,
 * capture, pre-roll, event semantics, timing marks — live in the core; this
 * hook only (a) mirrors callbacks into React state, (b) owns the app-side
 * token endpoint plus the pre-warm cache, and (c) archives run records.
 */
export function useLiveTranscribe(
  options?: UseLiveTranscribeOptions,
): UseLiveTranscribeResult {
  const tokenEndpoint = options?.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT;
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
  const [tokenSource, setTokenSource] = useState<TokenSource>("network");

  const sessionRef = useRef<TranscribeSession | null>(null);
  const cacheRef = useRef<CachedToken | null>(null);
  const prewarmAbortRef = useRef<AbortController | null>(null);
  const prewarmKeyRef = useRef<string | null>(null);
  const runCountRef = useRef(0);
  const runMetaRef = useRef<{
    settings: LiveTranscribeSettings;
    startMode: StartMode;
  }>({ settings: DEFAULT_SETTINGS, startMode: "cold" });

  // ------------------------------------------------------------- token

  const mintToken = useCallback(
    async (
      settings: LiveTranscribeSettings,
      signal?: AbortSignal,
    ): Promise<CachedToken> => {
      const key = settingsKey(settings);
      setTokenCache((prev) => ({ ...prev, status: "minting", error: null }));

      const response = await fetch(tokenEndpoint, {
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

      const rawExpiry = (payload as { expires_at?: unknown } | null)
        ?.expires_at;
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
    [tokenEndpoint],
  );

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
          // Best-effort; start() retries and surfaces errors.
        })
        .finally(() => {
          if (prewarmKeyRef.current === key) prewarmKeyRef.current = null;
        });
    },
    [mintToken],
  );

  /** Injected into the core session: cache when warm, mint otherwise. */
  const acquireToken = useCallback(
    async (
      settings: LiveTranscribeSettings,
      mode: StartMode,
    ): Promise<{ value: string; source: TokenSource }> => {
      const key = settingsKey(settings);
      const cached = cacheRef.current;
      if (mode === "warm" && isUsable(cached, key)) {
        return { value: cached.value, source: "cache" };
      }
      const token = await mintToken(settings);
      return { value: token.value, source: "network" };
    },
    [mintToken],
  );

  // ---------------------------------------------------------- lifecycle

  const start = useCallback(
    async (
      settings: LiveTranscribeSettings,
      capture: CaptureSettings,
      mode: StartMode = "cold",
    ) => {
      // Rapid start/stop must never leak a session: the previous instance is
      // disposed silently (no run record — it was superseded, not finished).
      sessionRef.current?.dispose();
      sessionRef.current = null;

      runMetaRef.current = { settings, startMode: mode };
      setMarks({});
      setUtterances([]);
      setEvents([]);
      setAudioStats(null);
      setLevelMeter(null);
      setError(null);
      setIsTranscribing(false);
      setTokenSource("network");

      const session = new TranscribeSession({
        settings,
        capture,
        getSecret: (s) => acquireToken(s, mode),
        callbacks: {
          onStatus: setStatus,
          onMarks: setMarks,
          onUtterances: setUtterances,
          onLevel: setLevelMeter,
          onAudioStats: setAudioStats,
          onTranscribing: setIsTranscribing,
          onTokenSource: setTokenSource,
          onEvent: (entry) => {
            setEvents((prev) => {
              const next =
                prev.length >= MAX_LOGGED_EVENTS ? prev.slice(1) : prev;
              return [...next, entry];
            });
          },
          onEnd: (result) => {
            if (sessionRef.current === session) sessionRef.current = null;

            runCountRef.current += 1;
            const record: RunRecord = {
              id: `run-${Date.now()}-${runCountRef.current}`,
              index: runCountRef.current,
              startedAt: Date.now(),
              settings: runMetaRef.current.settings,
              capture: result.capture,
              marks: result.marks,
              startMode: runMetaRef.current.startMode,
              tokenSource: result.tokenSource,
              utteranceCount: result.utteranceCount,
              prerollMs: result.prerollMs,
              error: result.error,
            };
            setRuns((prev) => [record, ...prev]);

            if (result.error) {
              setError(result.error);
              setStatus("error");
            } else {
              setStatus("idle");
            }

            // Keep the next warm run hot. (Superseded sessions are disposed,
            // not ended, so this never races a new start's own mint.)
            if (runMetaRef.current.startMode === "warm") {
              prewarm(runMetaRef.current.settings);
            }
          },
        },
      });

      sessionRef.current = session;
      await session.start();
    },
    [acquireToken, prewarm],
  );

  const stop = useCallback(() => {
    sessionRef.current?.stop();
  }, []);

  const clearRuns = useCallback(() => setRuns([]), []);

  useEffect(() => {
    return () => {
      prewarmAbortRef.current?.abort();
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, []);

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

export { DEFAULT_CAPTURE };
