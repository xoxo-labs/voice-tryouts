import { defineConfig } from "tsup";

export default defineConfig((options) => ({
  entry: {
    // Two public entries, mirroring the exports map: "." is the pure
    // framework-free core, "./react" is the hooks layer. esbuild splits the
    // shared core into a common chunk, so the react entry does not duplicate
    // the session machinery.
    index: "src/index.ts",
    "react/index": "src/react/index.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  // Never clean in watch mode: `turbo dev` builds the lib (^build), then
  // starts this watcher next to `next dev` — a startup clean would yank
  // dist/ out from under the app for a moment.
  clean: !options.watch,
  target: "es2020",
  // react is a peer dependency (and absent from the core entry entirely).
  external: ["react"],
}));
