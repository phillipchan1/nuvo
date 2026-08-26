# Google OAuth verification — runbook

**Status:** published to Production, **unverified** (100-user cap, unverified-app
warning). 7-day refresh-token expiry is resolved. Verification itself not yet
submitted.
**Owner:** Phil · **Last updated:** July 27, 2026

Getting Google Calendar out of test mode. Testing status is what forced the
7-day refresh-token expiry — that symptom is gone now that the app is
published. This is the path to full verification (no user cap, no warning).

---

## 1. The decision that gates everything

Nuvo requests `https://www.googleapis.com/auth/calendar`
([`google-oauth/index.ts:8`](../supabase/functions/google-oauth/index.ts)) — full
read/write/delete across every calendar the user can reach.

Google's Calendar auth docs classify the broad **write** scopes (`calendar`,
`calendar.events`, `calendar.calendars`, `calendar.app.created`) as
**Restricted**. Only the `.readonly` variants are merely *Sensitive*.

| | Sensitive | Restricted |
|---|---|---|
| Privacy policy · homepage · domain verification · demo video | ✓ | ✓ |
| **CASA Tier 2 security assessment** (annual, paid, weeks) | — | ✓ |

CASA triggers when restricted data flows *"from or through a third-party
server."* Nuvo does exactly that — refresh tokens in Supabase Vault, edge
functions syncing server-side. There is no reading of that clause that lets us out.

### ⚠️ Confirm this first — 60 seconds

Cloud Console → **APIs & Services → OAuth consent screen → Data Access**. Every
scope carries a literal **Sensitive** or **Restricted** chip. *That chip is
authoritative.* Everything below branches on it.

### What escaping Restricted would cost

Nuvo writes to Google in two places:

| Write | Where | Scope needed |
|---|---|---|
| Mirror "Nuvo" calendar — create + push scheduled tasks | [`google-oauth/index.ts:82`](../supabase/functions/google-oauth/index.ts), [`slot-mirror/index.ts:89`](../supabase/functions/slot-mirror/index.ts) | `calendar.app.created` (still Restricted) |
| The user's **real** events — RSVP, patch, move, delete | [`google-events/index.ts`](../supabase/functions/google-events/index.ts) | `calendar` / `calendar.events` (Restricted) |

Drop **both** → `calendar.events.readonly` + `calendar.calendarlist.readonly` =
Sensitive only, **no CASA**. Drop only the second → still Restricted.

So the honest fork is **read-only Google at public launch, or pay for CASA.**
There is no third door. Google stops working as a two-way calendar under the
read-only option; iCloud two-way sync is unaffected.

---

## 2. ✅ Done — Production, unverified

Published via Cloud Console → OAuth consent screen → **Publish app**.

- Cost: users see a "Google hasn't verified this app" interstitial, and you're
  capped at **100 users**.
- Benefit: **refresh tokens stop expiring after 7 days.** That was the actual pain,
  and it's resolved.

This was a legitimate holding position, not a hack. It buys runway to decide
read-only vs. CASA without blocking billing work. Sections 3+ below take you
from here to full verification (removes the cap and the warning).

---

## 3. Assets

### Done

- [x] **Privacy policy** — [nuvo.day/privacy](https://nuvo.day/privacy). Names both
      scopes individually, justifies each, carries the Limited Use paragraph and
      the link to the Google API Services User Data Policy.
- [x] **Terms of Service** — [nuvo.day/terms](https://nuvo.day/terms)
      ([`Terms.tsx`](../marketing/src/pages/Terms.tsx)).
      ⚠️ `GOVERNING_LAW` in [`config.ts`](../marketing/src/config.ts) is a
      placeholder — **set it to where the business is actually established.**
- [x] **Both linked from the homepage footer** — Google requires this.
- [x] **Prerendered to static HTML** ([`scripts/prerender.mjs`](../marketing/scripts/prerender.mjs)).
      This site is a CSR SPA, so `GET /privacy` used to return an empty shell —
      a reviewer or crawler that doesn't run JS saw *no policy at all*. Now
      `/privacy`, `/terms` and `/support` ship as real HTML with per-route
      title/description/canonical, and React hydrates over it.
- [x] **120×120 console logo** — square, derived from `public/pwa-512x512.png`.
- [x] **Governing law** set in `config.ts` — `GOVERNING_LAW = 'the State of
      California, United States'`. Not a placeholder anymore.
- [x] **Domain verification** — `nuvo.day` verified in Google Search Console
      (TXT record, added via Namecheap Advanced DNS) as of July 27, 2026.

### Remaining

- [ ] **Branding page submitted for verification** — see §4. Quick, automated.
- [ ] **Redirect URI on a domain you own** — see §5. Do this before submitting.
- [x] **Self-serve account deletion** — Settings → Account (and the locked
      screen). Type DELETE. Spec: [`account-deletion.md`](./account-deletion.md).
- [ ] **Demo video** — script in §7.
- [ ] **DECIDE: read-only Google vs. commit to CASA** — see §1. Gates the video
      script and the redirect-URI demo beats.

---

## 4. Console configuration

**Branding** page:

| Field | Value |
|---|---|
| App name | Nuvo |
| Logo | the 120×120 PNG |
| User support email | hello@nuvo.day |
| Application home page | `https://nuvo.day` |
| Privacy policy | `https://nuvo.day/privacy` |
| Terms of service | `https://nuvo.day/terms` |
| Authorized domain | `nuvo.day` |
| Developer contact | a monitored address — **Google emails rejections here** |

Branding review is automated and usually clears in minutes. Do it first; it's
the cheap half.

---

## 5. ⚠️ The redirect URI problem

`selfUrl()` resolves to `https://<project>.supabase.co/functions/v1/google-oauth`.

Reviewers routinely reject redirect URIs on domains the developer can't prove
they own — and the demo video is explicitly required to show the client ID in
the address bar during the grant, which puts `supabase.co` on camera.

**Fix:** enable a Supabase custom domain (e.g. `api.nuvo.day`), verify it in
Search Console alongside `nuvo.day`, and update the Google client's authorized
redirect URI. `selfUrl()` derives from `SUPABASE_URL`, so this is a config
change, not a code change — but re-verify the OAuth round trip after.

Related history: [`nuvo-desktop-oauth-origin`] — an unlisted `redirectTo` once
made Supabase silently fall back to Site URL. Redirect config in this project
has bitten us before. Change it carefully.

---

## 6. Account deletion

**Built 2026-08-26 (D-117).** Hard-delete. Settings → Account → Delete account,
and the same act on the locked screen. Type DELETE. The function cancels a
Stripe subscription if one exists, drops Vault secrets, and deletes the auth
user (every user-owned table already cascades). Apple subscriptions cannot be
cancelled from here — the confirm panel says so.

Privacy (`/privacy`) describes the in-app path first; email `hello@nuvo.day` is
the fallback when they cannot open the app.

Spec: [`account-deletion.md`](./account-deletion.md).

---

## 7. Scope justifications (paste-ready)

Each must argue why the *narrower* scope won't do. With `auth/calendar` that
argument is genuinely hard — which is itself the signal in §1.

**`https://www.googleapis.com/auth/calendar`**

> Nuvo is a personal planning application that places a user's own work onto the
> same timeline as their existing commitments. It needs this scope for three
> operations that narrower scopes cannot cover together:
>
> 1. **Read** events across all of the user's calendars, so the planning surface
>    shows true availability. `calendar.events.readonly` covers reading, but not 2 or 3.
> 2. **Create and maintain a dedicated secondary calendar** named "Nuvo," which
>    the user's scheduled work is mirrored into. This keeps Nuvo-generated blocks
>    separate from the user's own events and independently hideable.
>    `calendar.app.created` covers this, but not 3.
> 3. **Modify the user's existing events** — respond to invitations, change
>    times, and move events between calendars — from inside Nuvo, so replanning a
>    day doesn't require switching applications.
>
> All access is initiated by the user, applies only to their own account, and is
> used solely to deliver calendar sync and scheduling. Nuvo does not sell this
> data, does not use it for advertising, and does not use it to train generalized
> AI models.

**`https://www.googleapis.com/auth/userinfo.email`**

> Used only to identify which Google account the user connected, so it can be
> labelled in Settings and so reconnecting matches the existing connection rather
> than duplicating it. Not used for marketing or profiling.

---

## 8. Demo video

Unlisted YouTube, English, screen recording with narration. Required beats:

1. **Start at `nuvo.day`** — show the homepage, and the footer links to Privacy
   and Terms. Establishes the app is real and the policy is reachable.
2. **Sign in to Nuvo**, land in the app.
3. **Settings → Calendars → Connect Google.** Do not cut here.
4. **On the consent screen, pause and point out:**
   - the app name reads **Nuvo** (must match the Branding page exactly);
   - **the OAuth client ID is visible in the address bar** — zoom in;
   - the requested scopes are listed.
5. **Grant consent**, land back in Nuvo.
6. **Demonstrate each scope actually in use** — this is where submissions fail:
   - existing Google events appearing on the Schedule (read);
   - schedule a task → show it land in the "Nuvo" calendar **in Google Calendar
     itself**, in a second tab (write, secondary calendar);
   - open an existing Google event in Nuvo, change its time or RSVP → show the
     change reflected in Google Calendar (write, user's own events).
7. **Show disconnect** in Settings — reviewers look for revocability.

Narrate the *why* on each, not just the click. "Nuvo needs write access here
because…" is what the reviewer is grading.

---

## 9. Sequence

```
1. Check the Sensitive/Restricted chip in Data Access      ← branches everything
2. Publish to Production unverified                        ← kills the 7-day expiry today
3. Set GOVERNING_LAW, deploy marketing                     ← ships Terms + prerendered legal pages
4. Verify nuvo.day in Search Console (project's account)
5. Fill Branding, submit for brand verification            ← automated, minutes
6. Move the redirect URI to api.nuvo.day, re-test OAuth
7. DECIDE: read-only Google, or commit to CASA
8. Record the demo video against the final redirect URI
9. Submit
```

Sensitive-only review runs ~10 days. Restricted plus CASA runs weeks to months —
budget for it before promising anyone a launch date.

---

## References

- [Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth)
- [OAuth App Verification Help](https://support.google.com/cloud/answer/13463073)
