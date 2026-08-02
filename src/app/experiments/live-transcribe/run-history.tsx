"use client";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { settingsKey } from "@/lib/live-transcribe/token-cache";
import {
  computeStats,
  formatMs,
  HEADLINE_METRICS,
  timeToFirstWord,
} from "@/lib/live-transcribe/timings";
import type {
  LiveTranscribeSettings,
  RunRecord,
  StartMode,
} from "@/lib/live-transcribe/types";
import { cn } from "@/lib/utils";

export function RunHistory({
  runs,
  currentSettings,
  currentStartMode,
  onClear,
}: {
  runs: RunRecord[];
  currentSettings: LiveTranscribeSettings;
  currentStartMode: StartMode;
  onClear: () => void;
}) {
  if (runs.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No runs recorded yet. Each start/stop cycle is archived here so you can
        compare spread across connections.
      </p>
    );
  }

  // Tiles aggregate ONLY successful runs whose settings + start mode match
  // the current selection. Averaging across different delay/noise/language
  // configurations would erase exactly the differences this tool measures,
  // and errored runs carry partial marks that poison every statistic.
  const currentKey = settingsKey(currentSettings);
  const comparable = runs.filter(
    (run) =>
      run.error == null &&
      run.startMode === currentStartMode &&
      settingsKey(run.settings) === currentKey,
  );
  const excluded = runs.length - comparable.length;

  return (
    <div className="flex flex-col gap-6">
      {/* Stat readouts: figures separated by space, not boxes. Hierarchy is
          carried by the size jump between the primary metric and the rest. */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3">
        {HEADLINE_METRICS.map((metric) => {
          const stats = computeStats(comparable, metric.select);
          return (
            <div
              key={metric.key}
              className={cn(
                "flex flex-col gap-0.5",
                metric.contaminated && "opacity-60",
              )}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
                  {metric.label}
                </span>
                {metric.contaminated ? (
                  <span
                    className="shrink-0 font-mono text-[10px] tracking-wide text-amber-600 uppercase dark:text-amber-500"
                    title="Includes human reaction time — not comparable across delay settings."
                  >
                    noisy
                  </span>
                ) : null}
              </div>
              <div
                className={cn(
                  "font-mono tabular-nums",
                  metric.primary
                    ? "text-3xl font-bold tracking-tight"
                    : "text-lg font-medium",
                )}
              >
                {stats ? formatMs(stats.p50) : "—"}
              </div>
              <div className="text-muted-foreground/80 font-mono text-[11px] tabular-nums">
                {stats
                  ? `min ${formatMs(stats.min)} · max ${formatMs(stats.max)} · n=${stats.count}`
                  : metric.hint}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground text-xs">
          Tiles aggregate the {comparable.length} successful run
          {comparable.length === 1 ? "" : "s"} matching the current settings and
          start mode.
          {excluded > 0
            ? ` ${excluded} run${excluded === 1 ? "" : "s"} with different settings or errors ${excluded === 1 ? "is" : "are"} listed below but excluded from the medians.`
            : ""}
        </p>
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear history
        </Button>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {(
                [
                  ["#", ""],
                  ["Settings", ""],
                  ["Microphone", ""],
                  ["Ready", "text-right"],
                  ["TTFW", "text-right"],
                  ["start→delta", "text-right"],
                  ["Utt.", "text-right"],
                ] as const
              ).map(([label, align]) => (
                <TableHead
                  key={label}
                  className={cn(
                    "text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase",
                    align,
                  )}
                  title={
                    label === "TTFW"
                      ? "speech onset → first delta"
                      : label === "start→delta"
                        ? "start() → first delta, includes reaction time"
                        : undefined
                  }
                >
                  {label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => {
              const { marks } = run;
              const ttfw = timeToFirstWord(marks);
              const isComparable = comparable.includes(run);

              return (
                <TableRow
                  key={run.id}
                  className={cn(!isComparable && "opacity-55")}
                  title={
                    isComparable
                      ? undefined
                      : run.error
                        ? "Errored run — excluded from the medians."
                        : "Different settings or start mode — excluded from the medians."
                  }
                >
                  <TableCell className="font-mono text-xs">
                    {run.index}
                  </TableCell>
                  <TableCell>
                    <span
                      className="text-muted-foreground font-mono text-[11px]"
                      title={
                        run.tokenSource === "cache"
                          ? "Token served from cache"
                          : "Token minted over the network"
                      }
                    >
                      {[
                        run.settings.delay,
                        run.settings.noiseReduction,
                        run.settings.languages.length > 0
                          ? run.settings.languages.join("+")
                          : "auto",
                        run.settings.region,
                        run.startMode +
                          (run.tokenSource === "cache" ? "·cached" : ""),
                      ].join(" · ")}
                    </span>
                    {run.error ? (
                      <span className="text-destructive ml-2 font-mono text-[11px] tracking-wide uppercase">
                        error
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell
                    className="max-w-48 truncate text-xs"
                    title={run.capture.deviceLabel}
                  >
                    {run.capture.deviceLabel}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {formatMs(marks.sessionCreated)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-semibold tabular-nums">
                    {formatMs(ttfw)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right font-mono text-sm tabular-nums">
                    {formatMs(marks.firstDelta)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {run.utteranceCount}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
