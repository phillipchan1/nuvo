# Worker access audit — Neon has no RLS

**Status:** living · 2026-10-26  
**Thesis:** the Cloudflare Worker is the only tenant wall on Neon. Every
user-data query is scoped by the Better Auth session's user id — never a
client-supplied id. This file is the route × table matrix and the tests
that fail if that wall is cut.

Sister docs: [`inventory.md`](./inventory.md) (what Supabase does today),
[`cloudflare-cutover.md`](../cloudflare-cutover.md) (the rehearsal).

Billing **writers** (Stripe, StoreKit, webhooks) stay on Supabase and are
out of this matrix. The Worker **reads** `subscriptions` for
`GET /api/entitlement` by the verified session user id — never a client
id, never an email remap.

---

## 1 · How a request becomes an owner

`requireStore` (`worker/src/index.ts`) is the only door into planner SQL.

1. `sessionUser` (`worker/src/auth.ts`) calls Better Auth `getSession` on
   the request headers (signed bearer or session cookie).
2. No session → **401**. A session-lookup driver error → **503**, not a
   silent anonymous store.
3. `bootstrapUser` may remap the Better Auth id onto an existing
   `users.auth_id` / verified-email row. The store that comes back is
   keyed by that planner `users.id`.
4. Every query in `worker/src/store.ts` filters `user_id = ${store.userId}`
   (or a JOIN/EXISTS through a parent that does). Client `user_id` on the
   body, path, query, or `X-User-Id` is ignored as an owner key.

`user_settings` is the one table whose primary key *is* `user_id`. A
GET/PATCH/DELETE whose path id is not the session owner is **404** — it
must not return or mutate the caller's own row under someone else's id.

Unauthenticated requests are rejected **before** the table allowlist, so
`/api/data/not_a_table` is 401, not a table-existence leak.

---

## 2 · Route × table matrix

Owner = session user after bootstrap. "Denied" on a foreign row is HTTP
**403 or 404**, or a 200 whose payload is empty / `matched: 0` /
`deleted: 0`.

### Public / non-tenant

| Route | Scope | Test |
|---|---|---|
| `GET /api/health` | No user data | `miniflare.seq.check.ts` |
| `OPTIONS /api/data/*`, `/api/rpc/*` | CORS preflight, no SQL | — |
| `ALL /api/auth/*` | Better Auth identity. OTP / password. No planner read. | `authAdapter.check.ts`, `requestReuse.check.ts` |
| `ALL /assets/*`, `ALL *` | Static SPA | — |

### Planner REST — `/api/data/:table`

Tables: `tasks`, `domains`, `projects`, `initiatives`, `key_results`,
`slots`, `labels`, `recurrences`, `record_comments`, `week_reviews`,
`sprints`, `reminders`, `event_domain_routing`, `user_settings`.

| Route | Scope | Cross-user | Test |
|---|---|---|---|
| `GET /api/data/:table` | `listOwned` — `WHERE user_id = store.userId` | 200, A's id absent | `access.check.ts` + `accessHttp.check.ts` |
| `GET /api/data/:table/:id` | `getOwned` — `id` **and** `user_id = store.userId` (`user_settings`: both sides of the PK must be the session) | 403/404 | same |
| `POST /api/data/:table` | `upsertOwned` / `insertOwned` — `user_id` written from the store. Foreign FKs fail `assertOwnedFks` | 400 / row is B's | same |
| `PATCH /api/data/:table/:id` | `updateOwned` — same owner clause; unknown patch fields → 404 even on own rows | 403/404, A's row unchanged | same |
| `DELETE /api/data/:table/:id` | `deleteOwned` — `id` **and** `user_id = store.userId` | 403/404, row remains | same |

Writable via POST today: `tasks`, `domains`, `projects`, `initiatives`,
`key_results`, `slots`, `record_comments`, `event_domain_routing`,
`user_settings`. The others accept GET/DELETE (and a no-op PATCH → 404).
That is a CRUD gap, not an access gap — there is no unscoped write.

### Junction

| Route | Scope | Cross-user | Test |
|---|---|---|---|
| `GET /api/data/task_labels?task_id=` | JOIN `tasks` on `t.user_id = store.userId` | 200, empty | `access.check.ts` + `accessHttp.check.ts` |
| `POST /api/data/task_labels` | Task **and** label must both be owned | 404 | same |
| `DELETE /api/data/task_labels` | `DELETE … USING tasks` with `t.user_id = store.userId` | `deleted: 0` | same |

### RPCs

| Route | Scope | Cross-user | Test |
|---|---|---|---|
| `POST /api/rpc/apply_patch` | Delegates to `updateTaskTitle` / `updateDomainName` / `updateProjectName` / `updateSettingsTheme`. Match id that is not owned → `matched: 0`. Settings match id that is not the session → `matched: 0` | 200, `matched: 0`, A's row unchanged | `access.check.ts` + `accessHttp.check.ts` |
| `POST /api/rpc/contacts` | `contacts_directory.user_id = store.userId` | 200, A's emails absent | same |
| `POST /api/rpc/rotate_inbound_token` | `UPDATE user_settings WHERE user_id = store.userId` | A's `inbound_token` unchanged | same |
| `POST /api/rpc/claim_reminder` | Reminder must be owned; delivery inserted as `store.userId` | 404, no `reminder_deliveries` row for A | same |

### Billing read (Supabase `subscriptions`, not Neon)

| Route | Scope | Cross-user | Test |
|---|---|---|---|
| `GET /api/entitlement` | `readEntitlement(env, session.user.id)` — PostgREST `user_id=eq.<session>` | 200, B sees B's row only (tier + period / cancel / referral display; no Stripe ids). Query / `X-User-Id` ignored | `accessHttp.check.ts` + `entitlement.check.ts` |
| `POST/PATCH/DELETE /api/entitlement` | No writes. Same 404 body whether the posted id exists | 404, no existence oracle | `accessHttp.check.ts` |

### Agent / MCP / day / capture / inbound / cron

Owner is still the session (or the connection / inbound token → that user).
Full table: [`route-inventory.md`](./route-inventory.md).

| Route | Scope | Cross-user | Test |
|---|---|---|---|
| `POST/GET /api/agent` | Session store. Snapshot + tools filter `user_id = store.userId` | B snapshot omits A; B tool on A's id = random id | `accessHttp.check.ts` |
| `POST /api/mcp` | `connections.token_hash`; tools run as `conn.user_id` | B token omits A | same |
| `GET /api/day` | Session; events/tasks/slots `user_id = store.userId` | B schedule omits A | same |
| `GET/POST /api/capture` | Connection hash; tasks `user_id` + `connection_id` | B omits A's tasks | same |
| `POST /api/inbound-email` | Svix + `user_settings.inbound_token` | unknown token writes nothing; A's token writes A | same |
| `POST /api/route-events` | Session; domains + routing owned | unauth 401 | same |
| `POST /api/rollover` | Session user only | B does not roll A | same |
| `ALL /api/cron/:job` | `CRON_SECRET`, then fail-closed `skippedUntilCutoverFlip` for `POST_FLIP_CRON_JOBS`. Ported jobs iterate `users` then `user_id = $id`. Unset flip → 200 `{ skipped: true, reason: "cutover_not_flipped" }`. google-renew stays 501 | unauth 401; skip before flip (nothing sent); purge-trash / reminder-deliveries-prune keep the other user's recent rows | `accessHttp` + `pushDispatch.check.ts` + `miniflare.seq.check.ts` |

`stripe_*`, `apple_*` writers, calendar tokens, and push tables are
**not** on this Worker. `subscriptions` is read-only via `/api/entitlement`.

---

## 3 · Query inventory (`store.ts`)

Every tenant filter is a tagged `user_id = ${store.userId}` (or a JOIN
through a row that has one). `scripts/prove-isolation-mutation.mjs`
deletes each clause in turn and expects `access.check.ts` to fail.

| Function | Filter |
|---|---|
| `listOwned` / `getOwned` / `deleteOwned` | per-table `user_id = store.userId` (`user_settings` also requires path id = session) |
| `listDayScheduledTasks` / `listDaySlots` | windowed `user_id = store.userId` (A's in-window `start_time` is seeded so dropping the filter fails) |
| `insert*` / `upsertOwned` | `user_id` column set to `store.userId`; `assertOwnedFks` for parent ids (reminders: `target_id` is checked on the table that matches `target_kind`) |
| `updateTaskTitle` / `updateDomainName` / `updateProject` / `updateTaskFks` | `WHERE id = $id AND user_id = store.userId` |
| `updateSettingsTheme` / `rotateInboundToken` / `upsertSettings` | `WHERE user_id = store.userId` |
| `listTaskLabels` / `insertTaskLabel` / `deleteTaskLabel` | task (and label, on insert) owned |
| `applyPatch` | the update helpers above; rejects `user_id` in the patch |
| `claimReminder` | reminder owned, then insert delivery as `store.userId` |
| `contacts` | `contacts_directory.user_id = store.userId` |
| `bootstrapUser` | looks up `users` by `auth_id` / id / verified email; never by a client user id |

`users` itself is not a REST table. Adoption of an existing email row
requires `emailVerified` on the session (OTP). Unverified
email+password sign-up cannot take over that row — see
`access.check.ts` + `requestReuse.check.ts`.

---

## 4 · Findings this pass

| Finding | Severity | Fix |
|---|---|---|
| `GET/PATCH/DELETE /api/data/user_settings/:id` ignored the path id and operated on the session row. B deleting A's id wiped **B's** settings (no cross-tenant leak, but a confused 200). | Medium | Path id must equal `store.userId` or the call is 404. `apply_patch` with a foreign settings match id is `matched: 0`. |
| Table allowlist ran **before** `requireStore`, so an anonymous `GET /api/data/not_a_table` was 404 (table oracle). | Low | Auth first; unknown table is 404 only with a session. |
| No other client-supplied owner. Inserts that send `user_id: <other>` still land on the session. Foreign FKs are rejected. | — | Already correct; held by the mutation proof. |

---

## 5 · Test coverage

All of these run in `.github/workflows/checks.yml` via `npm run check:worker`
(and the isolation job via `npm run check:isolation-mutation`). No new
CI workflow, no new major deps.

| Check | What it proves |
|---|---|
| `worker/src/access.check.ts` | Store-layer: A cannot list/get/update/delete B's row in every planner table; FK planting; bootstrap takeover; settings path-id |
| `worker/src/accessHttp.check.ts` | **HTTP tokens.** Creates user A and user B via OTP. Seeds a row for A in every user-owned table (`PLANNER_TABLES` + `task_labels` + `contacts_directory`). B's signed bearer gets 403/404 or an empty payload on read / update / delete. Unauthenticated → **401** on every user-data route. Forged `user_id` and `X-User-Id` do not change the owner. `/api/entitlement` is session-scoped; B cannot read A's tier; POST with A's id is the same 404 as an unknown id. |
| `worker/src/entitlement.check.ts` | Lookup URL is `user_id=eq.<session>`; Stripe/Apple rows share `isEntitled`; a remapped auth id fails the parity proof |
| `scripts/check-entitlement-parity.ts` | 1:1 auth copy + per-user tier match. Counts only |
| `scripts/prove-isolation-mutation.mjs` | Deleting any `user_id = ${store.userId}` clause turns `access.check.ts` red |
| `worker/src/miniflare.seq.check.ts` | Real workerd + Postgres: task create/read/patch + B 404 + unauthenticated-style raw token 401 |
| `worker/src/requestReuse.check.ts` | Invalid bearer 401; client-supplied foreign id does not overwrite |

`accessHttp.check.ts` is the battery the matrix above cites for
"B's token cannot touch A's rows."
