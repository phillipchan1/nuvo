# Client data calls → Worker routes

**Status:** living · 2026-10-29 · driven against a local `wrangler dev` on a prod-shaped DB  
**Thesis:** the SPA keeps every `supabase.from()` / `.rpc()` / `.functions.invoke()` call
it has today. With `VITE_API_BASE_URL` set, **one seam** — the supabase client's own
`fetch` (`src/lib/supabase.ts` → `src/lib/workerRoute.ts`) — re-points that traffic at the
Worker and swaps the GoTrue JWT for the Better Auth bearer. The Worker answers the slice of
PostgREST Nuvo uses (`worker/src/rest.ts`), every statement ANDed with the session's owner
clause. Flag unset: the seam is never installed and the client is byte-for-byte today's.

Sisters: [`../cloudflare-cutover.md`](../cloudflare-cutover.md) § Not ready to flip,
[`route-inventory.md`](./route-inventory.md), [`access-audit.md`](./access-audit.md).

---

## 1 · Why a PostgREST subset, not per-table routes

The other shape — a client shim over `/api/data/:table` (PR #117) — lists the whole table
and filters in the browser. On a lived-in account that is every task on every query, one
extra request **per task** for `task_labels(label_id)` (it is in `TASK_COLS`), and no
`.or()` at all (event search). Speaking PostgREST's wire instead keeps the filters, order,
limit, embeds and upsert semantics in SQL, where they were, and leaves ~60 call sites
untouched. The cost is a strict parser on the Worker; `rest.check.ts` drives the real
supabase-js builder through it.

## 2 · Tables

All reads and writes go to `/api/rest/v1/:table`. Owner = `user_id = <session>` unless noted.

| Table | Call sites | Ops the app uses | Worker policy |
|---|---|---|---|
| `tasks` | `useTasks`, `useSlots`, `useVertical`, `useAgentRecords`, sync outbox | select (eq/neq/in/is/not.is/gte/lt, order, range, `task_labels(label_id)` embed), insert, upsert `on_conflict=id` ignore-dupes, update, delete | all ops, all columns; FKs owner-checked; steps one level deep |
| `task_labels` | outbox, `useTasks` embed | upsert `task_id,label_id`, delete by match | owner via the task |
| `domains` · `projects` · `initiatives` · `key_results` | `useVertical`, outbox | select (+ `key_results(*)` embed), insert `.select().single()` | all ops, all columns |
| `slots` · `labels` · `recurrences` · `record_comments` · `reminders` | `useSlots`, `useCalendar`, `useRecurrence`, `useRecordLog`, `useReminders`, outbox | select, insert, update, delete | all ops; `reminders.target_id` owner-checked by kind |
| `sprints` · `week_reviews` | `useVertical`, `useWeekReport`, `useWeekVerdicts`, `useWeekReview`, outbox | select `maybeSingle`, upsert `on_conflict=user_id,week_start` | all ops |
| `user_settings` | `useSettings`, outbox | select `maybeSingle`, upsert `on_conflict=user_id` | no delete; `inbound_token` never client-written |
| `event_domain_routing` | `useEventRouting`, `useEventRouter` | select + range paging, upsert `on_conflict=user_id,event_key` | all ops |
| `external_events` | `useCalendar`, `eventSearch`, `useAgentRecords` | select (lt/gt range, `.or(title.ilike…,location.ilike…)`, limit), update one instance | select + update of `title/start_at/end_at/all_day/location/busy` only |
| `calendar_accounts` | `useCalendar`, `SettingsModal` | select, delete | read allowlist (no token columns), select + delete |
| `connections` | `AppsDevicesPane`, `useWatchSession` | select, insert (`token_hash`), update `revoked_at` | read allowlist omits `token_hash` |
| `activity_sources` · `activity_units` | `useActivity`, `useVertical` | select | read-only; sources' token columns hidden |
| `activity_bindings` | `useActivity` | select, upsert `on_conflict=source_id,selector`, delete | all ops |
| `push_subscriptions` | `lib/push.ts` | upsert `on_conflict=user_id,endpoint`, delete by endpoint | all ops |
| `subscriptions` | `lib/entitlementRead.ts` | — | **not here**: already `GET /api/entitlement` on the flag |

## 3 · RPCs — `/api/rest/v1/rpc/:fn`

The cutover restore carries no functions, and Neon's `auth.uid()` is a stub that returns
null, so each is re-said in the Worker, scoped by the session.

| RPC | Caller | Worker |
|---|---|---|
| `apply_patch(p_table, p_match, p_patch, p_field_ts)` | sync outbox (`transport.ts`) | per-field LWW against `field_ts` in one transaction (`FOR UPDATE`), migration 57's table list. No `field_ts` column (the preview's `neon.sql`) → `PGRST202`, so the outbox degrades to row updates as it already does on Supabase |
| `claim_reminder(p_key, p_fire_at, p_channel)` | `useReminders` | insert-or-nothing on `reminder_deliveries`; `true` only for the first claim |
| `contacts(search)` | `GuestsInput` | `contacts_for`'s rows (address book + people met on events), LIKE matching only — no `pg_trgm` on Neon |
| `rotate_inbound_token()` | `InboxAddress` | 12-char token, as migration 77 |

## 4 · Edge functions — `/functions/v1/:name`

Re-pointed to the Worker's twin of the same path. A name the Worker hasn't ported answers
`501 stay_on_supabase` there, not a Supabase 401 for a session GoTrue never issued.

| Function | Caller | On the Worker |
|---|---|---|
| `agent` | the chat (`useAgent`, SSE via `functionUrl`), groom, narrate, refine, record log — about ten call sites | ported (also `/api/agent`) |
| `google-events` · `icloud-events` · `calendar-refresh` · `icloud-connect` | `useCalendar`, `SettingsModal` | ported |
| `task-mirror` · `slot-mirror` | `invokeQuiet` (`mirrorTask`; slot writes in `useSlots`, `useRecurrence`, `useVertical`) | ported; `invokeQuiet` now always goes through the client, so it carries the bearer |
| `rollover` · `route-events` · `github-activity` · `apple-identity` · `delete-account` | `useTasks`, `useEventRouter`, `useActivity`, `appleAuth`, `account` | ported |
| `apple-iap` · `stripe-checkout` · `stripe-portal` · `referral-code` | billing | **left on Supabase** (`SUPABASE_ONLY_FUNCTIONS`) until #120's proxy |

## 5 · Auth and realtime

| Surface | Flag on |
|---|---|
| `supabase.auth.getSession()` / `getUser()` (outbox owner key, push, agent bearer, ~15 hooks) | answered from Better Auth (`src/lib/workerSession.ts`, published by `useAuth`) |
| Sign-in / sign-out | Better Auth; `useAuth` re-reads the session on `nuvo-ba-session`, so a verified code leaves the login screen without a reload |
| `useRealtime` (`supabase.channel`) | not opened — see § Not ready to flip, item 4 |
| `useSubscription` (`supabase.channel`) | already skipped on the flag |

## 6 · Proof

- `node --experimental-strip-types worker/src/rest.check.ts` — the app's own queries through
  `workerRoute`, A/B isolation, LWW, natural-key upserts, freeze, preflight (in `check:worker`).
- `npm run check:isolation-mutation` — each `rest.ts` owner clause, deleted alone, fails `rest.check`.
- `tests/worker-seam.test.ts` — the route map, and that the flag-off client is untouched.
- Driven 2026-10-29, dev app → local `wrangler dev` → Postgres 17 restored the way
  `cutover-migrate.yml` restores (public schema + data, functions/triggers/policies skipped,
  auth stub): OTP sign-in; Schedule and phone Calendar load; capture (desktop and phone),
  complete, priority, label, add a step, trash, retry a parked change, reload. Every data
  request went to `:8787`. Flag off on the same build: every request to Supabase, none to the Worker.

### Drive it locally (until the preview is redeployed)

1. A Postgres 17 on `127.0.0.1:5432`, database `nuvo`, shaped like prod Neon: the `auth`
   stub from `cutover-migrate.yml` (`STUB_AUTH_SQL`), then the local Supabase stack's
   public schema + data via `pg_dump -Fc --schema=public` → `pg_restore -L` with the
   workflow's `SKIP_TOC_HEAD` entries removed, then `worker/schema/better-auth.sql`,
   `PUBLIC_USERS_SQL`, and `"user"` rows mapped from `auth.users` (same ids). The dev
   stack's dummy accounts then sign in with an email code.
2. `.dev.vars` from `.dev.vars.example` (`ENVIRONMENT=local`, `DATABASE_URL` at that DB).
3. `.claude/launch.json` → `worker-local` (wrangler on :8787; OTP codes print to its log),
   then `web-worker` (the dev server with `VITE_API_BASE_URL=http://localhost:8787`). Open
   `/?review` for the email door in a desktop browser tab.
