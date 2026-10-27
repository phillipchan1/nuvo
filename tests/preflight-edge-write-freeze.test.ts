import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  UNFROZEN_VALUES,
  WATCHED_SECRETS,
  evaluateSecretsList,
  knownOffDigests,
  parseProjectRef,
  sha256Hex,
} from "../scripts/preflight-edge-write-freeze.mjs";
import { writeFreezeOn } from "../supabase/functions/_shared/writeFreeze.ts";

const ROOT = join(import.meta.dirname, "..");
const SCRIPT = readFileSync(join(ROOT, "scripts/preflight-edge-write-freeze.mjs"), "utf8");

function digestOf(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Real `supabase secrets list -o json` SecretResponse row. `value` is sha256 hex. */
function cliRow(name: string, raw: string) {
  return { name, value: digestOf(raw), updated_at: "2026-10-27T15:00:00Z" };
}

describe("preflight-edge-write-freeze", () => {
  it("matches writeFreeze.ts unfrozen values exactly", () => {
    expect([...UNFROZEN_VALUES]).toEqual(["", "0", "false", "no", "off"]);
    for (const raw of UNFROZEN_VALUES) {
      expect(writeFreezeOn(raw), raw).toBe(false);
    }
    expect(writeFreezeOn("1")).toBe(true);
    expect(writeFreezeOn("maybe")).toBe(true);
  });

  it("known-off digests are sha256 hex of those raw strings", () => {
    const off = knownOffDigests();
    for (const raw of UNFROZEN_VALUES) {
      expect(off.has(sha256Hex(raw))).toBe(true);
      expect(off.has(digestOf(raw))).toBe(true);
    }
    expect(off.has(digestOf("1"))).toBe(false);
    expect(off.has(digestOf("FALSE"))).toBe(false);
  });

  it("absent secrets PASS", () => {
    const out = evaluateSecretsList([]);
    expect(out.ok).toBe(true);
    expect(out.lines).toEqual(["WRITE_FREEZE PASS", "MAINTENANCE_WRITE_FREEZE PASS"]);
  });

  it("unrelated secrets are ignored", () => {
    const out = evaluateSecretsList([cliRow("OPENAI_API_KEY", "sk-leak")]);
    expect(out.ok).toBe(true);
    expect(out.lines.join("\n")).not.toMatch(/OPENAI|sk-leak|digest|value/i);
  });

  it.each(UNFROZEN_VALUES)("known-off %j value is PASS", (raw) => {
    const out = evaluateSecretsList([cliRow("WRITE_FREEZE", raw)]);
    expect(out.ok).toBe(true);
    expect(out.lines).toContain("WRITE_FREEZE PASS");
    expect(out.lines).toContain("MAINTENANCE_WRITE_FREEZE PASS");
    expect(out.lines.join("\n")).not.toContain(digestOf(raw));
    if (raw) expect(out.lines.join("\n")).not.toContain(raw);
  });

  it.each(["0", "off"] as const)("%j present is PASS", (raw) => {
    const out = evaluateSecretsList([cliRow("WRITE_FREEZE", raw), cliRow("MAINTENANCE_WRITE_FREEZE", raw)]);
    expect(out.ok).toBe(true);
    expect(out.lines).toEqual(["WRITE_FREEZE PASS", "MAINTENANCE_WRITE_FREEZE PASS"]);
    expect(out.lines.join("\n")).not.toContain(digestOf(raw));
    expect(out.lines.join("\n")).not.toContain(raw);
  });

  it("a non-off value is FAIL", () => {
    const digest = digestOf("1");
    const out = evaluateSecretsList([cliRow("WRITE_FREEZE", "1")]);
    expect(out.ok).toBe(false);
    expect(out.lines).toContain("WRITE_FREEZE FAIL");
    expect(out.lines.join("\n")).not.toContain(digest);
    expect(out.lines.join("\n")).not.toMatch(/\b1\b/);
  });

  it("MAINTENANCE_WRITE_FREEZE stray value is FAIL", () => {
    const digest = digestOf("maybe");
    const out = evaluateSecretsList([cliRow("WRITE_FREEZE", "off"), cliRow("MAINTENANCE_WRITE_FREEZE", "maybe")]);
    expect(out.ok).toBe(false);
    expect(out.lines).toEqual(["WRITE_FREEZE PASS", "MAINTENANCE_WRITE_FREEZE FAIL"]);
    expect(out.lines.join("\n")).not.toContain(digest);
    expect(out.lines.join("\n")).not.toContain("maybe");
  });

  it("missing value field is FAIL", () => {
    const out = evaluateSecretsList([{ name: "WRITE_FREEZE", updated_at: "2026-10-27T15:00:00Z" }]);
    expect(out.ok).toBe(false);
    expect(out.lines).toContain("WRITE_FREEZE FAIL");
  });

  it("empty value field is FAIL", () => {
    const out = evaluateSecretsList([{ name: "WRITE_FREEZE", value: "", updated_at: "2026-10-27T15:00:00Z" }]);
    expect(out.ok).toBe(false);
    expect(out.lines).toContain("WRITE_FREEZE FAIL");
  });

  it("leftover digest field still PASSes known-off", () => {
    const out = evaluateSecretsList([{ name: "WRITE_FREEZE", digest: digestOf("off") }]);
    expect(out.ok).toBe(true);
    expect(out.lines).toContain("WRITE_FREEZE PASS");
    expect(out.lines.join("\n")).not.toContain(digestOf("off"));
  });

  it("unexpected JSON shape is FAIL", () => {
    for (const parsed of [{}, null, "x", { secrets: [] }, [{ value: "abc" }], [{ name: 1, value: "abc" }]]) {
      const out = evaluateSecretsList(parsed);
      expect(out.ok, JSON.stringify(parsed)).toBe(false);
      expect(out.lines.some((l) => l.includes("FAIL"))).toBe(true);
      expect(out.lines.join("\n")).not.toMatch(/abc|"x"/);
    }
  });

  it("parseProjectRef reads --project-ref and does not log it", () => {
    expect(parseProjectRef(["--project-ref", "abcdefghijklmnop"])).toBe("abcdefghijklmnop");
    expect(parseProjectRef(["--project-ref=abcdefghijklmnop"])).toBe("abcdefghijklmnop");
    expect(parseProjectRef([])).toBe("");
  });

  it("script never prints digest or secret values", () => {
    expect(SCRIPT).not.toMatch(/console\.(log|error|info)\([^)]*digest/);
    expect(SCRIPT).not.toMatch(/console\.(log|error|info)\([^)]*row\./);
    expect(SCRIPT).toMatch(/Prints only secret names and PASS\/FAIL/);
  });

  it("tests and the module do not call supabase themselves", () => {
    expect(SCRIPT).toMatch(/spawn\("supabase"/);
    expect(SCRIPT).toMatch(/fixture JSON/);
    const testSrc = readFileSync(join(ROOT, "tests/preflight-edge-write-freeze.test.ts"), "utf8");
    expect(testSrc).not.toMatch(/spawnSync\(\s*["']supabase["']/);
    expect(testSrc).toMatch(/evaluateSecretsList/);
  });

  it("runbook names the preflight before any edge redeploy", () => {
    const doc = readFileSync(join(ROOT, "docs/cloudflare-cutover.md"), "utf8");
    expect(doc).toMatch(/preflight-edge-write-freeze\.mjs/);
    expect(doc).toMatch(/before any Supabase edge-function redeploy/i);
    expect(doc).toMatch(/SecretResponse/);
    expect(WATCHED_SECRETS).toEqual(["WRITE_FREEZE", "MAINTENANCE_WRITE_FREEZE"]);
  });
});
