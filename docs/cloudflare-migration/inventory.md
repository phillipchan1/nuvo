# Nuvo Supabase inventory

**Status:** living · 2026-10-26  
**Why this exists:** the Cloudflare Workers + Neon + Better Auth rehearsal needs a
complete map of what Supabase does today. This file is the map. It does **not**
authorize a cutover.

Live Nuvo stays on Vercel + Supabase until a signed-off cutover
([`docs/cloudflare-cutover.md`](../cloudflare-cutover.md)). This PR adds a Worker
that is **inert** unless `VITE_API_BASE_URL` is set.

Access control on the Worker (Neon has no RLS):
[`access-audit.md`](./access-audit.md).

---

## 1 · Tables

Identity: almost every tenant row is `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`. RLS is `auth.uid() = user_id` unless noted.

| Table | Owner | RLS | Client writes | Notes |
|---|---|---|---|---|
| `domains` | `user_id` | `"own domains"` ALL | yes | Seeded by `handle_new_user` |
| `projects` | `user_id` | `"own projects"` ALL | yes | |
| `initiatives` | `user_id` | `"own initiatives"` ALL | yes | |
| `key_results` | `user_id` | `"own key_results"` ALL | yes | |
| `labels` | `user_id` | `"own labels"` ALL | yes | unique `(user_id, name)` |
| `tasks` | `user_id` | `"own tasks"` ALL | yes | Steps via `parent_task_id` |
| `task_labels` | via task | `"own task_labels"` EXISTS | yes | Composite PK |
| `slots` | `user_id` | `"own slots"` ALL | yes | |
| `recurrences` | `user_id` | `"own recurrences"` ALL | yes | |
| `user_settings` | `user_id` PK | `"own settings"` ALL | yes | `inbound_token` unique |
| `sprints` | `user_id` | `"own sprints"` ALL | yes | unique `(user_id, week_start)` |
| `week_reviews` | `user_id` | `"own week_reviews"` ALL | yes | unique `(user_id, week_start)` |
| `record_comments` | `user_id` | `"own project_comments"` ALL | yes | Renamed from `project_comments` |
| `reminders` | `user_id` | `"own reminders"` ALL | yes | |
| `event_domain_routing` | `user_id` | `"own event_domain_routing"` ALL | yes | PK `(user_id, event_key)` |
| `calendar_accounts` | `user_id` | `"own calendar_accounts"` + **column revoke** | delete / `calendars` update | Tokens not granted to anon/authenticated |
| `external_events` | `user_id` | `"own external_events"` ALL | no (sync writes) | |
| `sync_log` | `user_id` | SELECT only | no | |
| `subscriptions` | `user_id` PK | SELECT only | no | Service-role writers; `entitled()` / `plan()` |
| `stripe_webhook_events` | — | RLS, **no policies** | no | Service-role idempotency |
| `apple_notification_events` | — | RLS, **no policies** | no | |
| `apple_webhook_events` | — | RLS, **no policies** | no | |
| `inbound_emails` | `user_id` | SELECT only | no | Edge fn writes |
| `connections` | `user_id` | `"own connections"` ALL | yes | Bearer hash for capture/MCP |
| `contacts_directory` | `user_id` | `"own contacts_directory"` ALL | no | Sync writes |
| `activity_sources` | `user_id` | `"own activity_sources"` ALL | yes | |
| `activity_bindings` | `user_id` | `"own activity_bindings"` ALL | yes | |
| `activity_units` | `user_id` | `"own activity_units"` ALL | yes | |
| `push_subscriptions` | `user_id` | `"own push_subscriptions"` ALL | yes | |
| `reminder_deliveries` | `user_id` | `"own reminder_deliveries"` ALL | via RPC | |
| `apple_identities` | `user_id` PK | SELECT only | no | Edge fn writes |

**No Storage buckets.** No `storage.from()` in `src/`.

**Auth-adjacent DB functions:** `store_secret` / `read_secret` / `delete_secret` (Vault, service-role); `handle_new_user` on `auth.users`; `rollover_tasks`; `invoke_edge` (pg_cron → edge); `apply_patch` (authenticated LWW); `contacts` / `contacts_for`; `rotate_inbound_token`; `claim_reminder`; `rt_broadcast`; `entitled` / `billing_source` / `plan`.

---

## 2 · Auth flows

Client: `src/lib/supabase.ts` — `createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)`.

| Method | Where | API |
|---|---|---|
| Google OAuth | `src/lib/googleAuth.ts`, `Login.tsx` | `signInWithOAuth` / `linkIdentity` (`prompt=select_account`) |
| Apple native | `src/lib/appleAuth.ts` | `signInWithIdToken` + `apple-identity` |
| Apple web | `appleAuth.ts` when `VITE_APPLE_AUTH=1` | `signInWithOAuth` |
| Email + password | `Login.tsx`, App Review, dev auto-login | `signInWithPassword` |
| Email OTP | `Login.tsx` | `signInWithOtp` / `verifyOtp` |
| Sign out | Settings, billing locks, `lib/account.ts` | `signOut` |
| Watch | `SessionStore.swift` | Stores URL, anon key, access token |

`handle_new_user` (AFTER INSERT on `auth.users`) writes `user_settings`, four seed domains, and a trial `subscriptions` row.

---

## 3 · Realtime

Private **broadcast**, not `postgres_changes` (`tests/realtime-broadcast.test.ts`).

- `src/hooks/useRealtime.ts` — one channel per table, topic `nuvo:<uid>:<table>`
- `useSubscription.ts` — `nuvo:<uid>:subscriptions`
- DB: `rt_broadcast()` trigger → `realtime.send`
- `realtime.messages` RLS: own `nuvo:*` topics only

**Presence / postgres_changes:** unused in `src/`.

---

## 4 · Edge functions

`supabase/config.toml` sets `verify_jwt = false` only for: `google-oauth`, `m365-oauth`, `google-webhook`, `stripe-webhook`, `apple-webhook`, `capture`, `mcp`, `inbound-email`.

| Function | Auth | Billing / webhook | Dual-path this PR? |
|---|---|---|---|
| `agent` | User JWT | no | **Worker/Neon** (session scoped) |
| `apple-iap` | User JWT | **IAP write** | **Stay on Supabase** |
| `apple-identity` | User JWT | no | Stay |
| `apple-webhook` | Apple signed payload | **Apple billing** | **Stay — do not touch** |
| `calendar-refresh` | User JWT | no | Stay |
| `capture` | Connection bearer | no | **Worker/Neon** (connection hash) |
| `day` | User JWT | no | **Worker/Neon** |
| `delete-account` | User JWT + confirm | Stripe cancel | Stay |
| `github-activity` | JWT or service role | no | Stay |
| `google-contacts` | JWT / service | no | Stay |
| `google-events` | JWT | no | Stay |
| `google-oauth` | OAuth state | no | Stay |
| `google-sync` | Service role | no | Stay |
| `google-webhook` | Channel token | no | **Stay — do not touch** |
| `iap-catalog` | Public | no | Stay |
| `icloud-*` | JWT / service | no | Stay |
| `ics-subscribe` / `ics-sync` | JWT / service | no | Stay |
| `inbound-email` | Svix + inbound token | no | **Worker/Neon** |
| `m365-oauth` / `m365-sync` | OAuth / service | no | Stay |
| `mcp` | Connection bearer | no | **Worker/Neon** (connection hash) |
| `push-dispatch` | Service role cron | no | Stay |
| `referral-code` | User JWT | Stripe | Stay |
| `rollover` | Session or `CRON_SECRET` | no | **Worker/Neon** (session = that user; cron iterates `users`) |
| `route-events` | User JWT | no | **Worker/Neon** |
| `slot-mirror` / `task-mirror` | JWT / service | no | Stay |
| `stripe-checkout` / `stripe-portal` | User JWT | **Stripe** | **Stay — do not touch** |
| `stripe-webhook` | Stripe signature | **Stripe** | **Stay — do not touch** |

---

## 5 · Client `supabase.*` (`src/`)

### `.from(table)`

| Table | Files |
|---|---|
| Dynamic (`SYNC_TABLES`) | `src/lib/sync/transport.ts` |
| `tasks` | `useTasks.ts`, `useAgentRecords.ts`, `useVertical.tsx` |
| `projects` / `initiatives` / `domains` / `key_results` | `useVertical.tsx` |
| `slots` | `useSlots.ts`, `useAgentRecords.ts` |
| `labels` | `useCalendar.ts` |
| `recurrences` | `useRecurrence.ts` |
| `record_comments` | `useRecordLog.ts` |
| `week_reviews` | `useWeekReview.ts` |
| `sprints` | `useWeekVerdicts.ts`, `useWeekReport.ts`, `useVertical.tsx` |
| `reminders` | `useReminders.ts` |
| `calendar_accounts` | `useCalendar.ts`, `SettingsModal.tsx` |
| `external_events` | `useCalendar.ts`, `useAgentRecords.ts`, `lib/eventSearch.ts` |
| `event_domain_routing` | `useEventRouting.ts`, `useEventRouter.ts` |
| `subscriptions` | `useSubscription.ts` |
| `user_settings` | `useSettings.ts` |
| `connections` | `AppsDevicesPane.tsx`, `useWatchSession.ts` |
| `activity_*` | `useActivity.ts` |
| `push_subscriptions` | `lib/push.ts` |

### `.rpc`

| RPC | Files |
|---|---|
| `apply_patch` | `src/lib/sync/transport.ts` |
| `contacts` | `GuestsInput.tsx` |
| `rotate_inbound_token` | `InboxAddress.tsx` |
| `claim_reminder` | `useReminders.ts` |

### `.functions.invoke` / raw `/functions/v1/agent`

`useAgent.ts` (SSE), `useNarrator.ts`, `useCalendar.ts`, `useTasks.ts` (rollover), `useEventRouter.ts`, `stripeBilling.ts`, `iap.ts`, `appleAuth.ts`, `account.ts`, `useActivity.ts`, `SettingsModal.tsx`, `lib/supabase.ts` (`invokeQuiet` / `mirrorTask`).

### `.storage`

None.

### `.channel`

`useRealtime.ts`, `useSubscription.ts`.

---

## 6 · Cron / webhooks

Extensions: `pg_cron`, `pg_net`. Invoker: `public.invoke_edge` → `{SUPABASE_URL}/functions/v1/*` with Vault service-role key.

| Job | Target |
|---|---|
| `nuvo-rollover-pst` / `pdt` | `rollover` |
| `nuvo-google-renew` | `google-sync` |
| `nuvo-trim-sync-log` | SQL |
| `nuvo-github-poll` | `github-activity` |
| `nuvo-calendar-dispatch` | per-account `*-sync` (every minute) |
| `nuvo-push-dispatch` | `push-dispatch` |
| `nuvo-reminder-deliveries-prune` | SQL |
| `nuvo-purge-trash` | SQL |

External webhooks (do **not** retarget in this PR): Stripe, Apple ASN, Google Calendar, Resend.

**Vercel crons:** none (`vercel.json` has no `crons`). The Worker has no
`scheduled` handler. `CRON_SECRET` is compared in constant time on
`/api/cron/:job` — see [`cloudflare-cutover.md`](../cloudflare-cutover.md)
§ Crons stay off the Worker.

---

## 7 · iOS / Tauri / CI

| Location | Usage |
|---|---|
| `src/lib/supabase.ts` | Canonical client |
| `src-tauri/plugins/nuvo-siwa` | Identity token → GoTrue |
| `src-tauri/ios/NuvoWatch/SessionStore.swift` | Keychain `"supabase-session"` |
| `.github/workflows/release.yml` | Bakes `VITE_SUPABASE_*` |
| `.github/workflows/ios-release.yml` | Same + signing secrets |
| `.github/workflows/checks.yml` | No deploy; parses `supabase/functions` |
| `.github/workflows/cutover-migrate.yml` | Manual `workflow_dispatch` only. Read-only Supabase dump → Neon scratch/target. Does not deploy. Temporary secrets are deleted after the run |

No automated `supabase db push` or `functions deploy` in CI.

---

## 8 · What this PR dual-paths vs what stays

**Dual-path (Worker, flag-on only)**

- Better Auth (email OTP + email/password for App Review / dev)
- Planner REST: tasks, domains, projects, initiatives, key_results, slots, labels, recurrences, record_comments, week_reviews, sprints, reminders, event_domain_routing, user_settings
- `apply_patch`, `contacts`, `rotate_inbound_token`, `claim_reminder`
- `/functions/v1/agent` and `/functions/v1/mcp` (session / connection scoped on Neon)
- `day`, `capture`, `inbound-email`, `route-events`, user `rollover`
- Cron: `rollover`, `purge-trash`, `reminder-deliveries-prune` (iterate `users`)

See [`route-inventory.md`](./route-inventory.md) for the full table.

**Stay on Supabase until a later cutover**

- Billing webhooks and writers (Stripe, Apple IAP, StoreKit) — **flagged**: they also write `subscriptions` which is not in the Neon schema
- Calendar OAuth, sync, mirrors, Vault refresh tokens — **flagged**: they write `calendar_accounts` / `external_events` / `tasks.google_event_id` that move to Neon
- Push-dispatch cron — **flagged**: reads user-data tables moving to Neon
- Capture / MCP bearer and inbound email are **ported** (connection hash / inbound token on Neon)
- Realtime broadcast
- `handle_new_user` on `auth.users`
- Google / Apple identity linking as GoTrue providers (Worker has email paths only)

---

## 9 · Free-tier cost callouts

| Service | Free | Would cost money |
|---|---|---|
| Cloudflare Workers | 100k req/day, **10 ms CPU/request** | Paid ($5/mo) if agent/MCP blow CPU; **3 MB compressed bundle** (Paid is 10 MB) |
| Hyperdrive | Confirm on this account's Free plan | Workers Paid documents unlimited Hyperdrive queries |
| Neon | 0.5 GB, autosuspend | First query after suspend ~300–500 ms without Hyperdrive |
| Better Auth | library, no fee | — |
| Resend (OTP) | 100 emails/day | Paid if preview traffic exceeds |
| Stripe / App Store | existing | **Do not create new webhook endpoints** |
| Apple Developer | existing $99/yr | Not a new cost from this PR |

Do **not** run `npm run eval` (live model) as part of this rehearsal.
