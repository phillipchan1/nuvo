# Nuvo Cloudflare cutover + rollback

**Status:** draft rehearsal · 2026-10-26  
**Do not deploy, change DNS, or touch prod data** until Phil signs off.

Live Nuvo stays on Vercel + Supabase. This branch adds a Worker that is inert
unless `VITE_API_BASE_URL` is set on a build.

Sister inventory: [`cloudflare-migration/inventory.md`](./cloudflare-migration/inventory.md).
Shape follows `phillipchan1/zeroed` PRs #11–#13.

---

## What moves (eventually)

| Piece | Today | After cutover | Rollback |
|---|---|---|---|
| Static SPA | Vercel (Vite) | Workers Static Assets (optional) | DNS / Vercel still live |
| Planner CRUD | Supabase PostgREST + RLS | Hono `/api/data/*` + `/api/rpc/*`; owner filters in the Worker | Clear `VITE_API_BASE_URL` |
| Auth | GoTrue (Google, Apple, OTP, password) | Better Auth `/api/auth` (email OTP + verified password; signed bearer only) | Same flag flip |
| Agent / MCP | `*.supabase.co/functions/v1` | `/api/agent`, `/api/mcp` (aliases; handlers not ported yet) | Point the flag at `/functions/v1` |
| Database | Supabase Postgres + RLS | Neon via Hyperdrive | Leave Neon; app stops writing it |
| Billing / calendar / push | Supabase edge + pg_cron | **Still Supabase** except `slot-mirror`, `task-mirror`, and `push-dispatch` (Worker + Neon; same VAPID pair). Supabase copies stay until flip | n/a |

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
| `BETTER_AUTH_SECRET` | secret | Yes (32+ random bytes) |
| `BETTER_AUTH_URL` | **prod/preview var** | Preview is committed as `https://nuvo-preview.nq-morning-briefing.workers.dev`. Unset outside local → JSON 500 |
| `ENVIRONMENT` | var | `local` in `.dev.vars` for `wrangler dev`. Preview commits `preview` (OTP log path). Must not be `local` on workers.dev. Never `production` for console OTP |
| `RESEND_API_KEY` | secret | OTP email. Unset → codes logged only when `ENVIRONMENT` is `local` or `preview` — never production |
| `RESEND_FROM` | var | e.g. `Nuvo <noreply@yourdomain>` |
| `CRON_SECRET` | secret (optional) | Bearer for `/api/cron/:job`, compared in constant time. Unset or mismatch → 401. `push-dispatch` / `nuvo-push-dispatch` run; other jobs stay 501 |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | secret | **Same pair as today's Supabase function** — a new pair breaks every existing subscription |
| `TOKEN_ENC_KEY_V1` | secret | 32-byte AES-256-GCM (base64). Mirrors open sealed calendar tokens (PR A interface) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | secret | Optional until PR B. Mirror refresh when an access token has expired |
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

Set them for the run, then **delete them**:

```bash
gh secret delete SOURCE_DATABASE_URL
gh secret delete SCRATCH_DATABASE_URL
gh secret delete TARGET_DATABASE_URL
```

Values are masked (`::add-mask::`) and never echoed. A failed step's stderr is
redacted before it is printed. The custom-format dump is uploaded as a verified
backup (`pg_restore --list`, size, sha256; hash is re-checked before restore).
Auth CSVs stay on the runner and are not uploaded (PII). Per-table row counts
and ordered md5 hashes must match on every public table or the job fails.

Billing / Stripe / StoreKit stay on Supabase — this workflow does not retarget
webhooks. Nuvo stays on direct OpenAI; there is no AI Gateway in this path.

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
```

Do **not** run `wrangler deploy` without `--env preview`. Do **not** attach a
custom domain. Do **not** retarget Stripe, Apple, Google, or Resend webhooks.

---

## Crons

`vercel.json` has **no `crons`**. The Worker now has a `scheduled` handler and a
`* * * * *` Cron Trigger for **push-dispatch only** (same cadence as
`nuvo-push-dispatch`). Fan-out is a per-user SQL loop — no Queue. Flag if
account count grows past Workers Paid's included CPU.

`CRON_SECRET` is compared in constant time on `/api/cron/:job` (401 if unset
or wrong). Matching `push-dispatch` / `nuvo-push-dispatch` runs the dispatcher;
every other job still returns 501 stay-on-Supabase.

Supabase `pg_cron` stays scheduled until flip (`cron.unschedule` is reversible
via `00000000000002_cron.sql`):

| Where | What |
|---|---|
| **Worker Cron Trigger** | `push-dispatch` (VAPID web-push; same keys as Supabase) |
| **Supabase `pg_cron`** (inventory §6) | rollover, google-renew, calendar-dispatch, push-dispatch (until flip), github-poll, SQL prune/purge |
| **Vercel** | nothing scheduled |

A later cutover that wants the remaining jobs on Workers Cron Triggers still
needs a decision to stop each matching `pg_cron` job.

---

## iOS TestFlight at cutover

`.github/workflows/ios-release.yml` reads `VITE_API_BASE_URL` from a GitHub
**Actions variable** (Settings → Secrets and variables → Actions → Variables).
It does **not** skip `VITE_SUPABASE_*` — those stay baked so a rollback build
and any unported function still have a target.

| When | `VITE_API_BASE_URL` variable | What the IPA talks to |
|---|---|---|
| Before cutover (today) | unset / empty | Supabase, same as now |
| Workers preview | `https://nuvo-preview.<account>.workers.dev/api` | Worker `/api/auth`, `/api/data`, `/api/rpc`. Absolute URL — the IPA is a WKWebView loading local files, so `/api` will not resolve |
| Rollback | clear the variable | Supabase again after the next TestFlight build |

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
in the Neon rehearsal schema.

Isolation applies `worker/schema/neon.sql` onto PGlite, seeds two users, and
asserts user A cannot read/write user B. The mutation script deletes each
derived `user_id = ${store.userId}` filter and expects a failure.
