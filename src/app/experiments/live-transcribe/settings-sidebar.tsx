"use client";

import { ChevronsUpDown, RefreshCw, Settings2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { AudioInputDevice } from "@/hooks/use-audio-input-devices";
import {
  REGION_INFO,
  REGIONS,
  type Region,
} from "@/lib/live-transcribe/regions";
import { describeKey } from "@/lib/live-transcribe/token-cache";
import {
  NOISE_REDUCTION_MODES,
  TRANSCRIBE_DELAYS,
  type NoiseReductionMode,
  type StartMode,
  type TokenCacheState,
  type TranscribeDelay,
} from "@/lib/live-transcribe/types";

import { LanguagePicker } from "./language-picker";

/** Sentinel for "let the browser choose" — Select forbids empty values. */
export const DEFAULT_MIC = "__default__";

const NOISE_REDUCTION_LABEL: Record<NoiseReductionMode, string> = {
  near_field: "near_field — headset",
  far_field: "far_field — laptop / room",
  off: "off — no filtering",
};

export interface SettingsSidebarProps {
  disabled: boolean;
  delay: TranscribeDelay;
  onDelayChange: (value: TranscribeDelay) => void;
  noiseReduction: NoiseReductionMode;
  onNoiseReductionChange: (value: NoiseReductionMode) => void;
  languages: string[];
  onLanguagesChange: (value: string[]) => void;
  region: Region;
  onRegionChange: (value: Region) => void;
  micId: string;
  onMicIdChange: (value: string) => void;
  devices: AudioInputDevice[];
  hasLabels: boolean;
  micSupported: boolean;
  enumerationFailed: boolean;
  onRefreshDevices: () => void;
  startMode: StartMode;
  onStartModeChange: (value: StartMode) => void;
  tokenCache: TokenCacheState;
}

function Fields(props: SettingsSidebarProps) {
  const {
    disabled,
    delay,
    onDelayChange,
    noiseReduction,
    onNoiseReductionChange,
    languages,
    onLanguagesChange,
    region,
    onRegionChange,
    micId,
    onMicIdChange,
    devices,
    hasLabels,
    micSupported,
    enumerationFailed,
    onRefreshDevices,
    startMode,
    onStartModeChange,
    tokenCache,
  } = props;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="delay">Delay</Label>
        <Select
          value={delay}
          onValueChange={(value) => onDelayChange(value as TranscribeDelay)}
          disabled={disabled}
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
          Lower emits partial text sooner; higher gives more context.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="noise-reduction">Noise reduction</Label>
        <Select
          value={noiseReduction}
          onValueChange={(value) =>
            onNoiseReductionChange(value as NoiseReductionMode)
          }
          disabled={disabled}
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
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="microphone">Microphone</Label>
          <button
            type="button"
            onClick={onRefreshDevices}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
          >
            <RefreshCw className="size-3" aria-hidden />
            Refresh
          </button>
        </div>
        <Select
          value={micId}
          onValueChange={onMicIdChange}
          disabled={disabled || !micSupported}
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
          {!micSupported
            ? "This browser cannot enumerate audio devices."
            : enumerationFailed
              ? "Device enumeration failed — press Refresh to retry."
              : devices.length === 0
                ? "No input devices found yet."
                : hasLabels
                  ? `${devices.length} input${devices.length === 1 ? "" : "s"} detected.`
                  : "Names appear after you allow the microphone once."}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Languages</Label>
        <LanguagePicker
          value={languages}
          onChange={onLanguagesChange}
          disabled={disabled}
        />
      </div>

      <Separator />

      <div className="flex flex-col gap-2">
        <Label htmlFor="region">API region</Label>
        <Select
          value={region}
          onValueChange={(value) => onRegionChange(value as Region)}
          disabled={disabled}
        >
          <SelectTrigger id="region" className="w-full">
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
          {REGION_INFO[region].note} Applied to both the token mint and the SDP
          connection.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="start-mode">Start mode</Label>
        <Select
          value={startMode}
          onValueChange={(value) => onStartModeChange(value as StartMode)}
          disabled={disabled}
        >
          <SelectTrigger id="start-mode" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cold">cold — mint token at Start</SelectItem>
            <SelectItem value="warm">warm — reuse pre-minted token</SelectItem>
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
            className="w-fit font-mono text-[11px]"
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
        <p className="text-muted-foreground text-xs">
          Warm removes ~400 ms from Start, but changes what you measure — keep
          cold and warm runs apart when reading medians.
        </p>
      </div>
    </div>
  );
}

/**
 * All session settings. Sticky panel on desktop; collapsible on mobile so the
 * transcript is not pushed below the fold.
 */
export function SettingsSidebar(props: SettingsSidebarProps) {
  return (
    <>
      {/* Mobile: collapsed by default. */}
      <Collapsible className="bg-card rounded-xl border lg:hidden">
        <CollapsibleTrigger className="flex w-full items-center gap-2 p-4 text-sm font-medium">
          <Settings2 className="size-4" aria-hidden />
          Session settings
          <ChevronsUpDown
            className="text-muted-foreground ml-auto size-4"
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="px-4 pb-4">
          <Fields {...props} />
        </CollapsibleContent>
      </Collapsible>

      {/* Desktop: always visible, sticky. */}
      <div className="bg-card sticky top-6 hidden max-h-[calc(100vh-3rem)] flex-col gap-4 overflow-y-auto rounded-xl border p-5 lg:flex">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Settings2 className="size-4" aria-hidden />
          Session settings
        </h2>
        <p className="text-muted-foreground text-xs leading-5">
          Settings are baked into the ephemeral client secret when it is
          minted, so each run reconnects with exactly these values.
        </p>
        <Fields {...props} />
      </div>
    </>
  );
}
