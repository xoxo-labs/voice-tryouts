"use client";

import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Caps how long a single transcription session may run on the hosted demo.
 *
 * Every active session streams audio to a metered API on the demo's key, so
 * an abandoned tab with a live microphone burns money at a constant rate.
 * The WAF rate limit bounds how many sessions an IP can start; this bounds
 * how long each one lasts. Honest visitors are the audience — anyone
 * bypassing client code is handled by the per-IP limit and the hard budget
 * cap on the OpenAI project.
 *
 * The cap is inlined at build time from NEXT_PUBLIC_DEMO_MAX_SESSION_SECONDS.
 * Local dev leaves it unset (you are on your own key) and gets no cap.
 */
const CAP_SECONDS = Number(
  process.env.NEXT_PUBLIC_DEMO_MAX_SESSION_SECONDS ?? 0,
);

export function useDemoSessionCap(active: boolean, stop: () => void): void {
  useEffect(() => {
    if (!active || !Number.isFinite(CAP_SECONDS) || CAP_SECONDS <= 0) return;
    const id = window.setTimeout(() => {
      stop();
      toast.info("Demo session limit reached", {
        description: `Sessions stop after ${Math.round(CAP_SECONDS / 60)} minutes to keep the hosted demo affordable. Start again any time.`,
      });
    }, CAP_SECONDS * 1000);
    return () => window.clearTimeout(id);
  }, [active, stop]);
}
