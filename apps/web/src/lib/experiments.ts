export interface Experiment {
  slug: string;
  title: string;
  summary: string;
  tags: string[];
}

/** Registry for the experiments index. Add new experiments here. */
export const experiments: Experiment[] = [
  {
    slug: "live-transcribe",
    title: "Live transcription over WebRTC",
    summary:
      "Streams microphone audio to OpenAI's Realtime API with gpt-live-transcribe and benchmarks every stage of the handshake, down to time-to-first-word.",
    tags: ["OpenAI Realtime", "gpt-live-transcribe", "WebRTC", "benchmark"],
  },
  {
    slug: "voice-prompt-input",
    title: "Voice input for AI Elements",
    summary:
      "Wires real API transcription into an AI Elements PromptInput through a mic button: cross-browser dictation with model choice, delay control and pre-roll, instead of the built-in Web Speech mic.",
    tags: ["AI Elements", "gpt-live-transcribe", "ws-preroll", "useVoiceInput"],
  },
];

export function getExperiment(slug: string): Experiment | undefined {
  return experiments.find((experiment) => experiment.slug === slug);
}
