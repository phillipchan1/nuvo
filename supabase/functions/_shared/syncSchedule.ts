// Scheduling side of calendar sync: who is due, and what happened to them.
//
// The dispatcher (public.dispatch_calendar_sync, migration 46) claims due
// accounts in Postgres and invokes one function call per account, so the normal
// path through every sync now carries an explicit `accountId` and touches
// exactly one row. These helpers cover the two remaining needs: reporting the
// outcome so backoff works, and the fallback path that still walks a whole
// provider (a manual "sync everything", a backfill) without falling into the
// 1000-row trap.
import { admin } from "./admin.ts";

/** Record an account's sync outcome. Success clears the failure count and
 *  schedules the next run at base cadence; failure widens the backoff, so a
 *  dead feed stops being retried every cadence forever. */
export async function markSyncResult(accountId: string, ok: boolean): Promise<void> {
  const { error } = await admin.rpc("mark_calendar_sync", {
    p_account: accountId,
    p_ok: ok,
  });
  // Never let bookkeeping fail a sync that otherwise worked — the worst case is
  // this account is retried on the next dispatch tick.
  if (error) console.error("mark_calendar_sync failed", accountId, error.message);
}

/** Load accounts for a provider, paging past PostgREST's row cap.
 *
 *  `max_rows` is 1000 on this project, and an unbounded `.select()` is
 *  truncated at that silently — no error, no partial-result signal. A provider
 *  loop built on the truncated list simply never syncs account 1001 onward, and
 *  nothing anywhere reports it. Page explicitly until a short read. */
// deno-lint-ignore no-explicit-any
export async function loadAccountsPaged(provider: string, accountId?: string): Promise<any[]> {
  const PAGE = 1000;
  // deno-lint-ignore no-explicit-any
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    // Built fresh each page — a PostgREST builder is single-shot.
    let q = admin.from("calendar_accounts").select("*").eq("provider", provider);
    if (accountId) q = q.eq("id", accountId);
    const { data, error } = await q.order("id").range(from, from + PAGE - 1);
    if (error) throw error;
    const page = data ?? [];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}
