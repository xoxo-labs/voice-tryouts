import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { getExperiment } from "@/lib/experiments";
import { LIVE_TRANSCRIBE_MODEL } from "@xoxo-labs/realtime-transcribe";

import { VoicePromptInputExperiment } from "./voice-prompt-input-experiment";

const experiment = getExperiment("voice-prompt-input");

export const metadata: Metadata = {
  title: "Voice input for AI Elements",
  description: experiment?.summary,
};

export default function VoicePromptInputPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-12">
      <div className="flex flex-col gap-5">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-2 text-sm transition-colors"
        >
          <ArrowLeft className="size-4" aria-hidden />
          All experiments
        </Link>

        <div className="flex flex-col gap-3">
          <h1 className="text-4xl font-bold tracking-tight">
            Voice input for AI Elements
          </h1>
          <p className="text-muted-foreground max-w-2xl leading-7">
            The point of this experiment: replace the browser&apos;s built-in
            Web Speech mic with real API transcription. That trade buys
            cross-browser behaviour (no Chrome-only SpeechRecognition), an
            actual model choice, a latency/accuracy delay dial, and pre-roll —
            the mic captures from the instant it is pressed, so nothing said
            during connection setup is lost.
          </p>
          {/* Technical fingerprint of the setup — one dense mono line. */}
          <p className="text-muted-foreground font-mono text-[11px] leading-5 tracking-wide">
            {LIVE_TRANSCRIBE_MODEL} · useVoiceInput · ws-preroll · AI Elements
            PromptInput
          </p>
        </div>
      </div>

      <VoicePromptInputExperiment />
    </main>
  );
}
