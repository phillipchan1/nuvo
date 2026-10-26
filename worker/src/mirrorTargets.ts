/**
 * Resolve where a user's blocks mirror, and write one there.
 *
 * Owner is always the session / cron user id passed in — never a client id.
 * Google/iCloud write-back uses an injectable fetch so tests mock the endpoint.
 */
import type { Sql } from "./db.ts";
import type { Env } from "./env.ts";
import { openToken } from "./lib/secrets.ts";
import {
  MIRROR_CALENDAR_DESCRIPTION,
  MIRROR_CALENDAR_NAME,
  mirrorHref,
  mirrorUid,
  type MirrorKind,
} from "../../supabase/functions/_shared/mirror.ts";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_API = "https://www.googleapis.com/calendar/v3";
const ICLOUD_MIRROR_SLUG = "nuvo-blocks";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type CalendarAccountRow = {
  id: string;
  user_id: string;
  provider: string;
  email: string;
  refresh_token_secret_id: string | null;
  refresh_token_enc: Uint8Array | ArrayBuffer | null;
  refresh_token_iv: Uint8Array | ArrayBuffer | null;
  key_version: number | null;
  access_token: string | null;
  access_token_expires_at: string | null;
  sync_direction: string;
  mirror_calendar_id: string | null;
  needs_reconnect: boolean;
};

export type MirrorTarget =
  | { provider: "google"; account: CalendarAccountRow; calendarId: string }
  | { provider: "icloud"; account: CalendarAccountRow; calendarUrl: string; password: string };

export interface MirrorBlock {
  kind: MirrorKind;
  rowId: string;
  title: string;
  startISO: string;
  endISO: string;
  description?: string | null;
  tz: string;
}

export interface MirrorDeps {
  sql: Sql;
  env: Env;
  fetchImpl?: FetchLike;
}

async function logSync(
  sql: Sql,
  provider: string,
  operation: string,
  status: "ok" | "error",
  userId?: string,
): Promise<void> {
  try {
    await sql`
      INSERT INTO sync_log (provider, operation, status, user_id)
      VALUES (${provider}, ${operation}, ${status}, ${userId ?? null})
    `;
  } catch {
    // Logging must never fail a mirror write.
  }
}

export async function resolveMirrorTarget(
  deps: MirrorDeps,
  userId: string,
): Promise<MirrorTarget | null> {
  const sql = deps.sql;
  const google = (await sql`
    SELECT id, user_id, provider, email, refresh_token_secret_id,
           refresh_token_enc, refresh_token_iv, key_version,
           access_token, access_token_expires_at, sync_direction,
           mirror_calendar_id, needs_reconnect
    FROM calendar_accounts
    WHERE user_id = ${userId}
      AND provider = 'google'
      AND mirror_calendar_id IS NOT NULL
    LIMIT 1
  `) as CalendarAccountRow[];
  const g = google[0];
  if (g?.mirror_calendar_id) {
    return { provider: "google", account: g, calendarId: g.mirror_calendar_id };
  }

  const icloud = (await sql`
    SELECT id, user_id, provider, email, refresh_token_secret_id,
           refresh_token_enc, refresh_token_iv, key_version,
           access_token, access_token_expires_at, sync_direction,
           mirror_calendar_id, needs_reconnect
    FROM calendar_accounts
    WHERE user_id = ${userId}
      AND provider = 'icloud'
      AND sync_direction = 'two_way'
    ORDER BY created_at ASC
    LIMIT 1
  `) as CalendarAccountRow[];
  const i = icloud[0];
  if (!i) return null;

  const password = await openToken(
    deps.env.TOKEN_ENC_KEY_V1,
    "calendar_accounts",
    i.id,
    userId,
    i.refresh_token_enc,
    i.refresh_token_iv,
    i.key_version,
  );
  if (!password) return null;

  let calendarUrl = i.mirror_calendar_id;
  if (!calendarUrl) {
    const made = await ensureIcloudMirror(deps, i, password);
    if (!made) return null;
    calendarUrl = made;
    await sql`
      UPDATE calendar_accounts
      SET mirror_calendar_id = ${calendarUrl}
      WHERE id = ${i.id}
        AND user_id = ${userId}
    `;
    await logSync(sql, "icloud", "mirror-calendar-create", "ok", userId);
  }

  return { provider: "icloud", account: i, calendarUrl, password };
}

async function googleAccessToken(deps: MirrorDeps, account: CalendarAccountRow): Promise<string | null> {
  const expiresAt = account.access_token_expires_at
    ? new Date(account.access_token_expires_at).getTime()
    : 0;
  if (account.access_token && expiresAt > Date.now() + 60_000) return account.access_token;

  const refresh = await openToken(
    deps.env.TOKEN_ENC_KEY_V1,
    "calendar_accounts",
    account.id,
    account.user_id,
    account.refresh_token_enc,
    account.refresh_token_iv,
    account.key_version,
  );
  if (!refresh || !deps.env.GOOGLE_CLIENT_ID || !deps.env.GOOGLE_CLIENT_SECRET) return null;

  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: deps.env.GOOGLE_CLIENT_ID,
      client_secret: deps.env.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refresh,
    }),
  });
  if (!res.ok) {
    await deps.sql`
      UPDATE calendar_accounts
      SET needs_reconnect = TRUE
      WHERE id = ${account.id}
        AND user_id = ${account.user_id}
    `;
    return null;
  }
  const tok = (await res.json()) as { access_token?: string; expires_in?: number };
  const access = tok.access_token;
  if (!access) return null;
  const expires = new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString();
  await deps.sql`
    UPDATE calendar_accounts
    SET access_token = ${access},
        access_token_expires_at = ${expires},
        needs_reconnect = FALSE
    WHERE id = ${account.id}
      AND user_id = ${account.user_id}
  `;
  account.access_token = access;
  account.access_token_expires_at = expires;
  return access;
}

async function gFetch(
  deps: MirrorDeps,
  account: CalendarAccountRow,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await googleAccessToken(deps, account);
  if (!token) throw new Error("google token unavailable");
  const fetchImpl = deps.fetchImpl ?? fetch;
  const url = path.startsWith("http") ? path : `${GOOGLE_API}${path}`;
  return fetchImpl(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

function icsEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function toIcalUtc(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function buildMirrorIcs(block: MirrorBlock): string {
  const uid = mirrorUid(block.kind, block.rowId);
  const now = toIcalUtc(new Date().toISOString());
  const desc = block.description ? `\nDESCRIPTION:${icsEscape(block.description)}` : "";
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nuvo//Mirror//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${toIcalUtc(block.startISO)}`,
    `DTEND:${toIcalUtc(block.endISO)}`,
    `SUMMARY:${icsEscape(block.title)}`,
    desc.trimStart(),
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ]
    .filter((line) => line !== "")
    .join("\r\n");
}

async function dav(
  fetchImpl: FetchLike,
  url: string,
  init: { method: string; auth: string; body?: string; contentType?: string },
): Promise<Response> {
  let current = url;
  for (let i = 0; i < 6; i++) {
    const res = await fetchImpl(current, {
      method: init.method,
      redirect: "manual",
      headers: {
        Authorization: init.auth,
        "User-Agent": "Nuvo/1.0",
        ...(init.body
          ? { "Content-Type": init.contentType ?? "application/xml; charset=utf-8" }
          : {}),
      },
      ...(init.body ? { body: init.body } : {}),
    });
    if ([301, 302, 307, 308].includes(res.status)) {
      const loc = res.headers.get("Location");
      if (!loc) return res;
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error("too many CalDAV redirects");
}

function basicAuth(email: string, password: string): string {
  return `Basic ${btoa(`${email}:${password}`)}`;
}

async function ensureIcloudMirror(
  deps: MirrorDeps,
  account: CalendarAccountRow,
  password: string,
): Promise<string | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const auth = basicAuth(account.email, password);
  const principal = await dav(fetchImpl, "https://caldav.icloud.com/", {
    method: "PROPFIND",
    auth,
    body:
      `<?xml version="1.0" encoding="utf-8"?><A:propfind xmlns:A="DAV:">` +
      `<A:prop><A:current-user-principal/></A:prop></A:propfind>`,
  });
  if (!principal.ok) return null;
  const principalXml = await principal.text();
  const principalHref = /<[^>]*current-user-principal[^>]*>[\s\S]*?<[^>]*href[^>]*>([^<]+)</i.exec(principalXml)?.[1];
  if (!principalHref) return null;
  const principalUrl = new URL(principalHref.trim(), principal.url || "https://caldav.icloud.com/").toString();
  const home = await dav(fetchImpl, principalUrl, {
    method: "PROPFIND",
    auth,
    body:
      `<?xml version="1.0" encoding="utf-8"?><A:propfind xmlns:A="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
      `<A:prop><C:calendar-home-set/></A:prop></A:propfind>`,
  });
  if (!home.ok) return null;
  const homeXml = await home.text();
  const homeHref = /<[^>]*calendar-home-set[^>]*>[\s\S]*?<[^>]*href[^>]*>([^<]+)</i.exec(homeXml)?.[1];
  if (!homeHref) return null;
  const homeUrl = new URL(homeHref.trim(), home.url || principalUrl).toString();
  const url = `${homeUrl.replace(/\/$/, "")}/${ICLOUD_MIRROR_SLUG}/`;
  const strip = (t: string) => t.replace(/[<&>]/g, "");
  const made = await dav(fetchImpl, url, {
    method: "MKCALENDAR",
    auth,
    body:
      `<?xml version="1.0" encoding="utf-8"?><C:mkcalendar xmlns:A="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">` +
      `<A:set><A:prop><A:displayname>${strip(MIRROR_CALENDAR_NAME)}</A:displayname>` +
      `<C:calendar-description>${strip(MIRROR_CALENDAR_DESCRIPTION)}</C:calendar-description>` +
      `<C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>` +
      `</A:prop></A:set></C:mkcalendar>`,
  });
  if (made.status !== 405 && !made.ok) return null;
  return url;
}

export async function putMirror(
  deps: MirrorDeps,
  target: MirrorTarget,
  block: MirrorBlock,
  knownGoogleEventId?: string | null,
): Promise<string | null> {
  if (target.provider === "icloud") {
    const uid = mirrorUid(block.kind, block.rowId);
    const ics = buildMirrorIcs(block);
    const href = mirrorHref(target.calendarUrl, uid);
    const res = await dav(deps.fetchImpl ?? fetch, href, {
      method: "PUT",
      auth: basicAuth(target.account.email, target.password),
      contentType: "text/calendar; charset=utf-8",
      body: ics,
    });
    if (!res.ok) throw new Error("mirror create failed");
    return null;
  }

  const calId = encodeURIComponent(target.calendarId);
  const body = JSON.stringify({
    summary: block.title,
    description: block.description || undefined,
    start: { dateTime: block.startISO, timeZone: block.tz },
    end: { dateTime: block.endISO, timeZone: block.tz },
  });

  if (knownGoogleEventId) {
    const res = await gFetch(
      deps,
      target.account,
      `/calendars/${calId}/events/${encodeURIComponent(knownGoogleEventId)}`,
      { method: "PATCH", body },
    );
    if (res.ok) return knownGoogleEventId;
    if (res.status !== 404 && res.status !== 410) {
      throw new Error("mirror update failed");
    }
  }

  const createRes = await gFetch(deps, target.account, `/calendars/${calId}/events`, {
    method: "POST",
    body,
  });
  if (!createRes.ok) throw new Error("mirror create failed");
  const created = (await createRes.json()) as { id?: string };
  return created.id ?? null;
}

export async function deleteMirror(
  deps: MirrorDeps,
  target: MirrorTarget,
  kind: MirrorKind,
  rowId: string,
  knownGoogleEventId?: string | null,
): Promise<void> {
  if (target.provider === "icloud") {
    const href = mirrorHref(target.calendarUrl, mirrorUid(kind, rowId));
    const status = (await dav(deps.fetchImpl ?? fetch, href, {
      method: "DELETE",
      auth: basicAuth(target.account.email, target.password),
    })).status;
    if (status !== 204 && status !== 200 && status !== 404 && status !== 410) {
      throw new Error("mirror delete failed");
    }
    return;
  }
  if (!knownGoogleEventId) return;
  const res = await gFetch(
    deps,
    target.account,
    `/calendars/${encodeURIComponent(target.calendarId)}/events/${encodeURIComponent(knownGoogleEventId)}`,
    { method: "DELETE" },
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error("mirror delete failed");
  }
}

export async function noteMirror(
  sql: Sql,
  provider: string,
  operation: string,
  status: "ok" | "error",
  userId?: string,
): Promise<void> {
  await logSync(sql, provider, operation, status, userId);
}
