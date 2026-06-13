# Apple Watch — quick capture from the wrist

Goal: dictate a task on the watch and have it land in Nuvo, fast, with no
phone in hand. This note covers what's feasible, the recommended path, and a
recipe you can set up today.

## TL;DR

You do **not** need to build and ship a native watchOS app to capture from the
watch. Nuvo already exposes an authenticated **agent** Edge Function that can
create tasks from natural language. The fastest, zero-app-review path is:

> **Siri / Apple Shortcuts on the watch → POST to the `agent` function → task created.**

This works on every Apple Watch today, supports dictation, and reuses the exact
brain the in-app assistant uses (so "call David tomorrow 9am 30m" parses the
same way). Build a native app later only if you want a glanceable complication
or an offline queue.

---

## Path 1 — Shortcuts + the agent endpoint (recommended, ship this week)

The `agent` function (`supabase/functions/agent`) authenticates with a standard
Supabase user bearer token (`requireUser`) and has a `create_task` tool. So any
HTTP client with your token can capture a task.

### One-time setup

1. **Get a long-lived token.** Two options:
   - Easiest: in the web app, open the console and run
     `localStorage` lookup for the supabase auth token, or call
     `supabase.auth.getSession()` and copy `access_token`. These expire (~1h),
     so for a durable Shortcut prefer the next option.
   - Durable: copy the **refresh token** from the session and have the Shortcut
     first call `POST {SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`
     with `{ "refresh_token": "…" }` and the `apikey` header set to the anon
     key. Use the returned `access_token` for the capture call. (A Shortcut can
     chain these two requests; store the refresh token in a private Shortcut
     text field.)

2. **Note your values** (from the web app's `.env` / Supabase dashboard):
   - `SUPABASE_URL` → `https://<project-ref>.supabase.co`
   - `SUPABASE_ANON_KEY` → the `apikey` header value

### The capture Shortcut

Create a Shortcut named **"Add to Nuvo"** (works on watch + phone + "Hey Siri"):

1. **Dictate Text** (or **Ask for Input** → "What's the task?").
2. *(If using refresh tokens)* **Get Contents of URL**
   - URL: `https://<project-ref>.supabase.co/auth/v1/token?grant_type=refresh_token`
   - Method: `POST`
   - Headers: `apikey: <anon key>`, `Content-Type: application/json`
   - Body (JSON): `{ "refresh_token": "<your refresh token>" }`
   - **Get Dictionary Value** `access_token` from the result.
3. **Get Contents of URL** — the capture call:
   - URL: `https://<project-ref>.supabase.co/functions/v1/agent`
   - Method: `POST`
   - Headers:
     - `Authorization: Bearer <access_token from step 2, or a fresh token>`
     - `apikey: <anon key>`
     - `Content-Type: application/json`
   - Request Body (JSON):
     ```json
     {
       "messages": [
         { "role": "user", "content": "Add a task: <Dictated Text>" }
       ],
       "rangeStart": "<ISO start of today>",
       "rangeEnd": "<ISO end of today>"
     }
     ```
     `rangeStart`/`rangeEnd` can be any 24h window — they only scope the day
     context the agent reads. Use **Current Date** → Format if you want them
     exact; otherwise hardcoded same-day values are fine for pure capture.
4. *(Optional)* **Show Notification** with the agent's `reply` so the watch
   confirms "Added: …".

Add the Shortcut to the **watch face / Smart Stack** or trigger it with
"Hey Siri, Add to Nuvo". Dictation → task, hands-free.

### Why this is the right first step
- **Zero new backend.** The endpoint and `create_task` tool already exist.
- **No App Store / provisioning.** No Apple Developer paid membership required
  just to capture.
- **Same NLP** as the app — dates, durations, `#labels`, `!priority` all work.

### Optional hardening (small, in this repo)
If you want a leaner, cheaper capture call that skips the LLM round-trip, add a
tiny `capture` Edge Function that mirrors the web `parseCapture` + the
`useTaskMutations.create` insert (title/do_date/start_time/duration/priority/
labels). It would be ~40 lines and shave latency/cost off each wrist capture.
The agent path works without it; treat this as a follow-up.

---

## Path 2 — Native watchOS app (later, if Path 1 isn't enough)

Reasons to graduate to native:
- A **complication** on the watch face that taps straight into capture.
- A **glance** at "Right now" / today's count.
- **Offline queue** that syncs when the watch reconnects.

Shape of the work (cannot be built or tested in this Linux repo — needs a Mac
with Xcode + a paid Apple Developer account for signing):
- A SwiftUI watchOS target. For capture, a `TextField`/dictation view that
  POSTs to the same `agent` (or future `capture`) function with the user's
  token — identical contract to Path 1.
- Auth: do the Supabase email/password (or magic-link) exchange against
  `{SUPABASE_URL}/auth/v1/…`, store the refresh token in the Keychain, refresh
  access tokens as needed. No new server code required — Supabase GoTrue is a
  plain REST API.
- Read views (today / Right now) can hit Supabase REST (`/rest/v1/tasks?…`)
  with the same token and RLS, or a small read endpoint.

Estimate: ~1–2 days for a capture-only watch app once a Mac/Xcode/dev account
is in place; more for complications + offline.

### Recommendation
Set up **Path 1 today** for dogfooding (it fully delivers "input quickly from
the watch"). Revisit Path 2 only if you find yourself wanting a face
complication or offline capture after living with it.
