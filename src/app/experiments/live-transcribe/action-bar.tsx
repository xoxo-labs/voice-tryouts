"use client";

import { AlertCircle, Mic, RotateCw, Square } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatMs,
  timeToFirstWord,
  ttfwInvalidReason,
} from "@/lib/live-transcribe/timings";
import type {
  ConnectionStatus,
  RunMarks,
} from "@/lib/live-transcribe/types";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  idle: "Idle",
  preparing: "Preparing",
  connecting: "Exchanging SDP",
  connected: "Connected",
  stopping: "Finalising",
  error: "Error",
};

/**
 * Always-visible strip: controls, status, errors, and the number this whole
 * tool exists to produce — time to first word — as the hero figure instead of
 * row 8 of a table.
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
    <div className="bg-card flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-3">
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

        <Button variant="outline" onClick={onStart} disabled={!canRunAgain}>
          <RotateCw aria-hidden />
          Run again
        </Button>

        <Badge
          variant={
            status === "error"
              ? "destructive"
              : status === "connected"
                ? "default"
                : "secondary"
          }
        >
          {STATUS_LABEL[status]}
        </Badge>

        {isTranscribing ? (
          <span className="text-muted-foreground flex items-center gap-2 text-sm">
            <span className="relative flex size-2">
              <span className="bg-primary absolute inline-flex size-full animate-ping rounded-full opacity-60" />
              <span className="bg-primary relative inline-flex size-2 rounded-full" />
            </span>
            Transcribing
          </span>
        ) : null}

        <div className="ml-auto flex items-baseline gap-2 text-right">
          <span className="text-muted-foreground text-xs">
            Time to first word
          </span>
          <span
            className="font-mono text-2xl font-semibold tabular-nums"
            title="speech onset → first transcript delta"
          >
            {ttfw != null ? formatMs(ttfw) : "—"}
          </span>
        </div>
      </div>

      {ttfw == null && invalidReason ? (
        <p className="text-muted-foreground text-right text-xs">
          TTFW unavailable: {invalidReason}
        </p>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-3 rounded-lg border p-3 text-sm"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}
