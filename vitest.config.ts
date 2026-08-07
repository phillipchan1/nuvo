import { defineConfig } from "vitest/config";

// The edge functions are Deno: they import `npm:` specifiers and read `Deno.env`
// at module load. Aliasing those two specifiers and defining the global in a
// setup file is what lets the conformance suite drive the agent's REAL tool code
// instead of a copy — which is the only way a test can prove the shipped
// behaviour. See tests/agent/ for the fakes those aliases point at.
export const ALIASES = [
  { find: "npm:chrono-node@2.7.7", replacement: "chrono-node" },
  {
    find: "npm:@supabase/supabase-js@2",
    replacement: new URL("./tests/agent/stubSupabaseJs.ts", import.meta.url).pathname,
  },
];

export default defineConfig({
  resolve: { alias: ALIASES },
  test: {
    // Node is still the default — the kernel, agent and sync-core suites need no
    // DOM and are much faster without one. Files that drive React opt in with a
    // `@vitest-environment jsdom` docblock.
    setupFiles: ["./tests/agent/setup.ts", "./tests/setupDom.ts"],
    // The prompt-level eval (`*.eval.ts`) is deliberately absent — it needs a
    // live model. `npm run eval`, vitest.eval.config.ts.
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
