# Nuvo Cloudflare cutover + rollback

**Status:** draft rehearsal · 2026-10-26 · readiness re-read 2026-11-06 (**not yet**, below)  
**Do not deploy, change DNS, or touch prod data** until Phil signs off.

Live Nuvo is hosted on Cloudflare since 2026-11-06 (`nuvo-app` / `nuvo-site`,
[`cloudflare-hosting.md`](./cloudflare-hosting.md)), but every shell still talks to Supabase
for auth, data, realtime, edge functions and `pg_cron`. The `nuvo` API Worker
(api.nuvo.day) is inert unless a build sets `VITE_API_BASE_URL`.

Sister inventory: [`cloudflare-migration/inventory.md`](./cloudflare-migration/inventory.md).
Access matrix (Neon has no RLS): [`cloudflare-migration/access-audit.md`](./cloudflare-migration/access-audit.md).
Cutover-night route table: [`cloudflare-migration/route-inventory.md`](./cloudflare-migration/route-inventory.md).
Pre-flip billing read: [`cloudflare-migration/billing-live-check.md`](./cloudflare-migration/billing-live-check.md).
Source auth readers (already on prod): [`cloudflare-migration/migration_tmp.sql`](./cloudflare-migration/migration_tmp.sql).
Shape follows `phillipchan1/zeroed` PRs #11–#13.
Client data calls → Worker routes: [`cloudflare-migration/client-data-inventory.md`](./cloudflare-migration/client-data-inventory.md).

---

## Readiness — 2026-11-06: **not yet**

Read against `master` at `99474c1`, plus read-only checks of the live Cloudflare account
(`wrangler deployments list` / `versions list` / `secret list` / `hyperdrive get` /
`queues info`, and unauthenticated `curl`s of api.nuvo.day and the preview). Nothing was
deployed, set or written. **Verdict: not yet.** The client seam works (driven 2026-10-29),
and the data copy is rehearsed (a 2026-10-30 dry run passed, recorded in the still-open
PR #128). But the Worker that would serve the flip isn't deployed, can't be deployed from
master as configured, and would refuse the real app's origins if it were. Billing acts
and two of three sign-in doors also break at the flip. All of these are ordinary work,
and none of them is a design unknown, except realtime.

### Code update — 2026-11-06, branch `claude/affectionate-hellman-1dcca2`

Every non-billing code blocker below is **closed in code** on this branch, one commit per
item, nothing pushed or deployed. What's left is live work, in order, in
[§ Phil's go list](#phils-go-list) at the end of this doc. Billing (12, plus the
`/api/entitlement` CORS in 9) belongs to the parallel billing session and isn't touched here.

| Item | Commit | Evidence |
|---|---|---|
| 9b Auth CORS | `6ce0c84` | `authUrl.check.ts`: every shell is echoed, look-alikes are refused, and the CORS list and Better Auth's list are the same |
| 11 Queues | `7061d23` | `tests/wrangler-queues.test.ts`. Both `wrangler deploy --dry-run`s bind their own queue |
| 8 Sign-up FK | `c66a070` | **Driven:** the workflow's own `dump` → `restore` from local Supabase under `wrangler dev`, before (409, FK) and after (200, writes) |
| 10 Bearer | `6c18dc3` | **Driven:** OTP sign-in in the dev app, then a fresh tab (empty `sessionStorage`) stays signed in |
| 2, 2b Google + Apple | `1029c85` | `tests/signin-door.test.ts` (14 cases). **Driven:** the dev app goes through the door and back |
| 13 Armed build | `c53e687` | `tests/armed-build.test.ts`. Allowlist re-pinned |
| 7 `field_ts` | `f1b791a` | **Driven:** a fresh copy, then `POST /api/rollover` stamps the fields it moved |
| 4 Realtime | — | Not now (Phil, 2026-11-06). Ships with focus convergence; a post-cutover follow-up |

**Gate state on this branch:** `npm run typecheck`, `typecheck:worker` and every
`check:worker` script are clean, apart from two failures that **predate this branch**
(reproduced on `59a41a7` with these changes stashed):
- `accessHttp.check.ts` "B entitlement: live trial is entitled": the fixture's trial date
  has expired. This is the billing session's area.
- `guard-public-ci.test.ts` "checks.yml renamed to checks.YML": it assumes a case-sensitive
  filesystem. macOS isn't one, and Linux CI is.

`check:worker` chains with `&&`, so locally it stops at the first of those, and the scripts
after it only ran individually.

Local-drive caveat: `miniflare.seq.check.ts` re-applies `neon.sql` to the Hyperdrive local
string (`127.0.0.1:5432/nuvo`). If a scratch restore is sitting in that database, the check
overwrites it, so drive copies in a differently named database.

### What is actually live

| Thing | What it is | Evidence |
|---|---|---|
| Worker `nuvo` (api.nuvo.day) | **A stub, not master.** Its last code upload was **2026-10-27 20:48Z**. Ten secret-only versions followed, the last on 2026-10-29. Every `/api/*` path answers `{"backend":"supabase"}`: `/api/health` returns the maintenance body, `/api/rest/v1/*` returns 404, and `/api/auth/*` returns 404 with `ACAO: *`. That string isn't in any branch of this repo, so this checkout can't say which source it came from | `wrangler deployments list --name nuvo`; `curl` |
| Worker `nuvo-preview` | The 2026-10-26 build. `/api/maintenance` and `/api/rest/v1/*` both return the SPA's HTML | same |
| `nuvo-app` / `nuvo-site` | Static hosting, deployed from master today | same |
| Hyperdrive `nuvo-neon` | `caching.disabled: false`, origin `neondb`, 60 origin connections | `wrangler hyperdrive get` |
| Queue `nuvo-calendar-sync` | **Does not exist** | `wrangler queues info` |
| Repo variables | **None set.** `VITE_API_BASE_URL` is empty, so every build targets Supabase | `gh variable list` |

### The 2026-10-29 list, re-checked on master

| # | Item | Now | Where |
|---|---|---|---|
| 1 | SPA never calls the Worker | **Closed in code** (#127, D-174). The residual is still open: the preview is the 10-26 build, and prod `nuvo` is a stub (above) | `src/lib/workerRoute.ts`, `workerSession.ts` |
| 2 | Google sign-in not ported | **Closed in code (2026-11-06); console step on the go list.** Better Auth now wires Google (`googleSocialProvider`, `auth.ts`) with `prompt: "select_account"` (D-126), on the same `GOOGLE_CLIENT_ID` / `_SECRET` the calendar connect uses. Every shell signs in through **the sign-in door** (`worker/src/signinDoor.ts`): a top-level `GET /api/signin/google?return=<shell origin>` → Google → Better Auth's callback → `/api/signin/return` → `<shell>/#nuvo_ott=<one-time token>`, which the SPA redeems for the signed bearer (`src/lib/authReturn.ts`, `useAuth`). **Why a door:** Better Auth refuses a callback without its signed state cookie, and a cookie set by a cross-origin fetch is third-party, which WKWebView drops, so #120's client-side `signIn.social` could never finish on Mac or iOS. The door makes every cookie first-party, and the token rides in the fragment, single-use, hashed at rest, 3 minutes. `return` must be a trusted shell origin (no open redirect). Linking goes through the same door with a one-time token, never a bearer in a URL. **Existing users keep their account:** the copy's `account` rows carry the Google `sub` and the same user id; an email-only account links by provider-verified email; an unverified email never adopts one. `tests/signin-door.test.ts` drives all of it (real Hono app + Better Auth over PGlite, Google's token endpoint faked), including both shells' return legs. **Driven** in the dev app against `wrangler dev`: Continue with Google → door → back on the login with the door's message (Google unconfigured locally), fragment gone. Also fixed on the way: `exposeSignedAuthToken` rewrote *any* JSON `token` into the session bearer, which would have handed the shell its bearer instead of the one-time token; it now rewrites only session bodies. **Not driven:** a real Google consent (needs the redirect URI, go list) | `auth.ts`, `signinDoor.ts`, `googleAuth.ts`, `authReturn.ts` |
| 2b | *(new)* Apple sign-in is off too | **Closed in code (2026-11-06); secrets + console on the go list.** The provider registers once `APPLE_CLIENT_ID` (Services ID) and a client secret exist. The secret no longer has to be a hand-rotated ≤6-month JWT: without `APPLE_CLIENT_SECRET`, the Worker mints one from the SIWA key it already needs for revocation (`APPLE_SIWA_TEAM_ID` / `_KEY_ID` / `_PRIVATE_KEY`; `primeAppleClientSecret`, cached a week per isolate). The id-token audience accepts the Services ID and the bundle id, so native iOS (`ASAuthorizationController` → `signIn.social({ idToken })`, raw nonce; Better Auth compares `exact-or-sha256`) and the web redirect both verify. The web/desktop redirect and Apple linking go through the same door as Google. Tests: minted-secret shape, explicit-secret precedence, the door's `form_post` authorize URL, and the unconfigured message | `auth.ts`, `appleAuth.ts` |
| 3 | Desktop build never gets the flag | **Closed** (#127): `release.yml:173`, `ios-release.yml:204`, and now `cloudflare-hosting.yml:56` read `vars.VITE_API_BASE_URL`. #118 (a hard-coded literal plus #117's runtime flip) is still open, and #117 is closed, so #118 should be closed as superseded | workflows |
| 4 | Realtime has no Worker path | **Not now (Phil, 2026-11-06). Post-cutover follow-up.** The flip ships with focus convergence: `useRealtime.ts:51` skips when the flag is on, and other devices catch up on window focus (15s stale). The Durable Object design (§ Not ready to flip, item 4) is the follow-up. It is not a flip blocker | `useRealtime.ts` |
| 5 | Hyperdrive caches queries | **Open.** Verified live: caching is enabled. `rest.ts` reads are safe because they call `now()`. Agent, day, mirrors and `/api/data` reads are not | `wrangler hyperdrive get` |
| 6 | Worker secrets missing | **Open.** Missing: `GOOGLE_CLIENT_SECRET` (rotates in the freeze, by design), the whole Apple set (`APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET`, `APPLE_SIWA_*`), and `MS_*`. Present: 15 names, matching § Key rotation | `wrangler secret list` |
| 7 | Non-SPA writers don't stamp `field_ts` / `updated_at` | **`field_ts` closed in code, driven (2026-11-06).** Supabase already solved this with one trigger, `stamp_unstamped_field_ts` (migration 65): a column whose value changed but whose stamp didn't gets `now()`. The copy was dropping it (`pg_restore` skips every trigger and function). It's back as **one definition**, `worker/schema/field-ts.sql`, with the same name and body (a test pins it to migration 65 verbatim). The copy installs it right after the restore and dies if any `field_ts` table is left without it; `apply-neon-schema.mjs` applies it too, and it skips tables with no `field_ts`. **Deviation from the brief, on purpose:** the brief asked for a `stampFieldTs` helper called from each writer. There are ~40 hand-written writes to these tables (`store.ts`, `cronJobs.ts`, capture, inbound, agent, mirrors), so a helper would be one rule copied 40 times, and the next writer would forget it. The trigger covers them all, including future ones, and leaves client stamps alone (`rest.ts`, `apply_patch`). **Driven:** a fresh copy (14 triggers installed), a fresh sign-up under `wrangler dev`, then `POST /api/rollover`. That moved `do_date` and stamped `do_date` and `roll_count` with now, and left the client-stamped `title` untouched. `tests/field-ts-stamp.test.ts` runs the real `store.ts` writers and the rollover cron through it. `updated_at` is still hand-written per writer (unchanged) | `field-ts.sql`, `cutover-migrate.yml` |
| 8 | Post-flip sign-up hits `user_settings_user_id_fkey` | **Closed in code, driven (2026-11-06).** The copy now repoints every `public` FK on `auth.users(id)` at `public.users(id)` right after `PUBLIC_USERS_SQL` (`REPOINT_OWNER_FKS_SQL` in `scripts/cutover_copy.py`), keeping each constraint's name and `ON DELETE` / deferrable clauses, and dies if one is left. **Why the copy, not a `user.create` hook:** `public.users` is already the planner owner on a fresh Neon (`neon.sql`) and is what `bootstrapUser` writes, so the copied database ends with the same shape instead of keeping a fake Supabase `auth.users` alive forever; and Better Auth's `"user".id` is `TEXT` while planner `user_id` is `UUID`, so pointing FKs at `"user"` isn't possible without retyping every table. **Driven:** the workflow's own `cutover.py dump` → `restore` (extracted verbatim) from the local Supabase stack into a scratch Postgres 17, once from `HEAD~` and once with the fix, each under `wrangler dev`: the old restore 409s a fresh OTP sign-up's first read and first write with `23503 … user_settings_user_id_fkey`; the new one returns 200 and writes `user_settings`, 4 default domains and a task. A copied account (`dummy@nuvo.test`) still resolves to its original id. `tests/cutover-owner-fk.test.ts` (PGlite) pins the failure, the fix, idempotence and the refusal of a non-`id` FK. **Note for A8:** the trial row on sign-up is still the billing session's `user.create` hook | `cutover_copy.py`, `cutover-migrate.yml` |
| 9 | `/api/entitlement` CORS | **Open.** It answers `OPEN_CORS` (`ACAO: *`) to a `credentials: "include"` fetch (`entitlementRead.ts:144`). The fix (`reflectAllowOrigin`) exists only in #120 | `index.ts:255–273` |
| 9b | *(new, bigger)* **Auth CORS refuses every real origin** | **Closed in code (2026-11-06).** `trustedAuthOrigins` (`cors.ts`) now lists the auth origin, `APP_URL`, `https://app.nuvo.day`, `tauri://localhost` (Mac **and** iOS: Tauri v2 uses that scheme on both WKWebView shells) and Phil's workers.dev previews (`nuvo-app`, `nuvo-app-preview`, `nuvo-preview`, and `*-nuvo-app` version URLs; a `*` never spans a dot). **One list feeds both** the CORS echo and Better Auth's own `trustedOrigins`, so they cannot disagree. Loopback stays local-only. `authUrl.check.ts` asserts the echo for each shell, the refusal of look-alikes (`app.nuvo.day.evil.example`, `http://app.nuvo.day`, `tauri://evil`, a dotted wildcard), and that Better Auth's context carries the same strings. Not yet driven from a built Mac (B3) | `cors.ts`, `auth.ts` |
| 10 | Bearer in `sessionStorage` | **Closed in code (2026-11-06).** `authClient.ts` keeps the signed bearer in `localStorage` (where GoTrue's session already lives, so no new exposure), adopts a bearer an older build left in `sessionStorage` once, clears both on sign-out, and re-reads the session when another tab signs in or out (`storage` event). `tests/auth-bearer-storage.test.ts` simulates the relaunch (sessionStorage wiped, module reloaded) and the legacy adoption. **Still to drive on a built Mac and TestFlight (B3)** — a jsdom relaunch is not WKWebView | `authClient.ts` |
| 11 | *(new)* **Master can't deploy to `nuvo`** | **Closed in code (2026-11-06); the queues are a live step.** Preview now produces to and consumes its own `nuvo-calendar-sync-preview`; prod keeps `nuvo-calendar-sync`. `tests/wrangler-queues.test.ts` fails if any two environments consume the same queue or an environment consumes a queue it doesn't produce to. Both `wrangler deploy --dry-run` and `--env preview --dry-run` bind the right queue. **Still needed, Phil's go list G1:** `npx wrangler queues create nuvo-calendar-sync` and `npx wrangler queues create nuvo-calendar-sync-preview` — `wrangler deploy` does not create them | `wrangler.jsonc` |
| 12 | *(new)* **Billing acts break at the flip** | **Open.** `workerRoute.ts` leaves `stripe-checkout`, `stripe-portal`, `apple-iap`, `referral-code` and `iap-catalog` on Supabase, which now receives a Better Auth bearer that GoTrue rejects. So checkout, portal, StoreKit confirm and referral would 401 (#120's own description). A post-flip sign-up also never fires Supabase's `handle_new_user`, so it gets no `subscriptions` row and, inferred, no trial. #120 fixes both (`billingProxy.ts`, `ensureDefaultSubscription`) but is **CONFLICTING**. It's 80+ files and still carries #117's runtime-flip and `workerData.ts`, which D-174 superseded | `workerRoute.ts:19–27`, PR #120 |
| 13 | *(new)* **The armed build can't be shipped** | **Closed in code (2026-11-06); setting the variables is the go list.** `cloudflare-hosting.yml`, `release.yml` and `ios-release.yml` now pass `VITE_MAINTENANCE_URL` and `VITE_CUTOVER_ARMED` from repo **variables** beside `VITE_API_BASE_URL`; unset is today's build. `tests/armed-build.test.ts` fails if any build workflow drops one or reads it from `secrets.*`. Public-CI allowlist re-pinned (`regen-public-ci-allowlist.mjs`); `guard-public-ci.test.ts` is green except its macOS-only case-folding case (pre-existing, below). **Order matters:** an armed build fails *closed* when the maintenance URL is unreachable, so the real Worker must be deployed (G8) before the variables are set (G10), and `VITE_CUTOVER_ARMED` is cleared after the 24h watch (G12) | workflows |
| 14 | *(new)* **External callers still dial Supabase** | **Open, runbook only.** Resend's inbound webhook, MCP connectors and capture tokens people have already pasted, and Google push channels all point at `ebibzojtkzkphykznomv.supabase.co/functions/v1/*`. Google is handled by `google-resubscribe`. The others need a retarget and a re-copy, and Supabase's non-billing functions need to **stay** 503 (`WRITE_FREEZE`) after the switch, so a stale caller fails loudly instead of writing to the abandoned database | `route-inventory.md` §2 |

### Blockers in order, with an estimate

The estimates are engineering-time guesses, not measurements. Every "deploy" or "set" step
needs Phil's yes.

| Order | Blocker | Work | Est. |
|---|---|---|---|
| 1 | Auth CORS + entitlement CORS (9, 9b) | Allow `https://app.nuvo.day`, `tauri://localhost` and the preview hosts in `trustedAuthOrigins`, reflect them on `/api/entitlement`, and drive a flag-on build from app.nuvo.day-preview **and** a built Mac | 0.5–1 day |
| 2 | Deployable Worker (11, 1-residual) | Create `nuvo-calendar-sync`, give preview its own queue, then deploy preview and prod from master. Both stay inert (`CUTOVER_FLIPPED` unset, no client pointed at them) | 0.5 day |
| 3 | Billing at the flip (12) | Re-cut #120 down to the billing proxy, the subscription seed and `reflectAllowOrigin`, on top of D-174. Then run [`billing-live-check.md`](./cloudflare-migration/billing-live-check.md) | 1–2 days |
| 4 | Sign-up FK (8) | Repoint the planner FKs at Better Auth's `"user"(id)` in the copy (one migrate step), or insert the stub row in a `user.create` hook. Then drive a fresh OTP sign-up | 0.5 day |
| 5 | Session survives relaunch (10) | Move the signed bearer to `localStorage`, which is where GoTrue's session lives today, so no new exposure. Prove it on a built Mac and a TestFlight build | 0.5 day |
| 6 | Sign-in doors (2, 2b) | **Phil decides** (below). OTP-only means hiding the Google/Apple buttons when the flag is on: 0.5 day. Porting Google means a Worker provider, a GCP redirect URI for `api.nuvo.day/api/auth/callback/google`, and the Tauri return leg: 1–2 days. Apple needs a SIWA key, the JWT secret (≤6-month expiry) and the secrets: 0.5–1 day | 0.5–3 days |
| 7 | Armed build (13) | Pass `VITE_MAINTENANCE_URL` / `VITE_CUTOVER_ARMED` through `cloudflare-hosting.yml` + `release.yml` (+ iOS), and re-pin the guard allowlist | 0.5 day |
| 8 | Hyperdrive cache (5) | `wrangler hyperdrive update 2c52343139524c4e9ba39f8c1c9b0795 --caching-disabled true` | 5 min |
| 9 | `field_ts` on server writes (7) | One `stampFieldTs` helper, called from `store.ts`, `cronJobs.ts`, capture, inbound and the agent. **Or** accept it (decision below) | 1 day |
| 10 | Realtime (4) | **Phil decides.** Ship with focus convergence, or build the Durable Object design in item 4 below | 0 or 2–3 days |
| 11 | External callers (14) | A flip-night step, not code: retarget Resend's inbound webhook to `https://api.nuvo.day/functions/v1/inbound-email`, and tell MCP / capture users to re-copy their URLs (Settings → Apps already shows the Worker URL when the flag is on) | 1 hr |
| — | Housekeeping | Merge #128 (the 10-30 dry run). Close #118 as superseded by D-174. Delete the retired box secret files | — |

**Total before a flip:** about 5–8 days of work, plus one rehearsal on preview with a real
Mac and phone. That figure assumes OTP-only sign-in, no realtime, and the `field_ts`
fix. Porting Google, Apple and realtime adds up to about 6 more. Getting fully off Supabase
adds billing (A8–A9 below, about 4.5–6.5 days). The full code list is § Port plan to zero Supabase.

### What still needs Supabase after the flip

Phil's goal is to be **completely off Supabase and Vercel**, to save money. The flip
alone doesn't do that. This is every Supabase dependency that's left after step 9,
read from the repo and from `supabase functions list --project-ref ebibzojtkzkphykznomv`
(36 functions deployed).

| Dependency | What it is today | Work to port it | Est. |
|---|---|---|---|
| **Stripe:** `stripe-checkout`, `stripe-portal`, `stripe-webhook`, `referral-code` | Edge functions. Stripe's **live** webhook endpoint is `ebibzojtkzkphykznomv.supabase.co/functions/v1/stripe-webhook` ([`billing-setup.md`](./billing-setup.md) §3) | Port all four to the Worker, writing Neon. Move `STRIPE_*` secrets to `nuvo`. Add a **new** live webhook endpoint on api.nuvo.day, then retire the old one only after the new one has seen an event, because Stripe allows several endpoints | 2–3 days |
| **App Store:** `apple-iap`, `apple-webhook`, `iap-catalog` | Edge functions. App Store Server Notifications V2 points at a `supabase.co` URL (`billing-setup.md` §11) | Port them to the Worker. Change the production **and** sandbox notification URLs in App Store Connect, and move the Apple IAP secrets | 2–3 days |
| **Billing tables:** `subscriptions`, `stripe_webhook_events`, `apple_webhook_events`, `apple_notification_events`, plus `entitled()` / `plan()` / `billing_source()` | Excluded from the copy and the freeze on purpose. The Worker reads `subscriptions` over HTTPS with the service-role key (`entitlement.ts`) | Add the four tables to `neon.sql` and do a one-off frozen copy at the billing switch. Make `entitled()` a Worker function, and point `/api/entitlement` at Neon. Then delete `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` from `nuvo` | 1 day |
| **Orphan functions** `apple-notifications`, `apple-verify` | Deployed on Supabase, **not in this repo**. Migration 70 names `apple-notifications` as Apple's writer, so **which URL App Store Connect actually calls is unverified** | Check App Store Connect's URL before porting. Delete whichever one is unused | 1 hr |
| **Stale-caller freeze** (every non-billing function, `WRITE_FREEZE`d) | Kept after the flip on purpose, so old builds and pasted URLs get a 503 | Delete them after the 24h window, and once the last pre-flip Mac/iOS build is gone | 1 hr |
| **Webhooks / redirect URIs on `supabase.co`** | Resend inbound (step 7). Google push channels (`google-resubscribe`, step 8). **OAuth redirect URIs:** the Google Cloud client and the Azure (M365) app list `…supabase.co/functions/v1/google-oauth` / `m365-oauth` and Supabase Auth's callback. What's registered there is **unverified**: the consoles weren't opened | Add `https://api.nuvo.day/functions/v1/google-oauth` and `…/m365-oauth` **before** the flip, or calendar connects fail. Drop the Supabase ones afterwards | 1 hr |
| **Supabase Auth providers** (Google, Apple, email) | GoTrue holds the providers and the login. Unused once the flag is on | Nothing to port beyond blockers 4–6. Leave them in place until the rollback window closes | — |
| `pg_cron` | All nine jobs have Worker twins. They're unscheduled at step 8 | Done at the flip | — |
| Storage / Vault / Realtime | No buckets (`inventory.md` §1). Vault tokens are re-sealed into Neon by the copy. Realtime is replaced by focus refetch, or by the Durable Object | Done at the flip, or by blocker 10 | — |
| **Calendar sync** (Google, M365, iCloud, ICS) | **Already ported** (#106 `98913a8`, #107; `worker/src/calendar/http.ts`, `google/routes.ts`; the queue consumer polls all four). The "What moves" row that kept non-Google calendar on Supabase was stale and is fixed below. M365 still needs `MS_CLIENT_ID` / `MS_CLIENT_SECRET` on `nuvo` (decision 5) | Secrets plus the redirect URI above | 1 hr |

**Off Supabase entirely = the flip (about 5–8 days) + billing (about 5–7 days) + an
hour of console work**, plus one frozen billing copy. Billing can go on a later night,
but it is the only thing left that keeps the Supabase project alive.

#### Monthly cost, before and after

Verified means read today from a CLI. Everything else is marked.

| Line | Before | After everything moves | Status |
|---|---|---|---|
| Supabase | Nuvo is one of **8 projects** in org `pcmiozuynhgglvgrgwik`. 7 are `ACTIVE_HEALTHY`: zeroed, LeadWell, drove-dev, dayspring, nuvo, drove, mathy (Melu is inactive). Free allows 2 active projects, so the org is on a paid plan (**inferred**). The plan and Nuvo's compute add-on are **unverified**: reading them needed the CLI's raw token, which this session wasn't allowed to use | Deleting the `nuvo` project removes **only its own compute line**. On Pro, list price is roughly $10/mo for a Micro instance (**unverified**; check the org's billing page). **The org fee stays as long as the other six active projects do**, so moving Nuvo alone doesn't end the Supabase bill | project list **verified**, prices **unverified** |
| Neon | Project `nuvo` (`frosty-snow-66931204`) is in org `Phil` on plan **`free`** (`free_v3`), with a branch limit of 1 GB logical size | Stays $0 if prod fits Free. The 10-28 dump was 2.6 MB. Free autosuspends, so the first request after idle pays a cold start (§ Free-tier risk) | **verified** (plan) |
| Cloudflare Workers | `nuvo-app` / `nuvo-site` / `nuvo` / `nuvo-preview` exist. Whether the account is already on Workers Paid is **unverified**: no queues exist, and no plan call was made | **Workers Paid, $5/mo, is required.** `wrangler.jsonc` declares 8 cron triggers, a Queue and the agent's CPU work, which exceeds Free's limits on cron count (5) and per-request CPU (10 ms) per Cloudflare's published limits. Hyperdrive is included | requirement from code, **account plan unverified** |
| Vercel | Projects `nuvo` / `nuvo-site` still build from master as the hosting rollback ([`cloudflare-hosting.md`](./cloudflare-hosting.md)). The plan is **unverified** (no `vercel` CLI here) | $0 once both projects are deleted, after the hosting rollback window | **unverified** |
| Unchanged | Resend, OpenAI, Apple Developer, Stripe fees | Same | — |

Net, for Nuvo alone: **about −$10/mo of Supabase compute (unverified) +$5/mo Workers Paid
(unless already paid) − whatever Vercel costs today**. The large saving, the Supabase org
fee, only arrives when the other six active Supabase projects leave too. That's outside
this repo and worth deciding before treating "off Supabase" as the reason for this cutover.

#### Every Supabase function against its Worker twin

For each of the 34 functions under `supabase/functions/`, `worker/src` was searched for a
route registered under the same name (`index.ts`, `google/routes.ts`, `calendar/http.ts`).
`workerRoute.ts` maps `/functions/v1/<name>` to the Worker for every name except the
billing set.

| Has a Worker twin (27) | No twin (7, all billing) |
|---|---|
| `agent`, `mcp`, `capture`, `day`, `inbound-email`, `route-events`, `rollover`, `slot-mirror`, `task-mirror`, `push-dispatch`, `github-activity`, `apple-identity`, `delete-account`, `calendar-refresh`, `google-oauth` / `-sync` / `-events` / `-contacts` / `-webhook`, `m365-oauth` / `-sync`, `icloud-connect` / `-sync` / `-events` / `-contacts`, `ics-subscribe` / `-sync` | `stripe-checkout`, `stripe-portal`, `stripe-webhook`, `apple-iap`, `apple-webhook`, `iap-catalog`, `referral-code` |

Two loose ends:
- `apple-notifications` and `apple-verify` are deployed on Supabase but aren't in the repo.
- `blocked.ts` still lists `apple-identity` / `delete-account` as blocked, but `index.ts`
  registers both directly (#104). The set is stale, and nothing is broken by it.

**Non-Google calendar is fully ported** (#106, `98913a8`). `calendar/http.ts` serves
`m365-oauth`, `icloud-connect`, `ics-subscribe` and `icloud-events`, including iCloud
write-back. The queue consumer (`cronJobs.ts:299–350`) polls **all four** providers,
plus iCloud contacts. This used to say "others ack", and that line is fixed below.
M365 still needs `MS_CLIENT_ID` / `MS_CLIENT_SECRET` on `nuvo` and the Azure redirect URI.

**Client auth calls with no Better Auth path** (small): ~~`linkIdentity` for Google and Apple
in Settings~~ (now through the sign-in door, 2026-11-06), and `onAuthStateChange` listeners in `useSubscription` / `SettingsModal`.
`workerSession.ts` covers only `getSession` / `getUser`. Sign-in, OTP, password and
sign-out are already flag-gated (`authActions.ts`, `appleAuth.ts`).

### Port plan to zero Supabase

**Billing is now in scope** (Phil, 2026-11-06: "I want to port everything over"). That
replaces #120's approach (the Worker proxying to Supabase billing functions): close #120
once the port below lands. A separate session may own the billing port, and this report
only describes it.

**A. Code only. Safe to start now.** The Worker stays inert, because `CUTOVER_FLIPPED` and
`VITE_API_BASE_URL` stay unset.

| # | Work | Est. |
|---|---|---|
| A1 | Auth and entitlement CORS for `app.nuvo.day`, `tauri://localhost` and the preview hosts (blockers 9, 9b) | 0.5–1 d |
| A2 | `wrangler.jsonc`: give preview its own queue name (blocker 11; creating the queue is B1) | 1 hr |
| A3 | Sign-up FK: repoint the planner FKs at Better Auth `"user"(id)` in the copy (blocker 8) | 0.5 d |
| A4 | Signed bearer moved to `localStorage` (blocker 10) | 0.5 d |
| A5 | Sign-in doors: hide Google/Apple when the flag is on, or port them. Also give account linking a Better Auth path or hide it | 0.5–3 d |
| A6 | Armed-build plumbing in the three build workflows, plus a guard re-pin (blocker 13) | 0.5 d |
| A7 | `stampFieldTs` for server writers (blocker 7) | 1 d |
| A8 | **Billing on the Worker + Neon.** (1) The four billing tables, plus `entitled()` / `plan()` as Worker functions, go into `worker/schema/neon.sql`. (2) Port all 7 functions over Neon: Stripe signature verify, the `stripe_webhook_events` / `apple_webhook_events` idempotency claims, App Store JWS verification, `iap-catalog` and `referral-code`. Bring the `supabase/functions/_shared` billing helpers across the way the kernel is shared, never as a second copy. (3) `/api/entitlement` reads Neon, and `SUPABASE_URL` / `SERVICE_ROLE_KEY` leave `nuvo`. (4) A Better Auth `user.create` hook seeds the trial row. (5) `workerRoute.ts` drops `SUPABASE_ONLY_FUNCTIONS`, so every function name routes to the Worker. Tests: signature, replay, `entitled()` parity against today's SQL, and the trial on sign-up | 4–6 d |
| A9 | `cutover-migrate.yml` / `freeze.sql` / parity: **stop excluding** the billing tables, so they freeze and copy with everything else. `checks.yml` guard re-pin | 0.5 d |
| A10 | Realtime Durable Object, if Phil chooses it | 2–3 d |
| A11 | Tidy-up: `blocked.ts` sets, the stale runbook lines, and closing #118 / #120 | 1 hr |

That's about **9–14 days**, depending on A5 and A10.

**B. Live, and each step needs Phil's go.** In order.

| # | Step | Reversible? |
|---|---|---|
| B1 | Create the queues, disable the Hyperdrive cache, and set the missing `nuvo` secrets: Apple, `MS_*`, Stripe **live** secret + webhook secret, App Store keys. Deploy `nuvo-preview` and `nuvo` from master, still inert | yes |
| B2 | Add the `api.nuvo.day` redirect URIs to the Google Cloud client (`google-oauth`, and `/api/auth/callback/google` if A5 ports Google) and the Azure app (`m365-oauth`). Add, don't replace | yes |
| B3 | Rehearse on preview: a flag-on build from a browser, a Mac and TestFlight. A Stripe **test-mode** endpoint pointed at the preview Worker, and StoreKit sandbox. Never the live account | yes |
| B4 | `cutover-migrate` dry run with the billing tables included, plus the token go/no-go | yes (scratch only) |
| B5 | **Flip night:** the order above (steps 0–9), with billing now inside the freeze. At the switch, add a **new** Stripe live webhook endpoint on api.nuvo.day and **disable** the Supabase one. Change App Store Server Notifications (production + sandbox) to the Worker. Then **reconcile** any billing events that hit the frozen Supabase endpoint during the window: Stripe's event list or a subscription re-read, and App Store "Get Notification History". Whether Apple retries a failed notification to the *new* URL is **unverified**, which is why the reconcile is a step and not an assumption | until the copy: unfreeze. After: rollback loses Neon-side writes |
| B6 | After 24h: delete the frozen Supabase functions and the old Stripe endpoint, and confirm Apple's URL | — |
| B7 | **End of the rollback window** (Phil picks it; two weeks suggested): `pg_dump` Supabase one last time to the Mac (never CI, since the repo is public). Then pause or delete the `nuvo` project. Whether a project in a paid org can be paused is **unverified**. Deleting stops its compute billing | delete is **not** reversible |
| B8 | Delete the Vercel projects `nuvo` / `nuvo-site` once the hosting rollback window ends ([`cloudflare-hosting.md`](./cloudflare-hosting.md)) | not reversible |
| B9 | Code, after the last pre-flip build has aged out: drop `VITE_SUPABASE_*` and supabase-js from the bundle. Until then the client keeps the Supabase URL only as the key `workerRoute.ts` matches on, and nothing dials it | — |

### What Phil must decide

1. **Sign-in at the flip.** OTP-only (recommended for the flip: Google- and Apple-only
   users type their own address and land in the same account, because the copy keeps
   their email and id), or port Google and/or Apple first. Google *calendar* connections
   are separate (`calendar_accounts` tokens) and survive either way.
2. **Realtime.** Accept "other devices catch up on focus" for the first weeks, or build the
   Durable Object first.
3. ~~**Billing stays on Supabase for a while.**~~ **Decided 2026-11-06: port it** (Phil:
   "I want to port everything over"). Open: does billing move on flip night (A8 + A9 done
   first) or on a second, smaller night?
4. **`field_ts` on server writes.** Fix it before the flip (recommended, about 1 day), or
   accept that an older offline edit can overwrite an agent, capture or rollover write.
5. **M365.** `MS_*` isn't carried over, so any M365 calendar stops syncing at the flip.
   Carry it, or tell those users.
6. **Flip model.** The repo variable (D-174, #127, what's on master) or #118's literal plus
   runtime flip. Master has already chosen the variable. Closing #118 makes that official.
7. **The other six Supabase projects.** Nuvo is going fully off. But the org bill only ends
   when zeroed, LeadWell, drove-dev, dayspring, drove and mathy leave too. That's outside
   this repo.

### Flip-night order (once 1–9 are green)

Before the night: all fixes merged, prod and preview deployed and still inert, Hyperdrive
cache off, a flag-on build driven on preview from a browser, a Mac and a phone, the
billing live-check done, and a fresh `cutover-migrate` dry run with the token go/no-go.

0. **Ship the armed build.** Set `VITE_MAINTENANCE_URL=https://api.nuvo.day/api/maintenance`
   and `VITE_CUTOVER_ARMED=1` (needs blocker 7), then let it reach the PWA (master
   deploy), the Mac (auto-update) and TestFlight. Allow time for Macs to update.
1. **Preflight** the edge secrets (`preflight-edge-write-freeze.mjs`).
2. **Arm.** `CUTOVER_ARMED=1` + `MAINTENANCE_WRITE_FREEZE=1` on `nuvo`, and
   `WRITE_FREEZE=1` on Supabase's non-billing functions.
3. **Freeze.** Apply `freeze.sql` by hand. This revokes client writes and pauses every
   `nuvo-*` job.
4. **Rotate the Google client secret** (§ Key rotation) on both sides.
5. **Copy.** `cutover-migrate` `mode=cutover`: snapshot → copy → verify → first resync.
   Then the `TOKEN_ENC_KEY_V1` go/no-go against `neondb`.
6. **Switch.** In one sitting: set the repo variable
   `VITE_API_BASE_URL=https://api.nuvo.day/api`, replace the repo secret
   `VITE_VAPID_PUBLIC_KEY` with the D-173 key, then dispatch `cloudflare-hosting`,
   `release` and `ios-release`. Clear `MAINTENANCE_WRITE_FREEZE` and `CUTOVER_ARMED` on
   `nuvo`. **Leave Supabase frozen**: don't apply `unfreeze.sql`, and keep `WRITE_FREEZE`.
7. **Retarget** Resend's inbound webhook to the Worker, and post the "re-copy your MCP /
   capture URL" note.
8. **Flip crons.** `cron.unschedule` all nine `nuvo-*` jobs, run the final `phase=resync`,
   set `CUTOVER_FLIPPED=1`, `POST /api/cron/google-resubscribe`, then confirm per
   § Flip runbook step 4.
9. **Watch for 24h.** Sign in on each shell, check one paid account's entitlement, and do
   one checkout in Stripe test mode on preview (never live). Rollback is clearing the
   repo variable, re-dispatching the three builds and applying `unfreeze.sql`. Writes made
   on Neon meanwhile don't come back. Neon is left as it is, never reset.

Not checked here: whether an un-updated device's outbox replays its frozen-window edits
to the Worker after it updates, and whether Better Auth's origin check 403s a bearer-only
POST from a foreign origin. Drive both on preview.

---

## Not ready to flip (found 2026-10-27 · updated 2026-10-29)

Items 1–6 were read from the code while setting the Worker's secrets. On 2026-10-29,
items 1, 8 and 9 were driven in the dev app against a local `wrangler dev` on a Postgres
restored the way `cutover-migrate.yml` restores (public schema + data, no
functions/triggers/policies, `auth` stub); 3 and 4 changed in code; 5, 7 and 10 were read.

1. ~~**The SPA never calls the Worker's data API.**~~ **Closed** (client-data-inventory.md).
   With `VITE_API_BASE_URL` set, the supabase client's own `fetch` re-points `/rest/v1/*`
   and `/functions/v1/*` at the Worker with the Better Auth bearer (`src/lib/workerRoute.ts`),
   and `supabase.auth.getSession/getUser` answer from Better Auth
   (`src/lib/workerSession.ts`). The Worker speaks the PostgREST subset the app uses, every
   statement owner-scoped (`worker/src/rest.ts`; `rest.check.ts` + the isolation mutation
   proof). Flag unset: nothing is installed (`tests/worker-seam.test.ts`). Driven: OTP
   sign-in, Schedule and phone Calendar, capture, complete, priority, label, step, trash,
   parked-change retry, reload — every data request on the Worker.
   **Still open:** `nuvo-preview` is the #90-era build. It has no `/api/rest/v1` (it answers
   with the SPA's HTML) and its auth CORS allows only its own origin, so this client cannot
   be driven there until the preview is redeployed from this branch
   (`wrangler deploy --env preview` — not run). PR #117 routes the same calls through a
   browser-side shim over `/api/data` (whole-table reads, a request per task for labels, no
   `.or()`); this branch supersedes its client half.
2. **Google sign-in isn't ported.** Better Auth wires Apple only (`worker/src/auth.ts`);
   `src/lib/googleAuth.ts` ignores the flag.
3. ~~**The desktop build never gets the flag.**~~ **Closed.** `release.yml` passes
   `VITE_API_BASE_URL: ${{ vars.VITE_API_BASE_URL }}`, the line `ios-release.yml` already
   had. Unset repo variable → empty → Supabase, as today. Setting it is the switch for the
   next desktop and iOS build. The PWA reads the same repo variable through
   `cloudflare-hosting.yml` (since 2026-11-06; it used to be Vercel's project env). The variable model
   won: #117 is closed, and #118's literal bake depends on it, so #118 is superseded.
4. **Realtime has no Worker path.** Now, with the flag on, realtime is a **known no-op**:
   only the client's `fetch` is re-pointed, so `supabase.channel()` would still dial
   Supabase — and both of its callers (`useRealtime`, `useSubscription`) skip on the flag.
   That socket would hear nothing (Supabase broadcasts only Supabase writes) and its private
   topics reject a Better Auth bearer. Other devices converge on window focus (15s stale,
   `App.tsx`). **Smallest honest design (not built):**
   - One Durable Object per account (`idFromName(userId)`) holding hibernatable WebSockets —
     an idle socket costs nothing, a message costs one request.
   - `GET /api/live` upgrades after the Worker verifies the Better Auth bearer, sent as
     `Sec-WebSocket-Protocol: bearer.<token>` (never a query string, which lands in logs),
     and forwards to that account's room.
   - Every Worker write to a synced table calls one helper, `announce(env, userId, changes)`,
     after commit via `ctx.waitUntil`: `rest.ts`'s four write paths and `apply_patch`, then
     the agent, MCP, capture, calendar-sync and cron writers. One helper because Neon has no
     `rt_broadcast` trigger to do it (item 7).
   - The payload is the `LiveChange` shape `useRealtime` already consumes
     (`lib/sync/liveApply.ts`), so the client swaps only its transport —
     `supabase.channel(...)` → `new WebSocket(...)`; coalescing, outbox gating and
     `applyLiveChange` stay as they are.
   - Not LISTEN/NOTIFY: Hyperdrive pools by transaction and LISTEN needs a session. Not Neon
     logical replication: a Worker cannot hold a replication slot.
5. **Hyperdrive `nuvo-neon` caches queries** (default `max_age`); `zeroed-neon` has
   caching disabled. The SPA's own reads are safe by construction: every data `SELECT`
   `rest.ts` sends calls `now()`, and Hyperdrive never caches a query that calls a STABLE
   or VOLATILE function (`rest.check.ts` fails if one doesn't). **Every other Worker route
   still reads through the cache** (agent snapshot, day, mirrors, `/api/data`), so a read
   right after a write can be up to `max_age` old there. Disable caching on `nuvo-neon`
   before the flip.
6. **Secrets still missing on Worker `nuvo`** — § Key rotation at cutover.
7. **Neon has no functions or triggers.** The restore skips them (`SKIP_TOC_HEAD`), so
   `set_updated_at`, `stamp_unstamped_field_ts`, `tasks_steps_are_flat`,
   `guard_inbound_token`, `sync_self_rsvp`, `rt_broadcast` and the four RPCs are gone, and
   `auth.uid()` is a stub. `rest.ts` re-says the RPCs and the first four rules for the
   SPA's writes. **The other Worker writers (agent, MCP, capture, calendar sync, crons) do
   not stamp `field_ts` or bump `updated_at`** — read, not driven — so an older offline edit
   can overwrite what they write. Whether the Worker's calendar sync derives `self_rsvp`
   itself was not checked.
8. **A sign-up after the flip cannot write.** Planner tables keep Supabase's FKs to
   `auth.users` — the copy's stub — and a Better Auth user created after the copy has no row
   there. Driven: a fresh OTP sign-up on the restored DB gets `23503
   user_settings_user_id_fkey` on every data request (from `bootstrapUser`). Either insert
   the stub row in Better Auth's `user.create` hook or repoint the FKs to `public.users` in
   the copy. #120 handles the billing FKs only.
9. **The entitlement read is CORS-blocked.** `GET /api/entitlement` is credentialed but
   answered with `Access-Control-Allow-Origin: *`; Chrome refuses it (seen in the dev
   app's console). #120's `reflectAllowOrigin` fixes this.
10. **The Better Auth bearer may not survive a relaunch** (inferred, not driven).
    `authClient.ts` keeps it in `sessionStorage`, which outlives a reload (seen) but not a
    closed Tauri window or a killed iOS PWA. The cookie fallback (`credentials: "include"`)
    is third-party from `tauri://localhost`, which WKWebView blocks by default. GoTrue's
    session lives in `localStorage` today, so a Mac or phone would likely ask for a code
    on every launch after the flip. Check on a built app before the flip.

---

## What moves (eventually)

| Piece | Today | After cutover | Rollback |
|---|---|---|---|
| Static SPA | Cloudflare `nuvo-app` (moved off Vercel 2026-11-06, [`cloudflare-hosting.md`](./cloudflare-hosting.md)) | Unchanged. The flip is a rebuild with `VITE_API_BASE_URL` set | Clear the variable, re-dispatch `cloudflare-hosting` |
| Planner CRUD | Supabase PostgREST + RLS | The SPA's own PostgREST calls at `/api/rest/v1/*` (`worker/src/rest.ts`); also `/api/data/*` + `/api/rpc/*`. Owner filters in the Worker | Clear `VITE_API_BASE_URL` |
| Auth | GoTrue (Google, Apple, OTP, password) | Better Auth `/api/auth` (email OTP + verified password; signed bearer only) | Same flag flip |
| Agent / MCP | `*.supabase.co/functions/v1` | `/api/agent`, `/api/mcp` (session / connection scoped on Neon) | Point the flag at `/functions/v1` |
| Database | Supabase Postgres + RLS | Neon via Hyperdrive | Leave Neon; app stops writing it |
| Billing | Supabase edge (Stripe, App Store) + 4 tables | **Still Supabase** at the flip. Port it later: § What still needs Supabase after the flip | n/a |
| Calendar (Google, M365, iCloud, ICS) + mirrors + push | Supabase edge + pg_cron | Worker (#105–#107: `google/routes.ts`, `calendar/http.ts`, `slot-mirror`, `task-mirror`, `push-dispatch` with the new VAPID pair, D-173). Crons `google-renew` / `calendar-dispatch` / `push-dispatch`. M365 needs `MS_*` | Leave Supabase functions + jobs until `cron.unschedule` at flip |

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
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | secret | **A new pair** (D-173), already on Worker `nuvo`. Supabase's private key can't be read back. Its public key ships only in the switch build — § Key rotation at cutover |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | secret | Google OAuth + token refresh. The secret **rotates inside the freeze window** — § Key rotation at cutover |
| `MAINTENANCE_WRITE_FREEZE` | var | Same parse as `supabase/functions/_shared/writeFreeze.ts`: unset / empty / `0` / `false` / `no` / `off` (trimmed, case-insensitive) stay open. **Any other non-empty value** (`1`, `true`, `yes`, `on`, a typo, `maybe`, `2`) freezes Worker writes. `GET /api/maintenance` is what the app reads |
| `CUTOVER_ARMED` | var | `1` / `true` arms the copy window. The app fail-closes the freeze while armed |
| `SUPABASE_URL` | secret | Billing read only. `GET /api/entitlement` and delete-account SELECTs `subscriptions` here by the session user id |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | Same read. Used only as `user_id=eq.<session id>`. **Not** a Stripe key; do not add `STRIPE_SECRET_KEY` |
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

They live in the **`nuvo-cutover` GitHub Environment**, not at repo level
(the job has `environment: nuvo-cutover`). Set them for the run, then
**delete them**. Every secret the cleanup deletes has a restore source on
**Phil's Mac**: the login Keychain, or `neonctl` for the two Neon URLs, which mints
them from the signed-in CLI, so there is no stored copy to go stale. Names only;
never paste, echo, log, or commit a value. *(Until 2026-10-29 the restore source was
the ops box's `/home/box/agent-data/secrets/`. Those files are stale and retired:
§ Key rotation at cutover → Source of truth.)*

| Secret | Restore source (Mac) | Value |
|---|---|---|
| `SOURCE_DATABASE_URL` | Keychain `nuvo-migrate/SOURCE_DATABASE_URL` | migration_reader URI, session pooler |
| `SCRATCH_DATABASE_URL` | `neonctl connection-string`, database `nuvo_dryrun_scratch` | Neon direct URL; must be empty before a dry run |
| `TARGET_DATABASE_URL` | `neonctl connection-string`, database `neondb` | Neon direct URL |
| `TOKEN_ENC_KEY_V1` | Keychain `nuvo-worker/TOKEN_ENC_KEY_V1` | 64 hex chars. **Same item** the `nuvo` Worker secret was set from (sha256 `baa57583…`). Never regenerate it once tokens are sealed |

Restore (values go Keychain / `neonctl` → stdin → `gh`; nothing hits stdout or shell
history). The flags are spelled out on every line because zsh, the Mac's shell, does
not word-split a `$E`:

```bash
kc() { security find-generic-password -s "$1" -w | tr -d '\n'; }
neonurl() { neonctl connection-string main --project-id frosty-snow-66931204 --role-name neondb_owner --database-name "$1" | tr -d '\n'; }
kc nuvo-migrate/SOURCE_DATABASE_URL | gh secret set SOURCE_DATABASE_URL --env nuvo-cutover -R phillipchan1/nuvo
neonurl nuvo_dryrun_scratch | gh secret set SCRATCH_DATABASE_URL --env nuvo-cutover -R phillipchan1/nuvo
neonurl neondb | gh secret set TARGET_DATABASE_URL --env nuvo-cutover -R phillipchan1/nuvo
kc nuvo-worker/TOKEN_ENC_KEY_V1 | gh secret set TOKEN_ENC_KEY_V1 --env nuvo-cutover -R phillipchan1/nuvo
gh api repos/phillipchan1/nuvo/environments/nuvo-cutover/secrets --jq '.secrets[].name'   # names only
```

Delete after the run, then verify the count is 0:

```bash
gh secret delete SOURCE_DATABASE_URL --env nuvo-cutover -R phillipchan1/nuvo
gh secret delete SCRATCH_DATABASE_URL --env nuvo-cutover -R phillipchan1/nuvo
gh secret delete TARGET_DATABASE_URL --env nuvo-cutover -R phillipchan1/nuvo
gh secret delete TOKEN_ENC_KEY_V1 --env nuvo-cutover -R phillipchan1/nuvo
gh api repos/phillipchan1/nuvo/environments/nuvo-cutover/secrets --jq '.total_count'   # expect 0
```

`MAINTENANCE_URL` and `WRITE_FREEZE_PREFLIGHT_URL` are **variables**, not
secrets, and `mode=dry-run` skips both preflights. They are not deleted by the
cleanup. Set them only for `mode=cutover`.

#### Reset scratch: before **and** after every dry run

The restore aborts with `target public is not empty` if
`nuvo_dryrun_scratch` still holds the last run, and a finished dry run leaves
a full copy of prod there (auth users with password hashes, sealed tokens).
So reset it twice per dry run:

1. **Before**: after the secrets are restored, before `gh workflow run`.
2. **After**: once the go/no-go check below has run and the secrets are
   deleted. No prod copy stays on Neon between runs.

The reset connects to `neondb` (the database it must never touch), proves
that, records `neondb`'s table count, drops and recreates only
`nuvo_dryrun_scratch`, then checks `neondb` is unchanged and scratch has 0
tables. It runs from the Mac over Postgres (5432) with Homebrew's `postgresql@17`.
URLs come from `neonctl` and are never printed:

```bash
bash <<'EOF'
set -euo pipefail
PSQL=/opt/homebrew/opt/postgresql@17/bin/psql
TARGET=nuvo_dryrun_scratch
NEON=(--project-id frosty-snow-66931204 --role-name neondb_owner)
MAIN=$(neonctl connection-string main "${NEON[@]}" --database-name neondb)
SCRATCH=$(neonctl connection-string main "${NEON[@]}" --database-name "$TARGET")
q() { "$PSQL" "$1" -X -q -v ON_ERROR_STOP=1 -tA -c "$2"; }
TABLES="select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema')"
db=$(q "$MAIN" "select current_database()")
[ "$db" = neondb ] || { echo "ABORT: connected db is not neondb"; exit 1; }
[ "$TARGET" != "$db" ] || { echo "ABORT: target is the connected db"; exit 1; }
before=$(q "$MAIN" "$TABLES")
echo "connected=neondb neondb_tables_before=$before"
q "$MAIN" "DROP DATABASE IF EXISTS \"$TARGET\" WITH (FORCE)"
q "$MAIN" "CREATE DATABASE \"$TARGET\""
after=$(q "$MAIN" "$TABLES")
[ "$after" = "$before" ] || { echo "neondb table count changed $before -> $after"; exit 1; }
echo "neondb_tables_after=$after scratch=$(q "$SCRATCH" "select current_database()") tables=$(q "$SCRATCH" "$TABLES")"
EOF
```

Expect `neondb_tables_before=22`, `neondb_tables_after=22`, and
`scratch=nuvo_dryrun_scratch tables=0`. Stop if the connected database is not
`neondb`, if the `neondb` count moves, or if scratch is not at 0 tables. Never
point this at any other database name. Last run 2026-10-29: `neondb` 22 → 22,
scratch 34 tables → 0.

#### Go/no-go: Worker and copy job use the same `TOKEN_ENC_KEY_V1`

A key mismatch is silent until the Worker tries to open a sealed token (Apple
revoke, calendar refresh), so this is a **no-go** for the flip if it fails.

1. Set the Worker secret and the environment secret from the **same Keychain
   item**, `nuvo-worker/TOKEN_ENC_KEY_V1`
   (`security find-generic-password -s nuvo-worker/TOKEN_ENC_KEY_V1 -w | tr -d '\n' | npx wrangler secret put TOKEN_ENC_KEY_V1 --name nuvo`).
   Record the value's sha256 (the digest only, never the key) in the run notes
   each time either side is set; the digests must match. The Worker was last set
   2026-10-28: `baa57583…`.
2. After a dry run (or cutover) whose "Re-encrypt vault tokens in-runner" step
   succeeded, open the sealed tokens with the Keychain key. Dry run: point
   `DATABASE_URL` at the scratch database. Cutover: at Neon `neondb`.

   ```bash
   TOKEN_ENC_KEY_V1="$(security find-generic-password -s nuvo-worker/TOKEN_ENC_KEY_V1 -w)" \
   DATABASE_URL="$(neonctl connection-string main --project-id frosty-snow-66931204 --role-name neondb_owner --database-name nuvo_dryrun_scratch)" \
   TOKEN_DECRYPT_TCP=1 node --experimental-strip-types worker/src/tokenDecrypt.check.ts
   ```

   The check never prints the key. `TOKEN_DECRYPT_TCP=1` uses the repo's
   `postgres` driver over 5432; the HTTPS driver the box needed isn't a repo
   dependency. It decrypts every sealed token and prints only `provider ok` /
   `provider fail`. **Go** = every provider that owes tokens prints `ok` and none
   prints `fail`. A provider owes one sealed token per row that had a Vault
   pointer at the source (`refresh_token_secret_id` / `token_secret_id`). A row
   without one never had a token: prod's two Apple identities came from
   ID-token-only sign-in, so Apple owes none. Opening fewer than owed is a no-go
   (exit 1). A skip (exit 0 with nothing opened) is **not** a go: it means the key
   or URL was unset. Last run 2026-10-29, against the 2026-10-28 scratch copy:
   `github ok`, `google ok`, `icloud ok`, `ics ok` (11 tokens).
3. Because the Worker secret cannot be read back, step 1's matching digest is
   what ties the Worker to the key step 2 just proved. If the digests differ,
   or anyone re-ran `wrangler secret put` from another source, re-set the
   Worker from the Keychain item before the flip.

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

**Wrappers already on Supabase prod** (Engineer 3, management API SQL
editor). Verified 2026-10-26 (PT) from live `pg_get_functiondef` + the
grant catalog; re-checked 2026-10-27 (PG 17.6, as `postgres`): owner
`postgres`, `SECURITY DEFINER`, `search_path=""`, `EXECUTE` for
`migration_reader` only. `postgres` already has `USAGE` on `auth` and
`SELECT` on every COPY column of `auth.users` / `auth.identities`
(hosted defaults — do not grant, do not revoke). PostgREST `db_schema`
is `public,graphql_public`, so `migration_tmp` is not exposed.

The Oct 26 dry runs (`workflow_dispatch` 40380281025 / 40380492458 at
SHA `3398470`, before #99) failed with `permission denied for schema auth`
because the job `COPY`ed `auth.users` directly as `migration_reader`.
#99 already moved those reads onto `migration_tmp.auth_users()` /
`migration_tmp.auth_identities()` — same pattern as `vault_tokens()`.
Bodies project only `name` / `full_name` (and identity `sub` /
`provider_id`) through `pg_catalog.jsonb_build_object` +
`jsonb_strip_nulls`. Password hashes, recovery tokens, and other GoTrue
secrets never leave `auth`. **Never `GRANT USAGE` on `auth` to
`migration_reader`.**

**Re-apply before the next dry run** (as `postgres`, `CREATE OR REPLACE`)
so the `search_path = pg_catalog, pg_temp` fix lands on the existing
functions:

1. [`migration_tmp.sql`](./cloudflare-migration/migration_tmp.sql)
2. [`vault_tokens.sql`](./cloudflare-migration/vault_tokens.sql)

That apply also records leftover `migration_reader` `SELECT` on all 16
`auth` tables (harmless today only because the role lacks `USAGE` on
`auth`). Nothing new is granted on `auth`.

After cutover is signed off and `SOURCE_DATABASE_URL` is deleted,
revoke those leftovers, then drop (see the block in
`migration_tmp.sql` next to this):

Run the cleanup block **as the `postgres` role** (Supabase SQL editor or
the Management API `database/query`, which both run as `postgres`). Not as any
other Supabase admin role, not as `migration_reader`, and never from CI or
`cutover-migrate.yml`. **First take a fresh snapshot** (catalog only, no row
data) and keep it with the run notes, so the revoke can be checked against
what was there at that moment rather than at first apply:

```sql
-- 1. migration_reader grants in auth (schema, table, column)
SELECT 'schema' AS kind, n.nspname AS obj, '' AS col, e.privilege_type, pg_get_userbyid(e.grantor) AS grantor
FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) e
JOIN pg_roles r ON r.oid = e.grantee
WHERE n.nspname = 'auth' AND r.rolname = 'migration_reader'
UNION ALL
SELECT 'table', c.relname, '', e.privilege_type, pg_get_userbyid(e.grantor)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(c.relacl) e JOIN pg_roles r ON r.oid = e.grantee
WHERE n.nspname = 'auth' AND r.rolname = 'migration_reader'
UNION ALL
SELECT 'column', c.relname, a.attname, e.privilege_type, pg_get_userbyid(e.grantor)
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(a.attacl) e JOIN pg_roles r ON r.oid = e.grantee
WHERE n.nspname = 'auth' AND a.attnum > 0 AND NOT a.attisdropped
  AND r.rolname = 'migration_reader'
ORDER BY 1, 2, 3, 4;

-- 2. role membership both ways. Expected on prod (PG17): one row,
--    role=migration_reader member=postgres admin_option=true (the creator
--    grant), and no row where migration_reader is the member.
SELECT pg_get_userbyid(m.roleid) AS role, pg_get_userbyid(m.member) AS member,
       m.admin_option, m.inherit_option, m.set_option
FROM pg_auth_members m
WHERE m.roleid = 'migration_reader'::regrole OR m.member = 'migration_reader'::regrole;

-- 3. what the cleanup will act on
SELECT current_user;                       -- must be postgres
SELECT objkind, privilege, count(*) FROM migration_tmp.auth_grants GROUP BY 1, 2;
SELECT p.proname, p.proacl::text FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'migration_tmp';
```

Stop if `current_user` is not `postgres`, if the snapshot shows
`migration_reader` grants in `auth` that are not in `migration_tmp.auth_grants`,
or if the membership query shows anything beyond the expected creator grant
(in particular, any row where `migration_reader` is the member). Re-run query 1 after the cleanup; it must return zero rows.

```sql
-- Loop migration_tmp.auth_grants for migration_reader (see migration_tmp.sql).
-- Do not REVOKE ALL ON ALL TABLES IN SCHEMA auth — hosted postgres can 42501.
-- On PG17 a table-level REVOKE also clears that table's column ACLs.
DROP SCHEMA IF EXISTS migration_tmp CASCADE;
```

That cleanup is a source-side restore of pre-state, not a rollback
step. Do not revoke `postgres`'s own `auth` grants. Supabase itself
stays up (clear `VITE_API_BASE_URL`) until you decide otherwise.

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
custom domain. Do **not** retarget Stripe, Apple, or Resend webhooks. Google
Calendar push channels re-subscribe to the Worker at the flip
(`POST /api/cron/google-resubscribe`); `calendar-dispatch` is the poll fallback.

---

## Crons and Queues (Workers Paid)

Static hosting (`nuvo-app`, formerly Vercel) has **no crons**. The Worker now has Cron Triggers
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
Google, M365, iCloud (+ contacts) and ICS (`consumeCalendarSyncBatch`). `google-renew` re-watches channels that
expire within 48h. Flip tooling: `POST /api/cron/google-resubscribe`.
`trim-sync-log` deletes by
`created_at < now() - 30 days` and, when the identity is parked
(`last_value >= 1e6`), also `id < last_value - 1e6 + 1`. Copied source
ids typically sit below that floor. The floor keeps recent Neon-origin
rows out of age trim; it is not a permanent partition — after about 1e6 further Neon inserts the floor rises past those early Neon ids and any
row older than 30 days is eligible. The sequence is never reset.

| Cron (UTC) | Job | This PR |
|---|---|---|
| `* * * * *` | `calendar-dispatch` + `push-dispatch` | skip until flip, then dispatch enqueues due `calendar_accounts` onto `CALENDAR_SYNC_QUEUE`; consumer polls Google, M365, iCloud and ICS. Without a queue binding, HTTP dispatch claims Google in-process. push-dispatch is ported (per-user loop, new VAPID pair per D-173, no Queue) |
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

## Key rotation at cutover (D-173)

Two production secrets can't be copied to the Worker, because nothing will give
their values back. Supabase returns a sha256 of every edge secret, and its auth-config
API doesn't return the Google secret either. Google stopped showing client secrets
after creation. **Both rotate.**

### Worker `nuvo` secrets — state on 2026-10-29

| Secret | Source |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase CLI, piped straight to `wrangler` |
| `GOOGLE_CLIENT_ID`, `RESEND_WEBHOOK_SECRET` | Copied; sha256 matches Supabase's |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | **New pair**, below. Keychain `nuvo-worker/VAPID_*` |
| `BETTER_AUTH_SECRET`, `CRON_SECRET` | Generated. Keychain `nuvo-worker/…` |
| `BETTER_AUTH_URL` = `https://api.nuvo.day`, `APP_URL` = `https://app.nuvo.day` (sha256 matches Supabase's), `VAPID_SUBJECT`, `APPLE_BUNDLE_ID` = `day.nuvo.app` | Config |
| `RESEND_API_KEY`, `OPENAI_API_KEY` | **New keys, 2026-10-29**, both named `nuvo-worker`. Phil created them and pasted them into a hidden prompt that piped them to `wrangler`, so no copy exists anywhere else. Resend is Full access: inbound email reads `/emails/receiving` |
| `TOKEN_ENC_KEY_V1` | **Replaced 2026-10-28.** Keychain `nuvo-worker/TOKEN_ENC_KEY_V1` (sha256 `baa57583…`). The go/no-go opened every token sealed with it, 2026-10-29 |

**Source of truth: Phil's Mac, since 2026-10-29.** #122 had made the ops box's
`/home/box/agent-data/secrets/` files the restore source. A rehearsal from a Mac checkout cut
before #122 then replaced two of those values without updating the box, so the two copies
disagreed. Phil chose the Mac. The restore, reset and go/no-go steps above now read from it:

| Value | Source | Retired box file (stale; delete it) |
|---|---|---|
| `TOKEN_ENC_KEY_V1` | Keychain `nuvo-worker/TOKEN_ENC_KEY_V1`, which is also what Worker `nuvo` holds | `nuvo-token-enc-key-v1`: the pre-2026-10-28 key, which the Worker no longer has |
| `SOURCE_DATABASE_URL` | Keychain `nuvo-migrate/SOURCE_DATABASE_URL` | `nuvo-migration-reader`: the password was reset 2026-10-28, so it no longer logs in |
| `SCRATCH_` / `TARGET_DATABASE_URL` | `neonctl connection-string`, minted per run | `nuvo-neon-scratch-url`, `nuvo-neon.env` |

No real token was ever sealed with the old key outside a scratch copy, so retiring it strands
nothing.

**Still missing:**
- `GOOGLE_CLIENT_SECRET` — below.
- The Apple set. Nuvo has no Sign in with Apple key: Supabase only verifies the ID token,
  but Better Auth needs a client-secret JWT. Create a key for `day.nuvo.app` and download
  the `.p8` once. **Since 2026-11-06 the Worker mints the JWT itself** from
  `APPLE_SIWA_TEAM_ID` / `_KEY_ID` / `_PRIVATE_KEY` (`primeAppleClientSecret`), so there is
  no 6-month secret to rotate. Set `APPLE_CLIENT_SECRET` only to override that.
- `MS_*` — M365 isn't carried over this round.

`RESEND_FROM` stays `noreply@inbox.nuvo.day`: Resend has verified only `inbox.nuvo.day`.
Supabase's `RESEND_FROM` is `hello@nuvo.day`, on an unverified domain.

### Data — rehearsal on 2026-10-28

**A full rehearsal copy of production went into Neon `nuvo_dryrun_scratch`** on
2026-10-28. It ran with Supabase live, and Supabase wasn't frozen or written. The go/no-go
passed on it, then it was **reset 2026-10-29** (§ Reset scratch), so no prod copy stays on Neon.
`neondb` (what Hyperdrive serves) still holds only the synthetic A/B seed, 2 users.

| What | Result |
|---|---|
| Accounts | 12 `auth.users` → `"user"`, 13 identities → `account`. Auth parity hashes match |
| Planner tables | 26 copied. 25 match Supabase by count + md5 |
| `calendar_accounts` | 11 = 11. The md5 differs on `calendars`, `next_sync_at`, `sync_failures`, `updated_at`: the every-minute calendar poll wrote between the dump and the snapshot. **Live drift, not a copy bug.** The freeze pauses `pg_cron`, which removes it |
| Tokens | 10 calendar refresh tokens + 1 activity source sealed with the new key, 0 mismatches. 5 plaintext access tokens sealed and NULLed |
| `sync_log` | 87,472 rows by id anti-join. Identity parked at 1,250,355 |
| Dump | 2.6 MB, on the Mac only, shredded after the run |

The source credential: `migration_reader` (login, `default_transaction_read_only=on`)
and all three `migration_tmp` readers already existed. Its password was reset 2026-10-28
with a SCRAM verifier, never the plaintext. That reset is what left the box's
`nuvo-migration-reader` stale (above).

How it ran: the workflow's own helper on the Mac, extracted from the YAML, with the arm and
freeze gates skipped. That checkout still gated `dump` on the freeze even for `mode=dry-run`;
#116 has since dropped the gate for dry runs, so **the next rehearsal runs through
`cutover-migrate` itself**, not a local copy. A write that lands mid-run shows up as `verify`
drift, which is expected. The real copy still runs frozen (§ the copy steps above), because a
live copy goes stale the moment it finishes.

### VAPID — already rotated on the Worker

- New public key: `BMdUziU09i52gETKWH1D8J9sLKHWHpAZEdj-ix6ePW4Ht7aL7-wLwMBORC8CiQp6MW6DKGZfSOUMI2yFm1xQH6A`.
  **Never ship it in a build that still talks to Supabase.** Supabase's `push-dispatch`
  signs with the old private key, so a phone that re-subscribed early would go silent
  until the flip.
- **At the switch (step 7):** the build that sets `VITE_API_BASE_URL` also sets
  `VITE_VAPID_PUBLIC_KEY` to the key above.
- **On first launch**, `subscribeToPush` finds the subscription made with the old key. It
  unsubscribes, deletes that row, and re-subscribes (`tests/push-key-rotation.test.ts`).
  Only the installed PWA and desktop browsers have Web Push; the Tauri shells never did.
- **A device that never reopens** keeps an old-key row. Sends to it fail with an auth
  error, not 404/410, so D-167's prune won't remove it. After two weeks, delete the rows
  that are still failing.
- `push.ts` still writes through `supabase.from(...)`. Its re-subscribe reaches Neon only
  once blocker 1 lands.

### Google client secret — rotate inside the freeze window

Client `917673962447-p2if…` (project `nuvo-499002`) holds two enabled secrets:
`****kC0F` (2026-06-12) and `****A-lJ` (2026-07-24). Both slots are full. Nobody knows
which one Supabase's Auth provider uses, or which its edge functions use — possibly both.

1. **Inside the freeze**, writes already 503, so a minute of Google errors on Supabase
   costs nothing. A person deletes `****kC0F`, clicks **Add secret**, and copies the new one.
2. **Set it everywhere at once:**

   ```bash
   read -rs -p "new Google client secret: " G; echo
   printf '%s' "$G" | npx wrangler secret put GOOGLE_CLIENT_SECRET
   supabase secrets set --project-ref ebibzojtkzkphykznomv GOOGLE_CLIENT_SECRET="$G"
   unset G
   ```

   Then paste the same value into Supabase → Authentication → Providers → Google.
3. Supabase now runs on either the new secret or `****A-lJ`, and both are valid. Refresh
   tokens belong to the client, not the secret, so calendar connections survive.
   Delete `****A-lJ` once the Worker has run for a day.

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

**Ship the armed build first** before a `mode=cutover` copy. Before you
flip `CUTOVER_ARMED` on the Worker, ship a build with
`VITE_MAINTENANCE_URL` (the Worker `GET /api/maintenance` URL) and
`VITE_CUTOVER_ARMED=1` baked in. `mode=cutover` reads that same
endpoint (`MAINTENANCE_URL` / `VITE_MAINTENANCE_URL` Actions variable)
and **refuses to start dump** unless the payload reports
`cutover_armed: true`. `mode=dry-run` skips the armed / freeze / 503
preflight and does not freeze prod. An unarmed SPA would keep writing
through a cutover window; the cutover job will not copy against that.

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
iap-catalog, referral-code. Those keep writing billing tables.

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

`mode=dry-run` does **not** use this freeze. Re-apply
[`migration_tmp.sql`](./cloudflare-migration/migration_tmp.sql) and
[`vault_tokens.sql`](./cloudflare-migration/vault_tokens.sql) as
`postgres` (`CREATE OR REPLACE`) first, then dispatch
`mode=dry-run` `phase=copy`. Dump skips armed / freeze / 503
preflight. Source-vs-snapshot drift is report-only; target-vs-snapshot
still fails.

The order below is **`mode=cutover` only**. Freeze / arm / 503 do not
apply to a dry run.

0. **Ship the armed build** — `VITE_MAINTENANCE_URL` + `VITE_CUTOVER_ARMED=1`.
   `mode=cutover` will refuse to start until that endpoint reports armed.
0b. **Preflight edge secrets** — `node scripts/preflight-edge-write-freeze.mjs --project-ref <ref>`
   before any Supabase edge-function redeploy (and again before arming).
   PASS only when `WRITE_FREEZE` / `MAINTENANCE_WRITE_FREEZE` are absent
   or their CLI `value` (sha256 hex) matches an unfrozen string. Do not
   redeploy on FAIL.
1. **Arm** — set `CUTOVER_ARMED=1` on the Worker, `WRITE_FREEZE=1` on
   the non-billing edge functions, and `MAINTENANCE_WRITE_FREEZE=1` if
   you want Worker writes frozen too.
2. **Freeze** — apply `freeze.sql` by hand (`mode=cutover` only). Records
   `aclexplode` write ACLs (including `PUBLIC`), then revokes
   `INSERT`/`UPDATE`/`DELETE` on public app tables from `PUBLIC`,
   `anon`, and `authenticated` (SELECT stays). Pauses every `nuvo-*`
   `pg_cron` job via `cron.alter_job(..., active := false)` after
   recording the prior `active` flag. `service_role` and the billing
   tables are untouched.
3. **Snapshot** — `mode=cutover` `dump` first GETs the maintenance
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
   snapshot. `mode=cutover` dies if either drifted (writes leaked, or
   the copy is short). `mode=dry-run` treats source-vs-snapshot drift
   as report-only; target-vs-snapshot still fails. Auth parity (source
   vs Better Auth) is the same: report-only in dry-run so a sign-in
   during the run does not abort. Parity covers only the frozen tables
   (`sync_log` excluded).
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
7. **Switch** — flip `VITE_API_BASE_URL`. Or **unfreeze** — apply
   `unfreeze.sql`, which restores the recorded ACLs and each job's
   prior `active` exactly (idempotent), then clear `CUTOVER_ARMED`
   and `WRITE_FREEZE`.
8. **Flip Worker crons** — in this order, and not before:
   1. `cron.unschedule` **all nine** Supabase `nuvo-*` jobs. Every one has a
      Worker twin: `calendar-dispatch`, `push-dispatch`, `google-renew`,
      `rollover-pdt`, `rollover-pst`, `github-poll`, `trim-sync-log`,
      `purge-trash`, `reminder-deliveries-prune`. (This used to name only the
      first two. `push-dispatch` left running would double-send.)
   2. Final `cutover-migrate` `phase=resync` so post-switch billing
      inserts/updates/deletes land (id anti-join + setval +
      delete-then-upsert).
   3. Set `CUTOVER_FLIPPED` to one of `1`, `true`, `yes`, `on`
      (case-insensitive). Unset or any other value = not flipped =
      200 `{ skipped: true }` on `github-poll`, `trim-sync-log`, and
      github-activity `action: "sync"` with `CRON_SECRET`. The freeze
      is not enough.

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
in the Neon rehearsal schema. The Worker entitlement check
(`GET /api/entitlement`) reads that table by the preserved session user id
(Better Auth `user.id` = `auth.users.id`). Stripe / StoreKit writers are
unchanged. `scripts/check-entitlement-parity.ts` proves the 1:1 auth copy
and that every subscription keeps the same tier. The SPA's paid gate
(`useSubscription`) reads `GET /api/entitlement` when `VITE_API_BASE_URL`
is set, and keeps today's PostgREST select when it is not. Live Stripe +
StoreKit proof before a flip:
[`cloudflare-migration/billing-live-check.md`](./cloudflare-migration/billing-live-check.md).

Isolation applies `worker/schema/neon.sql` onto PGlite, seeds two users, and
asserts user A cannot read/write user B. The mutation script deletes each
derived `user_id = ${store.userId}` filter and expects a failure.

---

## Phil's go list

Every live step left after the code work on `claude/affectionate-hellman-1dcca2`, in order.
Each one needs Phil's yes, and none was run. Billing steps (Stripe and App Store endpoints,
`STRIPE_*`, the billing copy) come from the billing session and slot in at B1/B5 of
§ Port plan. Never paste a secret value into a chat, an issue or a log.

| # | Step | Command / where | Reversible? |
|---|---|---|---|
| G0 | Review and merge this branch (and the billing session's), then close #118 and #120 as superseded | GitHub | yes |
| G1 | Create both queues. `wrangler deploy` doesn't create them | `npx wrangler queues create nuvo-calendar-sync` and `npx wrangler queues create nuvo-calendar-sync-preview` | yes (`queues delete`) |
| G2 | Turn Hyperdrive caching off (blocker 5) | `npx wrangler hyperdrive update 2c52343139524c4e9ba39f8c1c9b0795 --caching-disabled true` | yes |
| G3 | **Apple key**: Apple Developer → Keys → new key with Sign in with Apple, primary App ID `day.nuvo.app`. Download the `.p8` once (Keychain) | developer.apple.com | revoke key |
| G4 | **Apple Services ID** for the web flow, e.g. `day.nuvo.web` (whatever exists). Under Sign in with Apple → Configure: domain `api.nuvo.day` and return URL `https://api.nuvo.day/api/auth/callback/apple`. For the rehearsal, also `nuvo-preview.nq-morning-briefing.workers.dev` + `https://nuvo-preview.nq-morning-briefing.workers.dev/api/auth/callback/apple`. **Add, don't replace** Supabase's entries until the rollback window closes | developer.apple.com | yes |
| G5 | **Google OAuth client** (the one `GOOGLE_CLIENT_ID` names): add the authorized redirect URIs `https://api.nuvo.day/api/auth/callback/google` (sign-in) and `https://api.nuvo.day/functions/v1/google-oauth` (calendar connect, if missing). For the rehearsal, also `https://nuvo-preview.nq-morning-briefing.workers.dev/api/auth/callback/google`. **Unverified:** whether the consent screen needs `nq-morning-briefing.workers.dev` as an authorized domain for that preview URI. If Google refuses it, rehearse Google on api.nuvo.day after G7 instead. Add, don't replace | console.cloud.google.com | yes |
| G6 | **Azure app** (M365): add `https://api.nuvo.day/functions/v1/m365-oauth`, if M365 is carried (decision 5) | portal.azure.com | yes |
| G7 | **Secrets on `nuvo` and `nuvo-preview`**: `APPLE_CLIENT_ID` (Services ID from G4), `APPLE_SIWA_TEAM_ID`, `APPLE_SIWA_KEY_ID`, `APPLE_SIWA_PRIVATE_KEY` (the `.p8` from G3). Optionally `APPLE_SIWA_CLIENT_ID`. `MS_CLIENT_ID` / `MS_CLIENT_SECRET` if G6. On **preview only** for now: `GOOGLE_CLIENT_SECRET`. On `nuvo` it rotates inside the freeze (§ Key rotation), and until it's set there, Google sign-in on prod answers "That sign-in option isn't available right now" | `npx wrangler secret put <NAME>` (add `--env preview` for preview), piped from Keychain | yes |
| G8 | **Deploy** preview, then prod, from merged master. Both stay inert (`CUTOVER_FLIPPED` unset, no client points at them) | `npx wrangler deploy --env preview`, then `npx wrangler deploy` | yes (redeploy) |
| G9 | **Rehearse on preview (B3)**: a flag-on build pointed at the preview Worker, on a browser, a **built Mac** (`tauri://localhost`) and **TestFlight**. Check OTP sign-in, Google (door round trip), Apple native + web, **quit and relaunch stays signed in** (blocker 10), and a fresh sign-up that writes (8). Also run a `cutover-migrate` dry run, which now installs the stamp trigger and repoints the FKs | — | yes |
| G10 | **Armed build (step 0), only after G8 prod is deployed.** An armed build fails *closed* if the maintenance URL doesn't answer. Set repo **variables** `VITE_MAINTENANCE_URL=https://api.nuvo.day/api/maintenance` and `VITE_CUTOVER_ARMED=1`, then let the PWA, Mac and TestFlight builds roll out | `gh variable set …` | yes (unset + rebuild) |
| G11 | **Flip night**: § Flip-night order steps 1–9, unchanged. Step 4 now also sets `GOOGLE_CLIENT_SECRET` on `nuvo`, which turns Google sign-in on | — | until the copy |
| G12 | After the 24h watch: unset `VITE_CUTOVER_ARMED` (keep `VITE_MAINTENANCE_URL`) and rebuild | `gh variable delete VITE_CUTOVER_ARMED` | yes |
| G13 | After the rollback window: remove the Supabase redirect URIs from Google and Apple, and do § Port plan B6–B9 | consoles | no |

**Follow-ups, not blockers:** realtime over a Durable Object (item 4). `updated_at` is
still hand-written per Worker writer: the trigger in `field-ts.sql` covers `field_ts` only.

