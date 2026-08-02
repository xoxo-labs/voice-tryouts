"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { deriveStages, formatMs } from "@/lib/live-transcribe/timings";
import type { RunMarks, TokenSource } from "@/lib/live-transcribe/types";

export function TimingsTable({
  marks,
  tokenSource,
}: {
  marks: RunMarks;
  tokenSource: TokenSource;
}) {
  const stages = deriveStages(marks, tokenSource);

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[46%]">Stage</TableHead>
            <TableHead className="text-right">From start()</TableHead>
            <TableHead className="text-right">Step</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stages.map((stage) => (
            <TableRow
              key={stage.key}
              className={cn(
                stage.at == null && !stage.unavailable && "opacity-45",
                stage.unavailable && "opacity-60",
                stage.highlight && "bg-muted/40",
              )}
            >
              <TableCell>
                <div
                  className={cn(
                    "text-sm",
                    stage.highlight ? "font-semibold" : "font-medium",
                    stage.unavailable && "line-through decoration-1",
                  )}
                >
                  {stage.label}
                  {stage.parallel ? (
                    <span
                      className="text-muted-foreground ml-2 align-middle text-[10px] tracking-wide uppercase"
                      title="Runs concurrently with the other parallel stages."
                    >
                      ∥
                    </span>
                  ) : null}
                </div>
                <div className="text-muted-foreground font-mono text-xs">
                  {stage.unavailable ?? stage.description}
                </div>
              </TableCell>
              <TableCell className="text-right font-mono text-sm tabular-nums">
                {stage.unavailable ? (
                  <span className="text-muted-foreground text-xs tracking-wide uppercase">
                    n/a
                  </span>
                ) : (
                  formatMs(stage.at)
                )}
              </TableCell>
              <TableCell className="text-muted-foreground text-right font-mono text-sm tabular-nums">
                {stage.unavailable ? (
                  <span className="text-xs tracking-wide uppercase">n/a</span>
                ) : stage.delta == null ? (
                  "—"
                ) : (
                  <>
                    {stage.deltaKind === "since-previous" ? "+" : ""}
                    {formatMs(stage.delta)}
                  </>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
      <p className="text-muted-foreground text-xs">
        Stages marked <span className="font-mono">∥</span> run concurrently, so
        their <span className="font-mono">From start()</span> values overlap —
        only the slowest of them is on the critical path.
      </p>
    </div>
  );
}
