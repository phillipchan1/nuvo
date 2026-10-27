import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareAuthIds } from "../worker/src/entitlementParity.ts";

/**
 * Cutover copies GoTrue `auth.users.id` into Better Auth `"user".id`
 * unchanged. Billing and entitlement both key by that id, so a remap
 * would orphan every subscription row.
 */
const ROOT = join(import.meta.dirname, "..");
const WORKFLOW = readFileSync(join(ROOT, ".github/workflows/cutover-migrate.yml"), "utf8");
const MIGRATION_TMP = readFileSync(join(ROOT, "docs/cloudflare-migration/migration_tmp.sql"), "utf8");

describe("cutover auth ids are 1:1", () => {
  it("COPY projects auth.users.id and INSERT uses that same id", () => {
    expect(WORKFLOW).toMatch(/FROM migration_tmp\.auth_users\(\)/);
    expect(WORKFLOW).toMatch(/mapping auth\.users → "user" \(same ids\)/);
    expect(WORKFLOW).toContain(
      'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (',
    );
    expect(WORKFLOW).toMatch(/sql_literal\(user\['id'\]\)/);
    expect(WORKFLOW).toMatch(/upserting public\.users from auth\.users \(auth_id = id\)/);
    expect(WORKFLOW).toMatch(/INSERT INTO public\.users \(id, email, auth_id, created_at\)/);
    expect(WORKFLOW).toMatch(/SELECT id, email, id, COALESCE\(created_at, now\(\)\)/);
  });

  it("migration_tmp.auth_users returns the GoTrue id unchanged", () => {
    expect(MIGRATION_TMP).toMatch(/SELECT u\.id,/);
    expect(MIGRATION_TMP).toMatch(/FROM auth\.users u/);
    expect(MIGRATION_TMP).not.toMatch(/gen_random_uuid\(\)/);
  });

  it("compareAuthIds is identical when the copy preserves ids", () => {
    const ids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ];
    const got = compareAuthIds(ids, ids);
    expect(got).toMatchObject({
      sourceUsers: 2,
      targetUsers: 2,
      identical: 2,
      missingOnTarget: 0,
      extraOnTarget: 0,
      remaps: 0,
    });
  });

  it("compareAuthIds reports a remap when ids are rewritten", () => {
    const source = ["11111111-1111-4111-8111-111111111111"];
    const remapped = ["99999999-9999-4999-8999-999999999999"];
    const got = compareAuthIds(source, remapped);
    expect(got.identical).toBe(0);
    expect(got.remaps).toBe(2);
    expect(got.missingOnTarget).toBe(1);
    expect(got.extraOnTarget).toBe(1);
  });
});
