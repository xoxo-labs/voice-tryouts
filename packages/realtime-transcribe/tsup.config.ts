import { defineConfig } from "tsup";

export default defineConfig({
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
  clean: true,
  target: "es2020",
  // react is a peer dependency (and absent from the core entry entirely).
  external: ["react"],
});
