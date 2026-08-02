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
import {
  computeStats,
  formatMs,
  HEADLINE_METRICS,
  timeToFirstWord,
} from "@/lib/live-transcribe/timings";
import type { RunRecord } from "@/lib/live-transcribe/types";
import { cn } from "@/lib/utils";

export function RunHistory({
  runs,
  onClear,
}: {
  runs: RunRecord[];
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

  const mixedModes =
    runs.some((run) => run.startMode === "cold") &&
    runs.some((run) => run.startMode === "warm");

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {HEADLINE_METRICS.map((metric) => {
          const stats = computeStats(runs, metric.select);
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
          Tiles show the median (p50) across {runs.length} run
          {runs.length === 1 ? "" : "s"}.
          {mixedModes
            ? " History mixes cold and warm starts — setup medians average two different things."
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

              return (
                <TableRow key={run.id}>
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
                        {run.settings.languages.join("+")}
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
