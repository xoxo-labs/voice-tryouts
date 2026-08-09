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
      "Press Start and talk: microphone audio streams to OpenAI's Realtime API over a peer connection with gpt-live-transcribe, and the words land as you speak. Every stage of the handshake is timed, down to time-to-first-word.",
    tags: ["OpenAI Realtime", "gpt-live-transcribe", "WebRTC", "benchmark"],
  },
  {
    slug: "voice-prompt-input",
    title: "Voice input for AI Elements",
    summary:
      "Press the mic in an AI Elements PromptInput and dictate into it. Real API transcription replaces the built-in Web Speech mic, which buys cross-browser behaviour, model choice, a delay dial and pre-roll. There is no chat backend — submitting echoes the text back at you.",
    tags: ["AI Elements", "gpt-live-transcribe", "ws-preroll", "useVoiceInput"],
  },
];

export function getExperiment(slug: string): Experiment | undefined {
  return experiments.find((experiment) => experiment.slug === slug);
}
