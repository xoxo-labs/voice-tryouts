"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Mic, RefreshCw, RotateCw, Square } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useAudioInputDevices } from "@/hooks/use-audio-input-devices";
import { useLiveTranscribe } from "@/hooks/use-live-transcribe";
import {
  NOISE_REDUCTION_MODES,
  TRANSCRIBE_DELAYS,
  type CaptureSettings,
  type ConnectionStatus,
  type LiveTranscribeSettings,
  type NoiseReductionMode,
  type StartMode,
  type TranscribeDelay,
} from "@/lib/live-transcribe/types";
import { describeKey } from "@/lib/live-transcribe/token-cache";
import {
  DEFAULT_REGION,
  REGION_INFO,
  REGIONS,
  type Region,
} from "@/lib/live-transcribe/regions";
import { cn } from "@/lib/utils";

import { ConnectionTestPanel } from "./connection-test-panel";
import { AudioStatsPanel, EventLog } from "./event-log";
import { LanguagePicker } from "./language-picker";
import { RunHistory } from "./run-history";
import { TimingsTable } from "./timings-table";

/** Sentinel for "let the browser choose" — Select forbids empty values. */
const DEFAULT_MIC = "__default__";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  idle: "Idle",
  preparing: "Preparing",
  "minting-token": "Minting token",
  "requesting-mic": "Requesting mic",
  negotiating: "Negotiating",
  connecting: "Exchanging SDP",
  connected: "Connected",
  stopping: "Finalising",
  error: "Error",
};

const NOISE_REDUCTION_LABEL: Record<NoiseReductionMode, string> = {
  near_field: "near_field — headset / close mic",
  far_field: "far_field — laptop / room mic",
  off: "off — no filtering",
};

export function LiveTranscribeExperiment() {
  const [delay, setDelay] = useState<TranscribeDelay>("low");
  const [noiseReduction, setNoiseReduction] =
    useState<NoiseReductionMode>("near_field");
  const [languages, setLanguages] = useState<string[]>(["en"]);
  const [micId, setMicId] = useState<string>(DEFAULT_MIC);
  const [startMode, setStartMode] = useState<StartMode>("cold");
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);

  const { devices, hasLabels, supported, refresh } = useAudioInputDevices();

  const {
    status,
    isActive,
    error,
    utterances,
    isTranscribing,
    marks,
    events,
    audioStats,
    levelMeter,
    runs,
    tokenCache,
    tokenSource,
    prewarm,
    start,
    stop,
    clearRuns,
  } = useLiveTranscribe();

  // Labels are blank until permission has been granted once, so re-enumerate
  // as soon as a run gets past the getUserMedia prompt.
  const micGrantedAt = marks.micEnd;
  useEffect(() => {
    if (micGrantedAt != null) refresh();
  }, [micGrantedAt, refresh]);

  // A device can vanish mid-session (headset unplugged). Derive the effective
  // selection during render rather than correcting state in an effect.
  const selectedExists = devices.some((device) => device.deviceId === micId);
  const effectiveMicId =
    micId !== DEFAULT_MIC && devices.length > 0 && !selectedExists
      ? DEFAULT_MIC
      : micId;

  const settings: LiveTranscribeSettings = useMemo(
    () => ({ delay, noiseReduction, languages, region }),
    [delay, noiseReduction, languages, region],
  );

  // Keep a secret hot for the current settings. The cache is keyed on the
  // settings because they are baked into the secret, so changing any of them
  // invalidates it and re-mints.
  const shouldPrewarm = startMode === "warm" && !isActive;
  useEffect(() => {
    if (shouldPrewarm) prewarm(settings);
  }, [shouldPrewarm, settings, prewarm]);

  const capture: CaptureSettings = useMemo(() => {
    if (effectiveMicId === DEFAULT_MIC) {
      return { deviceId: null, deviceLabel: "System default" };
    }
    const match = devices.find((device) => device.deviceId === effectiveMicId);
    return {
      deviceId: effectiveMicId,
      deviceLabel: match?.label ?? effectiveMicId,
    };
  }, [effectiveMicId, devices]);

  const hasTranscript = utterances.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Session settings</CardTitle>
          <CardDescription>
            Settings are baked into the ephemeral client secret when it is
            minted, so each run reconnects with exactly these values.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="delay">Delay</Label>
              <Select
                value={delay}
                onValueChange={(value) => setDelay(value as TranscribeDelay)}
                disabled={isActive}
              >
                <SelectTrigger id="delay" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRANSCRIBE_DELAYS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Lower emits partial text sooner; higher gives the model more
                context.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="noise-reduction">Noise reduction</Label>
              <Select
                value={noiseReduction}
                onValueChange={(value) =>
                  setNoiseReduction(value as NoiseReductionMode)
                }
                disabled={isActive}
              >
                <SelectTrigger id="noise-reduction" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NOISE_REDUCTION_MODES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {NOISE_REDUCTION_LABEL[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Filters audio before the model. Defaults to off in the API.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="microphone">Microphone</Label>
                <button
                  type="button"
                  onClick={refresh}
                  className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
                >
                  <RefreshCw className="size-3" aria-hidden />
                  Refresh
                </button>
              </div>
              <Select
                value={effectiveMicId}
                onValueChange={setMicId}
                disabled={isActive || !supported}
              >
                <SelectTrigger id="microphone" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_MIC}>System default</SelectItem>
                  {devices.map((device) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                {!supported
                  ? "This browser cannot enumerate audio devices."
                  : devices.length === 0
                    ? "No input devices found yet."
                    : hasLabels
                      ? `${devices.length} input${devices.length === 1 ? "" : "s"} detected.`
                      : "Names appear after you allow the microphone once."}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Languages</Label>
            <LanguagePicker
              value={languages}
              onChange={setLanguages}
              disabled={isActive}
            />
          </div>

          <Separator />

          <div className="flex flex-col gap-2">
            <Label htmlFor="region">API region</Label>
            <Select
              value={region}
              onValueChange={(value) => setRegion(value as Region)}
              disabled={isActive}
            >
              <SelectTrigger id="region" className="w-full sm:w-96">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REGIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {REGION_INFO[option].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              {REGION_INFO[region].note} The region is applied to both the token
              mint and the SDP connection, so a run never straddles two
              endpoints.
            </p>
          </div>

          <Separator />

          <div className="flex flex-col gap-2">
            <Label htmlFor="start-mode">Start mode</Label>
            <div className="flex flex-wrap items-center gap-3">
              <Select
                value={startMode}
                onValueChange={(value) => setStartMode(value as StartMode)}
                disabled={isActive}
              >
                <SelectTrigger id="start-mode" className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cold">
                    cold — mint the token at Start
                  </SelectItem>
                  <SelectItem value="warm">
                    warm — reuse a pre-minted token
                  </SelectItem>
                </SelectContent>
              </Select>

              {startMode === "warm" ? (
                <Badge
                  variant={
                    tokenCache.status === "ready"
                      ? "secondary"
                      : tokenCache.status === "error"
                        ? "destructive"
                        : "outline"
                  }
                  className="font-mono text-[11px]"
                >
                  {tokenCache.status === "ready"
                    ? `token ready · ${describeKey(tokenCache.key)}`
                    : tokenCache.status === "minting"
                      ? "minting…"
                      : tokenCache.status === "error"
                        ? "mint failed"
                        : "no token yet"}
                </Badge>
              ) : null}
            </div>
            <p className="text-muted-foreground text-xs">
              Pre-minting removes ~400 ms from Start, but it also changes what
              you are measuring — keep runs of the two modes apart when reading
              the medians. Changing any setting above invalidates the cached
              token, because the settings are baked into it.
            </p>
          </div>

          <Separator />

          <div className="flex flex-wrap items-center gap-3">
            {isActive ? (
              <Button onClick={stop} variant="destructive">
                <Square aria-hidden />
                Stop
              </Button>
            ) : (
              <Button onClick={() => void start(settings, capture, startMode)}>
                <Mic aria-hidden />
                Start
              </Button>
            )}

            <Button
              variant="outline"
              onClick={() => void start(settings, capture, startMode)}
              disabled={runs.length === 0 && !isActive}
            >
              <RotateCw aria-hidden />
              Run again
            </Button>

            <div className="ml-auto flex items-center gap-3">
              {isTranscribing ? (
                <span className="text-muted-foreground flex items-center gap-2 text-sm">
                  <span className="relative flex size-2">
                    <span className="bg-primary absolute inline-flex size-full animate-ping rounded-full opacity-60" />
                    <span className="bg-primary relative inline-flex size-2 rounded-full" />
                  </span>
                  Transcribing
                </span>
              ) : null}
              <Badge
                variant={
                  status === "error"
                    ? "destructive"
                    : status === "connected"
                      ? "default"
                      : "secondary"
                }
              >
                {STATUS_LABEL[status]}
              </Badge>
            </div>
          </div>

          {error ? (
            <div
              role="alert"
              className="border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-3 rounded-lg border p-3 text-sm"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connection test</CardTitle>
          <CardDescription>
            Checks every link in the chain and says exactly which one broke.
            Nothing here is ever left ambiguous — a check that cannot run
            reports why it was skipped.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConnectionTestPanel
            settings={settings}
            capture={capture}
            disabled={isActive}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transcript</CardTitle>
          <CardDescription>
            Streaming deltas are grey and italic. An utterance is finalised only
            when a commit is sent — this model has no server-side turn
            detection, so the app commits after{" "}
            <span className="font-mono text-xs">1.5 s</span> of delta silence.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hasTranscript ? (
            <div className="flex flex-col gap-3">
              {utterances.map((utterance) => (
                <div key={utterance.itemId} className="flex flex-col gap-1">
                  <p
                    className={cn(
                      "text-base leading-7",
                      utterance.transcript == null &&
                        "text-muted-foreground italic",
                    )}
                  >
                    {utterance.transcript ?? utterance.delta}
                    {utterance.transcript == null && utterance.delta === ""
                      ? "…"
                      : null}
                  </p>
                  {utterance.error ? (
                    <p className="text-destructive text-xs">
                      {utterance.error}
                    </p>
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
          ) : (
            <p className="text-muted-foreground text-sm">
              {isActive
                ? "Listening — start talking."
                : "Press Start, allow the microphone, then speak."}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Outbound audio</CardTitle>
          <CardDescription>
            Read from{" "}
            <code className="font-mono text-xs">pc.getStats()</code>. If these
            stay at zero while connected, the microphone is the problem, not the
            API.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AudioStatsPanel
            stats={audioStats}
            meter={levelMeter}
            isActive={isActive}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current run timings</CardTitle>
          <CardDescription>
            Measured with{" "}
            <code className="font-mono text-xs">performance.now()</code>{" "}
            relative to the <code className="font-mono text-xs">start()</code>{" "}
            call.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TimingsTable marks={marks} tokenSource={tokenSource} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Event log</CardTitle>
          <CardDescription>
            Every message on the{" "}
            <code className="font-mono text-xs">oai-events</code> channel, plus
            client-side milestones (prefixed with an arrow). Click a row for the
            full payload.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EventLog events={events} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Run history</CardTitle>
          <CardDescription>
            Spread across connections — connection setup is the noisiest number,
            so judge it over several runs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RunHistory runs={runs} onClear={clearRuns} />
        </CardContent>
      </Card>
    </div>
  );
}
