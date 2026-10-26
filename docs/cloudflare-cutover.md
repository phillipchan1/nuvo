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
| Auth | GoTrue (Google, Apple, OTP, password) | Better Auth `/api/auth` (email OTP + password) | Same flag flip |
| Agent / MCP | `*.supabase.co/functions/v1` | `/api/agent`, `/api/mcp` (aliases; handlers not ported yet) | Point the flag at `/functions/v1` |
| Database | Supabase Postgres + RLS | Neon via Hyperdrive | Leave Neon; app stops writing it |
| Billing / calendar / push | Supabase edge + pg_cron | **Still Supabase** | n/a |

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
| `HYPERDRIVE` | Worker binding | Yes for a real preview/prod Worker |
| `DATABASE_URL` | secret | Optional local fallback / seed |
| `BETTER_AUTH_SECRET` | secret | Yes (32+ random bytes) |
| `BETTER_AUTH_URL` | **prod/preview var** | Public origin, e.g. `https://nuvo-preview.<account>.workers.dev`. Unset outside local → JSON 500 |
| `ENVIRONMENT` | local `.dev.vars` only | `local` for `wrangler dev`. Must not be `local` on workers.dev |
| `RESEND_API_KEY` | secret | OTP email. Unset → codes logged (dev only) |
| `RESEND_FROM` | var | e.g. `Nuvo <noreply@yourdomain>` |
| `CLOUDFLARE_API_TOKEN` | (optional, later) | Only if someone later adds a manual deploy workflow |
| `CLOUDFLARE_ACCOUNT_ID` | (optional, later) | Same |

Client build-time:

| Name | Notes |
|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Keep until PostgREST is retired |
| `VITE_API_BASE_URL` | Empty = today's path. Worker: `/api` (same origin) or `https://<worker>/api`. iOS TestFlight reads this from a **repo variable** — see below |

Replace the placeholder Hyperdrive `id` in `wrangler.jsonc` before a real deploy.

---

## Preview on workers.dev (do not run until signed off)

This repo's `wrangler.jsonc` has an `env.preview` named `nuvo-preview` with
`workers_dev: true` and **no routes / custom domains**. Commands (for later):

```bash
# One-time: Neon project (free), Hyperdrive config, secrets
npx wrangler hyperdrive create nuvo-preview --connection-string="$NEON_DATABASE_URL"
# paste the returned id into wrangler.jsonc env.preview.hyperdrive[0].id

npx wrangler secret put BETTER_AUTH_SECRET --env preview
npx wrangler secret put DATABASE_URL --env preview   # optional if Hyperdrive is set
# then set BETTER_AUTH_URL as a Worker var to https://nuvo-preview.<account>.workers.dev

# Schema + synthetic seed (no prod data)
DATABASE_URL="$NEON_DATABASE_URL" npm run db:neon:apply
DATABASE_URL="$NEON_DATABASE_URL" npm run db:neon:seed

# Deploy ONLY the preview env (this PR does not run this)
npx wrangler deploy --env preview
```

Do **not** run `wrangler deploy` without `--env preview`. Do **not** attach a
custom domain. Do **not** retarget Stripe, Apple, Google, or Resend webhooks.

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
```

Isolation applies `worker/schema/neon.sql` onto PGlite, seeds two users, and
asserts user A cannot read/write user B. The mutation script deletes each
derived `user_id = ${store.userId}` filter and expects a failure.
