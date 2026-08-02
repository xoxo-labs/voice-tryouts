"use client";

import { cn } from "@/lib/utils";
import { formatMs } from "@xoxo-labs/realtime-transcribe";
import type {
  AudioStats,
  LevelMeter,
  LoggedEvent,
} from "@xoxo-labs/realtime-transcribe";

/**
 * Live mic level against the calibrated silence floor. Makes the speech-onset
 * detection auditable — you can see the threshold it picked and whether your
 * voice actually crosses it.
 */
export function LevelMeterBar({ meter }: { meter: LevelMeter }) {
  // Scale relative to the threshold so quiet mics stay legible: a webcam
  // peaking at 0.003 would be invisible on a 0..1 bar.
  const ceiling = Math.max((meter.threshold ?? 0.01) * 4, meter.rms * 1.2, 1e-6);
  const pct = Math.min(100, (meter.rms / ceiling) * 100);
  const thresholdPct =
    meter.threshold == null
      ? null
      : Math.min(100, (meter.threshold / ceiling) * 100);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
          Input level
        </span>
        <span className="font-mono text-xs tabular-nums">
          rms {meter.rms.toFixed(4)}
          {meter.threshold != null
            ? ` · threshold ${meter.threshold.toFixed(4)}`
            : " · calibrating…"}
          {meter.baseline != null
            ? ` · floor ${meter.baseline.toFixed(4)}`
            : ""}
        </span>
      </div>
      <div className="bg-muted relative h-2.5 overflow-hidden rounded-full">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-75",
            meter.threshold != null && meter.rms > meter.threshold
              ? "bg-amber-500"
              : "bg-muted-foreground/40",
          )}
          style={{ width: `${pct}%` }}
        />
        {thresholdPct != null ? (
          <div
            className="bg-foreground/70 absolute inset-y-0 w-px"
            style={{ left: `${thresholdPct}%` }}
            aria-hidden
          />
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs">
        {meter.onsetDetected
          ? "Speech onset detected — time-to-first-word is measured from that moment."
          : "Waiting for sustained audio above the threshold (vertical line)."}
      </p>
    </div>
  );
}

function StatReadout({
  label,
  value,
  hint,
  alarm,
}: {
  label: string;
  value: string;
  hint: string;
  alarm?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-lg font-medium tabular-nums",
          alarm && "text-destructive",
        )}
      >
        {value}
      </span>
      <span className="text-muted-foreground/80 font-mono text-[11px]">
        {hint}
      </span>
    </div>
  );
}

/**
 * Outbound RTP counters. This is the fastest way to tell a dead microphone
 * apart from a server-side problem: if nothing is being sent, or the level is
 * pinned at zero, no amount of API debugging will help.
 */
export function AudioStatsPanel({
  stats,
  meter,
  isActive,
}: {
  stats: AudioStats | null;
  meter: LevelMeter | null;
  isActive: boolean;
}) {
  if (!stats) {
    return (
      <div className="flex flex-col gap-4">
        {meter ? <LevelMeterBar meter={meter} /> : null}
        <p className="text-muted-foreground text-sm">
          {isActive
            ? "Waiting for the first stats sample…"
            : "Outbound audio counters appear here once a run is connected."}
        </p>
      </div>
    );
  }

  const silent = stats.audioLevel != null && stats.audioLevel < 0.001;
  const notSending = stats.packetsSent === 0;

  return (
    <div className="flex flex-col gap-4">
      {meter ? <LevelMeterBar meter={meter} /> : null}
      <div className="grid grid-cols-2 gap-x-8 gap-y-5 lg:grid-cols-4">
        <StatReadout
          label="Packets sent"
          value={stats.packetsSent.toLocaleString()}
          hint="outbound-rtp"
          alarm={notSending}
        />
        <StatReadout
          label="Bytes sent"
          value={stats.bytesSent.toLocaleString()}
          hint="outbound-rtp"
          alarm={notSending}
        />
        <StatReadout
          label="Input level"
          value={
            stats.audioLevel == null ? "—" : stats.audioLevel.toFixed(4)
          }
          hint="media-source audioLevel"
          alarm={silent}
        />
        <StatReadout
          label="Total energy"
          value={
            stats.totalAudioEnergy == null
              ? "—"
              : stats.totalAudioEnergy.toFixed(4)
          }
          hint="media-source totalAudioEnergy"
          alarm={silent}
        />
      </div>

      {(notSending || silent) && isActive ? (
        <p className="text-destructive text-sm">
          {notSending
            ? "No RTP packets are leaving the browser — the peer connection is not carrying audio."
            : "The microphone is producing silence. Check that the selected input device is the one you are speaking into, and that it is not muted at the OS level."}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Every event seen on the data channel, including ones the app does not act
 * on — silently swallowing unknown types is how you end up debugging blind.
 */
export function EventLog({ events }: { events: LoggedEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No events yet. Start a run to see raw traffic on the{" "}
        <code className="font-mono text-xs">oai-events</code> channel.
      </p>
    );
  }

  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Frequency summary as one dense mono line, not a badge cloud. */}
      <p className="text-muted-foreground font-mono text-[11px] leading-5">
        {[...counts.entries()]
          .map(([type, count]) => `${type} ×${count}`)
          .join("   ")}
      </p>

      <div className="max-h-96 overflow-y-auto border-y">
        <ul className="divide-border/60 divide-y">
          {events.map((event) => (
            <li key={event.id} className="py-1">
              <details className="group">
                <summary className="flex cursor-pointer items-baseline gap-3 text-sm marker:content-['']">
                  <span className="text-muted-foreground/70 w-16 shrink-0 text-right font-mono text-[11px] tabular-nums">
                    {formatMs(event.at)}
                  </span>
                  <span
                    className={cn(
                      "font-mono text-xs break-all",
                      event.expected
                        ? event.type.startsWith("→")
                          ? "text-muted-foreground"
                          : "text-foreground"
                        : "font-semibold text-amber-600 dark:text-amber-500",
                    )}
                  >
                    {event.type}
                  </span>
                  {!event.expected ? (
                    <span className="ml-auto shrink-0 font-mono text-[10px] tracking-wide text-amber-600 uppercase dark:text-amber-500">
                      unexpected
                    </span>
                  ) : null}
                </summary>
                <pre className="bg-muted/50 mt-2 max-h-56 overflow-auto rounded p-2 font-mono text-[11px] leading-5">
                  {event.payload}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
