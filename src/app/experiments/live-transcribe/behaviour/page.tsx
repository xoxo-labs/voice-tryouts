import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LIVE_TRANSCRIBE_MODEL } from "@/lib/live-transcribe/session-config";

import { TextLifecycleDiagram } from "./text-lifecycle-diagram";

export const metadata: Metadata = {
  title: "Behaviour — live transcription",
  description:
    "Empirically observed behaviour of gpt-live-transcribe over WebRTC: text lifecycle, events, expected latencies, and troubleshooting.",
};

const ARRIVING_EVENTS = [
  {
    type: "session.created",
    when: "Once, ~170 ms after the data channel opens",
    meaning: "Session is live and ready for audio.",
  },
  {
    type: "conversation.item.input_audio_transcription.delta",
    when: "Every ~200 ms while you speak",
    meaning:
      "Incremental text for the open item. Appends to whatever came before on the same item_id.",
  },
  {
    type: "input_audio_buffer.committed",
    when: "Immediately after we send a commit",
    meaning: "Acknowledges the commit. Carries no transcript.",
  },
  {
    type: "conversation.item.added",
    when: "Immediately after a commit",
    meaning: "The item is now part of the conversation. No transcript.",
  },
  {
    type: "conversation.item.done",
    when: "Immediately after a commit",
    meaning: "The item is closed. Still no transcript.",
  },
  {
    type: "conversation.item.input_audio_transcription.completed",
    when: "300–700 ms after a commit",
    meaning:
      "The final, corrected transcript for that item. This is the only event that finalises text.",
  },
];

const ABSENT_EVENTS = [
  {
    type: "input_audio_buffer.speech_started",
    why: "Requires turn detection, which this model rejects outright.",
  },
  {
    type: "input_audio_buffer.speech_stopped",
    why: "Same — no server-side VAD exists for this model.",
  },
  {
    type: "conversation.item.input_audio_transcription.completed (unprompted)",
    why: "Never arrives on its own. Verified: after audio stopped, five seconds passed with zero completions until a commit was sent.",
  },
];

const EXPECTED_NUMBERS = [
  {
    metric: "Ephemeral token mint",
    value: "~400 ms",
    note: "Round trip to our server, which calls OpenAI.",
  },
  {
    metric: "Microphone grant",
    value: "50–450 ms",
    note: "Near-instant once permission is remembered.",
  },
  {
    metric: "SDP exchange",
    value: "~500 ms–1 s",
    note: "POST /v1/realtime/calls.",
  },
  {
    metric: "ICE + DTLS",
    value: "~600 ms",
    note: "Until pc.connectionState is connected.",
  },
  {
    metric: "Total setup",
    value: "1.6–2.0 s",
    note: "start() through session.created.",
  },
  {
    metric: "Delta cadence",
    value: "~200 ms",
    note: "Steady while speech continues.",
  },
  {
    metric: "Commit → completed",
    value: "300–700 ms",
    note: "Observed 603, ~500 and ~320 ms across three utterances.",
  },
];

const PRICING = [
  {
    model: "gpt-live-transcribe",
    price: "$0.017 / min",
    use: "Streaming deltas from live audio. What this experiment uses.",
    current: true,
  },
  {
    model: "whisper-1",
    price: "$0.006 / min",
    use: "Batch transcription of completed files.",
    current: false,
  },
  {
    model: "gpt-transcribe",
    price: "$0.0045 / min",
    use: "Async transcription; in realtime only after a committed turn.",
    current: false,
  },
];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? (
          <CardDescription className="leading-6">{description}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function BehaviourPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-12">
      <div className="flex flex-col gap-4">
        <Link
          href="/experiments/live-transcribe"
          className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-2 text-sm transition-colors"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to the experiment
        </Link>

        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            How this model actually behaves
          </h1>
          <p className="text-muted-foreground max-w-2xl leading-7">
            Everything here was measured against the live API, not copied from
            the documentation. Where the two disagree, this page describes what
            the API did.
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="font-mono">
              {LIVE_TRANSCRIBE_MODEL}
            </Badge>
            <Badge variant="outline">WebRTC</Badge>
            <Badge variant="outline">verified Aug 2026</Badge>
          </div>
        </div>
      </div>

      <Section
        title="The life of a piece of text"
        description="Why transcript text starts grey, when it turns solid, and why it ends up split into separate sections."
      >
        <TextLifecycleDiagram />
      </Section>

      <Section title="The 1.5-second rule is ours, not the API's">
        <div className="flex flex-col gap-4 text-sm leading-6">
          <p>
            This model has no turn detection. It will happily stream deltas into
            a single item forever — it never decides that a sentence ended.
            Somebody has to draw the boundary, and since the API will not, this
            app does: <strong>after 1.5 seconds without a new delta, it sends{" "}
            <code className="font-mono text-xs">input_audio_buffer.commit</code></strong>,
            which is what produces the final transcript.
          </p>
          <div className="border-amber-500/40 bg-amber-500/5 rounded-lg border p-4">
            <p className="font-medium">
              The consequence you will actually notice
            </p>
            <p className="text-muted-foreground mt-1">
              If you pause for more than 1.5 seconds in the middle of a
              sentence, that sentence is cut into two sections. Nothing is lost,
              but the split is real and it happened on the client. If you find
              yourself thinking &ldquo;why did it break my sentence there&rdquo;,
              this is why.
            </p>
          </div>
          <p className="text-muted-foreground">
            The trade-off is symmetrical: a shorter timeout finalises text
            sooner but fragments natural speech more; a longer one keeps
            sentences whole but leaves text provisional for longer. 1.5 s is a
            starting point, not a discovered optimum. It lives in{" "}
            <code className="font-mono text-xs">
              IDLE_COMMIT_MS
            </code>{" "}
            in{" "}
            <code className="font-mono text-xs">use-live-transcribe.ts</code>.
          </p>
        </div>
      </Section>

      <Section
        title="Events that arrive"
        description="Observed on the oai-events data channel during a normal run."
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[38%]">Event</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Meaning</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ARRIVING_EVENTS.map((event) => (
                <TableRow key={event.type}>
                  <TableCell className="font-mono text-xs break-all">
                    {event.type}
                  </TableCell>
                  <TableCell className="text-sm">{event.when}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {event.meaning}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section
        title="Events that never arrive"
        description="Waiting on any of these will hang forever."
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[45%]">Event</TableHead>
                <TableHead>Why not</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ABSENT_EVENTS.map((event) => (
                <TableRow key={event.type}>
                  <TableCell className="text-muted-foreground font-mono text-xs break-all line-through decoration-1">
                    {event.type}
                  </TableCell>
                  <TableCell className="text-sm">{event.why}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-muted-foreground mt-4 text-sm leading-6">
          Because there is no{" "}
          <code className="font-mono text-xs">speech_started</code>, the
          &ldquo;Transcribing&rdquo; indicator and the speech-onset timestamp
          are both derived locally — the former from recent delta arrivals, the
          latter from the microphone level crossing a calibrated silence floor.
        </p>
      </Section>

      <Section
        title="Numbers to expect"
        description="From a real run on a Logitech C925e, en+ro, delay: low, noise_reduction: near_field."
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Typical</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {EXPECTED_NUMBERS.map((row) => (
                <TableRow key={row.metric}>
                  <TableCell className="text-sm font-medium">
                    {row.metric}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {row.value}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {row.note}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-muted-foreground mt-4 text-sm leading-6">
          One caveat on benchmarking: the headline &ldquo;time to first
          word&rdquo; is measured from <em>speech onset</em>, not from{" "}
          <code className="font-mono text-xs">start()</code>. Measured from
          <code className="font-mono text-xs"> start()</code> it would mostly
          record how long you spent looking at the screen before talking —
          seconds of variance that bury the few hundred milliseconds separating
          the <code className="font-mono text-xs">delay</code> settings.
        </p>
      </Section>

      <Section
        title="US vs EU endpoints"
        description="Preliminary — n=6 per endpoint. Enough to raise a question, not to answer one."
      >
        <div className="flex flex-col gap-4 text-sm leading-6">
          <p>
            <code className="font-mono text-xs">eu.api.openai.com</code> returns
            200 on a personal account, even though the documentation describes
            data residency as gated behind enterprise approval and a signed
            amendment. The endpoint answers anyway. Treat that as an
            observation, not a guarantee — it may stop working without notice,
            and the app reports an explicit &ldquo;not available for this
            account&rdquo; message if it ever returns 403 or 404.
          </p>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Measurement</TableHead>
                  <TableHead>api.openai.com</TableHead>
                  <TableHead>eu.api.openai.com</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="text-sm font-medium">
                    Resolved IPs
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    172.66.0.243, 162.159.140.245
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    identical — same Cloudflare anycast
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-sm font-medium">
                    TLS handshake
                  </TableCell>
                  <TableCell className="font-mono text-sm">~66 ms</TableCell>
                  <TableCell className="font-mono text-sm">~62–74 ms</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-sm font-medium">
                    Mint, median of 6
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    265 ms{" "}
                    <span className="text-muted-foreground">(250–419)</span>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    284 ms{" "}
                    <span className="text-muted-foreground">(203–1859)</span>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <p className="text-muted-foreground">
            The medians are effectively equal. EU showed a much fatter tail, but
            one 1.86 s outlier in six probes is not a finding. Both hostnames
            hit the same edge, so any real difference lives in routing from that
            edge to the origin — which TLS timings cannot see. That is precisely
            why the selector exists: accumulate a few dozen runs in the history
            and read those medians instead of trusting six probes.
          </p>
          <p className="text-muted-foreground">
            The more informative number is the ICE round-trip reported by the
            connection test. HTTPS terminates at a nearby CDN edge, but RTP goes
            to real media servers — so the media path can be far away even when
            the API edge answers in 66 ms.
          </p>
        </div>
      </Section>

      <Section
        title="What the model will not give you"
        description="Hard constraints. No configuration unlocks these."
      >
        <ul className="flex flex-col gap-2 text-sm leading-6">
          <li>
            <strong>No word-level timestamps.</strong> Use a file-transcription
            model if you need them.
          </li>
          <li>
            <strong>No speaker labels.</strong>{" "}
            <code className="font-mono text-xs">gpt-4o-transcribe-diarize</code>{" "}
            is the model for diarisation.
          </li>
          <li>
            <strong>No confidence scores.</strong> Logprobs can be requested via{" "}
            <code className="font-mono text-xs">
              include: [&quot;item.input_audio_transcription.logprobs&quot;]
            </code>
            , but that is per-token likelihood, not a transcript confidence.
          </li>
          <li>
            <strong>No turn detection.</strong> Sending{" "}
            <code className="font-mono text-xs">turn_detection</code> is
            rejected with &ldquo;Turn detection is not supported for this
            transcription model.&rdquo;
          </li>
        </ul>

        <div className="mt-6 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead>Use</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {PRICING.map((row) => (
                <TableRow key={row.model}>
                  <TableCell className="font-mono text-xs">
                    {row.model}
                    {row.current ? (
                      <Badge variant="secondary" className="ml-2 text-[10px]">
                        in use
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {row.price}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {row.use}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-muted-foreground mt-3 text-sm leading-6">
          Live streaming costs roughly three times batch transcription. If text
          is not needed until the recording ends, the cheaper models are the
          right call.
        </p>
      </Section>

      <Section
        title="Troubleshooting"
        description="Ordered by how much time each one has already cost."
      >
        <div className="flex flex-col gap-5 text-sm leading-6">
          <div>
            <p className="font-medium">
              Connected, but no text ever appears
            </p>
            <p className="text-muted-foreground mt-1">
              Check the <strong>Outbound audio</strong> panel first. If{" "}
              <code className="font-mono text-xs">packetsSent</code> is 0, no
              audio is leaving the browser at all. If packets are flowing but{" "}
              <code className="font-mono text-xs">audioLevel</code> is ~0, the
              microphone is capturing silence — wrong input device, muted at the
              OS level, or a hardware mute switch. This is the failure mode that
              looks exactly like a broken API, and it is not one: the session
              config has been verified working end to end.
            </p>
          </div>

          <div>
            <p className="font-medium">Text appears but accuracy is poor</p>
            <p className="text-muted-foreground mt-1">
              Look at the input level. A webcam microphone measured{" "}
              <code className="font-mono text-xs">audioLevel 0.0027</code> —
              audible, but very quiet. At that level whole phrases came back
              mangled and &ldquo;OK&rdquo; was transcribed as a caress. Move
              closer, raise the input gain in the OS, or switch to a headset.
              Also try <code className="font-mono text-xs">far_field</code> noise
              reduction for a laptop or room microphone, and raise{" "}
              <code className="font-mono text-xs">delay</code> to give the model
              more context per chunk.
            </p>
          </div>

          <div>
            <p className="font-medium">
              Text stays grey and never finalises
            </p>
            <p className="text-muted-foreground mt-1">
              A commit was never sent. That only happens if the data channel
              closed, or if deltas are still arriving so the 1.5 s idle timer
              keeps resetting. Pressing Stop always forces a final commit.
            </p>
          </div>

          <div>
            <p className="font-medium">A sentence got split in two</p>
            <p className="text-muted-foreground mt-1">
              Expected — you paused for more than 1.5 s. See above.
            </p>
          </div>

          <div>
            <p className="font-medium">
              Yellow &ldquo;unexpected&rdquo; tags in the event log
            </p>
            <p className="text-muted-foreground mt-1">
              Those mark event types never observed before. The routine commit
              trio —{" "}
              <code className="font-mono text-xs">
                input_audio_buffer.committed
              </code>
              , <code className="font-mono text-xs">conversation.item.added</code>
              , <code className="font-mono text-xs">conversation.item.done</code>{" "}
              — is known and is no longer flagged. Anything still highlighted is
              genuinely new and worth reading.
            </p>
          </div>
        </div>
      </Section>
    </main>
  );
}
