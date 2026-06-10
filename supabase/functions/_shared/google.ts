import { admin, logSync, readSecret } from "./admin.ts";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_API = "https://www.googleapis.com/calendar/v3";
export const MIRROR_CALENDAR_NAME = "Nuvo";

export interface GoogleAccount {
  id: string;
  user_id: string;
  email: string;
  refresh_token_secret_id: string | null;
  access_token: string | null;
  access_token_expires_at: string | null;
  calendars: CalendarEntry[];
  mirror_calendar_id: string | null;
  webhook_expires_at: string | null;
  needs_reconnect: boolean;
}

export interface CalendarEntry {
  id: string;
  summary: string;
  color: string | null;
  visible: boolean;
  sync_token?: string | null;
  channel_id?: string | null;
  resource_id?: string | null;
  channel_expires_at?: string | null;
}

export async function markReconnect(accountId: string, userId: string, why: string) {
  await admin.from("calendar_accounts").update({ needs_reconnect: true }).eq("id", accountId);
  await logSync("google", "token-refresh", "error", why, userId);
}

/** Return a valid access token, refreshing through the Vault refresh token
 *  when expired. Sets needs_reconnect (surfaced as an app banner) on failure
 *  — never fails silently. */
export async function getAccessToken(account: GoogleAccount): Promise<string> {
  const expiresAt = account.access_token_expires_at
    ? new Date(account.access_token_expires_at).getTime()
    : 0;
  if (account.access_token && expiresAt > Date.now() + 60_000) return account.access_token;

  if (!account.refresh_token_secret_id) {
    await markReconnect(account.id, account.user_id, "no refresh token stored");
    throw new Error("no refresh token");
  }
  const refreshToken = await readSecret(account.refresh_token_secret_id);
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      grant_type: "refresh_token",
      refresh_token: refreshToken ?? "",
    }),
  });
  if (!res.ok) {
    await markReconnect(account.id, account.user_id, `refresh failed: ${await res.text()}`);
    throw new Error("google token refresh failed");
  }
  const tok = await res.json();
  const access_token = tok.access_token as string;
  await admin
    .from("calendar_accounts")
    .update({
      access_token,
      access_token_expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
      needs_reconnect: false,
    })
    .eq("id", account.id);
  account.access_token = access_token;
  return access_token;
}

export async function gFetch(
  account: GoogleAccount,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getAccessToken(account);
  const url = path.startsWith("http") ? path : `${GOOGLE_API}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

export async function loadGoogleAccounts(accountId?: string): Promise<GoogleAccount[]> {
  let q = admin.from("calendar_accounts").select("*").eq("provider", "google");
  if (accountId) q = q.eq("id", accountId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as GoogleAccount[];
}

/** Map a Google event resource to an external_events row (null = skip/cancelled). */
export function mapGoogleEvent(
  account: GoogleAccount,
  calendarId: string,
  // deno-lint-ignore no-explicit-any
  e: any,
) {
  if (e.status === "cancelled") return null;
  const start = e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00-08:00` : null);
  const end = e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00-08:00` : null);
  if (!start || !end) return null;
  return {
    user_id: account.user_id,
    account_id: account.id,
    provider_event_id: e.id as string,
    calendar_id: calendarId,
    title: (e.summary as string) || "(no title)",
    start_at: start,
    end_at: end,
    all_day: Boolean(e.start?.date),
    location: (e.location as string) ?? null,
    busy: e.transparency !== "transparent",
    raw: e,
    last_synced_at: new Date().toISOString(),
  };
}
