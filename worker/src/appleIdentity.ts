/**
 * Persist what Sign in with Apple only ever hands over once, and attach the
 * Apple `sub` to this session's Better Auth `account` row.
 *
 * Owner is the verified session — never a client `user_id`. A later null
 * from Apple must not overwrite a stored name/email (`mergeAppleProfile`).
 * Best-effort: a failed code exchange still returns `{ ok: true }`.
 */
import { json, OPEN_CORS } from "./cors.ts";
import type { Env } from "./env.ts";
import {
  appleDisplayName,
  exchangeAppleAuthorizationCode,
  mergeAppleProfile,
  readAppleAuthConfig,
  type AppleProfile,
} from "../../supabase/functions/_shared/appleIdentity.ts";
import { openToken, sealToken } from "./lib/secrets.ts";
import {
  appleUserIdTakenByOther,
  getOwnedAppleIdentity,
  linkOwnedAppleAccount,
  ownedAppleRefreshToken,
  upsertOwnedAppleIdentity,
  type Store,
} from "./store.ts";

export type SessionUser = { id: string; email?: string | null };

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function persistAppleIdentity(
  store: Store,
  user: SessionUser,
  body: unknown,
  env: Env,
): Promise<Response> {
  const input = asRecord(body);
  const stored = await getOwnedAppleIdentity(store);
  let appleUserId = clean(input.appleUserId);
  if (appleUserId && (await appleUserIdTakenByOther(store, appleUserId))) {
    // Same 200 as a quiet merge — do not reveal that the sub is taken.
    appleUserId = clean(stored?.apple_user_id);
  }

  const profile = mergeAppleProfile(stored, {
    appleUserId,
    email: input.email,
    givenName: input.givenName,
    familyName: input.familyName,
  });

  let refreshToken: string | null = null;
  const code = typeof input.authorizationCode === "string" ? input.authorizationCode.trim() : "";
  const config = readAppleAuthConfig({
    APPLE_SIWA_TEAM_ID: env.APPLE_SIWA_TEAM_ID,
    APPLE_SIWA_KEY_ID: env.APPLE_SIWA_KEY_ID,
    APPLE_SIWA_PRIVATE_KEY: env.APPLE_SIWA_PRIVATE_KEY,
    APPLE_SIWA_CLIENT_ID: env.APPLE_SIWA_CLIENT_ID,
    APPLE_BUNDLE_ID: env.APPLE_BUNDLE_ID,
  });
  if (code && config) {
    refreshToken = await exchangeAppleAuthorizationCode(config, code).catch(() => null);
  }

  let sealed: { enc: Uint8Array; iv: Uint8Array; keyVersion: number } | null = null;
  if (refreshToken) {
    sealed = await sealToken(
      env.TOKEN_ENC_KEY_V1,
      refreshToken,
      `apple_identities:${store.userId}:${store.userId}`,
    );
  }

  await upsertOwnedAppleIdentity(store, profile, sealed);

  if (profile.apple_user_id) {
    await linkOwnedAppleAccount(store.sql, user.id, profile.apple_user_id, refreshToken);
  }

  const name = appleDisplayName(profile);
  if (name) {
    await store.sql`
      UPDATE "user"
      SET name = ${name}
      WHERE id = ${user.id}
        AND (name IS NULL OR name = '')
    `;
  }

  const revocable = Boolean(refreshToken) || Boolean(
    profile.apple_user_id && (await ownedAppleRefreshToken(store.sql, user.id, profile.apple_user_id)),
  );
  return json({ ok: true, revocable }, 200, OPEN_CORS);
}

export async function loadOwnedAppleRefreshToken(
  store: Store,
  authUserId: string,
  env: Env,
): Promise<string | null> {
  const fromAccount = await ownedAppleRefreshToken(store.sql, authUserId);
  if (fromAccount) return fromAccount;
  const row = await getOwnedAppleIdentity(store);
  if (!row?.refresh_token_enc || !row.refresh_token_iv) return null;
  return openToken(
    env.TOKEN_ENC_KEY_V1,
    row.refresh_token_enc,
    row.refresh_token_iv,
    `apple_identities:${store.userId}:${store.userId}`,
  );
}

export type { AppleProfile };
