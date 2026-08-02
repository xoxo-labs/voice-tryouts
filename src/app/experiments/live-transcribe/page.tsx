import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BookOpen } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { getExperiment } from "@/lib/experiments";
import { LIVE_TRANSCRIBE_MODEL } from "@/lib/live-transcribe/session-config";

import { LiveTranscribeExperiment } from "./live-transcribe-experiment";
import { PreloadResources } from "./preload-resources";

const experiment = getExperiment("live-transcribe");

export const metadata: Metadata = {
  title: "Live transcription over WebRTC",
  description: experiment?.summary,
};

export default function LiveTranscribePage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-12">
      <PreloadResources />
      <div className="flex flex-col gap-4">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-2 text-sm transition-colors"
        >
          <ArrowLeft className="size-4" aria-hidden />
          All experiments
        </Link>

        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            Live transcription over WebRTC
          </h1>
          <p className="text-muted-foreground max-w-2xl leading-7">
            Microphone audio streams straight to the OpenAI Realtime API through
            a peer connection. The server mints a short-lived client secret; the
            API key never reaches the browser. Every handshake stage is timed so
            time-to-first-word can be compared across settings.
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="font-mono">
              {LIVE_TRANSCRIBE_MODEL}
            </Badge>
            <Badge variant="outline" className="font-mono">
              POST /v1/realtime/client_secrets
            </Badge>
            <Badge variant="outline" className="font-mono">
              POST /v1/realtime/calls
            </Badge>
            <Badge variant="outline" className="font-mono">
              oai-events
            </Badge>
          </div>

          <Link
            href="/experiments/live-transcribe/behaviour"
            className="border-border hover:border-foreground/30 hover:bg-muted/50 group flex w-fit items-center gap-3 rounded-lg border px-4 py-2.5 transition-colors"
          >
            <BookOpen
              className="text-muted-foreground size-4 shrink-0"
              aria-hidden
            />
            <span className="flex flex-col">
              <span className="text-sm font-medium">
                How this model behaves
              </span>
              <span className="text-muted-foreground text-xs">
                Text lifecycle, which events arrive, expected latencies,
                troubleshooting
              </span>
            </span>
            <ArrowRight
              className="text-muted-foreground ml-2 size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        </div>
      </div>

      <LiveTranscribeExperiment />
    </main>
  );
}
