# Worker route inventory — cutover night

**Status:** living · 2026-10-26  
**Thesis:** Neon has no RLS. After cutover, every user-data read/write goes
through the Worker and is scoped by the verified session (or a hashed
connection token, or an inbound-mail token, or a cron job that iterates
`users` explicitly). This table is the checklist.

Sisters: [`access-audit.md`](./access-audit.md), [`inventory.md`](./inventory.md),
[`cloudflare-cutover.md`](../cloudflare-cutover.md).

Hard gate: nothing that reads or writes user-data tables may stay on
Supabase. Billing / Stripe / StoreKit code is **not** rewritten — those
routes are **blocked** and called out below when they also touch user
data that is moving to Neon.

---

## Status key

| Status | Meaning |
|---|---|
| **ported+tested** | Worker handler + `accessHttp.check.ts` A/B (and unauth 401) |
| **no-DB stays** | No user-data SQL. Same response as today. |
| **blocked** | Not ported. Reason in the notes. User-data tables it would have touched are listed. |

---

## 1 · Already on the Worker (planner REST / RPC)

| Route | Tables | Status | Tests |
|---|---|---|---|
| `GET/POST /api/data/:table` | planner set below | ported+tested | `accessHttp` list / POST-id body leak / forged `user_id` |
| `GET/PATCH/DELETE /api/data/:table/:id` | planner set | ported+tested | `accessHttp` 403/404 + FK plant on PATCH |
| `GET/POST/DELETE /api/data/task_labels` | `task_labels` via `tasks`/`labels` | ported+tested | `accessHttp` |
| `POST /api/rpc/apply_patch` | `tasks`, `domains`, `projects`, `user_settings` | ported+tested | `accessHttp` `matched: 0` |
| `POST /api/rpc/contacts` | `contacts_directory` | ported+tested | `accessHttp` |
| `POST /api/rpc/rotate_inbound_token` | `user_settings` | ported+tested | `accessHttp` |
| `POST /api/rpc/claim_reminder` | `reminders`, `reminder_deliveries` | ported+tested | `accessHttp` |
| `GET /api/health` | — | no-DB stays | `miniflare.seq.check.ts` |
| `ALL /api/auth/*` | Better Auth identity only | no-DB stays | `authAdapter.check.ts` |
| `OPTIONS /api/data/*`, `/api/rpc/*` | — | no-DB stays | — |

Planner tables: `tasks`, `domains`, `projects`, `initiatives`, `key_results`,
`slots`, `labels`, `recurrences`, `record_comments`, `week_reviews`, `sprints`,
`reminders`, `event_domain_routing`, `user_settings`.

POST with someone else's existing row id now inserts a **new** owned row (or
400) — never 23505 vs 200 as an existence oracle, and never updates the
foreign row. PATCH of a foreign key on your own row onto someone else's
parent is rejected (`assertOwnedFks`).

---

## 2 · Agent / MCP

| Route | Tables | Status | Tests |
|---|---|---|---|
| `POST/GET /api/agent` · `/functions/v1/agent` | `tasks`, `domains`, `projects`, `initiatives`, `key_results`, `slots`, `labels`, `user_settings`, `reminders`, `external_events` (read) | ported+tested | unauth 401; B snapshot omits A; B `update_task` A's id = random id (`not found`); B FK plant rejected; B `prepare` A's id = random 404 |
| `POST /api/mcp` · `/functions/v1/mcp` | same + `connections` (hash lookup) | ported+tested | unauth 401; B connection snapshot omits A; B `update_task` + `user_id: A` does not write A |

Agent chat still talks to **OpenAI directly** (`OPENAI_API_KEY`). No AI
Gateway. One-shot LLM bodies (`scaffold`, `assess`, …) 404 if the id is
not owned (same as a random id) and 503 if the key is unset.

Calendar **writes** (`create_calendar_event`, `move_event`, …) return
`stay_on_supabase` — see blocked calendar functions. Reads of
`external_events` are scoped by `user_id`.

---

## 3 · Other functions

| Route | Tables | Status | Tests |
|---|---|---|---|
| `GET /api/day` · `/functions/v1/day` | `external_events`, `tasks`, `slots`, `user_settings` | ported+tested | unauth 401; B schedule omits A's titles |
| `GET/POST /api/capture` · `/functions/v1/capture` | `connections`, `tasks` | ported+tested | unauth 401; B token omits A's tasks; B POST with A's id / `user_id` does not overwrite A |
| `POST /api/inbound-email` · `/functions/v1/inbound-email` | `user_settings` (token), `inbound_emails`, `tasks` | ported+tested | bad sig 401; unknown token 200 ignored + no row; valid sig + A's token writes **A only** |
| `POST /api/route-events` · `/functions/v1/route-events` | `domains`, `event_domain_routing` | ported+tested | unauth 401; empty batch 200 `{ routed: [] }` (no LLM) |
| `POST /api/rollover` · `/functions/v1/rollover` | `tasks`, `user_settings` | ported+tested | unauth 401; B session rolls **B only** |
| `POST /api/slot-mirror` · `/functions/v1/slot-mirror` | `slots` (`google_event_id`) | ported+tested | unauth 401; GET/HEAD 405; session owner; foreign id ≡ random id → 404 |
| `POST /api/task-mirror` · `/functions/v1/task-mirror` | `tasks` (`google_event_id`) | ported+tested | unauth 401; GET/HEAD 405; session owner; foreign id ≡ random id → 404 |
| `POST /api/github-activity` · `/functions/v1/github-activity` | `activity_sources`, `activity_bindings`, `activity_units`, `projects` | ported+tested | unauth 401; session owner; `action: "sync"` + `CRON_SECRET` uses `gateCronBearerRoute` before `requestIo` |

`iap-catalog` has **no user-data SQL** (product ids from env). It stays
blocked with the billing group so we do not retarget StoreKit config.

---

## 4 · Cron

`/api/cron/:job` still requires `CRON_SECRET` (constant-time). Unset or
wrong → 401. After auth, `gateCron` (`CUTOVER_FLIPPED` in
`worker/src/cutoverFlip.ts`) fail-closes every job — unset / unknown is 200
`{ skipped: true, reason: "cutover_not_flipped" }` so Worker + pg_cron
cannot double-fire. Cron Triggers call the same `runCronJob` gate. Bearer
routes such as `/api/push-dispatch` go through `handleCron` and therefore
the same gate, before the DB opens.

| Job | Tables | Status | Tests |
|---|---|---|---|
| `rollover` / `nuvo-rollover-pst` / `pdt` | `users`, `tasks`, `user_settings` | ported+tested | unauth 401; authorized 200; iterates `SELECT id FROM users` then `WHERE user_id = $id` |
| `purge-trash` / `nuvo-purge-trash` | `users`, `tasks` | ported+tested | unauth 401; A/B stale trash gone, recent trash + live task kept |
| `reminder-deliveries-prune` / `nuvo-reminder-deliveries-prune` | `users`, `reminder_deliveries` | ported+tested | unauth 401; A/B stale deliveries gone, recent kept |
| `push-dispatch` / `nuvo-push-dispatch` | `user_settings`, `tasks`, `slots`, `external_events`, `push_subscriptions`, `reminders`, `reminder_deliveries` | ported+tested | unauth 401; authorized + unset `CUTOVER_FLIPPED` → 200 `{ skipped: true, reason: "cutover_not_flipped" }` (nothing sent); after flip 200 and runs; HTTP ignores caller `nowMs` |
| `google-renew` / `nuvo-google-renew` | `calendar_accounts` | **blocked** | 501 |
| `calendar-dispatch` / `nuvo-calendar-dispatch` | `calendar_accounts`, `external_events` | **blocked** | 501 |
| `github-poll` / `nuvo-github-poll` | `activity_sources`, `activity_bindings`, `activity_units`, `projects` | ported+tested | unauth 401; 200 `skipped:true` until `CUTOVER_FLIPPED`; then iterates `users` then `user_id`; A's units stay on A |
| `nuvo-trim-sync-log` / `trim-sync-log` | `sync_log` | ported+tested | unauth 401; 200 `skipped:true` until `CUTOVER_FLIPPED`; after flip, age > 30d deleted only below the floor (Supabase-origin); Neon-origin ids at/above the floor kept; sequence unchanged |

Calendar mirror teardown during rollover is **skipped** (Vault + Google /
iCloud). The Neon row still loses `start_time` / `do_date` as the
rollover rule requires.

---

## 5 · Blocked — billing (do not rewrite Stripe / StoreKit)

These stay on Supabase. **They also read/write user-data rows that are
moving to Neon.** After cutover they will write the old database unless
a follow-up ports only the DB access (without touching Stripe/StoreKit
code). Flagged, not changed.

| Route | User-data tables on Neon path | Why blocked |
|---|---|---|
| `stripe-checkout` / `stripe-portal` | `subscriptions` | Stripe; do not touch billing code |
| `stripe-webhook` | `subscriptions`, `stripe_webhook_events` | Stripe signature + webhooks |
| `apple-iap` | `subscriptions` | StoreKit / IAP write |
| `apple-webhook` | `apple_webhook_events`, `subscriptions` | Apple signed payload |
| `referral-code` | `subscriptions` | Stripe referral |
| `iap-catalog` | — (no user data) | StoreKit product ids; left with billing |

`subscriptions` was **never** in the Neon rehearsal schema. Billing
rows staying on Supabase is the existing cutover decision.

---

## 6 · Blocked — calendar / identity (user data + Vault)

These read/write user-data tables that **are** moving (`tasks`,
`external_events`, `calendar_accounts`, `user_settings`, …) and cannot
run correctly against Neon without the Worker owning the query. They
are blocked because they need Vault secrets or provider OAuth — not
because they are allowed to keep writing Supabase after cutover.
`slot-mirror`, `task-mirror`, `push-dispatch`, and `github-activity`
are ported.

| Route | User-data tables | Blocker |
|---|---|---|
| `google-oauth` / `google-sync` / `google-events` / `google-webhook` / `google-contacts` | `calendar_accounts`, `external_events`, `user_settings`, `contacts_directory` | Vault refresh tokens + Google APIs |
| `m365-oauth` / `m365-sync` | `calendar_accounts`, `external_events` | Vault + Microsoft |
| `icloud-connect` / `icloud-sync` / `icloud-events` / `icloud-contacts` | `calendar_accounts`, `external_events`, `user_settings` | Vault + CalDAV/CardDAV |
| `ics-subscribe` / `ics-sync` | `calendar_accounts`, `external_events` | feed pull + account rows |
| `calendar-refresh` | `calendar_accounts` | token refresh via Vault |
| `apple-identity` | `apple_identities` | GoTrue identity link |
| `delete-account` | almost every user table + Stripe cancel | Stripe + auth wipe |

---

## 7 · Test counts

`npm run check:worker` (already in `.github/workflows/checks.yml`):

| File | Count | What |
|---|---|---|
| `access.check.ts` | 230 | Store-layer isolation + FK plant + day window + reminder target table |
| `accessHttp.check.ts` | 533 | HTTP A/B + unauth 401 + POST-id body leak + PATCH FK + purge/prune + github-activity (CRON_SECRET sync flip-skip before DB) + github-poll / trim-sync-log + maintenance no-store |
| `authUrl.check.ts` | 99 | auth URL / local fallback |
| `authAdapter.check.ts` | 29 | Better Auth adapter |
| `db.check.ts` | 55 | Hyperdrive / connect timeout |
| `requestReuse.check.ts` | 156 | per-request IO; POST foreign id = new owned row |
| `secrets.check.ts` | 227 | A's seal/open + writeFrozen fail-closed (typo + non-string) + allowlist cutoverFlipped + gateCron(env, job) + github PAT AAD + trim floor + docs |
| `cutoverFlip.check.ts` | 407 | Shared allowlist + POST_FLIP_CRON_JOBS + per-function CRON_SECRET scan + github-activity `gateCronBearerRoute(c.env, 'github-poll')` + google-events gate + queue no-IO unflipped + maintenance no-store |
| `pushDispatch.check.ts` | — | 4-route unflipped skip matrix + sender call-site scan |
| `miniflare.seq.check.ts` | 61 | workerd + Postgres; authorized cron `push-dispatch` skips until `CUTOVER_FLIPPED` |

`npm run check:isolation-mutation`: **80/80** owner filters in `store.ts`.

SPA: `npm run typecheck` clean · `npm test` **2265** passed (167 files).
