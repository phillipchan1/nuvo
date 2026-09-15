import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Tauri deserializes a command's arguments by its Rust parameter names. The
// paywall sent `{ productIds }` to a command whose parameter is `payload`, so
// every TestFlight build rejected the call before StoreKit ever saw it and
// showed "Subscriptions aren't available" — over a correctly configured Connect.

const root = join(__dirname, "..");
const commands = readFileSync(join(root, "src-tauri/plugins/nuvo-iap/src/commands.rs"), "utf8");
const iap = readFileSync(join(root, "src/lib/iap.ts"), "utf8");

/** command name → name of its single input parameter (after `app: AppHandle`), or null. */
function rustInputs(): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const re = /pub\(crate\) async fn (\w+)<R: Runtime>\(([\s\S]*?)\)\s*->/g;
  for (const [, name, params] of commands.matchAll(re)) {
    const input = params
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p && !p.startsWith("app:"))
      .map((p) => p.split(":")[0].trim());
    out.set(name, input[0] ?? null);
  }
  return out;
}

describe("nuvo-iap invoke arguments match the Rust command signatures", () => {
  const inputs = rustInputs();

  it("finds the plugin's commands", () => {
    expect([...inputs.keys()].sort()).toEqual(
      ["manage_subscriptions", "products", "purchase", "restore"].sort(),
    );
  });

  for (const [cmd, param] of rustInputs()) {
    it(`${cmd} is invoked with ${param ? `{ ${param}: … }` : "no arguments"}`, () => {
      const call = new RegExp(`invokeIap(?:<[\\s\\S]*?>)?\\(\\s*"${cmd}"\\s*(,\\s*\\{\\s*(\\w+)\\s*:)?`);
      const m = iap.match(call);
      expect(m, `invokeIap("${cmd}") not found`).toBeTruthy();
      expect(m?.[2] ?? null).toBe(param);
    });
  }
});
