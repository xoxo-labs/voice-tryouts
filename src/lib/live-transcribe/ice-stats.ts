import type { IcePathInfo } from "./types";

interface RawStat {
  type?: string;
  state?: string;
  nominated?: boolean;
  selected?: boolean;
  localCandidateId?: string;
  remoteCandidateId?: string;
  candidateType?: string;
  address?: string;
  ip?: string;
  port?: number;
  protocol?: string;
  currentRoundTripTime?: number;
}

/**
 * Read the active ICE candidate pair.
 *
 * `currentRoundTripTime` here is the media path's RTT, which is a different
 * question from how fast the REST edge answers: HTTPS terminates at a CDN
 * edge, while RTP goes to actual media servers via the ICE candidates. This is
 * the number that says where the audio really lands.
 *
 * Everything read here is local to the peer connection — no third party is
 * contacted and the remote address is only ever displayed, never sent
 * anywhere.
 */
export async function readIcePath(
  pc: RTCPeerConnection,
): Promise<IcePathInfo | null> {
  let report: RTCStatsReport;
  try {
    report = await pc.getStats();
  } catch {
    return null;
  }

  // Collected into an array rather than assigned inside the callback: TypeScript
  // cannot track mutations made in a `forEach` closure and narrows them to
  // `never` afterwards.
  const pairs: RawStat[] = [];
  report.forEach((entry) => {
    const stat = entry as unknown as RawStat;
    if (stat.type === "candidate-pair") pairs.push(stat);
  });

  const pair =
    pairs.find((p) => p.state === "succeeded" && (p.nominated || p.selected)) ??
    pairs.find((p) => p.state === "succeeded");
  if (!pair) return null;

  const local = pair.localCandidateId
    ? (report.get(pair.localCandidateId) as RawStat | undefined)
    : undefined;
  const remote = pair.remoteCandidateId
    ? (report.get(pair.remoteCandidateId) as RawStat | undefined)
    : undefined;

  return {
    localType: local?.candidateType ?? null,
    remoteType: remote?.candidateType ?? null,
    remoteAddress: remote?.address ?? remote?.ip ?? null,
    remotePort: remote?.port ?? null,
    protocol: remote?.protocol ?? pair.protocol ?? null,
    roundTripMs:
      typeof pair.currentRoundTripTime === "number"
        ? pair.currentRoundTripTime * 1000
        : null,
  };
}
