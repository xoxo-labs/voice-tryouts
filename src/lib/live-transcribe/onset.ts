import { median } from "./timings";

/**
 * Speech-onset detection parameters.
 *
 * The threshold is derived from a per-run silence measurement rather than
 * hardcoded. Input levels vary enormously by device — a Logitech webcam idles
 * around 0.0027 RMS while a headset boom mic sits an order of magnitude
 * higher — so any fixed number would either never fire or fire constantly.
 */
export const ONSET = {
  /** How often to sample the analyser. */
  sampleMs: 50,
  /** Opening window used to measure the room's silence floor. */
  calibrationMs: 400,
  /** Consecutive above-threshold samples required, so a keyboard click or
   *  chair creak cannot register as speech. */
  sustainSamples: 3,
  /** Threshold = baseline × this. */
  baselineMultiplier: 4,
  /** Lower bound, for when the baseline calibrates to (near) digital zero. */
  absoluteFloor: 0.0006,
} as const;

export interface OnsetDetector {
  readonly baseline: number | null;
  readonly threshold: number | null;
  readonly onsetAt: number | null;
  /**
   * Feed one RMS sample. Returns the onset timestamp the first time speech is
   * confirmed, then `null` forever after.
   */
  push(rms: number, now: number): number | null;
}

/**
 * `startedAt` anchors the calibration window; pass the timestamp at which the
 * microphone stream became live.
 */
export function createOnsetDetector(startedAt: number): OnsetDetector {
  const calibration: number[] = [];
  let baseline: number | null = null;
  let threshold: number | null = null;
  let streak: number[] = [];
  let onsetAt: number | null = null;

  return {
    get baseline() {
      return baseline;
    },
    get threshold() {
      return threshold;
    },
    get onsetAt() {
      return onsetAt;
    },
    push(rms: number, now: number) {
      if (onsetAt != null) return null;

      // Still listening to the room.
      if (now - startedAt < ONSET.calibrationMs) {
        calibration.push(rms);
        return null;
      }

      if (baseline == null) {
        baseline = calibration.length > 0 ? median(calibration) : 0;
        threshold = Math.max(
          baseline * ONSET.baselineMultiplier,
          ONSET.absoluteFloor,
        );
      }

      if (threshold != null && rms > threshold) {
        streak.push(now);
        if (streak.length >= ONSET.sustainSamples) {
          // Credit the onset to the first sample of the run, not the last —
          // the speech really began there.
          onsetAt = streak[0];
          return onsetAt;
        }
      } else {
        streak = [];
      }

      return null;
    },
  };
}

/** RMS of a time-domain buffer. */
export function computeRms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}
