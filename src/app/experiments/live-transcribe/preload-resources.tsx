"use client";

import ReactDOM from "react-dom";

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
  ReactDOM.prefetchDNS("https://api.openai.com");
  ReactDOM.preconnect("https://api.openai.com", { crossOrigin: "anonymous" });
  return null;
}
