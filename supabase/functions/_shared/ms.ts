import { admin, logSync, readSecret, storeSecret } from "./admin.ts";

export const MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
export const MS_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
export const GRAPH = "https://graph.microsoft.com/v1.0";
export const MS_SCOPES = "offline_access User.Read Calendars.Read";

export interface MsAccount {
  id: string;
  user_id: string;
  email: string;
  refresh_token_secret_id: string | null;
  access_token: string | null;
  access_token_expires_at: string | null;
  delta_link: string | null;
  needs_reconnect: boolean;
}

/** Refresh the Graph access token. Microsoft rotates refresh tokens, so the
 *  new one goes back into Vault on every refresh. */
export async function getMsAccessToken(account: MsAccount): Promise<string> {
  const expiresAt = account.access_token_expires_at
    ? new Date(account.access_token_expires_at).getTime()
    : 0;
  if (account.access_token && expiresAt > Date.now() + 60_000) return account.access_token;

  const fail = async (why: string) => {
    await admin.from("calendar_accounts").update({ needs_reconnect: true }).eq("id", account.id);
    await logSync("m365", "token-refresh", "error", why, account.user_id);
    throw new Error(`m365 token refresh failed: ${why}`);
  };

  if (!account.refresh_token_secret_id) return await fail("no refresh token stored");
  const refreshToken = await readSecret(account.refresh_token_secret_id);

  const res = await fetch(MS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("MS_CLIENT_ID")!,
      client_secret: Deno.env.get("MS_CLIENT_SECRET")!,
      grant_type: "refresh_token",
      refresh_token: refreshToken ?? "",
      scope: MS_SCOPES,
    }),
  });
  if (!res.ok) return await fail(await res.text());
  const tok = await res.json();

  if (tok.refresh_token) {
    await storeSecret(`m365_refresh_${account.user_id}_${account.email}`, tok.refresh_token);
  }
  await admin
    .from("calendar_accounts")
    .update({
      access_token: tok.access_token,
      access_token_expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
      needs_reconnect: false,
    })
    .eq("id", account.id);
  account.access_token = tok.access_token;
  return tok.access_token;
}
