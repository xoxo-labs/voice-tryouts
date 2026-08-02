"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Loader2,
  MinusCircle,
  Stethoscope,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
} from "@/lib/live-transcribe/types";
import { cn } from "@/lib/utils";

const STATUS_ICON: Record<StageStatus, React.ComponentType<{ className?: string }>> = {
  pending: CircleDashed,
  running: Loader2,
  pass: CheckCircle2,
  warn: AlertTriangle,
  fail: XCircle,
  skip: MinusCircle,
};

const STATUS_COLOR: Record<StageStatus, string> = {
  pending: "text-muted-foreground/50",
  running: "text-muted-foreground animate-spin",
  pass: "text-emerald-600",
  warn: "text-amber-600",
  fail: "text-destructive",
  skip: "text-muted-foreground",
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

        <Badge variant="outline" className="ml-auto font-mono text-[11px]">
          {settings.region.toUpperCase()}
        </Badge>
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
        <ol className="flex flex-col gap-2">
          {stages.map((stage) => {
            const Icon = STATUS_ICON[stage.status];
            return (
              <li
                key={stage.id}
                className={cn(
                  "flex gap-3 rounded-lg border p-3",
                  stage.status === "fail" &&
                    "border-destructive/40 bg-destructive/5",
                  stage.status === "warn" && "border-amber-500/40 bg-amber-500/5",
                )}
              >
                <Icon
                  className={cn("mt-0.5 size-4 shrink-0", STATUS_COLOR[stage.status])}
                  aria-hidden
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-medium">{stage.label}</span>
                    <span
                      className={cn(
                        "text-[10px] tracking-wide uppercase",
                        STATUS_COLOR[stage.status].replace("animate-spin", ""),
                      )}
                    >
                      {stage.status}
                    </span>
                    {stage.durationMs != null ? (
                      <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
                        {stage.durationMs} ms
                      </span>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground text-sm leading-6">
                    {stage.detail}
                  </p>
                  {stage.remedy ? (
                    <p className="text-sm leading-6">
                      <span className="font-medium">Do this: </span>
                      {stage.remedy}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}

      {summary ? (
        <div
          className={cn(
            "rounded-lg border p-4",
            summary.ok
              ? "border-emerald-600/40 bg-emerald-600/5"
              : "border-destructive/40 bg-destructive/5",
          )}
        >
          <p className="text-sm font-medium">{summary.headline}</p>
          {summary.advice ? (
            <p className="text-muted-foreground mt-1 text-sm leading-6">
              {summary.advice}
            </p>
          ) : null}
          {summary.icePath ? (
            <p className="text-muted-foreground mt-2 font-mono text-xs">
              media path → {summary.icePath.remoteAddress ?? "?"}
              {summary.icePath.remotePort ? `:${summary.icePath.remotePort}` : ""}
              {summary.icePath.roundTripMs != null
                ? ` · RTT ${summary.icePath.roundTripMs.toFixed(1)} ms`
                : " · RTT not reported"}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
