"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Stethoscope } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  runConnectionTest,
  type ConnectionTestSummary,
} from "@/lib/live-transcribe/connection-test";
import type {
  CaptureSettings,
  LiveTranscribeSettings,
  StageResult,
  StageStatus,
} from "@/lib/realtime-transcribe";
import { cn } from "@/lib/utils";

/**
 * Instrument-panel verdicts: an aligned mono glyph column. Pass is calm —
 * success is the default state of a working instrument and doesn't shout.
 * Amber is the single accent (attention), red is reserved for failure.
 */
const STATUS_GLYPH: Record<StageStatus, string> = {
  pending: "·",
  running: "…",
  pass: "✓",
  warn: "!",
  fail: "×",
  skip: "–",
};

const STATUS_COLOR: Record<StageStatus, string> = {
  pending: "text-muted-foreground/50",
  running: "text-muted-foreground animate-pulse",
  pass: "text-foreground",
  warn: "text-amber-600 dark:text-amber-500",
  fail: "text-destructive",
  skip: "text-muted-foreground/70",
};

export function ConnectionTestPanel({
  settings,
  capture,
  disabled,
  onFailuresChange,
}: {
  settings: LiveTranscribeSettings;
  capture: CaptureSettings;
  disabled: boolean;
  /** Reports whether the last completed test contained failures. */
  onFailuresChange?: (hasFailures: boolean) => void;
}) {
  const [stages, setStages] = useState<StageResult[]>([]);
  const [summary, setSummary] = useState<ConnectionTestSummary | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [includeMicrophone, setIncludeMicrophone] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStages([]);
    setSummary(null);
    setIsRunning(true);

    try {
      const result = await runConnectionTest({
        settings,
        capture,
        includeMicrophone,
        signal: controller.signal,
        onProgress: (stage) => {
          // Reports from an aborted run must not leak into a newer one.
          if (controller.signal.aborted) return;
          setStages((prev) => {
            const index = prev.findIndex((s) => s.id === stage.id);
            if (index === -1) return [...prev, stage];
            // A settled verdict is final — only "running"/"pending"
            // placeholders may be replaced. A straggling update can therefore
            // never overwrite a legitimate result.
            const existing = prev[index];
            if (existing.status !== "running" && existing.status !== "pending") {
              return prev;
            }
            const next = prev.slice();
            next[index] = stage;
            return next;
          });
        },
      });
      if (!controller.signal.aborted) {
        setSummary(result);
        onFailuresChange?.(!result.ok);
      }
    } finally {
      if (!controller.signal.aborted) setIsRunning(false);
    }
  }, [settings, capture, includeMicrophone, onFailuresChange]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={() => void run()} disabled={disabled || isRunning}>
          {isRunning ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Stethoscope aria-hidden />
          )}
          {isRunning ? "Running…" : "Run connection test"}
        </Button>

        <div className="flex items-center gap-2">
          <Switch
            id="include-mic"
            checked={includeMicrophone}
            onCheckedChange={setIncludeMicrophone}
            disabled={isRunning}
          />
          <Label htmlFor="include-mic" className="text-sm font-normal">
            Include microphone checks
          </Label>
        </div>

        <span className="text-muted-foreground ml-auto font-mono text-[11px] tracking-[0.14em] uppercase">
          {settings.region}
        </span>
      </div>

      {stages.length === 0 && !isRunning ? (
        <p className="text-muted-foreground text-sm leading-6">
          Runs the whole chain — server, API key, token mint, microphone, ICE,
          SDP, data channel, session, and a full audio round trip using
          synthetic speech. Every stage reports pass, fail or an explicit
          reason for being skipped. It works without a microphone: turn the
          switch off and the mic stages are skipped rather than silently
          passed.
        </p>
      ) : null}

      {stages.length > 0 ? (
        <ol className="divide-border/60 divide-y border-y">
          {stages.map((stage) => (
            <li key={stage.id} className="flex gap-3 py-2.5">
              <span
                className={cn(
                  "w-4 shrink-0 text-center font-mono text-sm leading-6 font-bold",
                  STATUS_COLOR[stage.status],
                )}
                aria-hidden
              >
                {STATUS_GLYPH[stage.status]}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span
                    className={cn(
                      "text-sm leading-6",
                      stage.status === "fail"
                        ? "text-destructive font-semibold"
                        : stage.status === "skip"
                          ? "text-muted-foreground"
                          : "font-medium",
                    )}
                  >
                    {stage.label}
                  </span>
                  <span
                    className={cn(
                      "font-mono text-[10px] tracking-[0.14em] uppercase",
                      STATUS_COLOR[stage.status].replace(" animate-pulse", ""),
                    )}
                  >
                    {stage.status}
                  </span>
                  {stage.durationMs != null ? (
                    <span className="text-muted-foreground ml-auto font-mono text-[11px] tabular-nums">
                      {stage.durationMs} ms
                    </span>
                  ) : null}
                </div>
                <p className="text-muted-foreground text-sm leading-6">
                  {stage.detail}
                </p>
                {stage.remedy ? (
                  <p className="text-sm leading-6">
                    <span className="font-semibold">Do this: </span>
                    {stage.remedy}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {summary ? (
        <div
          className={cn(
            "flex flex-col gap-1 border-l-2 py-1 pl-4",
            summary.ok ? "border-foreground/60" : "border-destructive",
          )}
        >
          <p
            className={cn(
              "text-sm font-bold",
              !summary.ok && "text-destructive",
            )}
          >
            {summary.headline}
          </p>
          {summary.advice ? (
            <p className="text-muted-foreground text-sm leading-6">
              {summary.advice}
            </p>
          ) : null}
          {summary.icePath ? (
            <p className="text-muted-foreground font-mono text-xs">
              media path → {summary.icePath.remoteAddress ?? "?"}
              {summary.icePath.remotePort ? `:${summary.icePath.remotePort}` : ""}
              {summary.icePath.roundTripMs != null
                ? ` · rtt ${summary.icePath.roundTripMs.toFixed(1)} ms`
                : " · rtt not reported"}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
