"use client";

import type { Utterance } from "@/lib/live-transcribe/types";
import { cn } from "@/lib/utils";

/**
 * The hero of the Live tab: large text with air around it, no box. Grey
 * italic = still streaming; solid = finalised. That colour semantics carries
 * the whole state story, so nothing else decorates it.
 */
export function TranscriptPanel({
  utterances,
  isActive,
}: {
  utterances: Utterance[];
  isActive: boolean;
}) {
  if (utterances.length === 0) {
    return (
      <p className="text-muted-foreground py-10 text-sm">
        {isActive
          ? "Listening — start talking."
          : "Press Start, allow the microphone, then speak."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8 py-6">
      {utterances.map((utterance) => (
        <div key={utterance.itemId} className="flex flex-col gap-1.5">
          <p
            className={cn(
              "max-w-[60ch] text-2xl leading-9 tracking-tight",
              utterance.transcript == null
                ? "text-muted-foreground font-normal italic"
                : "font-medium",
            )}
          >
            {utterance.transcript ?? utterance.delta}
            {utterance.transcript == null && utterance.delta === ""
              ? "…"
              : null}
          </p>
          {utterance.error ? (
            <p className="text-destructive text-xs">{utterance.error}</p>
          ) : null}
          <p className="text-muted-foreground/70 font-mono text-[11px] tabular-nums">
            {utterance.itemId}
            {utterance.completedAt != null
              ? ` · finalised ${Math.round(utterance.completedAt)} ms`
              : " · streaming"}
          </p>
        </div>
      ))}
    </div>
  );
}
