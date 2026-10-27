import { describe, expect, it } from "vitest";
import {
  ACTING_EMAIL_HEADER,
  ACTING_USER_HEADER,
  actingUserFromRequest,
  isUuid,
  sameSecret,
} from "../supabase/functions/_shared/actingUser.ts";

const KEY = "service-role-test-key-not-a-secret";
const USER = "11111111-1111-4111-8111-111111111111";

function req(headers: Record<string, string>): Request {
  return new Request("https://example.test/apple-iap", { headers });
}

describe("actingUserFromRequest", () => {
  it("accepts service-role + verified UUID header", () => {
    const got = actingUserFromRequest(
      req({
        Authorization: `Bearer ${KEY}`,
        [ACTING_USER_HEADER]: USER,
        [ACTING_EMAIL_HEADER]: "a@example.test",
      }),
      KEY,
    );
    expect(got).toEqual({
      id: USER,
      email: "a@example.test",
      user_metadata: {},
    });
  });

  it("ignores a client-supplied id without the service-role key", () => {
    expect(
      actingUserFromRequest(
        req({
          Authorization: "Bearer user-jwt",
          [ACTING_USER_HEADER]: USER,
        }),
        KEY,
      ),
    ).toBeNull();
  });

  it("ignores a body-shaped spoof — only the header counts", () => {
    const spoof = new Request("https://example.test/apple-iap", {
      method: "POST",
      headers: {
        Authorization: "Bearer user-jwt",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id: USER, actingUserId: USER }),
    });
    expect(actingUserFromRequest(spoof, KEY)).toBeNull();
  });

  it("rejects a non-UUID acting header even with the service-role key", () => {
    expect(
      actingUserFromRequest(
        req({
          Authorization: `Bearer ${KEY}`,
          [ACTING_USER_HEADER]: "not-a-uuid",
        }),
        KEY,
      ),
    ).toBeNull();
  });

  it("rejects service-role alone (no acting header)", () => {
    expect(actingUserFromRequest(req({ Authorization: `Bearer ${KEY}` }), KEY)).toBeNull();
  });

  it("does not treat a prefix of the key as the key", () => {
    expect(
      actingUserFromRequest(
        req({
          Authorization: `Bearer ${KEY.slice(0, 8)}`,
          [ACTING_USER_HEADER]: USER,
        }),
        KEY,
      ),
    ).toBeNull();
  });
});

describe("sameSecret / isUuid", () => {
  it("is false for different lengths or empty", () => {
    expect(sameSecret("", KEY)).toBe(false);
    expect(sameSecret(KEY, "")).toBe(false);
    expect(sameSecret("ab", "abc")).toBe(false);
    expect(sameSecret(KEY, KEY)).toBe(true);
  });

  it("accepts only hyphenated UUIDs", () => {
    expect(isUuid(USER)).toBe(true);
    expect(isUuid(USER.replace(/-/g, ""))).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});
