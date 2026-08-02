import { realtimeCallsUrl } from "./regions";
import { REALTIME_DATA_CHANNEL } from "./session-config";
import type {
  Transport,
  TransportCallbacks,
  TransportConnectOptions,
  TransportPrepareOptions,
} from "./transport";
import type { AudioStats } from "./types";

/**
 * WebRTC transport: the peer connection carries the audio (no manual append,
 * no resampling — the browser's media stack owns it), JSON events ride the
 * `oai-events` data channel, and the SDP offer is POSTed with the ephemeral
 * secret directly from the browser. No query parameters on the calls URL.
 *
 * `prepare` builds the peer connection and local offer — everything that does
 * NOT need the secret — so it can overlap with token minting.
 */
export class WebRtcTransport implements Transport {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private localSdp: string | null = null;
  private dcOpen: Promise<void> | null = null;
  private callbacks: TransportCallbacks | null = null;

  /** WebRTC has no pre-roll — audio only flows once the peer is connected. */
  readonly prerollMs = null;

  async prepare(options: TransportPrepareOptions): Promise<void> {
    const { stream, onMessage, mark, log, onFatal } = options;
    this.callbacks = { onMessage, mark, log, onFatal };

    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) {
      throw new Error("No audio track was produced by getUserMedia.");
    }

    const pc = new RTCPeerConnection();
    this.pc = pc;
    pc.addTrack(audioTrack, stream);

    const dc = pc.createDataChannel(REALTIME_DATA_CHANNEL);
    this.dc = dc;

    this.dcOpen = new Promise<void>((resolve) => {
      dc.onopen = () => {
        mark("dcOpen");
        log("→ data channel open", { label: REALTIME_DATA_CHANNEL }, true);
        resolve();
      };
    });
    dc.onmessage = (event: MessageEvent) => {
      if (typeof event.data === "string") onMessage(event.data);
    };
    dc.onerror = () => log("→ data channel error", {}, false);

    pc.onconnectionstatechange = () => {
      log(`→ pc.connectionState = ${pc.connectionState}`, {}, true);
      if (pc.connectionState === "connected") {
        mark("connected");
      } else if (pc.connectionState === "failed") {
        onFatal("The WebRTC peer connection failed.");
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.localSdp = pc.localDescription?.sdp ?? offer.sdp ?? null;
    if (!this.localSdp) {
      throw new Error("Could not generate a local SDP offer.");
    }
    mark("offerReady");
  }

  async connect(options: TransportConnectOptions): Promise<void> {
    const { secret, region, signal } = options;
    const pc = this.pc;
    const callbacks = this.callbacks;
    if (!pc || !this.localSdp || !callbacks || !this.dcOpen) {
      throw new Error("WebRtcTransport.connect called before prepare.");
    }

    callbacks.mark("sdpStart");
    const sdpResponse = await fetch(realtimeCallsUrl(region), {
      method: "POST",
      body: this.localSdp,
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/sdp",
      },
      signal,
    });
    const answerSdp = await sdpResponse.text();
    if (!sdpResponse.ok) {
      throw new Error(
        `SDP exchange failed (${sdpResponse.status}): ${answerSdp.slice(0, 200)}`,
      );
    }
    callbacks.mark("sdpEnd");

    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    await this.dcOpen;
  }

  send(event: object): boolean {
    const dc = this.dc;
    if (!dc || dc.readyState !== "open") return false;
    try {
      dc.send(JSON.stringify(event));
      return true;
    } catch {
      return false;
    }
  }

  async getAudioStats(): Promise<AudioStats | null> {
    const pc = this.pc;
    if (!pc) return null;

    let report: RTCStatsReport;
    try {
      report = await pc.getStats();
    } catch {
      return null;
    }

    let next: AudioStats = {
      packetsSent: 0,
      bytesSent: 0,
      audioLevel: null,
      totalAudioEnergy: null,
    };
    report.forEach((entry) => {
      const stat = entry as unknown as {
        type?: string;
        kind?: string;
        packetsSent?: number;
        bytesSent?: number;
        audioLevel?: number;
        totalAudioEnergy?: number;
      };
      if (stat.type === "outbound-rtp" && stat.kind === "audio") {
        next = {
          ...next,
          packetsSent: stat.packetsSent ?? 0,
          bytesSent: stat.bytesSent ?? 0,
        };
      }
      if (stat.type === "media-source") {
        next = {
          ...next,
          audioLevel: stat.audioLevel ?? null,
          totalAudioEnergy: stat.totalAudioEnergy ?? null,
        };
      }
    });
    return next;
  }

  async close(): Promise<void> {
    const dc = this.dc;
    this.dc = null;
    if (dc) {
      dc.onopen = null;
      dc.onmessage = null;
      dc.onerror = null;
      dc.onclose = null;
      try {
        dc.close();
      } catch {
        // already closed
      }
    }

    const pc = this.pc;
    this.pc = null;
    if (pc) {
      pc.onconnectionstatechange = null;
      pc.ondatachannel = null;
      pc.ontrack = null;
      for (const sender of pc.getSenders()) {
        try {
          sender.track?.stop();
        } catch {
          // already stopped
        }
      }
      try {
        pc.close();
      } catch {
        // already closed
      }
    }
  }
}
