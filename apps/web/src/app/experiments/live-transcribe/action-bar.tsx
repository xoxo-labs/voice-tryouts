"use client";

import { AlertCircle, Mic, RotateCw, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  formatMs,
  timeToFirstWord,
  ttfwInvalidReason,
} from "@xoxo-labs/realtime-transcribe";
import type { ConnectionStatus, RunMarks } from "@xoxo-labs/realtime-transcribe";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  idle: "idle",
  preparing: "preparing",
  connecting: "exchanging sdp",
  connected: "connected",
  stopping: "finalising",
  error: "error",
};

/**
 * Always-visible control strip. Deliberately not a box: controls left, the
 * hero figure right, one hairline underneath. Time-to-first-word is the
 * number this instrument exists to produce, so this is the only place in the
 * UI where type size is allowed to be dramatic.
 */
export function ActionBar({
  status,
  isActive,
  isTranscribing,
  error,
  marks,
  canRunAgain,
  onStart,
  onStop,
}: {
  status: ConnectionStatus;
  isActive: boolean;
  isTranscribing: boolean;
  error: string | null;
  marks: RunMarks;
  canRunAgain: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const ttfw = timeToFirstWord(marks);
  const invalidReason = ttfwInvalidReason(marks);

  return (
    <div className="flex flex-col gap-3 border-b pb-6">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="flex items-center gap-2">
          {isActive ? (
            <Button onClick={onStop} variant="destructive">
              <Square aria-hidden />
              Stop
            </Button>
          ) : (
            <Button onClick={onStart}>
              <Mic aria-hidden />
              Start
            </Button>
          )}

          <Button variant="ghost" onClick={onStart} disabled={!canRunAgain}>
            <RotateCw aria-hidden />
            Run again
          </Button>
        </div>

        {/* Status as an instrument readout: dot + mono uppercase, no badge. */}
        <div className="flex items-center gap-2 pb-2.5">
          <span
            className={cn(
              "size-1.5 rounded-full",
              status === "error"
                ? "bg-destructive"
                : status === "connected"
                  ? "bg-amber-500"
                  : status === "idle"
                    ? "bg-muted-foreground/40"
                    : "bg-amber-500/50",
            )}
            aria-hidden
          />
          <span className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
            {STATUS_LABEL[status]}
          </span>
          {isTranscribing ? (
            <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-500">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-current" />
              </span>
              <span className="font-mono text-[11px] tracking-[0.14em] uppercase">
                transcribing
              </span>
            </span>
          ) : null}
        </div>

        <div className="ml-auto flex flex-col items-end">
          <span
            className="font-mono text-5xl font-bold tracking-tight tabular-nums"
            title="speech onset → first transcript delta"
          >
            {ttfw != null ? formatMs(ttfw) : "——"}
          </span>
          <span className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
            time to first word
          </span>
        </div>
      </div>

      {ttfw == null && invalidReason ? (
        <p className="text-muted-foreground text-right font-mono text-xs">
          ttfw unavailable: {invalidReason}
        </p>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="border-destructive text-destructive flex items-start gap-3 border-l-2 py-1 pl-3 text-sm"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}
