/**
 * Formant-synthesised speech, generated in the browser.
 *
 * The connection test needs audio that the transcription model will actually
 * emit deltas for — a sine tone produces silence from the model, which would
 * make the round-trip check fail for the wrong reason. A source-filter model
 * (glottal pulse train through three formant resonators, swept between vowel
 * targets) is close enough to speech to get a transcript back.
 *
 * Verified against the live API: this signal produced deltas and a completed
 * transcript. The *content* is meaningless — what matters is that deltas
 * arrive at all, which is what proves the round trip.
 *
 * Generating it beats shipping a ~400 KB audio fixture in the repo.
 */

/** F1/F2/F3 for a handful of vowels, in Hz. */
const VOWELS: readonly (readonly [number, number, number])[] = [
  [730, 1090, 2440], // a
  [270, 2290, 3010], // i
  [530, 1840, 2480], // e
  [570, 840, 2410], // o
  [300, 870, 2240], // u
];

const SYLLABLE_SECONDS = 0.28;

/** Two-pole resonator — the formant filter. */
function resonate(
  input: Float32Array,
  freq: number,
  bandwidth: number,
  rate: number,
): Float32Array {
  const out = new Float32Array(input.length);
  const theta = (2 * Math.PI * freq) / rate;
  const r = Math.exp((-Math.PI * bandwidth) / rate);
  const a1 = 2 * r * Math.cos(theta);
  const a2 = -(r * r);
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i += 1) {
    const y = input[i] + a1 * y1 + a2 * y2;
    out[i] = y;
    y2 = y1;
    y1 = y;
  }
  return out;
}

/** Render speech-like audio into a mono Float32Array. */
export function renderSyntheticSpeech(
  rate: number,
  seconds: number,
): Float32Array {
  const total = Math.floor(rate * seconds);
  const syllable = Math.floor(rate * SYLLABLE_SECONDS);

  const glottal = new Float32Array(total);
  const envelope = new Float32Array(total);
  let phase = 0;

  for (let i = 0; i < total; i += 1) {
    const t = i / rate;
    const f0 = 120 + 12 * Math.sin(2 * Math.PI * 0.7 * t);
    phase += f0 / rate;
    if (phase >= 1) phase -= 1;
    // Asymmetric pulse, roughly a glottal flow derivative.
    glottal[i] = Math.pow(1 - phase, 3) * 2 - 0.3;

    const pos = (i % syllable) / syllable;
    envelope[i] =
      pos < 0.12
        ? pos / 0.12
        : pos > 0.82
          ? Math.max(0, (1 - pos) / 0.18)
          : 1;
  }

  const result = new Float32Array(total);
  for (let s = 0; s * syllable < total; s += 1) {
    const start = s * syllable;
    const end = Math.min(total, start + syllable);
    const segment = glottal.slice(start, end);
    const [f1, f2, f3] = VOWELS[s % VOWELS.length];
    const r1 = resonate(segment, f1, 80, rate);
    const r2 = resonate(segment, f2, 100, rate);
    const r3 = resonate(segment, f3, 140, rate);
    for (let i = start; i < end; i += 1) {
      const j = i - start;
      result[i] = (r1[j] + 0.6 * r2[j] + 0.3 * r3[j]) * envelope[i];
    }

    // A short fricative burst at the syllable onset. Pure vowels turned out to
    // be a marginal signal — the model returned barely one delta for five
    // seconds of them. Consonant-like transients give an ASR the edges it
    // needs to segment, which makes the round-trip check far less flaky.
    const burst = Math.floor(rate * 0.035);
    const noise = new Float32Array(burst);
    for (let i = 0; i < burst; i += 1) noise[i] = Math.random() * 2 - 1;
    const shaped = resonate(noise, 2600 + (s % 3) * 900, 900, rate);
    for (let i = 0; i < burst && start + i < total; i += 1) {
      const fade = 1 - i / burst;
      result[start + i] += shaped[i] * 0.22 * fade;
    }
  }

  let peak = 0;
  for (let i = 0; i < total; i += 1) peak = Math.max(peak, Math.abs(result[i]));
  if (peak > 0) {
    for (let i = 0; i < total; i += 1) result[i] = (result[i] / peak) * 0.85;
  }
  return result;
}

export interface SyntheticSource {
  stream: MediaStream;
  track: MediaStreamTrack;
  /** Begin playback. */
  play: () => void;
  /** Stop playback and release the AudioContext. */
  dispose: () => Promise<void>;
}

/**
 * Build a MediaStream carrying synthetic speech, usable as a drop-in
 * replacement for a microphone track.
 */
export async function createSyntheticSource(
  seconds = 5,
): Promise<SyntheticSource> {
  const ctx = new AudioContext();
  await ctx.resume();

  const samples = renderSyntheticSpeech(ctx.sampleRate, seconds);
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.getChannelData(0).set(samples);

  const destination = ctx.createMediaStreamDestination();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(destination);
  // Deliberately not connected to ctx.destination — the test should be silent.

  const track = destination.stream.getAudioTracks()[0];

  return {
    stream: destination.stream,
    track,
    play: () => source.start(),
    dispose: async () => {
      try {
        source.stop();
      } catch {
        // never started
      }
      for (const t of destination.stream.getTracks()) t.stop();
      await ctx.close().catch(() => {});
    },
  };
}
