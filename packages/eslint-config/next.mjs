import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * ESLint config for Next.js apps in this monorepo. Factored out of the
 * original single-app setup unchanged: core-web-vitals + typescript, with
 * eslint-config-next's default ignores restated so they stay overridable.
 */
export const nextJsConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default nextJsConfig;
