"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useAudioInputDevices } from "@/hooks/use-audio-input-devices";
import { useLiveTranscribe } from "@/hooks/use-live-transcribe";
import { DEFAULT_REGION, type Region } from "@/lib/realtime-transcribe";
import type {
  CaptureSettings,
  LiveTranscribeSettings,
  NoiseReductionMode,
  StartMode,
  TranscribeDelay,
  TransportKind,
} from "@/lib/realtime-transcribe";
import { cn } from "@/lib/utils";

import { ActionBar } from "./action-bar";
import { ConnectionTestPanel } from "./connection-test-panel";
import { AudioStatsPanel, EventLog } from "./event-log";
import { RunHistory } from "./run-history";
import { SectionLabel, SectionNote } from "./section-label";
import { DEFAULT_MIC, SettingsSidebar } from "./settings-sidebar";
import { TimingsTable } from "./timings-table";
import { TranscriptPanel } from "./transcript-panel";

export function LiveTranscribeExperiment({
  defaultTransport = "webrtc",
}: {
  defaultTransport?: TransportKind;
}) {
  const [delay, setDelay] = useState<TranscribeDelay>("low");
  const [noiseReduction, setNoiseReduction] =
    useState<NoiseReductionMode>("near_field");
  const [languages, setLanguages] = useState<string[]>(["en"]);
  const [micId, setMicId] = useState<string>(DEFAULT_MIC);
  const [startMode, setStartMode] = useState<StartMode>("cold");
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [transport, setTransport] = useState<TransportKind>(defaultTransport);
  const [testHasFailures, setTestHasFailures] = useState(false);

  const {
    devices,
    hasLabels,
    supported,
    enumerationFailed,
    refresh,
  } = useAudioInputDevices();

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
    () => ({ delay, noiseReduction, languages, region, transport }),
    [delay, noiseReduction, languages, region, transport],
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

  const handleStart = useCallback(() => {
    void start(settings, capture, startMode);
  }, [start, settings, capture, startMode]);

  // The user's recurring failure mode is the SILENT one: everything looks
  // connected while nothing flows. If anything is wrong — run error, audio
  // dead while connected, or a failed connection test — the Diagnostics tab
  // gets a visible dot from every other tab instead of hiding the evidence.
  const audioDeadWhileConnected =
    status === "connected" &&
    audioStats != null &&
    (audioStats.packetsSent === 0 ||
      (audioStats.audioLevel != null && audioStats.audioLevel < 0.001));
  const diagnosticsAlert =
    error != null || audioDeadWhileConnected || testHasFailures;

  return (
    <div className="flex flex-col gap-6">
      <ActionBar
        status={status}
        isActive={isActive}
        isTranscribing={isTranscribing}
        error={error}
        marks={marks}
        canRunAgain={isActive || runs.length > 0}
        onStart={handleStart}
        onStop={stop}
      />

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]">
        <div>
          <SettingsSidebar
            disabled={isActive}
            delay={delay}
            onDelayChange={setDelay}
            noiseReduction={noiseReduction}
            onNoiseReductionChange={setNoiseReduction}
            languages={languages}
            onLanguagesChange={setLanguages}
            region={region}
            onRegionChange={setRegion}
            micId={effectiveMicId}
            onMicIdChange={setMicId}
            devices={devices}
            hasLabels={hasLabels}
            micSupported={supported}
            enumerationFailed={enumerationFailed}
            onRefreshDevices={refresh}
            startMode={startMode}
            onStartModeChange={setStartMode}
            transport={transport}
            onTransportChange={setTransport}
            tokenCache={tokenCache}
          />
        </div>

        <Tabs defaultValue="live" className="min-w-0">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="live">Live</TabsTrigger>
            <TabsTrigger value="benchmark">Benchmark</TabsTrigger>
            <TabsTrigger value="diagnostics" className="relative">
              Diagnostics
              {diagnosticsAlert ? (
                <span
                  className={cn(
                    "bg-destructive absolute -top-0.5 -right-0.5 size-2 rounded-full",
                  )}
                  aria-label="Diagnostics need attention"
                />
              ) : null}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="live" className="mt-6">
            {/* The transcript is the hero — no box, just air. */}
            <TranscriptPanel utterances={utterances} isActive={isActive} />
            <p className="text-muted-foreground/70 mt-6 border-t pt-3 text-xs leading-5">
              Streaming deltas are grey and italic. An utterance is finalised
              only when a commit is sent — this model has no server-side turn
              detection, so the app commits after{" "}
              <span className="font-mono">1.5 s</span> of delta silence.
            </p>
          </TabsContent>

          <TabsContent value="benchmark" className="mt-6 flex flex-col gap-10">
            <section className="flex flex-col gap-3">
              <SectionLabel>Current run timings</SectionLabel>
              <SectionNote>
                Measured with{" "}
                <code className="font-mono text-xs">performance.now()</code>{" "}
                relative to the <code className="font-mono text-xs">start()</code>{" "}
                call.
              </SectionNote>
              <TimingsTable
                marks={marks}
                tokenSource={tokenSource}
                transport={transport}
              />
            </section>

            <section className="flex flex-col gap-3">
              <SectionLabel>Run history</SectionLabel>
              <SectionNote>
                Connection setup is the noisiest number — judge it over several
                runs.
              </SectionNote>
              <RunHistory
                runs={runs}
                currentSettings={settings}
                currentStartMode={startMode}
                onClear={clearRuns}
              />
            </section>
          </TabsContent>

          <TabsContent value="diagnostics" className="mt-6 flex flex-col gap-10">
            <section className="flex flex-col gap-3">
              <SectionLabel>Connection test</SectionLabel>
              <SectionNote>
                Checks every link in the chain and says exactly which one broke.
                A check that cannot run reports why it was skipped.
              </SectionNote>
              <ConnectionTestPanel
                settings={settings}
                capture={capture}
                disabled={isActive}
                onFailuresChange={setTestHasFailures}
              />
            </section>

            <section className="flex flex-col gap-3">
              <SectionLabel>Outbound audio</SectionLabel>
              <SectionNote>
                Read from <code className="font-mono text-xs">pc.getStats()</code>
                . If these stay at zero while connected, the microphone is the
                problem, not the API.
              </SectionNote>
              <AudioStatsPanel
                stats={audioStats}
                meter={levelMeter}
                isActive={isActive}
              />
            </section>

            <section className="flex flex-col gap-3">
              <SectionLabel>Event log</SectionLabel>
              <SectionNote>
                Every message on the{" "}
                <code className="font-mono text-xs">oai-events</code> channel,
                plus client-side milestones. Click a row for the full payload.
              </SectionNote>
              <EventLog events={events} />
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
