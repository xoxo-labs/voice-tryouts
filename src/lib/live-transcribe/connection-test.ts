import { readIcePath } from "@/lib/realtime-transcribe";
import { computeRms } from "@/lib/realtime-transcribe";
import { realtimeCallsUrl, REGION_INFO } from "@/lib/realtime-transcribe";
import { REALTIME_DATA_CHANNEL } from "@/lib/realtime-transcribe";
import { createSyntheticSource } from "@/lib/realtime-transcribe";
import type {
  CaptureSettings,
  IcePathInfo,
  LiveTranscribeSettings,
  StageResult,
} from "@/lib/realtime-transcribe";

/**
 * End-to-end connection test.
 *
 * Design rule: every stage ends `pass`, `warn`, `fail` or `skip`, and every
 * one of them carries a sentence explaining why. A stage is never allowed to
 * finish blank or ambiguous — silent failure is the exact problem this exists
 * to eliminate.
 *
 * The API half of the test drives a peer connection with *synthetic* speech
 * rather than the microphone, which means it works with no microphone at all,
 * and it cleanly separates "my mic is dead" from "the API is broken". The
 * microphone stages are local-only checks alongside it.
 */

export const STAGE_IDS = [
  "server",
  "mint",
  "mic-permission",
  "mic-audio",
  "ice",
  "sdp",
  "datachannel",
  "session",
  "roundtrip",
  "ice-path",
] as const;

export type StageId = (typeof STAGE_IDS)[number];

const STAGE_LABELS: Record<StageId, string> = {
  server: "Server + API key",
  mint: "Mint ephemeral token",
  "mic-permission": "Microphone permission",
  "mic-audio": "Microphone produces audio",
  ice: "ICE candidate gathering",
  sdp: "SDP exchange",
  datachannel: "Data channel opens",
  session: "session.created received",
  roundtrip: "Round trip: audio → transcript",
  "ice-path": "Media path (active ICE pair)",
};

export interface ConnectionTestOptions {
  settings: LiveTranscribeSettings;
  capture: CaptureSettings;
  /** When false, the two microphone stages report `skip` with a reason. */
  includeMicrophone: boolean;
  onProgress: (result: StageResult) => void;
  signal: AbortSignal;
}

export interface ConnectionTestSummary {
  ok: boolean;
  headline: string;
  advice: string | null;
  icePath: IcePathInfo | null;
}

const MIC_LISTEN_MS = 1500;
const MIC_SILENCE_THRESHOLD = 0.0008;
const ROUNDTRIP_TIMEOUT_MS = 15_000;
const HANDSHAKE_TIMEOUT_MS = 12_000;

function stage(
  id: StageId,
  status: StageResult["status"],
  detail: string,
  extra: Partial<StageResult> = {},
): StageResult {
  return { id, label: STAGE_LABELS[id], status, detail, ...extra };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runConnectionTest(
  options: ConnectionTestOptions,
): Promise<ConnectionTestSummary> {
  const { settings, capture, includeMicrophone, onProgress, signal } = options;
  const region = REGION_INFO[settings.region];
  const results: StageResult[] = [];
  const settled = new Set<StageId>();
  /** The stage currently in flight — exceptions are attributed to it. */
  let currentStage: StageId | null = null;

  const report = (result: StageResult) => {
    settled.add(result.id as StageId);
    if (currentStage === result.id) currentStage = null;
    results.push(result);
    onProgress(result);
  };
  const running = (id: StageId, detail = "Checking…") => {
    currentStage = id;
    onProgress(stage(id, "running", detail));
  };

  /**
   * Close out every stage that never got a verdict. A user's cancel must
   * produce "skipped — cancelled", not a fabricated network diagnosis; an
   * exception must be pinned on the stage that actually threw, with the rest
   * skipped instead of left spinning forever.
   */
  const settleRemaining = (why: string) => {
    for (const id of STAGE_IDS) {
      if (!settled.has(id)) report(stage(id, "skip", why));
    }
  };

  /** Every exit goes through here so no stage is ever left dangling. */
  const finishTest = (skipReason: string) => {
    settleRemaining(
      signal.aborted ? "Skipped — the test was cancelled." : skipReason,
    );
    return finish(results, icePath, cleanup, signal.aborted);
  };

  let pc: RTCPeerConnection | null = null;
  let synthetic: Awaited<ReturnType<typeof createSyntheticSource>> | null = null;
  let icePath: IcePathInfo | null = null;

  const cleanup = async () => {
    if (pc) {
      pc.onconnectionstatechange = null;
      pc.onicecandidate = null;
      try {
        pc.close();
      } catch {
        // already closed
      }
    }
    if (synthetic) await synthetic.dispose();
  };

  try {
    // ---------------------------------------------------- 1. server + key
    running("server");
    const serverStart = performance.now();
    try {
      const response = await fetch(
        `/api/realtime/diagnostics?region=${settings.region}`,
        { signal },
      );
      const body = (await response.json()) as {
        ok?: boolean;
        detail?: string;
        remedy?: string;
        durationMs?: number;
      };
      report(
        stage(
          "server",
          body.ok ? "pass" : "fail",
          body.detail ?? "The diagnostics endpoint returned no detail.",
          {
            remedy: body.remedy,
            durationMs: Math.round(performance.now() - serverStart),
          },
        ),
      );
      if (!body.ok) {
        return finishTest("Skipped — an earlier stage failed, so this one was never reached.");
      }
    } catch (cause) {
      report(
        stage(
          "server",
          "fail",
          `Could not reach this app's own /api/realtime/diagnostics endpoint: ${
            cause instanceof Error ? cause.message : "unknown error"
          }`,
          { remedy: "Is the dev server still running on this origin?" },
        ),
      );
      return finishTest("Skipped — an earlier stage failed, so this one was never reached.");
    }

    // ------------------------------------------------------------ 2. mint
    running("mint");
    let ephemeralKey: string | null = null;
    const mintStart = performance.now();
    try {
      const response = await fetch("/api/realtime/transcription-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
        signal,
      });
      const body = (await response.json()) as {
        value?: string;
        error?: string;
        code?: string;
      };
      const durationMs = Math.round(performance.now() - mintStart);

      if (!response.ok || typeof body.value !== "string") {
        report(
          stage(
            "mint",
            "fail",
            body.error ?? `The token endpoint returned ${response.status}.`,
            {
              durationMs,
              remedy:
                body.code === "region_unavailable"
                  ? "Switch the region back to US and run the test again."
                  : body.code === "rate_limited"
                    ? "Check billing and usage limits on the OpenAI dashboard."
                    : undefined,
            },
          ),
        );
        return finishTest("Skipped — an earlier stage failed, so this one was never reached.");
      }

      ephemeralKey = body.value;
      report(
        stage(
          "mint",
          "pass",
          `Client secret minted by ${region.host} in ${durationMs} ms.`,
          { durationMs, data: { region: settings.region } },
        ),
      );
    } catch (cause) {
      report(
        stage(
          "mint",
          "fail",
          `The mint request failed: ${
            cause instanceof Error ? cause.message : "unknown error"
          }`,
        ),
      );
      return finishTest("Skipped — an earlier stage failed, so this one was never reached.");
    }

    // ------------------------------------------------------ 3+4. microphone
    if (!includeMicrophone) {
      report(
        stage(
          "mic-permission",
          "skip",
          "Skipped on purpose — the microphone checks were turned off for this run.",
        ),
      );
      report(
        stage(
          "mic-audio",
          "skip",
          "Skipped because the microphone checks were turned off. The API stages below use synthetic audio and do not need a microphone.",
        ),
      );
    } else if (!navigator.mediaDevices?.getUserMedia) {
      const why =
        "This browser exposes no getUserMedia — a secure context (https or localhost) is required.";
      report(stage("mic-permission", "fail", why));
      report(
        stage(
          "mic-audio",
          "skip",
          "Skipped because microphone access is unavailable, so there is no stream to measure.",
        ),
      );
    } else {
      running("mic-permission");
      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia(
          capture.deviceId
            ? { audio: { deviceId: { exact: capture.deviceId } } }
            : { audio: true },
        );
        const label = micStream.getAudioTracks()[0]?.label || capture.deviceLabel;
        report(
          stage("mic-permission", "pass", `Permission granted for "${label}".`),
        );
      } catch (cause) {
        const name = (cause as { name?: string } | null)?.name;
        const detail =
          name === "NotAllowedError"
            ? "Permission was denied by the browser or the OS."
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "The selected input device no longer exists."
              : `getUserMedia failed: ${
                  cause instanceof Error ? cause.message : "unknown error"
                }`;
        report(
          stage("mic-permission", "fail", detail, {
            remedy:
              name === "NotAllowedError"
                ? "Allow microphone access for this site, then re-run."
                : "Pick a different device in the Microphone selector.",
          }),
        );
        report(
          stage(
            "mic-audio",
            "skip",
            "Skipped because no microphone stream could be opened.",
          ),
        );
      }

      // The check that would have saved a whole session: is the device
      // actually producing sound, or is it silently delivering digital zero?
      if (micStream) {
        running(
          "mic-audio",
          "Listening for 1.5 s — say something into the microphone now.",
        );
        try {
          const ctx = new AudioContext();
          await ctx.resume();
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          ctx.createMediaStreamSource(micStream).connect(analyser);
          const buffer = new Float32Array(analyser.fftSize);

          let peak = 0;
          const until = performance.now() + MIC_LISTEN_MS;
          while (performance.now() < until) {
            analyser.getFloatTimeDomainData(buffer);
            peak = Math.max(peak, computeRms(buffer));
            await wait(40);
          }
          await ctx.close().catch(() => {});

          const loud = peak > MIC_SILENCE_THRESHOLD;
          // Silence is a WARN, not a fail: microphones with hardware noise
          // gates output digital zero until they hear sound, and the user may
          // simply have stayed quiet during the listen window. The wording
          // still makes the "device opens but delivers silence" case
          // unmissable — it just doesn't false-fail a healthy gated mic.
          report(
            stage(
              "mic-audio",
              loud ? "pass" : "warn",
              loud
                ? `Captured sound: peak RMS ${peak.toFixed(4)} over ${MIC_LISTEN_MS} ms.`
                : `The microphone produced no sound — peak RMS was ${peak.toFixed(4)} over ${MIC_LISTEN_MS} ms. If you spoke during the test, the device is delivering silence and live transcription will silently produce nothing. If you stayed quiet (or the mic has a hardware noise gate), re-run and talk through the whole listen window.`,
              {
                data: { peakRms: Number(peak.toFixed(5)) },
                remedy: loud
                  ? peak < 0.005
                    ? "Level is very low; expect degraded accuracy. Move closer or raise the input gain."
                    : undefined
                  : "Speak during the test. If it stays silent: check the OS input device and volume, any hardware mute switch, and whether another app holds the microphone.",
              },
            ),
          );
        } catch (cause) {
          report(
            stage(
              "mic-audio",
              "warn",
              `Could not analyse the microphone signal: ${
                cause instanceof Error ? cause.message : "unknown error"
              }. Permission was granted, so this is a Web Audio problem rather than a device problem.`,
            ),
          );
        } finally {
          for (const track of micStream.getTracks()) track.stop();
        }
      }
    }

    if (signal.aborted) return finishTest("Skipped — an earlier stage failed, so this one was never reached.");

    // -------------------------------------------- 5-9. the API round trip
    synthetic = await createSyntheticSource(8);

    pc = new RTCPeerConnection();
    pc.addTrack(synthetic.track, synthetic.stream);
    const dc = pc.createDataChannel(REALTIME_DATA_CHANNEL);

    let dcOpen = false;
    let sessionCreated = false;
    let deltaCount = 0;
    let transcript = "";
    let serverError: string | null = null;

    dc.onopen = () => {
      dcOpen = true;
      synthetic?.play();
    };
    dc.onmessage = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data as string) as {
          type?: string;
          delta?: string;
          error?: { message?: string };
        };
        if (parsed.type === "session.created") sessionCreated = true;
        if (
          parsed.type === "conversation.item.input_audio_transcription.delta"
        ) {
          deltaCount += 1;
          transcript += parsed.delta ?? "";
        }
        if (parsed.type === "error") {
          serverError = parsed.error?.message ?? "unspecified error event";
        }
      } catch {
        // ignore malformed frames
      }
    };

    // ICE gathering
    running("ice");
    const candidates: string[] = [];
    pc.onicecandidate = (event) => {
      if (event.candidate?.candidate) candidates.push(event.candidate.candidate);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const gatherUntil = performance.now() + 2000;
    while (
      candidates.length === 0 &&
      pc.iceGatheringState !== "complete" &&
      performance.now() < gatherUntil
    ) {
      await wait(50);
    }

    const sdpCandidates = (pc.localDescription?.sdp ?? "").split("\n").filter(
      (line) => line.startsWith("a=candidate:"),
    ).length;
    const totalCandidates = Math.max(candidates.length, sdpCandidates);

    report(
      stage(
        "ice",
        totalCandidates > 0 ? "pass" : "warn",
        totalCandidates > 0
          ? `Gathered ${totalCandidates} local candidate${totalCandidates === 1 ? "" : "s"} (state: ${pc.iceGatheringState}).`
          : `No local ICE candidates were gathered within 2 s (state: ${pc.iceGatheringState}). The offer is still sent — OpenAI's answer supplies its own candidates — but a total absence of local candidates usually means the network blocks UDP.`,
        {
          data: { candidates: totalCandidates },
          remedy:
            totalCandidates > 0
              ? undefined
              : "If the connection then fails, suspect a firewall or VPN blocking UDP.",
        },
      ),
    );

    // SDP exchange
    running("sdp");
    const localSdp = pc.localDescription?.sdp ?? offer.sdp;
    if (!localSdp) {
      report(
        stage("sdp", "fail", "The browser produced no local SDP offer to send."),
      );
      return finishTest("Skipped — an earlier stage failed, so this one was never reached.");
    }

    const sdpStart = performance.now();
    let answerSdp: string;
    try {
      const response = await fetch(realtimeCallsUrl(settings.region), {
        method: "POST",
        body: localSdp,
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
        signal,
      });
      answerSdp = await response.text();
      const durationMs = Math.round(performance.now() - sdpStart);

      if (!response.ok) {
        report(
          stage(
            "sdp",
            "fail",
            `${region.host} rejected the SDP offer with ${response.status}: ${answerSdp.slice(0, 200)}`,
            {
              durationMs,
              remedy:
                response.status === 401
                  ? "The ephemeral secret was rejected — it may have expired between minting and use."
                  : undefined,
            },
          ),
        );
        return finishTest("Skipped — an earlier stage failed, so this one was never reached.");
      }

      report(
        stage(
          "sdp",
          "pass",
          `${region.host} returned an SDP answer in ${durationMs} ms.`,
          { durationMs },
        ),
      );
    } catch (cause) {
      report(
        stage(
          "sdp",
          "fail",
          `The SDP POST to ${region.host} failed: ${
            cause instanceof Error ? cause.message : "unknown error"
          }`,
          { remedy: "Check for a proxy or extension blocking the request." },
        ),
      );
      return finishTest("Skipped — an earlier stage failed, so this one was never reached.");
    }

    // Data channel + session.created. `running` is set BEFORE
    // setRemoteDescription so an exception there is attributed to this stage.
    running("datachannel");
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    const handshakeUntil = performance.now() + HANDSHAKE_TIMEOUT_MS;
    let handshakeLastTick = 0;
    while (
      (!dcOpen || !sessionCreated) &&
      performance.now() < handshakeUntil &&
      !signal.aborted
    ) {
      // Re-report each second with the time left — a silent spinner for the
      // whole window is indistinguishable from a hang, which is the exact
      // ambiguity this test exists to remove.
      const secondsLeft = Math.ceil((handshakeUntil - performance.now()) / 1000);
      if (secondsLeft !== handshakeLastTick) {
        handshakeLastTick = secondsLeft;
        running("datachannel", `Waiting for the channel… ${secondsLeft}s left`);
      }
      await wait(50);
    }

    // A cancel is a cancel — reporting the timeout verdict after an abort
    // would turn the user's own click into a fake network diagnosis.
    if (signal.aborted && (!dcOpen || !sessionCreated)) {
      return finishTest("Skipped — the test was cancelled.");
    }

    report(
      stage(
        "datachannel",
        dcOpen ? "pass" : "fail",
        dcOpen
          ? `The "${REALTIME_DATA_CHANNEL}" channel opened; peer connection is ${pc.connectionState}.`
          : `The "${REALTIME_DATA_CHANNEL}" channel never opened within ${HANDSHAKE_TIMEOUT_MS / 1000} s. Peer connection state is ${pc.connectionState}, ICE is ${pc.iceConnectionState}.`,
        {
          remedy: dcOpen
            ? undefined
            : "The SDP exchange succeeded, so this is media-path connectivity — usually UDP blocked by a firewall or VPN.",
        },
      ),
    );

    report(
      stage(
        "session",
        sessionCreated ? "pass" : dcOpen ? "fail" : "skip",
        sessionCreated
          ? "session.created arrived on the data channel."
          : dcOpen
            ? "The channel opened but session.created never arrived. The transport works while the session does not."
            : "Skipped because the data channel never opened, so no server events could arrive.",
      ),
    );

    if (!dcOpen || !sessionCreated) {
      report(
        stage(
          "roundtrip",
          "skip",
          "Skipped because the session was never established, so there was nothing to send audio to.",
        ),
      );
      return finishTest("Skipped — an earlier stage failed, so this one was never reached.");
    }

    // Round trip
    running("roundtrip");
    const roundtripUntil = performance.now() + ROUNDTRIP_TIMEOUT_MS;
    let roundtripLastTick = 0;
    while (
      deltaCount === 0 &&
      performance.now() < roundtripUntil &&
      !signal.aborted &&
      !serverError
    ) {
      // Same countdown treatment as the handshake wait: on EU this window
      // always runs to exhaustion, and 15 s of bare "Checking…" reads as a
      // freeze rather than a deliberate wait.
      const secondsLeft = Math.ceil((roundtripUntil - performance.now()) / 1000);
      if (secondsLeft !== roundtripLastTick) {
        roundtripLastTick = secondsLeft;
        running("roundtrip", `Waiting for deltas… ${secondsLeft}s left`);
      }
      await wait(100);
    }

    if (signal.aborted && deltaCount === 0) {
      return finishTest("Skipped — the test was cancelled.");
    }

    let packetsSent = 0;
    const statsReport = await pc.getStats().catch(() => null);
    statsReport?.forEach((entry) => {
      const s = entry as unknown as {
        type?: string;
        kind?: string;
        packetsSent?: number;
      };
      if (s.type === "outbound-rtp" && s.kind === "audio") {
        packetsSent = s.packetsSent ?? 0;
      }
    });

    if (serverError) {
      report(
        stage(
          "roundtrip",
          "fail",
          `The API reported an error while transcribing: ${serverError}`,
        ),
      );
    } else if (deltaCount > 0) {
      report(
        stage(
          "roundtrip",
          "pass",
          `Full round trip confirmed: ${deltaCount} transcript delta${deltaCount === 1 ? "" : "s"} came back for synthetic audio (${packetsSent} RTP packets sent). Transcribed as "${transcript.trim().slice(0, 60)}" — the text is meaningless, the fact it arrived is the point.`,
          { data: { deltas: deltaCount, packetsSent } },
        ),
      );
    } else if (packetsSent === 0) {
      report(
        stage(
          "roundtrip",
          "fail",
          `No RTP packets left the browser at all, so the API had nothing to transcribe. The session is up but media is not flowing.`,
          {
            data: { packetsSent },
            remedy: "Suspect a firewall or VPN blocking outbound UDP media.",
          },
        ),
      );
    } else {
      report(
        stage(
          "roundtrip",
          "warn",
          `${packetsSent} RTP packets were sent and the session stayed healthy, but no transcript deltas came back within ${ROUNDTRIP_TIMEOUT_MS / 1000} s. Transport is confirmed working; transcription of this synthetic signal is not. Since the test audio is machine-generated rather than real speech, this is not conclusive evidence of an API fault.`,
          {
            data: { packetsSent, deltas: 0 },
            remedy:
              "Run a normal session and speak — if real speech also produces nothing, the problem is upstream. On eu.api.openai.com this is the expected outcome for accounts without data-residency approval: the handshake succeeds, the stream stays silent (confirmed with real speech).",
          },
        ),
      );
    }

    // Media path — always local, no third party involved.
    running("ice-path");
    icePath = await readIcePath(pc);
    report(
      stage(
        "ice-path",
        icePath ? "pass" : "skip",
        icePath
          ? `Media flows ${icePath.protocol ?? "?"} to ${icePath.remoteAddress ?? "unknown"}${
              icePath.remotePort ? `:${icePath.remotePort}` : ""
            } (${icePath.remoteType ?? "?"} candidate)${
              icePath.roundTripMs != null
                ? `, round-trip ${icePath.roundTripMs.toFixed(1)} ms`
                : ", round-trip not reported yet"
            }.`
          : "Skipped — no succeeded ICE candidate pair was reported, so there is no active media path to describe.",
        {
          data: icePath
            ? {
                remoteAddress: icePath.remoteAddress,
                remoteType: icePath.remoteType,
                roundTripMs:
                  icePath.roundTripMs != null
                    ? Number(icePath.roundTripMs.toFixed(2))
                    : null,
              }
            : undefined,
        },
      ),
    );

    return finishTest("Skipped — an earlier stage failed, so this one was never reached.");
  } catch (cause) {
    // A user abort surfaces here as an AbortError from fetch — that is a
    // cancel, not a failure of whatever stage happened to be in flight.
    if (
      signal.aborted ||
      (cause instanceof DOMException && cause.name === "AbortError")
    ) {
      return finishTest("Skipped — the test was cancelled.");
    }

    // Attribute the exception to the stage that was actually running when it
    // threw (createOffer, setRemoteDescription, etc. run under a stage), and
    // never blame a stage that had already settled or was never reached.
    const blame: StageId = currentStage ?? "roundtrip";
    report(
      stage(
        blame,
        "fail",
        `This stage threw unexpectedly: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`,
      ),
    );
    return finishTest(
      "Skipped — the test stopped after an unexpected error in an earlier stage.",
    );
  }
}

async function finish(
  results: StageResult[],
  icePath: IcePathInfo | null,
  cleanup: () => Promise<void>,
  cancelled = false,
): Promise<ConnectionTestSummary> {
  await cleanup();

  const failed = results.filter((r) => r.status === "fail");
  const warned = results.filter((r) => r.status === "warn");

  if (cancelled && failed.length === 0) {
    return {
      ok: false,
      headline: "Test cancelled before completion.",
      advice: "Run it again to get a full verdict.",
      icePath,
    };
  }

  if (failed.length > 0) {
    const first = failed[0];
    return {
      ok: false,
      headline: `Failed at "${first.label}".`,
      advice: first.remedy ?? first.detail,
      icePath,
    };
  }

  if (warned.length > 0) {
    return {
      ok: true,
      headline: `Everything essential passed, with ${warned.length} warning${warned.length === 1 ? "" : "s"}.`,
      advice: warned[0].remedy ?? warned[0].detail,
      icePath,
    };
  }

  return {
    ok: true,
    headline: "All checks passed — the full audio round trip works.",
    advice: null,
    icePath,
  };
}
