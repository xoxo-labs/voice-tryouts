"use client";

import { useCallback, useEffect, useState } from "react";

export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

export interface AudioInputSnapshot {
  devices: AudioInputDevice[];
  /**
   * `false` until the user has granted microphone permission at least once —
   * browsers blank out `label` before that, so the names are placeholders.
   */
  hasLabels: boolean;
  /** The API does not exist at all in this browser/context. Permanent. */
  supported: boolean;
  /**
   * enumerateDevices exists but threw on the last attempt. Transient —
   * distinct from `supported: false`, and worth retrying via `refresh()`.
   */
  enumerationFailed: boolean;
}

const EMPTY: AudioInputSnapshot = {
  devices: [],
  hasLabels: false,
  supported: true,
  enumerationFailed: false,
};

/**
 * Pure read of the current audio inputs. Deliberately free of React state so
 * it can be called from effects without tripping `set-state-in-effect`.
 *
 * Devices with an empty `deviceId` (pre-permission placeholders) are dropped:
 * they cannot be used as a constraint, and Radix Select forbids empty values.
 */
async function readAudioInputs(): Promise<AudioInputSnapshot> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.enumerateDevices
  ) {
    return { ...EMPTY, supported: false };
  }

  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    const inputs = all.filter(
      (device) => device.kind === "audioinput" && device.deviceId !== "",
    );

    return {
      supported: true,
      enumerationFailed: false,
      hasLabels: inputs.some((device) => device.label !== ""),
      devices: inputs.map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Microphone ${index + 1}`,
      })),
    };
  } catch {
    // The API exists but this attempt failed — transient, retryable.
    return { ...EMPTY, enumerationFailed: true };
  }
}

export interface UseAudioInputDevicesResult extends AudioInputSnapshot {
  refresh: () => void;
}

/**
 * Enumerates audio input devices and keeps the list fresh across hot-plugs.
 * Call `refresh()` after microphone permission is granted — that is when the
 * real device names become readable.
 */
export function useAudioInputDevices(): UseAudioInputDevicesResult {
  const [snapshot, setSnapshot] = useState<AudioInputSnapshot>(EMPTY);

  const refresh = useCallback(() => {
    void readAudioInputs().then(setSnapshot);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      void readAudioInputs().then((next) => {
        if (!cancelled) setSnapshot(next);
      });
    };

    sync();

    const mediaDevices =
      typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) {
      return () => {
        cancelled = true;
      };
    }

    mediaDevices.addEventListener("devicechange", sync);
    return () => {
      cancelled = true;
      mediaDevices.removeEventListener("devicechange", sync);
    };
  }, []);

  return { ...snapshot, refresh };
}
