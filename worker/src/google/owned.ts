/**
 * Owner-scoped calendar reads/writes. Every tenant filter is
 * `user_id = ${store.userId}` (or a JOIN through a user-owned parent).
 * `scripts/prove-isolation-mutation.mjs` deletes each of those clauses.
 */
import type { Sql } from "../db.ts";
import { jsonParam } from "../db.ts";
import type { Env } from "../env.ts";
import { parseTokenKeyring, sealToken } from "../secrets.ts";
import type { CalendarEntry, GoogleAccount, GoogleAccountStatus, GoogleEventListItem } from "./types.ts";

/** postgres.js / PGlite may return BYTEA as Uint8Array, Buffer, or \\x hex. */
function bytesFromUnknown(value: unknown): Uint8Array | null {
  if (value == null) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (typeof value === "string") {
    const hex = value.startsWith("\\x") ? value.slice(2) : value;
    if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      return out;
    }
  }
  return null;
}

export interface CalendarStore {
  sql: Sql;
  userId: string;
}

export function makeCalendarStore(sql: Sql, userId: string): CalendarStore {
  return { sql, userId };
}

function asCalendars(value: unknown): CalendarEntry[] {
  if (Array.isArray(value)) return value as CalendarEntry[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as CalendarEntry[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapAccount(row: Record<string, unknown>): GoogleAccount {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    email: String(row.email),
    refresh_token_enc: bytesFromUnknown(row.refresh_token_enc),
    refresh_token_iv: bytesFromUnknown(row.refresh_token_iv),
    key_version: row.key_version == null ? null : Number(row.key_version),
    access_token: null,
    access_token_enc: bytesFromUnknown(row.access_token_enc),
    access_token_iv: bytesFromUnknown(row.access_token_iv),
    access_token_expires_at: row.access_token_expires_at
      ? new Date(row.access_token_expires_at as string | Date).toISOString()
      : null,
    calendars: asCalendars(row.calendars),
    mirror_calendar_id: (row.mirror_calendar_id as string | null) ?? null,
    webhook_expires_at: row.webhook_expires_at
      ? new Date(row.webhook_expires_at as string | Date).toISOString()
      : null,
    needs_reconnect: Boolean(row.needs_reconnect),
  };
}

export function publicGoogleAccount(account: GoogleAccount): GoogleAccountStatus {
  return {
    id: account.id,
    email: account.email,
    needs_reconnect: account.needs_reconnect,
    webhook_expires_at: account.webhook_expires_at,
    calendars: account.calendars.map((c) => ({
      id: c.id,
      summary: c.summary,
      visible: c.visible,
      last_synced_at: c.last_synced_at ?? null,
    })),
  };
}

export function calendarAccountAad(account: { id: string; user_id: string }) {
  return { table: "calendar_accounts" as const, rowId: account.id, userId: account.user_id };
}

export async function getOwnedGoogleAccount(
  store: CalendarStore,
  accountId: string,
): Promise<GoogleAccount | null> {
  const sql = store.sql;
  const rows = await sql`
    SELECT * FROM calendar_accounts
    WHERE id = ${accountId}
      AND user_id = ${store.userId}
      AND provider = 'google'
    LIMIT 1
  `;
  return rows[0] ? mapAccount(rows[0] as Record<string, unknown>) : null;
}

export async function listOwnedGoogleAccounts(store: CalendarStore): Promise<GoogleAccount[]> {
  const sql = store.sql;
  const rows = await sql`
    SELECT * FROM calendar_accounts
    WHERE user_id = ${store.userId}
      AND provider = 'google'
    ORDER BY id
  `;
  return rows.map((row) => mapAccount(row as Record<string, unknown>));
}

/** Cron path: one account by id (no session). Still one row, then later writes stay on that user_id. */
export async function loadGoogleAccountById(sql: Sql, accountId: string): Promise<GoogleAccount | null> {
  const rows = await sql`
    SELECT * FROM calendar_accounts
    WHERE id = ${accountId}
      AND provider = 'google'
    LIMIT 1
  `;
  return rows[0] ? mapAccount(rows[0] as Record<string, unknown>) : null;
}

export async function listGoogleAccountIds(sql: Sql, accountId?: string): Promise<string[]> {
  const rows = accountId
    ? await sql`
        SELECT id FROM calendar_accounts
        WHERE provider = 'google' AND id = ${accountId}
        ORDER BY id
      `
    : await sql`
        SELECT id FROM calendar_accounts
        WHERE provider = 'google'
        ORDER BY id
      `;
  return rows.map((row) => String((row as { id: string }).id));
}

export async function saveCalendars(sql: Sql, account: GoogleAccount): Promise<void> {
  const minExpiry = account.calendars
    .map((c) => c.channel_expires_at)
    .filter((v): v is string => Boolean(v))
    .sort()[0] ?? null;
  await sql`
    UPDATE calendar_accounts
    SET calendars = ${jsonParam(sql, account.calendars)},
        webhook_expires_at = ${minExpiry},
        updated_at = now()
    WHERE id = ${account.id}
      AND user_id = ${account.user_id}
  `;
}

export async function markReconnect(sql: Sql, accountId: string, userId: string): Promise<void> {
  await sql`
    UPDATE calendar_accounts
    SET needs_reconnect = true, updated_at = now()
    WHERE id = ${accountId}
      AND user_id = ${userId}
  `;
}

export async function saveAccessToken(
  sql: Sql,
  env: Env,
  account: GoogleAccount,
  accessToken: string,
  expiresAt: string,
): Promise<void> {
  const ring = await parseTokenKeyring(env);
  const sealed = await sealToken(
    accessToken,
    calendarAccountAad(account),
    ring,
    account.key_version ?? undefined,
  );
  await sql`
    UPDATE calendar_accounts
    SET access_token = NULL,
        access_token_enc = ${sealed.ciphertext},
        access_token_iv = ${sealed.iv},
        access_token_expires_at = ${expiresAt},
        key_version = ${sealed.keyVersion},
        needs_reconnect = false,
        updated_at = now()
    WHERE id = ${account.id}
      AND user_id = ${account.user_id}
  `;
  account.access_token = accessToken;
  account.access_token_enc = sealed.ciphertext;
  account.access_token_iv = sealed.iv;
  account.access_token_expires_at = expiresAt;
  account.key_version = sealed.keyVersion;
  account.needs_reconnect = false;
}

export async function listOwnedGoogleEvents(store: CalendarStore): Promise<GoogleEventListItem[]> {
  const sql = store.sql;
  const rows = await sql`
    SELECT e.id, e.title, e.start_at, e.end_at, e.calendar_id
    FROM external_events e
    JOIN calendar_accounts a ON a.id = e.account_id AND a.user_id = e.user_id
    WHERE e.user_id = ${store.userId}
      AND a.provider = 'google'
    ORDER BY e.start_at NULLS LAST, e.id
  `;
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      title: String(r.title ?? "(no title)"),
      start_at: r.start_at ? new Date(r.start_at as string | Date).toISOString() : null,
      end_at: r.end_at ? new Date(r.end_at as string | Date).toISOString() : null,
      calendar_id: r.calendar_id == null ? null : String(r.calendar_id),
    };
  });
}

export async function logSync(
  sql: Sql,
  provider: string,
  operation: string,
  status: "ok" | "error",
  error?: string,
  userId?: string,
): Promise<void> {
  await sql`
    INSERT INTO sync_log (provider, operation, status, error, user_id)
    VALUES (${provider}, ${operation}, ${status}, ${error ?? null}, ${userId ?? null})
  `;
}

export function calendarSyncInterval(provider: string, failures: number): number {
  const base = provider === "google" || provider === "m365" ? 300 : 900;
  const exp = Math.min(Math.max(failures, 0), 5);
  return Math.min(base * 2 ** exp, 86400);
}

export async function markSyncResult(sql: Sql, accountId: string, userId: string, ok: boolean): Promise<void> {
  const rows = await sql`
    SELECT provider, sync_failures FROM calendar_accounts
    WHERE id = ${accountId}
      AND user_id = ${userId}
    LIMIT 1
  `;
  const row = rows[0] as { provider?: string; sync_failures?: number } | undefined;
  if (!row) return;
  const nextFailures = ok ? 0 : Number(row.sync_failures ?? 0) + 1;
  const secs = calendarSyncInterval(String(row.provider ?? "google"), nextFailures);
  await sql`
    UPDATE calendar_accounts
    SET sync_failures = ${nextFailures},
        next_sync_at = now() + (${secs} * interval '1 second'),
        updated_at = now()
    WHERE id = ${accountId}
      AND user_id = ${userId}
  `;
}

export async function claimDueGoogleAccounts(sql: Sql, max: number): Promise<{ id: string; user_id: string }[]> {
  const rows = await sql`
    UPDATE calendar_accounts AS a
    SET next_sync_at = now() + (
          ${300} * interval '1 second' * (2 ^ least(greatest(coalesce(a.sync_failures, 0), 0), 5))
        ),
        updated_at = now()
    WHERE a.id IN (
      SELECT id FROM calendar_accounts
      WHERE provider = 'google'
        AND NOT needs_reconnect
        AND coalesce(next_sync_at, '-infinity'::timestamptz) <= now()
      ORDER BY coalesce(next_sync_at, '-infinity'::timestamptz)
      LIMIT ${max}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING a.id, a.user_id
  `;
  return rows.map((row) => ({
    id: String((row as { id: string }).id),
    user_id: String((row as { user_id: string }).user_id),
  }));
}

export async function getOwnedExternalEvent(
  store: CalendarStore,
  eventId: string,
): Promise<(Record<string, unknown> & { account: GoogleAccount }) | null> {
  const sql = store.sql;
  const rows = await sql`
    SELECT e.*,
           to_jsonb(a.*) AS account
    FROM external_events e
    JOIN calendar_accounts a ON a.id = e.account_id AND a.user_id = e.user_id
    WHERE e.id = ${eventId}
      AND e.user_id = ${store.userId}
    LIMIT 1
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const accountRaw = row.account as Record<string, unknown>;
  return { ...row, account: mapAccount(accountRaw) };
}

export async function defaultCalendarAccountId(store: CalendarStore): Promise<string | null> {
  const sql = store.sql;
  const rows = await sql`
    SELECT default_calendar_account_id
    FROM user_settings
    WHERE user_id = ${store.userId}
    LIMIT 1
  `;
  const id = (rows[0] as { default_calendar_account_id?: string | null } | undefined)?.default_calendar_account_id;
  return id ?? null;
}

export async function meetPreference(store: CalendarStore): Promise<string | null> {
  const sql = store.sql;
  const rows = await sql`
    SELECT auto_add_meet
    FROM user_settings
    WHERE user_id = ${store.userId}
    LIMIT 1
  `;
  return (rows[0] as { auto_add_meet?: string } | undefined)?.auto_add_meet ?? null;
}
