import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SOURCE_TOKENLESS_APPLE_SQL,
  TARGET_UNSEALED_APPLE_SQL,
  tokenlessParity,
} from "../scripts/cutover-token-parity.mjs";

describe("apple_identities token-less parity", () => {
  it("passes when every token-less source row lands unsealed (2 = 2)", () => {
    // Prod 2026-10-29: two Apple identities from ID-token-only sign-in.
    expect(tokenlessParity({ source: 2, target: 2 })).toEqual({
      ok: true,
      line: "apple_identities token-less: source=2 neon=2",
    });
  });

  it("passes zero/zero", () => {
    expect(tokenlessParity({ source: 0, target: 0 }).ok).toBe(true);
  });

  it("fails when Neon has fewer unsealed rows than the source had token-less (2 vs 1)", () => {
    const r = tokenlessParity({ source: 2, target: 1 });
    expect(r.ok).toBe(false);
    expect(r.line).toBe("apple_identities token-less: source=2 neon=1");
  });

  it("fails when Neon has more unsealed rows — an owed token went unsealed (2 vs 3)", () => {
    expect(tokenlessParity({ source: 2, target: 3 }).ok).toBe(false);
  });

  it("fails on a count it cannot read", () => {
    expect(tokenlessParity({ source: undefined, target: 0 }).ok).toBe(false);
    expect(tokenlessParity({ source: -1, target: -1 }).ok).toBe(false);
  });

  it("counts the source by Vault pointer and Neon by sealed column, nothing else", () => {
    expect(SOURCE_TOKENLESS_APPLE_SQL).toMatch(/count\(\*\)/);
    expect(SOURCE_TOKENLESS_APPLE_SQL).toMatch(/public\.apple_identities/);
    expect(SOURCE_TOKENLESS_APPLE_SQL).toMatch(/refresh_token_secret_id IS NULL/);
    expect(TARGET_UNSEALED_APPLE_SQL).toMatch(/count\(\*\)/);
    expect(TARGET_UNSEALED_APPLE_SQL).toMatch(/public\.apple_identities/);
    expect(TARGET_UNSEALED_APPLE_SQL).toMatch(/refresh_token_enc IS NULL/);
    for (const q of [SOURCE_TOKENLESS_APPLE_SQL, TARGET_UNSEALED_APPLE_SQL]) {
      expect(q).not.toMatch(/user_id|email|secret\b|decrypted/i);
    }
  });

  it("is wired into the seal script after the per-table check, and dies on mismatch", () => {
    const script = readFileSync(new URL("../scripts/cutover-seal-tokens.mjs", import.meta.url), "utf8");
    const perTable = script.indexOf('die("token copy mismatches — abort")');
    const parity = script.indexOf("tokenlessParity(");
    expect(perTable).toBeGreaterThan(0);
    expect(parity).toBeGreaterThan(perTable);
    expect(script).toMatch(/source\.unsafe\(SOURCE_TOKENLESS_APPLE_SQL\)/);
    expect(script).toMatch(/target\.unsafe\(TARGET_UNSEALED_APPLE_SQL\)/);
    expect(script).toMatch(/if \(!parity\.ok\) die\(/);
  });
});
