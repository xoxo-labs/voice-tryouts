import { useCallback, useEffect, useRef, useState } from "react";

import {
  DEFAULT_CAPTURE,
  DEFAULT_SETTINGS,
  TranscribeSession,
  type LiveTranscribeSettings,
  type TransportKind,
  type Utterance,
} from "../index";

import { DEFAULT_TOKEN_ENDPOINT } from "./use-live-transcribe";

export interface UseVoiceInputOptions {
  /**
   * Fires once per completed utterance with its final transcript. The caller
   * appends this to whatever value it controls (a textarea, a form field).
   */
  onText: (final: string) => void;
  /**
   * Fires on every change of the in-flight (not yet committed) text. The same
   * string is also exposed as `interim` on the result, so most callers can
   * ignore this and just render the state.
   */
  onInterim?: (partial: string) => void;
  /**
   * How audio reaches the API. Defaults to `ws-preroll`: capture starts the
   * instant `start()` is called and everything spoken during connection setup
   * is buffered locally and flushed once the session is live — the user can
   * speak immediately and no words are lost.
   */
  transport?: TransportKind;
  /** Overrides for delay, languages, noise reduction, region. */
  settings?: Partial<Omit<LiveTranscribeSettings, "transport">>;
  /**
   * POST endpoint that mints the Realtime client secret. Defaults to
   * {@link DEFAULT_TOKEN_ENDPOINT}.
   */
  tokenEndpoint?: string;
}

export interface UseVoiceInputResult {
  /** True from `start()` until the session fully ends (including the flush). */
  listening: boolean;
  /** Text of the utterance currently being spoken, not yet committed. */
  interim: string;
  /** Last session error, or null. Cleared on the next `start()`. */
  error: string | null;
  /** Begin capturing. Safe to call while already listening (no-op). */
  start: () => Promise<void>;
  /** Commit the open utterance, flush the tail, then end the session. */
  stop: () => void;
}

/**
 * Voice-to-text into any controlled text input.
 *
 * A deliberately thin ergonomic wrapper over {@link TranscribeSession}: while
 * listening, streaming deltas surface as `interim` (and `onInterim`); each
 * utterance the model finalises fires `onText` exactly once; `stop()` sends a
 * final commit and waits briefly so the tail of speech still arrives as
 * `onText` before the session ends.
 *
 * Compared to `useLiveTranscribe` (the instrumentation hook) this exposes no
 * timings, event logs, or run history — just text in, text out.
 */
export function useVoiceInput(options: UseVoiceInputOptions): UseVoiceInputResult {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<TranscribeSession | null>(null);
  const emittedRef = useRef<Set<string>>(new Set());
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const start = useCallback(async () => {
    if (sessionRef.current) return;

    const opts = optionsRef.current;
    const settings: LiveTranscribeSettings = {
      ...DEFAULT_SETTINGS,
      ...opts.settings,
      transport: opts.transport ?? "ws-preroll",
    };
    const tokenEndpoint = opts.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT;

    setError(null);
    setInterim("");
    emittedRef.current = new Set();
    setListening(true);

    const handleUtterances = (utterances: Utterance[]) => {
      let open = "";
      for (const utterance of utterances) {
        if (utterance.transcript != null) {
          if (!emittedRef.current.has(utterance.itemId)) {
            emittedRef.current.add(utterance.itemId);
            const text = utterance.transcript.trim();
            if (text) optionsRef.current.onText(text);
          }
        } else if (utterance.error == null) {
          open += utterance.delta;
        }
      }
      setInterim(open);
      optionsRef.current.onInterim?.(open);
    };

    const session = new TranscribeSession({
      settings,
      capture: DEFAULT_CAPTURE,
      getSecret: async (s) => {
        const response = await fetch(tokenEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(s),
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            (payload as { error?: string } | null)?.error ??
              `Token request failed with ${response.status}.`,
          );
        }
        const value = (payload as { value?: unknown } | null)?.value;
        if (typeof value !== "string") {
          throw new Error("The token endpoint did not return a client secret.");
        }
        return { value, source: "network" };
      },
      callbacks: {
        onUtterances: handleUtterances,
        onEnd: (result) => {
          if (sessionRef.current === session) sessionRef.current = null;
          setListening(false);
          setInterim("");
          optionsRef.current.onInterim?.("");
          if (result.error) setError(result.error);
        },
      },
    });

    sessionRef.current = session;
    await session.start();
  }, []);

  const stop = useCallback(() => {
    sessionRef.current?.stop();
  }, []);

  useEffect(() => {
    return () => {
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, []);

  return { listening, interim, error, start, stop };
}
