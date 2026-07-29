import { defineConfig } from "vitest/config";
import { ALIASES } from "./vitest.config";

// The prompt-level eval — a live model, so it is NOT part of `npm test`. Same
// aliases and setup as the conformance suite, but a different include glob, set
// standalone rather than merged: mergeConfig concatenates arrays, which would
// drag the whole `*.test.ts` suite into every eval run.
export default defineConfig({
  resolve: { alias: ALIASES },
  test: {
    setupFiles: ["./tests/agent/setup.ts"],
    include: ["tests/**/*.eval.ts"],
    testTimeout: 120_000,
  },
});
