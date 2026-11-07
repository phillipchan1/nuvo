import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Blocker 13 (docs/cloudflare-cutover.md): flip-night step 0 ships a build
// with the maintenance URL and the armed flag baked in, on every shell.
// Every workflow that builds the SPA must carry all three cutover variables,
// from repo *variables* (public values, never secrets), unset = today.
const ROOT = join(import.meta.dirname, "..");
const BUILDS = ["cloudflare-hosting.yml", "release.yml", "ios-release.yml"];
const VARS = ["VITE_API_BASE_URL", "VITE_MAINTENANCE_URL", "VITE_CUTOVER_ARMED"];

describe("armed build plumbing", () => {
  for (const file of BUILDS) {
    const text = readFileSync(join(ROOT, ".github/workflows", file), "utf8");
    it(`${file} passes every cutover variable from vars.*`, () => {
      for (const name of VARS) {
        expect(text, `${file} ${name}`).toContain(`${name}: \${{ vars.${name} }}`);
        expect(text, `${file} ${name} as a secret`).not.toContain(`secrets.${name}`);
      }
    });
  }

  it("the app reads exactly those names", () => {
    const maintenance = readFileSync(join(ROOT, "src/lib/maintenance.ts"), "utf8");
    expect(maintenance).toContain("VITE_MAINTENANCE_URL");
    expect(maintenance).toContain("VITE_CUTOVER_ARMED");
  });
});
