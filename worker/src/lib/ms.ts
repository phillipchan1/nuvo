import type { Sql } from "../db.ts";
import { logSync, openAccountSecret, sealAccountSecret, updateAccount } from "../calendar/store.ts";
import type { CalendarAccount } from "../calendar/types.ts";

export const MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
export const MS_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
export const GRAPH = "https://graph.microsoft.com/v1.0";
export const MS_SCOPES = "offline_access User.Read Calendars.Read";

export async function getMsAccessToken(
  sql: Sql,
  account: CalendarAccount,
  env: { TOKEN_ENC_KEY_V1?: string; TOKEN_ENC_KEY_V2?: string; TOKEN_ENC_CURRENT?: string; MS_CLIENT_ID?: string; MS_CLIENT_SECRET?: string },
): Promise<string> {
  const expiresAt = account.access_token_expires_at
    ? new Date(account.access_token_expires_at).getTime()
    : 0;
  if (account.access_token && expiresAt > Date.now() + 60_000) return account.access_token;

  const fail = async (why: string): Promise<never> => {
    await updateAccount(sql, account.id, account.user_id, { needs_reconnect: true });
    await logSync(sql, "m365", "token-refresh", "error", why, account.user_id);
    throw new Error("m365 token refresh failed");
  };

  const refreshToken = await openAccountSecret(account, env);
  if (!refreshToken) return await fail("no refresh token stored");
  if (!env.MS_CLIENT_ID || !env.MS_CLIENT_SECRET) return await fail("MS client is not configured");

  const res = await fetch(MS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.MS_CLIENT_ID,
      client_secret: env.MS_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: MS_SCOPES,
    }),
  });
  if (!res.ok) return await fail(`refresh failed: ${res.status}`);
  const tok = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!tok.access_token) return await fail("token response missing access_token");

  if (tok.refresh_token) {
    await sealAccountSecret(sql, account.id, account.user_id, env, tok.refresh_token);
  }
  const expires = new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString();
  await updateAccount(sql, account.id, account.user_id, {
    access_token: tok.access_token,
    access_token_expires_at: expires,
    needs_reconnect: false,
  });
  account.access_token = tok.access_token;
  account.access_token_expires_at = expires;
  return tok.access_token;
}

/** Shape-only check used by tokenDecrypt. Never prints the token. */
export function tokenShapeOk(provider: string, token: string): boolean {
  if (!token || token.length < 8) return false;
  if (provider === "google") return token.startsWith("1//") || token.length > 20;
  if (provider === "m365") return token.length > 20;
  if (provider === "icloud") return token.replace(/-/g, "").length >= 8;
  if (provider === "ics") return /^https:\/\//i.test(token);
  if (provider === "apple") return token.length > 20;
  if (provider === "github") return /^(gho_|ghp_|github_pat_)/.test(token) || token.length > 20;
  return token.length > 8;
}
