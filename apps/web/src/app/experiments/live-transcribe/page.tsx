import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BookOpen } from "lucide-react";

import { getExperiment } from "@/lib/experiments";
import { LIVE_TRANSCRIBE_MODEL } from "@xoxo-labs/realtime-transcribe";

import { LiveTranscribeExperiment } from "./live-transcribe-experiment";
import { PreloadResources } from "./preload-resources";

const experiment = getExperiment("live-transcribe");

export const metadata: Metadata = {
  title: "Live transcription over WebRTC",
  description: experiment?.summary,
};

export default function LiveTranscribePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-12">
      <PreloadResources />
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-2 text-sm transition-colors"
          >
            <ArrowLeft className="size-4" aria-hidden />
            All experiments
          </Link>

          <Link
            href="/experiments/live-transcribe/behaviour"
            className="text-muted-foreground hover:text-foreground group flex items-center gap-2 text-sm transition-colors"
            title="Text lifecycle, which events arrive, expected latencies, troubleshooting"
          >
            <BookOpen className="size-4 shrink-0" aria-hidden />
            How this model behaves
            <ArrowRight
              className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        </div>

        <div className="flex flex-col gap-3">
          <h1 className="text-4xl font-bold tracking-tight">
            Live transcription over WebRTC
          </h1>
          <p className="text-muted-foreground max-w-2xl leading-7">
            Microphone audio streams straight to the OpenAI Realtime API through
            a peer connection. The server mints a short-lived client secret; the
            API key never reaches the browser. Every handshake stage is timed so
            time-to-first-word can be compared across settings.
          </p>
          {/* Technical fingerprint of the setup — one dense mono line. */}
          <p className="text-muted-foreground font-mono text-[11px] leading-5 tracking-wide">
            {LIVE_TRANSCRIBE_MODEL} · POST /v1/realtime/client_secrets · POST
            /v1/realtime/calls · dc oai-events
          </p>
        </div>
      </div>

      <LiveTranscribeExperiment />
    </main>
  );
}
