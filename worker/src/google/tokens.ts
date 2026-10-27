import type { Env } from "../env.ts";
import type { Sql } from "../db.ts";
import { outboundFetch } from "../lib/outboundFetch.ts";
import { openToken, parseTokenKeyring } from "../secrets.ts";
import { GOOGLE_API, GOOGLE_TOKEN_URL, type GoogleAccount } from "./types.ts";
import { calendarAccountAad, logSync, markReconnect, saveAccessToken } from "./owned.ts";

function accessStillValid(expiresAtIso: string | null): boolean {
  if (!expiresAtIso) return false;
  return new Date(expiresAtIso).getTime() > Date.now() + 60_000;
}

async function unsealAccessToken(env: Env, account: GoogleAccount): Promise<string | null> {
  if (!account.access_token_enc || !account.access_token_iv || account.key_version == null) {
    return null;
  }
  const ring = await parseTokenKeyring(env);
  return openToken(
    {
      ciphertext: account.access_token_enc,
      iv: account.access_token_iv,
      keyVersion: account.key_version,
    },
    calendarAccountAad(account),
    ring,
  );
}

export async function getAccessToken(sql: Sql, env: Env, account: GoogleAccount): Promise<string> {
  if (account.access_token && accessStillValid(account.access_token_expires_at)) {
    return account.access_token;
  }

  if (accessStillValid(account.access_token_expires_at)) {
    try {
      const opened = await unsealAccessToken(env, account);
      if (opened) {
        account.access_token = opened;
        return opened;
      }
    } catch {
      // Fall through to refresh. AAD/key mismatch is not a client-facing leak.
    }
  }

  if (!account.refresh_token_enc || !account.refresh_token_iv || account.key_version == null) {
    await markReconnect(sql, account.id, account.user_id);
    await logSync(sql, "google", "token-refresh", "error", "no refresh token stored", account.user_id);
    throw new Error("no refresh token");
  }

  const ring = await parseTokenKeyring(env);
  const refreshToken = await openToken(
    {
      ciphertext: account.refresh_token_enc,
      iv: account.refresh_token_iv,
      keyVersion: account.key_version,
    },
    calendarAccountAad(account),
    ring,
  );

  const res = await outboundFetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID ?? "",
      client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    await markReconnect(sql, account.id, account.user_id);
    await logSync(sql, "google", "token-refresh", "error", `refresh failed: ${res.status}`, account.user_id);
    throw new Error("google token refresh failed");
  }
  const tok = (await res.json()) as { access_token?: string; expires_in?: number };
  const accessToken = tok.access_token;
  if (!accessToken) throw new Error("google token refresh failed");
  const expires = new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString();
  await saveAccessToken(sql, env, account, accessToken, expires);
  return accessToken;
}

export async function gFetch(
  sql: Sql,
  env: Env,
  account: GoogleAccount,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getAccessToken(sql, env, account);
  const url = path.startsWith("http") ? path : `${GOOGLE_API}${path}`;
  return outboundFetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

export function isGoogleSeriesMaster(e: { recurrence?: unknown; recurringEventId?: unknown }): boolean {
  return Boolean(Array.isArray(e?.recurrence) && e.recurrence.length && !e.recurringEventId);
}

export function mapGoogleEvent(
  account: GoogleAccount,
  calendarId: string,
  e: Record<string, unknown>,
) {
  if (e.status === "cancelled") return null;
  const startObj = (e.start ?? {}) as { dateTime?: string; date?: string };
  const endObj = (e.end ?? {}) as { dateTime?: string; date?: string };
  const start = startObj.dateTime ?? (startObj.date ? `${startObj.date}T00:00:00-08:00` : null);
  const end = endObj.dateTime ?? (endObj.date ? `${endObj.date}T00:00:00-08:00` : null);
  if (!start || !end) return null;
  return {
    user_id: account.user_id,
    account_id: account.id,
    provider_event_id: e.id as string,
    calendar_id: calendarId,
    title: (e.summary as string) || "(no title)",
    start_at: start,
    end_at: end,
    all_day: Boolean(startObj.date),
    location: (e.location as string) ?? null,
    busy: e.transparency !== "transparent",
    raw: e,
    last_synced_at: new Date().toISOString(),
    recurring_event_id: typeof e.recurringEventId === "string" ? e.recurringEventId : null,
  };
}
