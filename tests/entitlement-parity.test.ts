import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { entitlementOf, type SubscriptionColumns } from "../worker/src/entitlement.ts";
import {
  compareAuthIds,
  compareEntitlementParity,
  formatParityCounts,
} from "../worker/src/entitlementParity.ts";

const now = new Date("2026-10-26T19:00:00Z");
const U1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const U2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const U3 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";

const stripe: SubscriptionColumns = {
  user_id: U1,
  status: "active",
  trial_ends_at: "2026-12-01T00:00:00Z",
  plan_source: "stripe",
};
const apple: SubscriptionColumns = {
  user_id: U2,
  status: "active",
  trial_ends_at: null,
  plan_source: "apple",
};
const trial: SubscriptionColumns = {
  user_id: U3,
  status: "trialing",
  trial_ends_at: "2026-11-01T00:00:00Z",
  plan_source: null,
};

describe("auth id mapping from the copy", () => {
  it("is 1:1 when every source id exists as a Better Auth user id", () => {
    const report = compareAuthIds([U1, U2, U3], [U3, U1, U2]);
    expect(report).toMatchObject({
      sourceUsers: 3,
      targetUsers: 3,
      identical: 3,
      remaps: 0,
      missingOnTarget: 0,
      extraOnTarget: 0,
    });
  });

  it("is a no-go when an id is remapped", () => {
    const remapped = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
    const report = compareAuthIds([U1, U2], [remapped, U2]);
    expect(report.identical).toBe(1);
    expect(report.remaps).toBeGreaterThan(0);
    expect(report.missingOnTarget).toBe(1);
  });
});

describe("entitlement parity (Worker check keyed by preserved user_id)", () => {
  it("keeps Stripe, Apple, and trial tiers identical after a 1:1 copy", () => {
    const report = compareEntitlementParity({
      sourceUserIds: [U1, U2, U3],
      targetUserIds: [U1, U2, U3],
      subscriptions: [stripe, apple, trial],
      now,
    });
    expect(report.ok).toBe(true);
    expect(report.entitlementMismatches).toBe(0);
    expect(report.entitlementMatches).toBe(3);
    expect(report.orphanSubscriptions).toBe(0);
    expect(formatParityCounts(report)).toContain("auth users 3/3 identical, remaps 0");
    expect(formatParityCounts(report)).toContain("entitlement mismatches 0");
  });

  it("fails when the Worker check would read a different tier for the same id", () => {
    const report = compareEntitlementParity({
      sourceUserIds: [U1],
      targetUserIds: [U1],
      subscriptions: [stripe],
      now,
      readAfter: (userId) =>
        entitlementOf({ user_id: userId, status: "cancelled", trial_ends_at: null, plan_source: "stripe" }, userId, now),
    });
    expect(report.ok).toBe(false);
    expect(report.entitlementMismatches).toBe(1);
    expect(report.problems.some((p) => p.includes("entitlement changed"))).toBe(true);
  });

  it("fails when a subscription's user id is missing from the auth copy", () => {
    const report = compareEntitlementParity({
      sourceUserIds: [U1],
      targetUserIds: [U1],
      subscriptions: [apple],
      now,
    });
    expect(report.ok).toBe(false);
    expect(report.orphanSubscriptions).toBe(1);
  });

  it("treats a Stripe-active row and an Apple-active row as the same yes", () => {
    expect(entitlementOf(stripe, U1, now).entitled).toBe(true);
    expect(entitlementOf(apple, U2, now).entitled).toBe(true);
    expect(entitlementOf(stripe, U1, now).plan).toBe("active");
    expect(entitlementOf(apple, U2, now).plan).toBe("active");
  });
});

describe("parity CLI", () => {
  it("exits 0 on a 1:1 fixture and prints counts, not row data", () => {
    const dir = mkdtempSync(join(tmpdir(), "entitlement-parity-"));
    const source = join(dir, "source.json");
    const target = join(dir, "target.json");
    const subs = join(dir, "subs.json");
    writeFileSync(source, JSON.stringify([{ id: U1 }, { id: U2 }]));
    writeFileSync(target, JSON.stringify([{ id: U1 }, { id: U2 }]));
    writeFileSync(subs, JSON.stringify([stripe, apple]));
    const out = execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/check-entitlement-parity.ts",
        "--source-ids",
        source,
        "--target-ids",
        target,
        "--subscriptions",
        subs,
      ],
      { encoding: "utf8", env: { ...process.env, ENTITLEMENT_NOW: now.toISOString() } },
    );
    expect(out).toContain("auth users 2/2 identical, remaps 0");
    expect(out).toContain("entitlement parity: ok");
    expect(out).not.toContain(U1);
    expect(out).not.toContain("stripe");
    expect(out).not.toMatch(/@/);
  });

  it("exits 1 when ids are remapped", () => {
    const dir = mkdtempSync(join(tmpdir(), "entitlement-parity-"));
    const source = join(dir, "source.json");
    const target = join(dir, "target.json");
    const subs = join(dir, "subs.json");
    writeFileSync(source, JSON.stringify([U1, U2]));
    writeFileSync(target, JSON.stringify(["cccccccc-cccc-4ccc-8ccc-ccccccccccc1", U2]));
    writeFileSync(subs, JSON.stringify([stripe, apple]));
    try {
      execFileSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "scripts/check-entitlement-parity.ts",
          "--source-ids",
          source,
          "--target-ids",
          target,
          "--subscriptions",
          subs,
        ],
        { encoding: "utf8" },
      );
      expect.fail("remap fixture should exit 1");
    } catch (err) {
      const failure = err as { status?: number; stdout?: string; stderr?: string };
      expect(failure.status).toBe(1);
      expect(`${failure.stderr ?? ""}${failure.stdout ?? ""}`).toMatch(/auth ids are not 1:1/);
    }
  });
});
