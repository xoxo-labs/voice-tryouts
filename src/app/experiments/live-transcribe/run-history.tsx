"use client";

import { Badge } from "@/components/ui/badge";
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {HEADLINE_METRICS.map((metric) => {
          const stats = computeStats(comparable, metric.select);
          return (
            <div
              key={metric.key}
              className={cn(
                "rounded-lg border p-3",
                metric.primary && "border-foreground/30 bg-muted/40",
                metric.contaminated && "opacity-70",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-muted-foreground text-xs font-medium">
                  {metric.label}
                </span>
                {metric.contaminated ? (
                  <span
                    className="shrink-0 text-[10px] tracking-wide text-amber-600 uppercase"
                    title="Includes human reaction time — not comparable across delay settings."
                  >
                    noisy
                  </span>
                ) : null}
              </div>
              <div
                className={cn(
                  "mt-1 font-mono tabular-nums",
                  metric.primary ? "text-2xl font-semibold" : "text-xl",
                )}
              >
                {stats ? formatMs(stats.p50) : "—"}
              </div>
              <div className="text-muted-foreground mt-1 font-mono text-xs tabular-nums">
                {stats
                  ? `min ${formatMs(stats.min)} · max ${formatMs(stats.max)} · n=${stats.count}`
                  : metric.hint}
              </div>
              {stats ? (
                <div className="text-muted-foreground mt-0.5 text-xs">
                  {metric.hint}
                </div>
              ) : null}
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
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Settings</TableHead>
              <TableHead>Microphone</TableHead>
              <TableHead className="text-right">Ready</TableHead>
              <TableHead className="text-right" title="speech onset → first delta">
                TTFW
              </TableHead>
              <TableHead
                className="text-right"
                title="start() → first delta, includes reaction time"
              >
                start→delta
              </TableHead>
              <TableHead className="text-right">Utterances</TableHead>
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
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {run.settings.delay}
                      </Badge>
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {run.settings.noiseReduction}
                      </Badge>
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {run.settings.languages.length > 0
                          ? run.settings.languages.join("+")
                          : "auto"}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="font-mono text-[11px] uppercase"
                      >
                        {run.settings.region}
                      </Badge>
                      <Badge
                        variant={
                          run.startMode === "warm" ? "secondary" : "outline"
                        }
                        className="font-mono text-[11px]"
                        title={
                          run.tokenSource === "cache"
                            ? "Token served from cache"
                            : "Token minted over the network"
                        }
                      >
                        {run.startMode}
                        {run.tokenSource === "cache" ? " ⚡" : ""}
                      </Badge>
                      {run.error ? (
                        <Badge variant="destructive" className="text-[11px]">
                          error
                        </Badge>
                      ) : null}
                    </div>
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
