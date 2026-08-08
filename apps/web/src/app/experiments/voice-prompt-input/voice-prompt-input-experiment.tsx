"use client";

import { useCallback, useRef, useState } from "react";
import { Mic } from "lucide-react";

import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  PromptInputButton,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useDemoSessionCap } from "@/hooks/use-demo-session-cap";
import { useVoiceInput } from "@xoxo-labs/realtime-transcribe/react";
import { cn } from "@/lib/utils";

import { SectionLabel, SectionNote } from "../live-transcribe/section-label";

/** Join two fragments with a single space, tolerating empty sides. */
function append(base: string, extra: string): string {
  if (!base) return extra;
  if (!extra) return base;
  return `${base.replace(/\s+$/, "")} ${extra}`;
}

export function VoicePromptInputExperiment() {
  // Text the user (or a completed utterance) has committed to the input.
  const [committed, setCommitted] = useState("");
  const [sent, setSent] = useState<string[]>([]);
  // Submitting mid-dictation includes the interim tail in the message, so the
  // finalised version of that same tail must not be re-appended afterwards —
  // and its ghost must stop rendering at once, since the session takes a
  // beat to wind down after stop(). Ref for the callback, state for render.
  const discardTailRef = useRef(false);
  const [tailDiscarded, setTailDiscarded] = useState(false);

  const { listening, interim, error, start, stop } = useVoiceInput({
    onText: (final) => {
      if (discardTailRef.current) return;
      setCommitted((prev) => append(prev, final));
    },
  });

  useDemoSessionCap(listening, stop);

  const toggleMic = useCallback(() => {
    if (listening) {
      stop();
    } else {
      discardTailRef.current = false;
      setTailDiscarded(false);
      void start();
    }
  }, [listening, start, stop]);

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      const text = message.text.trim();
      if (listening) {
        discardTailRef.current = true;
        setTailDiscarded(true);
        stop();
      }
      if (text) setSent((prev) => [...prev, text]);
      setCommitted("");
    },
    [listening, stop],
  );

  // While listening, the live interim rides in the textarea value itself. A
  // controlled textarea cannot style a substring, so the ghost text is only
  // implied by the listening indicator — that limitation is stated below
  // rather than papered over. Typing is paused during dictation (readOnly):
  // reconciling manual edits with a machine-appended suffix is ambiguous —
  // the obvious "strip the interim suffix" breaks precisely in the most
  // common case, typing at the end — and misplacing dictated words is worse
  // than a brief edit lock.
  const value =
    listening && !tailDiscarded ? append(committed, interim) : committed;

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-10">
        <section className="flex flex-col gap-3">
          <SectionLabel>Prompt input</SectionLabel>
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputBody>
              <PromptInputTextarea
                placeholder="Type, or press the mic and just start talking…"
                value={value}
                readOnly={listening}
                onChange={(event) => setCommitted(event.currentTarget.value)}
              />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                <PromptInputButton
                  aria-label={listening ? "Stop dictation" : "Start dictation"}
                  aria-pressed={listening}
                  onClick={toggleMic}
                  tooltip={{
                    content: listening
                      ? "Stop dictation (flushes the tail)"
                      : "Start dictation — speak immediately, pre-roll has you covered",
                  }}
                  className={cn(
                    listening &&
                      "text-amber-600 hover:text-amber-600 dark:text-amber-500 dark:hover:text-amber-500",
                  )}
                >
                  <Mic
                    className={cn("size-4", listening && "animate-pulse")}
                    aria-hidden
                  />
                </PromptInputButton>
                {listening ? (
                  <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-500">
                    <span className="relative flex size-1.5">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />
                      <span className="relative inline-flex size-1.5 rounded-full bg-current" />
                    </span>
                    <span className="font-mono text-[11px] tracking-[0.14em] uppercase">
                      listening
                    </span>
                  </span>
                ) : null}
              </PromptInputTools>
              <PromptInputSubmit disabled={!value.trim()} />
            </PromptInputFooter>
          </PromptInput>
          {error ? (
            <p className="text-destructive text-sm leading-6">{error}</p>
          ) : null}
          <SectionNote>
            While listening, completed utterances are committed into the box;
            the tail you are still speaking is appended live, and typing is
            paused — mixing manual edits with a live machine-appended tail
            would put words in unpredictable places, so stop the mic to edit.
            A controlled textarea cannot style part of its value, so interim
            text looks like the rest — the amber indicator is what tells you
            the tail is still provisional.
          </SectionNote>
        </section>

        <section className="flex flex-col gap-3">
          <SectionLabel>Submitted</SectionLabel>
          <SectionNote>
            There is no chat backend here — the experiment is the input.
            Submitting just echoes the message below.
          </SectionNote>
          {sent.length === 0 ? (
            <p className="text-muted-foreground font-mono text-[11px] tracking-wide">
              nothing submitted yet
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {sent.map((text, index) => (
                <li
                  key={`${index}-${text.slice(0, 16)}`}
                  className="border-border border-l-2 py-1 pl-4 text-sm leading-6"
                >
                  {text}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </TooltipProvider>
  );
}
