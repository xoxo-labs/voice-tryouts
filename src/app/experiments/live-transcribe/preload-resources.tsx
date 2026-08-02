"use client";

import ReactDOM from "react-dom";

import { ALL_REGION_ORIGINS } from "@/lib/live-transcribe/regions";

/**
 * Warms DNS + TLS to the OpenAI API before the user clicks Start, so the SDP
 * POST does not pay for connection setup.
 *
 * Next 16 / React 19 do not want a hand-written `<link rel="preconnect">` here
 * — the documented route is the ReactDOM resource-hint methods, which dedupe
 * and hoist the tag into `<head>` correctly.
 * https://nextjs.org/docs/app/api-reference/functions/generate-metadata#resource-hints
 */
export function PreloadResources() {
  // Both region hosts, so switching region never pays a cold connection.
  // They resolve to the same anycast IPs, making the second hint nearly free.
  for (const origin of ALL_REGION_ORIGINS) {
    ReactDOM.prefetchDNS(origin);
    ReactDOM.preconnect(origin, { crossOrigin: "anonymous" });
  }
  return null;
}
