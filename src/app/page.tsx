import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { experiments } from "@/lib/experiments";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Voice Tryouts</h1>
        <p className="text-muted-foreground max-w-2xl text-base leading-7">
          A scratchpad for live voice and speech APIs. Each experiment is
          self-contained and instrumented so the numbers can be compared.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        {experiments.map((experiment) => (
          <Link
            key={experiment.slug}
            href={`/experiments/${experiment.slug}`}
            className="focus-visible:ring-ring rounded-xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <Card className="hover:border-foreground/20 transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-4">
                  <span>{experiment.title}</span>
                  <ArrowRight
                    className="text-muted-foreground size-4 shrink-0"
                    aria-hidden
                  />
                </CardTitle>
                <CardDescription className="leading-6">
                  {experiment.summary}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {experiment.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          </Link>
        ))}
      </section>
    </main>
  );
}
