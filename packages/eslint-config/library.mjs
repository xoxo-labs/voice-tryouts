import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * ESLint config for framework-free library packages. TypeScript recommended
 * rules plus the React hooks rules (the `./react` entries of packages still
 * ship hooks, and `react-hooks/set-state-in-effect` has bitten this repo
 * before).
 */
export const libraryConfig = defineConfig([
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  globalIgnores(["dist/**"]),
]);

export default libraryConfig;
