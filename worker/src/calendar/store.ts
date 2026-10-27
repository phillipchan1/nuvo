/**
 * Owner-scoped calendar reads/writes. Every tenant filter is user_id
 * (or account.user_id through a join). Cron iterates accounts then
 * scopes each pass by that row's user_id.
 */
import type { Sql } from "../db.ts";
import type { Env } from "../env.ts";
import { calendarAccountAad, calendarSyncInterval, markSyncResult as markOwnedSyncResult } from "../google/owned.ts";
import { redactSecrets } from "../lib/redact.ts";
import { openToken, parseTokenKeyring, sealToken } from "../secrets.ts";
import type { Store } from "../store.ts";
import { mapAccount, type CalendarAccount } from "./types.ts";

export { calendarSyncInterval };

export async function logSync(
  sql: Sql,
  provider: string,
  operation: string,
  status: "ok" | "error",
  error?: string,
  userId?: string,
): Promise<void> {
  await sql`
    INSERT INTO sync_log (user_id, provider, operation, status, error)
    VALUES (${userId ?? null}, ${provider}, ${operation}, ${status}, ${error ?? null})
  `;
}

export async function getOwnedAccount(
  store: Store,
  accountId: string,
): Promise<CalendarAccount | null> {
  const rows = await store.sql`
    SELECT * FROM calendar_accounts
    WHERE id = ${accountId} AND user_id = ${store.userId}
    LIMIT 1
  `;
  return rows[0] ? mapAccount(rows[0] as Record<string, unknown>) : null;
}

export async function listOwnedAccounts(
  store: Store,
  provider?: string,
): Promise<CalendarAccount[]> {
  const rows = provider
    ? await store.sql`
        SELECT * FROM calendar_accounts
        WHERE user_id = ${store.userId} AND provider = ${provider}
        ORDER BY id
      `
    : await store.sql`
        SELECT * FROM calendar_accounts
        WHERE user_id = ${store.userId}
        ORDER BY id
      `;
  return rows.map((row) => mapAccount(row as Record<string, unknown>));
}

export async function loadAccountById(sql: Sql, accountId: string): Promise<CalendarAccount | null> {
  const rows = await sql`
    SELECT * FROM calendar_accounts WHERE id = ${accountId} LIMIT 1
  `;
  return rows[0] ? mapAccount(rows[0] as Record<string, unknown>) : null;
}

/** Cron / fallback: page a provider. Caller must then treat each row as that user. */
export async function loadAccountsPaged(
  sql: Sql,
  provider: string,
  accountId?: string,
  userId?: string,
): Promise<CalendarAccount[]> {
  if (accountId) {
    const one = await loadAccountById(sql, accountId);
    if (!one || one.provider !== provider) return [];
    if (userId && one.user_id !== userId) return [];
    return [one];
  }
  const PAGE = 1000;
  const out: CalendarAccount[] = [];
  let lastId = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const page = userId
      ? await sql`
          SELECT * FROM calendar_accounts
          WHERE provider = ${provider} AND user_id = ${userId} AND id > ${lastId}
          ORDER BY id
          LIMIT ${PAGE}
        `
      : await sql`
          SELECT * FROM calendar_accounts
          WHERE provider = ${provider} AND id > ${lastId}
          ORDER BY id
          LIMIT ${PAGE}
        `;
    for (const row of page) out.push(mapAccount(row as Record<string, unknown>));
    if (page.length < PAGE) break;
    lastId = String((page[page.length - 1] as { id: string }).id);
  }
  return out;
}

export async function claimDueAccounts(
  sql: Sql,
  providers: string[],
  max = 50,
): Promise<CalendarAccount[]> {
  const due = await sql`
    SELECT * FROM calendar_accounts
    WHERE provider = ANY(${providers})
      AND NOT needs_reconnect
      AND coalesce(next_sync_at, '-infinity'::timestamptz) <= now()
    ORDER BY coalesce(next_sync_at, '-infinity'::timestamptz)
    LIMIT ${max}
  `;
  const accounts = due.map((row) => mapAccount(row as Record<string, unknown>));
  for (const account of accounts) {
    const secs = calendarSyncInterval(account.provider, account.sync_failures);
    await sql`
      UPDATE calendar_accounts
      SET next_sync_at = now() + (${secs} * interval '1 second')
      WHERE id = ${account.id}
    `;
  }
  return accounts;
}

export async function markSyncResult(sql: Sql, accountId: string, userId: string, ok: boolean): Promise<void> {
  await markOwnedSyncResult(sql, accountId, userId, ok);
}

export async function openAccountSecret(
  account: CalendarAccount,
  env: Pick<Env, "TOKEN_ENC_KEY_V1" | "TOKEN_ENC_KEY_V2" | "TOKEN_ENC_CURRENT">,
): Promise<string | null> {
  if (!account.refresh_token_enc || !account.refresh_token_iv || account.key_version == null) return null;
  const ring = await parseTokenKeyring(env);
  return openToken(
    {
      ciphertext: account.refresh_token_enc,
      iv: account.refresh_token_iv,
      keyVersion: account.key_version,
    },
    calendarAccountAad(account),
    ring,
  );
}

export async function sealAccountSecret(
  sql: Sql,
  accountId: string,
  userId: string,
  env: Pick<Env, "TOKEN_ENC_KEY_V1" | "TOKEN_ENC_KEY_V2" | "TOKEN_ENC_CURRENT">,
  plaintext: string,
): Promise<void> {
  const ring = await parseTokenKeyring(env);
  const sealed = await sealToken(plaintext, calendarAccountAad({ id: accountId, user_id: userId }), ring);
  await sql`
    UPDATE calendar_accounts
    SET
      refresh_token_enc = ${sealed.ciphertext},
      refresh_token_iv = ${sealed.iv},
      key_version = ${sealed.keyVersion},
      refresh_token_secret_id = NULL
    WHERE id = ${accountId} AND user_id = ${userId}
  `;
}

export function loggedError(err: unknown): string {
  return redactSecrets(err instanceof Error ? err.message : String(err));
}

export async function upsertAccount(
  sql: Sql,
  userId: string,
  row: {
    provider: string;
    email: string;
    sync_direction: string;
    calendars: unknown;
    access_token?: string | null;
    access_token_expires_at?: string | null;
    delta_link?: string | null;
    needs_reconnect?: boolean;
  },
): Promise<CalendarAccount> {
  const rows = await sql`
    INSERT INTO calendar_accounts (
      user_id, provider, email, sync_direction, calendars,
      access_token, access_token_expires_at, delta_link, needs_reconnect
    )
    VALUES (
      ${userId}, ${row.provider}, ${row.email}, ${row.sync_direction},
      ${JSON.stringify(row.calendars)}::jsonb,
      ${row.access_token ?? null}, ${row.access_token_expires_at ?? null},
      ${row.delta_link ?? null}, ${row.needs_reconnect ?? false}
    )
    ON CONFLICT (user_id, provider, email) DO UPDATE SET
      sync_direction = EXCLUDED.sync_direction,
      calendars = EXCLUDED.calendars,
      access_token = EXCLUDED.access_token,
      access_token_expires_at = EXCLUDED.access_token_expires_at,
      delta_link = EXCLUDED.delta_link,
      needs_reconnect = EXCLUDED.needs_reconnect,
      updated_at = now()
    RETURNING *
  `;
  return mapAccount(rows[0] as Record<string, unknown>);
}

export async function updateAccount(
  sql: Sql,
  accountId: string,
  userId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  if (patch.needs_reconnect !== undefined) {
    await sql`UPDATE calendar_accounts SET needs_reconnect = ${Boolean(patch.needs_reconnect)}, updated_at = now() WHERE id = ${accountId} AND user_id = ${userId}`;
  }
  if (patch.delta_link !== undefined) {
    await sql`UPDATE calendar_accounts SET delta_link = ${patch.delta_link as string | null}, updated_at = now() WHERE id = ${accountId} AND user_id = ${userId}`;
  }
  if (patch.access_token !== undefined) {
    await sql`
      UPDATE calendar_accounts
      SET access_token = ${patch.access_token as string | null},
          access_token_expires_at = ${patch.access_token_expires_at as string | null},
          needs_reconnect = ${patch.needs_reconnect === undefined ? false : Boolean(patch.needs_reconnect)},
          updated_at = now()
      WHERE id = ${accountId} AND user_id = ${userId}
    `;
  }
  if (patch.calendars !== undefined) {
    await sql`
      UPDATE calendar_accounts
      SET calendars = ${JSON.stringify(patch.calendars)}::jsonb, updated_at = now()
      WHERE id = ${accountId} AND user_id = ${userId}
    `;
  }
}

export async function getOwnedEvent(
  store: Store,
  eventId: string,
): Promise<(Record<string, unknown> & { account: CalendarAccount }) | null> {
  const rows = await store.sql`
    SELECT e.*, to_jsonb(a.*) AS account
    FROM external_events e
    JOIN calendar_accounts a ON a.id = e.account_id
    WHERE e.id = ${eventId}
      AND e.user_id = ${store.userId}
      AND a.user_id = ${store.userId}
    LIMIT 1
  `;
  const row = rows[0] as (Record<string, unknown> & { account?: unknown }) | undefined;
  if (!row) return null;
  const account = mapAccount((row.account ?? {}) as Record<string, unknown>);
  return { ...row, account };
}

export async function hiddenCalendarIds(store: Store): Promise<string[]> {
  const rows = await store.sql`
    SELECT hidden_calendar_ids FROM user_settings WHERE user_id = ${store.userId} LIMIT 1
  `;
  const raw = rows[0]?.hidden_calendar_ids;
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
}

export async function deleteOwnedEventsByIds(store: Store, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const rows = await store.sql`
    DELETE FROM external_events
    WHERE user_id = ${store.userId} AND id = ANY(${ids})
    RETURNING id
  `;
  return rows.length;
}

export async function deleteOwnedSeries(
  store: Store,
  accountId: string,
  calendarId: string,
  uidBase: string,
): Promise<number> {
  const rows = await store.sql`
    DELETE FROM external_events
    WHERE user_id = ${store.userId}
      AND account_id = ${accountId}
      AND calendar_id = ${calendarId}
      AND (provider_event_id = ${uidBase} OR provider_event_id LIKE ${`${uidBase}::%`})
    RETURNING id
  `;
  return rows.length;
}
