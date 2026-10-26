// Run one of the battery's TypeScript entry points (run.ts, showHistory.ts) under
// the SAME resolution the test suite uses.
//
//   node tests/agent/runModule.mjs tests/agent/run.ts --repeat 5
//
// The battery imports the agent's Deno modules, which reach for `npm:` specifiers
// and the `Deno` global at load time. vitest.config.ts aliases the specifiers
// (stubSupabaseJs among them) and tests/agent/setup.ts defines the global — so
// this loads that config into a Vite module runner and runs the setup file first.
// It replaces `vite-node`, which vitest 4 stopped shipping: the scripts that
// called it failed with "command not found" and the battery could not run at all.

import { createServer, createServerModuleRunner } from "vite";

const [entry, ...rest] = process.argv.slice(2);
if (!entry) {
  console.error("usage: node tests/agent/runModule.mjs <entry.ts> [args…]");
  process.exit(2);
}
// The entry reads its own flags from process.argv.slice(2); a stray `--` (the old
// scripts passed one through) is dropped.
process.argv = [process.argv[0], entry, ...rest.filter((a) => a !== "--")];

const server = await createServer({
  configFile: "vitest.config.ts",
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
  logLevel: "error",
});
const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });

let code = 0;
try {
  await runner.import("/tests/agent/setup.ts");
  await runner.import(`/${entry.replace(/^\.?\//, "")}`);
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await runner.close();
  await server.close();
}
// The entry sets process.exitCode (or calls process.exit) for its verdict.
if (code) process.exit(code);
