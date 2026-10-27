# Nuvo Cloudflare cutover + rollback

**Status:** draft rehearsal · 2026-10-26  
**Do not deploy, change DNS, or touch prod data** until Phil signs off.

Live Nuvo stays on Vercel + Supabase. This branch adds a Worker that is inert
unless `VITE_API_BASE_URL` is set on a build.

Sister inventory: [`cloudflare-migration/inventory.md`](./cloudflare-migration/inventory.md).
Access matrix (Neon has no RLS): [`cloudflare-migration/access-audit.md`](./cloudflare-migration/access-audit.md).
Cutover-night route table: [`cloudflare-migration/route-inventory.md`](./cloudflare-migration/route-inventory.md).
Pre-flip billing read: [`cloudflare-migration/billing-live-check.md`](./cloudflare-migration/billing-live-check.md).
Source auth readers (already on prod): [`cloudflare-migration/migration_tmp.sql`](./cloudflare-migration/migration_tmp.sql).
Shape follows `phillipchan1/zeroed` PRs #11–#13.

---

## What moves (eventually)

| Piece | Today | After cutover | Rollback |
|---|---|---|---|
| Static SPA | Vercel (Vite) | Workers Static Assets (optional) | DNS / Vercel still live |
| Planner CRUD | Supabase PostgREST + RLS | Hono `/api/data/*` + `/api/rpc/*`; owner filters in the Worker | **24h after flip only.** Set `CUTOVER_FLIPPED` back, then freeze Neon writes (`MAINTENANCE_WRITE_FREEZE`). Never drop or reset Neon. After 24h, fix forward |
| Auth | GoTrue (Google, Apple, OTP, password) | Better Auth `/api/auth` (email OTP + verified password; signed bearer only) | Same flag flip |
| Agent / MCP | `*.supabase.co/functions/v1` | `/api/agent`, `/api/mcp` (session / connection scoped on Neon) | Same flag flip |
| Database | Supabase Postgres + RLS | Neon via Hyperdrive | Leave Neon; app stops writing it |
| Billing / Stripe / StoreKit | Supabase edge | **Still Supabase writes (option b).** After the flip, `apple-iap` / `stripe-checkout` / `stripe-portal` / `referral-code` go Worker → service-role acting-user → the same Supabase functions. Webhooks stay pointed at Supabase. Entitlement is read from those same Supabase rows (`GET /api/entitlement`). Billing tables stay writable (exempt from the freeze); we do not repoint writers to Neon. | n/a |
| Calendar + OAuth (Google, M365, iCloud, ICS) | Supabase edge + pg_cron | Worker `/functions/v1/:name` **and** `/api/:name` for `google-oauth`, `google-events`, `calendar-refresh`, `m365-oauth`, `icloud-connect`, `ics-subscribe`. Crons `google-renew` / `calendar-dispatch` / `m365-sync` / `icloud-sync` / `ics-sync` | Leave Supabase functions + jobs until `cron.unschedule` at flip |

`ENVIRONMENT=local` (exactly, case-insensitive) **or** a parsed DB/Hyperdrive
**hostname** that is loopback is the only unset-`BETTER_AUTH_URL` fallback.
Substring matches on user, database name, or query are **not** local. Prod must
set `BETTER_AUTH_URL` to the public Worker origin and must **not** set
`ENVIRONMENT=local`.

---

## Secrets and bindings

None of these belong in the Vite bundle.

| Name | Kind | Required |
|---|---|---|
| `HYPERDRIVE` | Worker binding | **Production / `wrangler dev` only.** Preview does not bind it |
| `DATABASE_URL` | secret | **Required on preview.** Optional local fallback when Hyperdrive is set |
| `BETTER_AUTH_SECRET` | secret | Yes (32+ random bytes). During a keyring rotation this **must stay the OLD secret** (BA's `legacySecret` for bare-hex). Set it to NEW while `BETTER_AUTH_SECRETS=2:NEW,1:OLD` and old tokens open to null — Apple revoke is silently skipped |
| `BETTER_AUTH_SECRETS` | secret (optional) | BA keyring `2:<current>,1:<previous>`. First entry is the write version. Unset → `secretConfig` is the string `BETTER_AUTH_SECRET`. The previous secret belongs here **and** in `BETTER_AUTH_SECRET`, not only in the keyring |
| `BETTER_AUTH_URL` | **prod/preview var** | Preview is committed as `https://nuvo-preview.nq-morning-briefing.workers.dev`. Unset outside local → JSON 500 |
| `ENVIRONMENT` | var | `local` in `.dev.vars` for `wrangler dev`. Preview commits `preview` (OTP log path). Must not be `local` on workers.dev. Never `production` for console OTP |
| `RESEND_API_KEY` | secret | OTP email + inbound-email body fetch. Unset → codes logged only when `ENVIRONMENT` is `local` or `preview` — never production |
| `RESEND_FROM` | var | e.g. `Nuvo <noreply@yourdomain>` |
| `RESEND_WEBHOOK_SECRET` | secret | Svix verify for `/api/inbound-email`. Unset → inbound 500 |
| `OPENAI_API_KEY` | secret | Direct OpenAI (no AI Gateway). Unset → agent chat / route-events LLM 503. Snapshot + tools still work |
| `CRON_SECRET` | secret (optional) | Bearer for `/api/cron/:job` and `/api/push-dispatch`, compared in constant time. Unset or mismatch → 401. Until `CUTOVER_FLIPPED`, every cron and cron-bearer route (including github-activity `action: "sync"`, google-sync / google-contacts / google-events, and m365-sync / icloud-sync / icloud-contacts / ics-sync) returns 200 `{ skipped: true, reason: "cutover_not_flipped" }` and does not open the DB. After flip: rollover, purge-trash, reminder-deliveries-prune, push-dispatch, github-poll, trim-sync-log, `google-renew`, `calendar-dispatch`, `google-resubscribe`, `m365-sync`, `icloud-sync`, `ics-sync` run. Calendar-dispatch enqueues when `CALENDAR_SYNC_QUEUE` is bound |
| `CUTOVER_FLIPPED` | var | **Allowlist only:** `1` / `true` / `yes` / `on` (trimmed, case-insensitive). Unset, empty, and anything else (`garbage`, `maybe`, `2`, `false`, `0`) is not flipped. Set only after runbook step 8. One helper: `gateCron` / `gateCronBearerRoute` in `worker/src/cutoverFlip.ts`. Freeze is not a substitute — freeze 503s writes only. Until then Worker crons, push-dispatch bearer routes, github-activity `action: "sync"` with `CRON_SECRET`, google-sync / google-contacts / google-events, and m365-sync / icloud-sync / icloud-contacts / ics-sync cron-bearer routes stay skipped |
| `APPLE_CLIENT_ID` | secret | Better Auth Apple provider (Services ID or bundle id) |
| `APPLE_CLIENT_SECRET` | secret | Better Auth Apple `client_secret` JWT. **Not** `STRIPE_SECRET` |
| `APPLE_BUNDLE_ID` | secret | Native SIWA; revoke/exchange fallback client id |
| `APPLE_SIWA_TEAM_ID` / `APPLE_SIWA_KEY_ID` / `APPLE_SIWA_PRIVATE_KEY` / `APPLE_SIWA_CLIENT_ID` | secrets | Authorization-code exchange + Apple `/auth/revoke` (guideline 5.1.1(v)) |
| `TOKEN_ENC_KEY_V1` | secret | 32-byte AES-256-GCM key (hex or base64). Seals refresh tokens / PATs / app passwords into Neon `refresh_token_enc` columns. AAD is length-prefixed `table` / `row_id` / `user_id`. Unset or invalid → fail closed (Apple refresh token is not stored; 503, no plaintext) |
| `TOKEN_ENC_KEY_V2` | secret (optional) | Next key for rotation. `TOKEN_ENC_CURRENT=2` seals with v2; open still accepts v1 |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | secret | **Same pair as today's Supabase function** — a new pair breaks every existing subscription |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | secret | Google OAuth + token refresh |
| `MAINTENANCE_WRITE_FREEZE` | var | Same parse as `supabase/functions/_shared/writeFreeze.ts`: unset / empty / `0` / `false` / `no` / `off` (trimmed, case-insensitive) stay open. **Any other non-empty value** (`1`, `true`, `yes`, `on`, a typo, `maybe`, `2`) freezes Worker writes. `GET /api/maintenance` is what the app reads |
| `MIN_CLIENT_VERSION` | var | Floor the SPA reads as `min_version` from `GET /api/maintenance`. Unset / empty → clients **fail open** (no update wall). Set on the Worker deploy (below) when a shipped binary must stop writing |
| `CUTOVER_ARMED` | var | `1` / `true` arms the copy window. The app fail-closes the freeze while armed |
| `SUPABASE_URL` | secret | Billing read + the billing-function proxy. `GET /api/entitlement` and delete-account SELECTs `subscriptions` here by the session user id. The proxy POSTs `apple-iap` / `stripe-checkout` / `stripe-portal` / `referral-code` at `${SUPABASE_URL}/functions/v1/<name>` |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | Same read (`user_id=eq.<session id>`) and the proxy's service-role bearer + `X-Nuvo-Acting-User` (the verified Better Auth id — never a client-supplied id). **Not** a Stripe key; do not add `STRIPE_SECRET_KEY`. Stripe stays in TEST mode for rehearsal |
| `APP_URL` | var | SPA origin for the post-consent redirect |
| `CLOUDFLARE_API_TOKEN` | (optional, later) | Only if someone later adds a manual deploy workflow |
| `CLOUDFLARE_ACCOUNT_ID` | (optional, later) | Same |

### Temporary migrate secrets (delete after the run)

`.github/workflows/cutover-migrate.yml` is **manual `workflow_dispatch` only**. It
never runs on push/PR, never deploys, and never writes Supabase. Source is
PostgreSQL 17.6 (`nuvo`); the job installs `postgresql-client-17` and fails
unless `pg_dump` / `pg_restore` match that major. The job uses the
`nuvo-cutover` GitHub Environment (set required reviewers there). `mode=cutover`
also requires the confirm input exactly `CUTOVER nuvo`.

| Secret | Used when | Role |
|---|---|---|
| `SOURCE_DATABASE_URL` | always | Read-only Supabase URI. `PGOPTIONS=default_transaction_read_only=on`. Dump + `COPY … TO STDOUT` only |
| `SCRATCH_DATABASE_URL` | `mode=dry-run` | Empty Neon branch the restore lands in |
| `TARGET_DATABASE_URL` | `mode=cutover` | Neon URI. Hyperdrive is later; this job talks to Neon directly |
| `TOKEN_ENC_KEY_V1` | token copy (after restore) | Same AES-256-GCM key as the Worker. The job calls `migration_tmp.vault_tokens()` (applied by hand — never by this workflow), seals in-process, `UPDATE`s Neon. Counts only; no token files or artifacts |

Set them for the run, then **delete them**:

```bash
gh secret delete SOURCE_DATABASE_URL
gh secret delete SCRATCH_DATABASE_URL
gh secret delete TARGET_DATABASE_URL
gh secret delete TOKEN_ENC_KEY_V1
```

Values are masked (`::add-mask::`) and never echoed. A failed step's stderr is
redacted before it is printed. The custom-format dump is verified on the
runner (`pg_restore --list`, size, sha256; hash is re-checked before restore)
and **never uploaded** — this repo is public. Auth COPY CSVs stay in
`$RUNNER_TEMP` and are shredded in an `always()` step. The only artifact is
`artifacts/cutover-report.md` (per-table counts + content md5). Logs are
those counts and hashes — never emails or row data. `checks.yml` runs
`scripts/guard-public-ci.mjs`, which fails if any workflow uploads anything
else.

### Limits

Every public workflow step (`run` and `uses`, including
`actions/github-script` and reusable-workflow `jobs.<id>.uses`) is
default-deny: rejected unless listed in
`scripts/guard-public-ci.allowlist.json` by file + job + step id with a
sha256 of the **whole** canonical step (every key, including
`timeout-minutes`) plus the **whole** job minus `steps` (`container`,
`services`, `strategy`, `if`, `environment`, `permissions`, `outputs`,
`concurrency`, `timeout-minutes`, reusable `uses` / `with` / `secrets`,
…) plus the **whole** workflow minus `jobs` (`on`, `concurrency`,
`run-name`, `env`, `defaults`, `permissions`, …). Unknown keys are
included — the full object is hashed, not a key list. Per job, the
ordered step-id list is hashed and duplicate ids are rejected. Per
workflow, the ordered job list is hashed. Deleting `signing` /
`assert-logs`, reordering `publish` first, or duplicating `publish`
fails. A new job, step, trigger (e.g. `pull_request_target`), container,
or env change fails.

Always denied, even on an allowlisted step: `BASH_ENV` / `ENV` keys.
Writes to `$GITHUB_ENV` / `$GITHUB_PATH` and to `RELEASE_NOTES.md` or
release paths are denied outside allowlisted steps. `curl` / `wget` /
`gh` value checks stay as defense in depth.

`nc` and other non-`gh` exfil inside an already-allowlisted run are out
of scope for the value deny-list. Reviewers must read the hashed step
before bumping its sha256. `@phillipchan1` is required on the allowlist
JSON, the guard script, and `.github/workflows/` (`.github/CODEOWNERS`).
Regenerating hashes:

```bash
node scripts/regen-public-ci-allowlist.mjs
```

Billing / Stripe / StoreKit stay on Supabase — this workflow does not retarget
webhooks. Nuvo stays on direct OpenAI; there is no AI Gateway in this path.

### `migration_tmp` (source-only auth readers)

The apply script + runbook (who created it, verification queries, the
post-cutover drop) is
[`cloudflare-migration/migration_tmp.sql`](./cloudflare-migration/migration_tmp.sql).
It is **not** under `supabase/migrations` and must not be `db push`ed.

**Already applied on Supabase prod** by Engineer 3 via the management API
SQL editor. Verified 2026-10-26 (PT) from live `pg_get_functiondef` + the
grant catalog: owner `postgres`, `SECURITY DEFINER`, `search_path=""`,
`EXECUTE` for `migration_reader` only. PostgREST `db_schema` is
`public,graphql_public`, so `migration_tmp` is not exposed.

The cutover source role (`migration_reader`) is read-only and has **no
`USAGE` on `auth`** — `SELECT` / `COPY` from `auth.users` /
`auth.identities` fails with `permission denied for schema auth`. The
workflow therefore `COPY`s `migration_tmp.auth_users()` /
`migration_tmp.auth_identities()`. Bodies project only `name` / `full_name`
(and identity `sub` / `provider_id`) through `pg_catalog.jsonb_build_object`
+ `jsonb_strip_nulls`. Password hashes, recovery tokens, and other GoTrue
secrets never leave `auth`.

After cutover is signed off and `SOURCE_DATABASE_URL` is deleted:

```sql
DROP SCHEMA migration_tmp CASCADE;
```

That drop is a source-side cleanup, not a rollback step. Supabase itself
stays up. Rollback is `CUTOVER_FLIPPED=false` (see below), not clearing
`VITE_API_BASE_URL`.

Client build-time:

| Name | Notes |
|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Keep until PostgREST is retired |
| `VITE_API_BASE_URL` | Empty = today's path. Worker: `/api` (same origin) or `https://<worker>/api`. iOS TestFlight reads this from a **repo variable** — see below |

Replace the placeholder Hyperdrive `id` in the **top-level** `wrangler.jsonc`
`hyperdrive` block before a production deploy. Preview does not use it.

---

## Preview on workers.dev (do not run until signed off)

This repo's `wrangler.jsonc` has an `env.preview` named `nuvo-preview` with
`workers_dev: true`, **no routes / custom domains**, and **no Hyperdrive**.
`BETTER_AUTH_URL` is a committed preview var:
`https://nuvo-preview.nq-morning-briefing.workers.dev`. Commands (for later):

```bash
npx wrangler secret put BETTER_AUTH_SECRET --env preview
npx wrangler secret put DATABASE_URL --env preview

# Schema + synthetic seed (no prod data)
DATABASE_URL="$NEON_DATABASE_URL" npm run db:neon:apply
DATABASE_URL="$NEON_DATABASE_URL" npm run db:neon:seed

# Config check (CI runs this; no deploy)
npm run cf:preview:dry-run

# Deploy ONLY the preview env (this PR does not run this)
npx wrangler deploy --env preview

# Client floor. Unset = fail-open. Set when a shipped binary must stop writing.
npx wrangler vars put MIN_CLIENT_VERSION --env preview
```

Do **not** run `wrangler deploy` without `--env preview`. Do **not** attach a
custom domain. Do **not** retarget Stripe, Apple, or Resend webhooks. Google
Calendar push channels re-subscribe to the Worker at the flip
(`POST /api/cron/google-resubscribe`); `calendar-dispatch` is the poll fallback.

---

## Crons and Queues (Workers Paid)

`vercel.json` still has **no `crons`**. The Worker now has Cron Triggers
(UTC, matching today's `pg_cron`) and a `scheduled` + `queue` export.

`CRON_SECRET` is compared in constant time on `/api/cron/:job` (401 if unset
or wrong). The scheduled handler is Cloudflare-authenticated and calls the
same runners. **One flip gate** (`worker/src/cutoverFlip.ts`): until
`CUTOVER_FLIPPED` is an allowlisted value (`1` / `true` / `yes` / `on`),
every post-flip job — and github-activity `action: "sync"` with
`CRON_SECRET`, and google-sync / google-contacts / google-events
cron-bearer routes — returns **200 `{ ok: true, skipped: true, reason:
"cutover_not_flipped", job }`** with no DB, fetch, or queue work. After
the flip, ported jobs (`rollover`, `purge-trash`,
`reminder-deliveries-prune`, `push-dispatch`, `github-poll`,
`trim-sync-log`) iterate `users` then scope by `user_id`. Calendar-dispatch
enqueues due accounts onto `CALENDAR_SYNC_QUEUE` and the consumer polls
Google (other providers ack). `google-renew` re-watches channels that
expire within 48h. Flip tooling: `POST /api/cron/google-resubscribe`.
`trim-sync-log` deletes by
`created_at < now() - 30 days` and, when the identity is parked
(`last_value >= 1e6`), also `id < last_value - 1e6 + 1`. Copied source
ids typically sit below that floor. The floor keeps recent Neon-origin
rows out of age trim; it is not a permanent partition — after about 1e6 further Neon inserts the floor rises past those early Neon ids and any
row older than 30 days is eligible. The sequence is never reset.

| Cron (UTC) | Job | This PR |
|---|---|---|
| `* * * * *` | `calendar-dispatch` + `push-dispatch` | skip until flip, then dispatch enqueues due `calendar_accounts` onto `CALENDAR_SYNC_QUEUE`; consumer runs Google poll (others ack). Without a queue binding, HTTP dispatch claims Google in-process. push-dispatch is ported (per-user loop, same VAPID pair, no Queue) |
| `5 7 * * *` / `5 8 * * *` | `rollover` | skip until flip, then iterates `users`, scopes `UPDATE` by `user_id` |
| `15 9 * * *` | `google-renew` | skip until flip, then re-watches Google channels expiring within 48h |
| `20 9 * * *` | `github-poll` | skip until flip, then iterates `users`, scopes `activity_sources` by `user_id`; PAT via A's `openToken`. Same gate on github-activity `CRON_SECRET` sync |
| `0 10 * * 0` | `trim-sync-log` | skip until flip, then per-user age delete. Floor keeps recent Neon-origin ids out of trim until ~1e6 further inserts |
| `30 4 * * *` | `reminder-deliveries-prune` | skip until flip, then iterates `users`, scopes `DELETE` by `user_id` |
| `0 4 * * *` | `purge-trash` | skip until flip, then iterates `users`, scopes `DELETE` by `user_id` |

**Queue projection (flag, not extra spend):** one send + one consume per due
account per minute. At the current ~12 accounts that is ~35k ops/day, inside
Workers Paid's included Queue operations. Revisit past a few hundred accounts.

`pg_cron` stays scheduled on Supabase until the flip (`cron.unschedule` the
`nuvo-*` jobs then; reversible via `00000000000002_cron.sql`). Follow
step 8 in order: unschedule, final resync, then set `CUTOVER_FLIPPED`.
Until `CUTOVER_FLIPPED` is an allowlisted value, `runCronJob` /
`handleCron` / `scheduled` no-op (HTTP 200 `{ skipped: true, reason:
"cutover_not_flipped" }`) — including push-dispatch, github-poll, and
every other Worker cron. Unset or an unknown value is not flipped.
Doing it earlier lets Worker `github-poll` (and github-activity
`CRON_SECRET` sync) double-fire with `nuvo-github-poll`, lets
`google-renew` / `calendar-dispatch` double-fire with the Supabase
jobs, and lets trim delete old copied rows the next resync copies back.
Flip tooling: `POST /api/cron/google-resubscribe` re-watches every
Google channel onto the Worker webhook; `calendar-dispatch` poll covers
watch setup failures (unverified domain).

### Flip runbook (order is load-bearing)

Do **not** set `CUTOVER_FLIPPED` until both of these have landed. The
Worker copies must not run beside `pg_cron`, and they must not run
against a Neon that is still missing the last billing / `sync_log` rows.

1. **`cron.unschedule` the Supabase `pg_cron` jobs** (`nuvo-*` in
   `00000000000002_cron.sql`). Reversible: reschedule from that file.
2. **Final `phase=resync`** — one more `cutover-migrate` resync after
   the `VITE_API_BASE_URL` switch so every post-switch source row lands.
3. **Set `CUTOVER_FLIPPED=1`** on the Worker. Accepted values are only
   `1`, `true`, `yes`, `on` (trimmed, case-insensitive). Anything else
   stays skipped — including github-activity `action: "sync"` with
   `CRON_SECRET`.
4. **Confirm the flip landed.** `GET /api/maintenance` must report
   `cutover_flipped: true` (boolean only — it does not echo the env
   string). Then fire one **ported** cron — `/api/cron/rollover` or
   `/api/cron/calendar-dispatch`, not `github-poll` or `trim-sync-log` —
   and check it actually ran: a non-skipped JSON body, or a log line
   from the runner — not `{ skipped: true, reason: "cutover_not_flipped" }`.

## Write freeze

`MAINTENANCE_WRITE_FREEZE=1` on the Worker makes `GET /api/maintenance`
return `{ write_freeze: true, cutover_armed: …, cutover_flipped: … }`
with `Cache-Control: no-store`.
`cutover_flipped` is the boolean from the allowlist — it does not echo
the env string. Mutating `/api/data` and write RPCs then 503. RPC reads
(`contacts`) stay open. The SPA reads
that flag (or `VITE_MAINTENANCE_URL` / `VITE_WRITE_FREEZE`) and the
Supabase transport refuses writes so the outbox retries after the window.
Auth refresh is not frozen.

Fail-open if the flag URL is unreachable — unless a cutover is **armed**
(`CUTOVER_ARMED` on the Worker, `VITE_CUTOVER_ARMED=1` on a build, or
`cutover_armed: true` on the last successful payload). Armed + unreachable
is fail-closed.

**Ship the armed build first.** Before you flip `CUTOVER_ARMED` on the
Worker, ship a build with `VITE_MAINTENANCE_URL` (the Worker
`GET /api/maintenance` URL) and `VITE_CUTOVER_ARMED=1` baked in. The
copy job reads that same endpoint (`MAINTENANCE_URL` / `VITE_MAINTENANCE_URL`
Actions variable) and **refuses to start dump** unless the payload reports
`cutover_armed: true`. An unarmed SPA would keep writing through the
window; the job will not copy against that.

Non-billing Supabase edge functions that write with `service_role` also
read `WRITE_FREEZE` **or** `MAINTENANCE_WRITE_FREEZE`
(`supabase/functions/_shared/writeFreeze.ts`) and 503 if either is
frozen. Frozen is **any non-empty value other than** `0` / `false` /
`no` / `off` (trimmed, case-insensitive). Unset and empty stay open —
same as the Worker `MAINTENANCE_WRITE_FREEZE` row above. Set one of
them as an edge-function secret when you arm.

### Preflight before any edge-function redeploy

Before **any** `supabase functions deploy` (or dashboard redeploy), run:

```bash
node scripts/preflight-edge-write-freeze.mjs --project-ref <ref>
```

The script calls `supabase secrets list --project-ref <ref> -o json`.
The CLI emits `[{ name, value, updated_at }]` (Go `SecretResponse`;
`value` is the sha256 hex — we read `row.value ?? row.digest`). It
checks `WRITE_FREEZE` and `MAINTENANCE_WRITE_FREEZE` only. Absent →
PASS. Present with sha256 hex of `''` / `0` / `false` / `no` / `off`
→ PASS. Any other hash, a missing `value`/`digest`, or unexpected
JSON → FAIL (nonzero). Prints only names and PASS/FAIL.
Do not redeploy on FAIL. This does not change the secrets.
Covered: agent, capture (POST only; GET is a poll), mcp, inbound-email,
google-webhook, delete-account,
google-sync / oauth / events / contacts, m365-oauth / sync, ics-sync /
subscribe, icloud-connect / sync / events / contacts, calendar-refresh,
slot-mirror, task-mirror, route-events, rollover, push-dispatch,
github-activity, apple-identity. **Not** covered — do not add it:
`stripe-webhook`, `apple-webhook`, stripe-checkout / portal, apple-iap,
iap-catalog, referral-code. Those keep writing billing tables on
Supabase — **option (b)**. The tables stay writable (exempt from
`freeze.sql`) and the Worker reads entitlement from them. We did not
repoint those writers to Neon: smaller, no Stripe/StoreKit signature
change, and rollback is still "leave the webhooks where they are."

## Copy-window freeze (hand-applied, not CI)

`docs/cloudflare-migration/freeze.sql` and `unfreeze.sql` are committed
and reviewed. Do **not** apply them from CI, the Worker, or
`cutover-migrate.yml`. Billing stays on Supabase: `subscriptions`,
`stripe_webhook_events`, `apple_webhook_events`, and
`apple_notification_events` are excluded from the freeze, from
`pg_dump --exclude-table`, from `source-snapshot.json`, and from the
parity proof. `sync_log` **structure** is dumped (`--exclude-table-data`);
its rows stay out of snapshot/parity (billing webhooks insert via
`logSync`). After the switch, `phase=resync` copies **every** source
row whose `id` is missing on the target. An incoming id that already
exists on Neon with **different content** aborts (count only — no row
data). The temp-table load (before `BEGIN`) sets session `lock_timeout = '10s'`.
Then, in the **same transaction** (`SET LOCAL lock_timeout = '10s'`
then `LOCK TABLE` SHARE ROW EXCLUSIVE — a stuck writer times out as
`lock_not_available` / `55P03` and is rewritten to
`sync_log lock timed out after 10s — retry the resync (retryable) [55P03]`,
with the redacted psql error appended, rather than hanging the job).
The resync script starts with `\set VERBOSITY sqlstate` and
`SET client_min_messages = error` so the psql banner is
`ERROR:  55P03` with no message text (PG17 prints no colon after the
code; NOTICE / WARNING are suppressed; INFO cannot be). Only the resync target
`psql` call classifies a retryable lock timeout; dump / restore /
`pg_restore` always stop as a plain failure. The classifier takes the
first `psql:<file>:<n>: ERROR:` banner and requires `ERROR:  55P03` on
that line (colon after the code is optional); the table is the
script line that number maps to, not message text. Any INFO / NOTICE /
WARNING / LOG / DEBUG banner before that ERROR is not retryable. A bare
or `pg_restore` `ERROR:` line is not retryable.
A `push_subscriptions`
lock timeout uses the same SQLSTATE `55P03` and names that table from the
resync.sql line number, not `sync_log`. There is **no automatic retry**:
re-dispatch `cutover-migrate` with `phase=resync` by hand.
`setval`s `GREATEST(max(id), last_value, 1)`
so the parked identity never decreases — `--exclude-table-data` drops
sequence data and `OVERRIDING SYSTEM VALUE` does not advance it. After restore (empty
`sync_log`), the job `setval`s to source `max(id)` plus a 1e6 margin
and keeps Neon ids in that parked range for the whole switch window,
so they cannot overlap Supabase ids below the park. A dump-time
watermark (`max(id)`, `max(created_at)`) is reported only — a
late-committed lower id must still land. `push_subscriptions` stays in
the copy; resync **deletes missing ids first**, then upserts full
source rows (`ON CONFLICT (id) DO UPDATE` all columns, counts only),
so a row re-created with the same `(user_id, endpoint)` under a new
id does not hit the UNIQUE constraint. Webhook deletes **and**
`last_seen_at` / `failure_count` edits during the window land. If a
billing-written table ever has to be copied *and* stay frozen, it
needs the freeze too.

Grants are recorded from `aclexplode(relacl)`, including `PUBLIC`, and
`unfreeze.sql` restores those exact ACL entries — no new direct grants
to `anon` / `authenticated` that were only inherited via `PUBLIC`.
`unfreeze.sql` is idempotent (NOTICE no-op if the recording tables are
already gone). Partitioned tables, views, and column-level grants
(`attacl`) are out of scope: Nuvo public app tables are ordinary
relations.

Order:

0. **Ship the armed build** — `VITE_MAINTENANCE_URL` + `VITE_CUTOVER_ARMED=1`.
   The copy job will refuse to start until that endpoint reports armed.
0b. **Preflight edge secrets** — `node scripts/preflight-edge-write-freeze.mjs --project-ref <ref>`
   before any Supabase edge-function redeploy (and again before arming).
   PASS only when `WRITE_FREEZE` / `MAINTENANCE_WRITE_FREEZE` are absent
   or their CLI `value` (sha256 hex) matches an unfrozen string. Do not
   redeploy on FAIL.
1. **Arm** — set `CUTOVER_ARMED=1` on the Worker, `WRITE_FREEZE=1` on
   the non-billing edge functions, and `MAINTENANCE_WRITE_FREEZE=1` if
   you want Worker writes frozen too.
2. **Freeze** — apply `freeze.sql` by hand. Records `aclexplode` write
   ACLs (including `PUBLIC`), then revokes `INSERT`/`UPDATE`/`DELETE`
   on public app tables from `PUBLIC`, `anon`, and `authenticated`
   (SELECT stays). Pauses every `nuvo-*` `pg_cron` job via
   `cron.alter_job(..., active := false)` after recording the prior
   `active` flag. `service_role` and the billing tables are untouched.
3. **Snapshot** — `cutover-migrate` `dump` first GETs the maintenance
   endpoint and dies unless `cutover_armed` is true, POSTs one gated
   edge function (`calendar-refresh`) and dies unless it 503s, and
   checks `has_table_privilege(anon, sync_log, INSERT)` is false.
   Then records per-table counts + md5 for the frozen copy set only
   (`source-snapshot.json` in runner temp) plus the `sync_log`
   watermark (report only, on `cutover-report.md`).
4. **Copy** — restore + token seal into Neon. Billing tables are not in
   the dump TOC. `sync_log` is: structure only, no rows. Restore
   `setval`s the empty identity past source `max(id)` + 1e6 so any
   pre-resync Neon insert cannot collide with a Supabase id.
5. **Verify** — `verify` recomputes source and target hashes against the
   snapshot and dies if either drifted (writes leaked, or the copy is short).
   Parity covers only the frozen tables (`sync_log` excluded).
6. **First resync** — the same job copies every `sync_log` id missing
   on Neon (aborts on a content collision), `setval`s
   `GREATEST(max(id), last_value, 1)` in that transaction so the park
   never drops (session `lock_timeout` on the temp-table load, then
   `SET LOCAL lock_timeout = '10s'` before `LOCK TABLE`; timeout is
   retryable when the error carries SQLSTATE `55P03`, names the table
   that waited (`sync_log` or `push_subscriptions`), and includes the
   redacted psql error — re-dispatch `phase=resync` by hand; there is
   no automatic retry), then deletes
   missing `push_subscriptions`
   ids and upserts the rest.
7. **Switch** — set `CUTOVER_FLIPPED` (`1` / `true` / `yes` / `on`).
   Clients already baked with `VITE_API_BASE_URL` (separate release-workflow
   PR, needs Phil's yes) ask `GET /api/maintenance` at launch and flip
   then. Do **not** treat flipping `VITE_API_BASE_URL` as the live switch
   or as rollback — rollback is `CUTOVER_FLIPPED=false` plus unfreeze.
   Or **unfreeze** — apply `unfreeze.sql`, which restores the recorded
   ACLs and each job's prior `active` exactly (idempotent), then clear
   `CUTOVER_ARMED` and `WRITE_FREEZE`. Rollback of a flipped Worker is
   the dedicated section below — not this unfreeze, and not clearing
   `VITE_API_BASE_URL`.
8. **Flip Worker crons** — in this order, and not before:
   1. `cron.unschedule` Supabase `nuvo-github-poll` and
      `nuvo-trim-sync-log` (and any other `nuvo-*` job that would
      double-fire).
   2. Final `cutover-migrate` `phase=resync` so post-switch billing
      inserts/updates/deletes land (id anti-join + setval +
      delete-then-upsert).
   3. Set `CUTOVER_FLIPPED` to one of `1`, `true`, `yes`, `on`
      (case-insensitive). Unset or any other value = not flipped =
      200 `{ skipped: true }` on `github-poll`, `trim-sync-log`, and
      github-activity `action: "sync"` with `CRON_SECRET`. The freeze
      is not enough.

---

## Rollback (24 hours after flip)

The rollback window is **24 hours after the flip**. After that, fix
forward only. Do not drop or reset Neon.

1. Set `CUTOVER_FLIPPED` back (unset, empty, `false`, or any value that
   is not `1` / `true` / `yes` / `on`). Clients already baked with
   `VITE_API_BASE_URL` ask `GET /api/maintenance` at launch and stay on
   Supabase. Do not clear the bake.
2. Freeze Neon writes through the Worker's existing mechanism:
   `MAINTENANCE_WRITE_FREEZE` (same parse as the live freeze). This is
   not a substitute for step 1 — freeze 503s Worker writes; the flag
   is what sends the SPA back to Supabase.
3. Export every row changed since the flip, per planner table, as a
   **count** plus an **encrypted dump**. Filter on
   `field_ts` / `updated_at` (whichever the table carries) `>` the flip
   timestamp. On the orchestrator box only:

   ```bash
   # Key lives on the box. Name the path. Never print or commit the value.
   #   /home/box/agent-data/nuvo-rollback/rollback.key
   mkdir -p /home/box/agent-data/nuvo-rollback
   # per table: count, then \copy | gpg/age
   psql "$NEON_DATABASE_URL" -c "SELECT count(*) FROM ${TABLE} WHERE coalesce(updated_at, to_timestamp(0)) > '${FLIP_TS}'"
   psql "$NEON_DATABASE_URL" -c "\\copy (SELECT * FROM ${TABLE} WHERE coalesce(updated_at, to_timestamp(0)) > '${FLIP_TS}') TO STDOUT" \
     | gpg --symmetric --cipher-algo AES256 --batch --passphrase-file /home/box/agent-data/nuvo-rollback/rollback.key \
     > /home/box/agent-data/nuvo-rollback/${TABLE}.csv.gpg
   ```

   `age` is the same shape (`age -e -p` / `-i` against that key path).
   The dump stays on the orchestrator. It is not a CI artifact.

The rollback report line includes the **stranded-row count per table**
(the `count(*)` above). Those rows were written on Neon after the flip
and will not be on Supabase.

---

## iOS TestFlight at cutover

`.github/workflows/ios-release.yml` and `release.yml` bake
`VITE_API_BASE_URL=https://api.nuvo.day` only after Phil signs the
small dedicated PR for those two workflows. That bake is **not** the
live switch: the binary still talks to Supabase until
`GET /api/maintenance` returns `cutover_flipped`.
It does **not** skip `VITE_SUPABASE_*` — those stay baked so a rollback
(`CUTOVER_FLIPPED=false`) and any unported function still have a target.

| When | `VITE_API_BASE_URL` variable | What the IPA talks to |
|---|---|---|
| Before cutover (today) | unset / empty | Supabase, same as now |
| Workers preview | `https://nuvo-preview.<account>.workers.dev/api` | Worker `/api/auth`, `/api/data`, `/api/rpc`. Absolute URL — the IPA is a WKWebView loading local files, so `/api` will not resolve |
| Rollback (24h window) | leave the bake | Set `CUTOVER_FLIPPED=false`. Clients already baked ask `GET /api/maintenance` and stay on Supabase. Do not clear the variable |

### Signing (current target)

Automatic signing with an App Store Connect API key and
`-allowProvisioningUpdates` (Tauri's `tauri ios build --export-method app-store-connect --ci`).

**Required secrets**

| Secret | Why |
|---|---|
| `APPSTORE_KEY_ID` | ASC API key id |
| `APPSTORE_ISSUER_ID` | ASC issuer |
| `APPSTORE_PRIVATE_KEY` | Base64 of the `.p8` |
| `APPLE_TEAM_ID` | 10-char team id (`APPLE_DEVELOPMENT_TEAM`) |

**Still baked (web + iOS)**

`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_POSTHOG_PROJECT_TOKEN`, `VITE_POSTHOG_HOST`.

**Manual-signing fallback** (only if automatic signing fails): `IOS_CERTIFICATE`,
`IOS_CERTIFICATE_PASSWORD`, `IOS_MOBILE_PROVISION`. Leave them empty to stay on
automatic signing.

Identifiers that must already exist (ASC API keys cannot register new ones):
`day.nuvo.app`, `day.nuvo.app.widgets`, `day.nuvo.app.watchkitapp`,
`day.nuvo.app.watchkitapp.complications`. Full list: [`ios-releases.md`](./ios-releases.md).

This PR does **not** submit to the App Store.

---

## Free-tier risk

Workers Free: **10 ms CPU per request**. `/api/health` and `/api/data` are fine.
A later agent port can blow that; the honest fix is Workers Paid ($5/mo), not
rewriting the port. Bundle limit is **3 MB compressed**. Neon Free autosuspends.
Hyperdrive on Free is not guaranteed — fallback is `DATABASE_URL`.

---

## Proof on this branch

```bash
npm run typecheck
npm test
npm run check:worker
npm run check:isolation-mutation
npm run cf:preview:dry-run
# Live cutover only (SOURCE_DATABASE_URL + TARGET_DATABASE_URL):
# npm run check:entitlement-parity
# tokenDecrypt.check.ts skips unless TOKEN_ENC_KEY_V1 + DATABASE_URL point at a sealed Neon
```

Postgres.js and the Better Auth `pg` Pool are **per-request**. Workers cannot
reuse TCP sockets across requests; a `WeakMap` (or module-scope) cache hangs
every request after the first on an isolate. `openSql` / `openAuth` create
fresh clients (`max: 1` each → **two sockets per request**);
`ctx.waitUntil` closes them after the response.

**Connection cap (chosen):** production uses **Hyperdrive**. The Worker still
opens those two sockets, but they land on Hyperdrive's edge pool, which holds
a small origin pool to Neon — 150–200 parallel requests do not open 300–400
Postgres connections (PG's default `max_connections` is 100). Preview has no
Hyperdrive binding and talks to `DATABASE_URL` directly; it is not sized for
that concurrency (CI sequential tests are fine). Do not point preview at a
100-connection Neon without Hyperdrive and then hammer it.

**Hyperdrive TLS:** Cloudflare already TLS-terminates to the origin. Client
TLS to `*.hyperdrive.local` hangs, so `postgresSsl` / `clientSsl` set
`ssl: false` when the string comes from `env.HYPERDRIVE` or the hostname is
`hyperdrive.local`. `sslmode` is stripped so node-pg cannot override the
explicit `ssl` flag. Direct remote `DATABASE_URL`s (Neon) always require
TLS, even when `sslmode` is `prefer`, `allow`, or `disable`.
Connection errors stay generic — they never echo the internal host.

**Connect timeout:** a refused origin is already 503. A hung one (accept and
silence) used to wait for the Worker/OS timeout. `openSql` sets postgres.js
`connect_timeout` (5s) and `openAuth` sets `connectionTimeoutMillis` (5s).
The auth 503 probe (`SELECT 1`) is raced against the same deadline, so OTP
send fails fast as `{"error":"service unavailable"}`.

Planner `users.auth_id` is the Better Auth user id. `bootstrapUser` looks that
up first, adopts a row **only when the BA email is verified**, and never
auto-signs-in an unverified email+password account
(`requireEmailVerification`). Cookie-only `get-session` always returns a
signed bearer (`token.hmac`), not the raw `session.token`.

Better Auth tables in `worker/schema/better-auth.sql` use the 1.7.13 default
camelCase columns (`emailVerified`, `userId`, `expiresAt`, …). A snake_case
schema 500s on OTP send, OTP sign-in, sign-up and get-session even with a
`fields` map. `npm run check:worker` drives those four routes through real
Better Auth on PGlite. Billing `subscriptions` stays on Supabase — it is not
in the Neon rehearsal schema (**option (b)**: tables stay writable, exempt
from the freeze; the Worker reads them). The cutover copy inserts Better
Auth `"user".id` as the GoTrue `auth.users.id` — they are equal, not
remapped. The Worker entitlement check (`GET /api/entitlement`) reads that
table by the preserved session user id. After the flip, user-authenticated
billing calls (`apple-iap`, `stripe-checkout`, `stripe-portal`,
`referral-code`) go through the Worker proxy (Better Auth session →
service-role + `X-Nuvo-Acting-User`); Apple/Stripe webhooks stay on
Supabase. StoreKit purchases set `appAccountToken` to that UUID so a new
buyer is attached even if confirm never ran. Stripe / StoreKit pricing,
product ids, and webhook signatures are unchanged. Stripe rehearsal is
TEST mode only. `scripts/check-entitlement-parity.ts` proves the 1:1 auth
copy and that every subscription keeps the same tier. The SPA's paid gate
(`useSubscription`) reads `GET /api/entitlement` when the backend is
flipped, and keeps today's PostgREST select when it is not. Live Stripe +
StoreKit proof before a flip:
[`cloudflare-migration/billing-live-check.md`](./cloudflare-migration/billing-live-check.md).

Isolation applies `worker/schema/neon.sql` onto PGlite, seeds two users, and
asserts user A cannot read/write user B. The mutation script deletes each
derived `user_id = ${store.userId}` filter and expects a failure.
