"use client";

import type { Utterance } from "@/lib/live-transcribe/types";
import { cn } from "@/lib/utils";

export function TranscriptPanel({
  utterances,
  isActive,
}: {
  utterances: Utterance[];
  isActive: boolean;
}) {
  if (utterances.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {isActive
          ? "Listening — start talking."
          : "Press Start, allow the microphone, then speak."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {utterances.map((utterance) => (
        <div key={utterance.itemId} className="flex flex-col gap-1">
          <p
            className={cn(
              "text-lg leading-8",
              utterance.transcript == null && "text-muted-foreground italic",
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
          <p className="text-muted-foreground font-mono text-[11px]">
            {utterance.itemId}
            {utterance.completedAt != null
              ? ` · finalised at ${Math.round(utterance.completedAt)} ms`
              : " · streaming"}
          </p>
        </div>
      ))}
    </div>
  );
}
