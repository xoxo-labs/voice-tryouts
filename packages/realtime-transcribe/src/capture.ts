/**
 * Microphone capture pipeline for the WebSocket transport: AudioWorklet →
 * 24 kHz mono Float32 → Int16LE → base64 chunks sized for
 * `input_audio_buffer.append`.
 *
 * Sample rate strategy: the AudioContext is *constructed* at 24 kHz, which
 * makes the browser's own resampler do the 48→24 kHz conversion before the
 * worklet ever sees a sample — higher quality than anything hand-rolled. If
 * the browser refuses the rate (older Safari), a linear-interpolation
 * fallback resamples in JS. The session is configured `audio/pcm` @ 24 kHz,
 * verified end-to-end against the live API.
 *
 * Pre-roll: when enabled, chunks accumulate in a bounded local buffer instead
 * of being dropped while the connection is still being established. Verified
 * against the live API: bursting several seconds of buffered audio (much
 * faster than realtime) yields a transcript of the ENTIRE buffer, first word
 * included, with the live tail stitched on seamlessly.
 */

export const CAPTURE_SAMPLE_RATE = 24000;

/** ~100 ms of 24 kHz mono Int16 per append message. */
const SAMPLES_PER_CHUNK = 2400;

/** Pre-roll safety cap. 60 s at ~4.7 kB/chunk ≈ 2.8 MB — plenty. */
const MAX_BUFFERED_CHUNKS = 600;

/**
 * The worklet source is inlined and loaded via a Blob URL so the library has
 * no build-time asset to ship or path to configure. The processor just posts
 * raw Float32 blocks to the main thread; all conversion happens outside the
 * audio thread.
 */
const WORKLET_SOURCE = `
class PcmTapProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length > 0) {
      // Copy — the engine reuses the underlying buffer between calls.
      this.port.postMessage(new Float32Array(channel));
    }
    return true;
  }
}
registerProcessor("pcm-tap", PcmTapProcessor);
`;

function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

function int16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  const STRIDE = 0x8000;
  for (let i = 0; i < bytes.length; i += STRIDE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + STRIDE));
  }
  return btoa(binary);
}

/** Linear-interpolation resampler — fallback only. */
function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

export interface CaptureStats {
  /** Total audio pushed into chunks, in ms. */
  capturedMs: number;
  chunksProduced: number;
  bytesProduced: number;
}

export interface PcmCapture {
  readonly stats: CaptureStats;
  /** Actual context rate — 24000 unless the browser refused. */
  readonly sampleRate: number;
  stop(): Promise<void>;
}

/**
 * Start capturing `stream` and deliver ~100 ms base64 PCM16 chunks to
 * `onChunk`. Runs until `stop()`.
 */
export async function startPcmCapture(
  stream: MediaStream,
  onChunk: (base64: string, durationMs: number) => void,
): Promise<PcmCapture> {
  let ctx: AudioContext;
  try {
    ctx = new AudioContext({ sampleRate: CAPTURE_SAMPLE_RATE });
  } catch {
    // Browser refused the explicit rate; fall back to default + JS resample.
    ctx = new AudioContext();
  }
  await ctx.resume();
  const contextRate = ctx.sampleRate;

  const workletUrl = URL.createObjectURL(
    new Blob([WORKLET_SOURCE], { type: "text/javascript" }),
  );
  try {
    await ctx.audioWorklet.addModule(workletUrl);
  } finally {
    URL.revokeObjectURL(workletUrl);
  }

  const source = ctx.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(ctx, "pcm-tap", {
    numberOfInputs: 1,
    numberOfOutputs: 0,
  });
  source.connect(tap);

  const stats: CaptureStats = {
    capturedMs: 0,
    chunksProduced: 0,
    bytesProduced: 0,
  };

  // Accumulate 24 kHz samples until a full chunk is ready.
  let pending = new Float32Array(0);

  tap.port.onmessage = (event: MessageEvent<Float32Array>) => {
    const block =
      contextRate === CAPTURE_SAMPLE_RATE
        ? event.data
        : resampleLinear(event.data, contextRate, CAPTURE_SAMPLE_RATE);

    const merged = new Float32Array(pending.length + block.length);
    merged.set(pending);
    merged.set(block, pending.length);
    pending = merged;

    while (pending.length >= SAMPLES_PER_CHUNK) {
      const chunk = pending.subarray(0, SAMPLES_PER_CHUNK);
      pending = pending.slice(SAMPLES_PER_CHUNK);
      const int16 = floatToInt16(chunk);
      const durationMs = (SAMPLES_PER_CHUNK / CAPTURE_SAMPLE_RATE) * 1000;
      stats.capturedMs += durationMs;
      stats.chunksProduced += 1;
      stats.bytesProduced += int16.byteLength;
      onChunk(int16ToBase64(int16), durationMs);
    }
  };

  return {
    stats,
    sampleRate: contextRate,
    stop: async () => {
      tap.port.onmessage = null;
      try {
        source.disconnect();
        tap.disconnect();
      } catch {
        // already disconnected
      }
      await ctx.close().catch(() => {});
    },
  };
}

/**
 * Bounded pre-roll buffer. Chunks accumulate until `flush(send)` hands them
 * off, after which `push` forwards directly. If the cap is hit before flush,
 * the OLDEST audio is dropped (keeping the newest keeps the buffer contiguous
 * with the live continuation).
 */
export class PrerollBuffer {
  private chunks: string[] = [];
  private bufferedMs = 0;
  private flushed = false;
  private send: ((base64: string) => void) | null = null;
  private droppedMs = 0;

  push(base64: string, durationMs: number): void {
    if (this.flushed) {
      this.send?.(base64);
      return;
    }
    this.chunks.push(base64);
    this.bufferedMs += durationMs;
    if (this.chunks.length > MAX_BUFFERED_CHUNKS) {
      this.chunks.shift();
      this.bufferedMs -= durationMs;
      this.droppedMs += durationMs;
    }
  }

  /** Returns the amount of audio that was buffered, in ms. */
  flush(send: (base64: string) => void): {
    bufferedMs: number;
    droppedMs: number;
  } {
    this.send = send;
    this.flushed = true;
    for (const chunk of this.chunks) send(chunk);
    const result = { bufferedMs: this.bufferedMs, droppedMs: this.droppedMs };
    this.chunks = [];
    return result;
  }

  get pendingMs(): number {
    return this.bufferedMs;
  }
}
