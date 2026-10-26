import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APPLE_TOKEN_SEAL_ERROR,
  persistAppleProfileAndToken,
} from "../worker/src/appleIdentity.ts";
import { sealTokenOrThrow, TokenSealError } from "../worker/src/lib/secrets.ts";
import type { Store } from "../worker/src/store.ts";

const TOKEN = "rt_apple_refresh_do_not_store";
const USER = "11111111-1111-1111-1111-111111111111";
const PROFILE = {
  apple_user_id: "001234.apple-sub.0001",
  email: "ada@example.test",
  given_name: "Ada",
  family_name: "Lovelace",
  is_private_relay: false,
};

function encKey(): string {
  const bytes = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
  return btoa(String.fromCharCode(...bytes));
}

function recordingStore(): { store: Store; calls: { text: string; values: unknown[] }[] } {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve([]);
  }) as Store["sql"];
  return { store: { sql, userId: USER }, calls };
}

describe("Apple refresh token is never stored in plaintext", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sealTokenOrThrow fails closed when TOKEN_ENC_KEY_V1 is unset or invalid", async () => {
    await expect(sealTokenOrThrow(undefined, TOKEN, "apple_identities:u:u")).rejects.toBeInstanceOf(TokenSealError);
    await expect(sealTokenOrThrow("", TOKEN, "apple_identities:u:u")).rejects.toBeInstanceOf(TokenSealError);
    await expect(sealTokenOrThrow("not-a-32-byte-key", TOKEN, "apple_identities:u:u")).rejects.toBeInstanceOf(
      TokenSealError,
    );
  });

  it("returns 503, logs no token value, and persists no plaintext when the key is unset", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { store, calls } = recordingStore();
    const res = await persistAppleProfileAndToken(
      store,
      { id: USER },
      {},
      PROFILE,
      TOKEN,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string; ok?: boolean };
    expect(body.error).toBe(APPLE_TOKEN_SEAL_ERROR);
    expect(body.ok).not.toBe(true);
    expect(JSON.stringify(calls)).not.toContain(TOKEN);
    expect(error).toHaveBeenCalled();
    const logged = error.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).toContain("TOKEN_ENC_KEY_V1");
    expect(logged).not.toContain(TOKEN);
  });

  it("seals the token when the key is set and still never writes plaintext", async () => {
    const { store, calls } = recordingStore();
    const res = await persistAppleProfileAndToken(
      store,
      { id: USER },
      { TOKEN_ENC_KEY_V1: encKey() },
      PROFILE,
      TOKEN,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);
    expect(JSON.stringify(calls)).not.toContain(TOKEN);
    expect(calls.some((c) => c.values.some((v) => v instanceof Uint8Array))).toBe(true);
  });

  it("the persist path never hands the refresh token to Better Auth account", () => {
    const apple = readFileSync("worker/src/appleIdentity.ts", "utf8");
    const store = readFileSync("worker/src/store.ts", "utf8");
    expect(apple).toContain("sealTokenOrThrow");
    expect(apple).toContain("TokenSealError");
    expect(apple).not.toMatch(/linkOwnedAppleAccount\([^;]*refreshToken/);
    const start = store.indexOf("export async function linkOwnedAppleAccount");
    const end = store.indexOf("export async function ownedAppleRefreshToken");
    expect(store.slice(start, end)).not.toMatch(/refreshToken/);
  });
});
