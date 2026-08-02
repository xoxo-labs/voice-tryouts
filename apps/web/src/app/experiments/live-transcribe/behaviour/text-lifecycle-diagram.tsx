import { cn } from "@/lib/utils";

interface Stage {
  time: string;
  actor: "you" | "server" | "app";
  events: string[];
  note: string;
  /** Transcript contents at this instant. */
  preview: { text: string; final: boolean; itemId?: string }[];
}

const ITEM_A = "item_E8Sm…3b";
const ITEM_B = "item_E8Sn…7c";

const STAGES: Stage[] = [
  {
    time: "0 ms",
    actor: "you",
    events: ["(you start speaking)"],
    note: "Audio flows continuously over the peer connection. No client event is needed to begin — adding the microphone track is enough.",
    preview: [],
  },
  {
    time: "~200 ms",
    actor: "server",
    events: ["conversation.item.input_audio_transcription.delta"],
    note: "The first delta arrives and opens a new item_id. Text is provisional, so it renders grey and italic.",
    preview: [{ text: "Hello", final: false, itemId: ITEM_A }],
  },
  {
    time: "~400 ms",
    actor: "server",
    events: ["…delta"],
    note: "Deltas keep landing roughly every 200 ms, each appending to the same item.",
    preview: [{ text: "Hello, can you", final: false, itemId: ITEM_A }],
  },
  {
    time: "~1.2 s",
    actor: "server",
    events: ["…delta ×N"],
    note: "Still one item, still grey. Nothing has been finalised yet — and nothing will be until a commit is sent.",
    preview: [
      { text: "Hello, can you hear me clearly", final: false, itemId: ITEM_A },
    ],
  },
  {
    time: "+1.5 s of silence",
    actor: "app",
    events: ["→ input_audio_buffer.commit"],
    note: "This app decides the utterance is over and commits. The API never does this on its own for this model.",
    preview: [
      { text: "Hello, can you hear me clearly", final: false, itemId: ITEM_A },
    ],
  },
  {
    time: "+~10 ms",
    actor: "server",
    events: [
      "input_audio_buffer.committed",
      "conversation.item.added",
      "conversation.item.done",
    ],
    note: "Bookkeeping acknowledging the commit. The transcript still shows grey text — these three carry no transcript.",
    preview: [
      { text: "Hello, can you hear me clearly", final: false, itemId: ITEM_A },
    ],
  },
  {
    time: "+300–700 ms",
    actor: "server",
    events: ["conversation.item.input_audio_transcription.completed"],
    note: "The final transcript replaces the accumulated grey text. Punctuation and casing are often corrected here. This item is now a finished section.",
    preview: [
      {
        text: "Hello, can you hear me clearly?",
        final: true,
        itemId: ITEM_A,
      },
    ],
  },
  {
    time: "next audio",
    actor: "server",
    events: ["…delta (new item_id)"],
    note: "Speaking again opens a fresh item below the finished one. That is why the transcript is a stack of sections rather than one paragraph.",
    preview: [
      {
        text: "Hello, can you hear me clearly?",
        final: true,
        itemId: ITEM_A,
      },
      { text: "This is the next", final: false, itemId: ITEM_B },
    ],
  },
];

const ACTOR_STYLE: Record<Stage["actor"], { dot: string; label: string }> = {
  you: { dot: "bg-muted-foreground", label: "you" },
  server: { dot: "bg-primary", label: "OpenAI" },
  app: { dot: "bg-amber-500", label: "this app" },
};

function TranscriptPreview({ preview }: { preview: Stage["preview"] }) {
  if (preview.length === 0) {
    return (
      <div className="text-muted-foreground/60 rounded-md border border-dashed p-3 text-sm italic">
        (transcript empty)
      </div>
    );
  }

  return (
    <div className="bg-muted/40 flex flex-col gap-2 rounded-md border p-3">
      {preview.map((line, index) => (
        <div key={index} className="flex flex-col gap-0.5">
          <p
            className={cn(
              "text-sm leading-6",
              line.final
                ? "text-foreground"
                : "text-muted-foreground italic",
            )}
          >
            {line.text}
            {!line.final ? <span className="opacity-50"> ▍</span> : null}
          </p>
          <p className="text-muted-foreground/70 font-mono text-[10px]">
            {line.itemId} · {line.final ? "finalised" : "streaming"}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * The whole point of this page: showing *why* the transcript looks the way it
 * does — grey text that later turns solid, split into sections.
 *
 * Built from HTML and Tailwind rather than SVG so it stays theme-aware,
 * responsive, and selectable, with no external dependency.
 */
export function TextLifecycleDiagram() {
  return (
    <div className="flex flex-col gap-4">
      <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
        {(Object.keys(ACTOR_STYLE) as Stage["actor"][]).map((actor) => (
          <span key={actor} className="flex items-center gap-1.5">
            <span
              className={cn("size-2 rounded-full", ACTOR_STYLE[actor].dot)}
              aria-hidden
            />
            {ACTOR_STYLE[actor].label}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-3">
          <span className="text-muted-foreground italic">grey = streaming</span>
          <span className="text-foreground">solid = finalised</span>
        </span>
      </div>

      <ol className="flex flex-col">
        {STAGES.map((stage, index) => {
          const isLast = index === STAGES.length - 1;
          return (
            <li key={index} className="grid grid-cols-[auto_1fr] gap-x-4">
              {/* Rail */}
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "mt-1.5 size-2.5 shrink-0 rounded-full",
                    ACTOR_STYLE[stage.actor].dot,
                  )}
                  aria-hidden
                />
                {!isLast ? (
                  <span className="bg-border w-px flex-1" aria-hidden />
                ) : null}
              </div>

              <div className={cn("grid gap-3 pb-6 sm:grid-cols-2")}>
                <div className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground font-mono text-xs tabular-nums">
                    {stage.time}
                  </span>
                  <div className="flex flex-col gap-1">
                    {stage.events.map((event) => (
                      <code
                        key={event}
                        className="bg-muted w-fit rounded px-1.5 py-0.5 font-mono text-[11px] break-all"
                      >
                        {event}
                      </code>
                    ))}
                  </div>
                  <p className="text-muted-foreground text-sm leading-6">
                    {stage.note}
                  </p>
                </div>

                <TranscriptPreview preview={stage.preview} />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
