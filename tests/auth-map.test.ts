import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  betterAuthProviderId,
  identityAccountId,
  mapAuthIdentityToAccount,
} from "../worker/src/lib/authMap.ts";

const USER = "11111111-1111-1111-1111-111111111111";

describe("Apple sub → Better Auth account mapping", () => {
  it("preserves the Apple sub as accountId and the GoTrue user_id as userId", () => {
    const mapped = mapAuthIdentityToAccount({
      user_id: USER,
      provider: "apple",
      provider_id: "should-not-win",
      identity_data: { sub: "001234.apple-sub.0001", provider_id: "also-not-win" },
    });
    expect(mapped).toEqual({
      accountId: "001234.apple-sub.0001",
      providerId: "apple",
      userId: USER,
    });
  });

  it("falls back to identity_data.provider_id then the copied provider_id column", () => {
    expect(
      identityAccountId({
        user_id: USER,
        provider: "apple",
        provider_id: "col-sub",
        identity_data: { provider_id: "data-provider-id" },
      }),
    ).toBe("data-provider-id");
    expect(
      identityAccountId({
        user_id: USER,
        provider: "apple",
        provider_id: "col-sub",
        identity_data: {},
      }),
    ).toBe("col-sub");
  });

  it("maps email identities to Better Auth credential and leaves google/apple named", () => {
    expect(betterAuthProviderId("email")).toBe("credential");
    expect(betterAuthProviderId("Apple")).toBe("apple");
    expect(betterAuthProviderId("google")).toBe("google");
  });

  it("the copy job and migration_tmp reader use identity_data.sub as the Apple account id", () => {
    const yml = readFileSync(".github/workflows/cutover-migrate.yml", "utf8");
    expect(yml).toContain("identity_data->>'sub'");
    expect(yml).toContain('provider in {"google", "apple"}');
    expect(yml).toContain('"accountId"');
    expect(yml).toContain('"userId"');
    expect(yml).toContain("mapping auth.identities → account (google / apple / email)");

    const sql = readFileSync("docs/cloudflare-migration/migration_tmp.sql", "utf8");
    expect(sql).toContain("identity_data->>'sub'");
    expect(sql).toContain("migration_tmp.auth_identities");
  });
});
