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

// The desktop release bakes the Worker's public address as a literal: it is
// inert until the app reads `cutover_flipped: true` at runtime (maintenance.ts),
// so an installed app can switch without shipping another update.
const DESKTOP_API_BASE = "https://api.nuvo.day/api";

describe("armed build plumbing", () => {
  for (const file of BUILDS) {
    const text = readFileSync(join(ROOT, ".github/workflows", file), "utf8");
    it(`${file} passes every cutover variable from vars.* (release.yml: a baked API literal)`, () => {
      for (const name of VARS) {
        expect(text, `${file} ${name} as a secret`).not.toContain(`secrets.${name}`);
        if (file === "release.yml" && name === "VITE_API_BASE_URL") {
          expect(text).toContain(`VITE_API_BASE_URL: ${DESKTOP_API_BASE}\n`);
          expect(text).not.toContain("vars.VITE_API_BASE_URL");
          continue;
        }
        expect(text, `${file} ${name}`).toContain(`${name}: \${{ vars.${name} }}`);
      }
    });
  }

  it("the app reads exactly those names", () => {
    const maintenance = readFileSync(join(ROOT, "src/lib/maintenance.ts"), "utf8");
    expect(maintenance).toContain("VITE_MAINTENANCE_URL");
    expect(maintenance).toContain("VITE_CUTOVER_ARMED");
  });
});
