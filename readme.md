# Nuvo

A single-user daily planning app: GTD inbox + task list + Google/M365 calendars on one
planning surface with drag-and-drop time blocking. Phase 1 of LifeOS — the daily driver
that replaces Akiflow.

**Core model decision:** a scheduled task IS a time block. One row in `tasks`:
`do_date` set + `start_time` null = planned for the day (unblocked); both set =
scheduled on the calendar. There is no separate event entity for tasks.

## Docs

[`docs/README.md`](docs/README.md) is the map. Two layers:

- **[`docs/product/`](docs/product/) — the why.** The canon
  ([`overview.md`](docs/product/overview.md)), the rules
  ([`principles.md`](docs/product/principles.md)), who it's for and the questions on their
  minds ([`personas.md`](docs/product/personas.md)), the story
  ([`brandscript.md`](docs/product/brandscript.md)), the field
  ([`landscape.md`](docs/product/landscape.md)), the bets
  ([`roadmap.md`](docs/product/roadmap.md)), the log
  ([`decisions.md`](docs/product/decisions.md)), the names
  ([`glossary.md`](docs/product/glossary.md)), and the methods for auditing
  ([`audit.md`](docs/product/audit.md)) and ideating
  ([`ideation.md`](docs/product/ideation.md)).
- **`docs/*.md` — the how.** Mechanism specs, each with its own status header.

## Stack

- **Frontend** — Vite + React 18 + TypeScript + Tailwind CSS 4. Pure SPA, static bundle,
  zero server runtime (Tauri-ready). Calendar UI is FullCalendar (timegrid + interaction),
  chosen over Schedule-X because external drag-in from the task rail is natively supported.
- **Backend** — Supabase: Postgres + RLS, Auth (Google), Edge Functions (Deno), pg_cron,
  pg_net, Vault, Realtime.
- **State** — TanStack Query + Supabase Realtime invalidation. Boring on purpose.

## Repo layout

```
src/                        SPA source
marketing/                  Public one-pager (separate Vite app + Vercel project)
packages/design/            Shared design tokens stub (app + marketing)
supabase/migrations/        schema, RLS, vault wrappers, rollover fn, cron jobs
supabase/functions/         edge functions (all server-side logic)
  google-oauth/             OAuth consent + callback, mirror-calendar setup
  google-sync/              full/incremental sync, watch channels, poll fallback
  google-webhook/           push notification receiver
  google-events/            write-back for real Google events (move/resize/retitle)
  task-mirror/              scheduled task → "Nuvo" Google calendar reconciler
  m365-oauth/               Microsoft identity platform OAuth
  m365-sync/                Graph calendarView delta polling (read-only)
  icloud-connect/           iCloud CalDAV connect (Apple ID + app-specific password)
  icloud-sync/              iCloud CalDAV read sync (per-calendar calendar-query)
  icloud-events/            iCloud CalDAV write-back (create/move/resize/delete)
  rollover/                 00:05 LA rollover + mirror cleanup
```

## Setup

### 1. Supabase project

```sh
supabase link --project-ref YOUR_REF
supabase db push                  # applies migrations
supabase functions deploy google-oauth google-sync google-webhook google-events \
  task-mirror m365-oauth m365-sync icloud-connect icloud-sync icloud-events \
  rollover agent
```

In the SQL editor, seed the two Vault secrets that pg_cron uses to invoke edge functions:

```sql
select vault.create_secret('https://YOUR_REF.supabase.co', 'project_url');
select vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'service_role_key');
```

Auth → Google only (disable the Email provider). Optionally disable signups after
your account exists (single-user app). New-user trigger seeds the four domains
(Work / Church / Trading / Family) and the settings row.

### 2. Edge function secrets

```sh
supabase secrets set \
  GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... \
  MS_CLIENT_ID=... MS_CLIENT_SECRET=... \
  APP_URL=https://your-app-host \
  OPENAI_API_KEY=sk-... \
  OPENAI_MODEL=gpt-4.1-mini
```

The Nuvo agent reads/writes tasks via the `agent` edge function. **Do not** put
`OPENAI_API_KEY` in the frontend `.env` — it lives in Supabase secrets only.
For local function dev: `supabase functions serve agent --env-file .env.local`.

- **Google Cloud Console:** OAuth client (web), redirect URI
  `https://YOUR_REF.supabase.co/functions/v1/google-oauth`, Calendar API enabled.
  Push notifications require the domain to be verifiable; if `events.watch` fails the
  app automatically falls back to 5-minute polling (check `sync_log`).
- **Microsoft Entra admin center:** app registration (personal + work accounts),
  redirect URI `https://YOUR_REF.supabase.co/functions/v1/m365-oauth`, delegated
  permissions `Calendars.Read`, `User.Read`, `offline_access`.
- **Apple Calendar (iCloud):** no cloud console and no app secret to register —
  Apple has no OAuth for calendars. Each user connects with their **Apple ID + an
  app-specific password** (Settings → Calendars → Connect Apple Calendar walks
  through generating one at [account.apple.com](https://account.apple.com/account/manage)
  → Sign-In and Security → App-Specific Passwords). The password is stored in
  Vault and used as the CalDAV credential; nothing goes in `supabase secrets`.

### 3. Frontend

```sh
cp .env.example .env    # fill VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm install
npm run dev             # or: npm run build → dist/ static bundle
```

## The flows layer (docs/execution-flows.md)

- **Four pools, one gate** — `inbox` (raw captures) → `backlog` (processed, deliberately
  undated: project/initiative tasks live here, never in the inbox, never on Today, never
  rolled) → **Week** (`sprints` row per week; tasks point at it via `sprint_id`) → Day
  (`do_date`, optionally a block). The Week is the only gate between the vertical and
  the calendar.
- **Flows** (◉ on the spine) — each one is inputs → boundaries → intelligence → one
  output. **Sunday** (Gain → Sweep → Bets → Pull → **Compose**): the Week Composer
  auto-blocks the committed week inside working hours and around immovable calendar
  events (morning deep work, batched small tasks, breathers, deadlines first) — you
  review and accept. **Summit** (quarterly: Quarter's Gain → Vows → Portfolio →
  Months). **Blueprint** (state a bet → the assistant proposes KRs + projects +
  ordered tasks → accept creates the subtree). Daily: Sunrise (morning plan, pulls
  from the Week pool, surfaces prepared tasks) and Sundown (leads with the day's
  gain, "back to week" for leftovers).
- **One task world** — the floors (`useVertical`) read/write live Supabase rows; the
  localStorage prototype is gone. Domain invested/quarter/last-touched derive from
  completed blocks. Calendar blocks and rail rows are tinted by domain color.
- **The assistant** (Nuvo, ⌘J) — one principle everywhere: it proposes into quiet
  pools; only you promote work toward the calendar. Endpoints on the `agent` edge
  function: `{scaffold:{projectId}}` (ordered project tasks), `{blueprint:{…}}`
  (initiative subtree), `{prepare:{taskId}}` (pre-work written to the task: approach,
  drafts, pitfalls — ✦ badge, surfaced at Sunrise, boosted in Now),
  `{narrate:{…}}` (one gain-framed sentence over the measured deltas).
- **Compose boundaries** — working hours in `user_settings`
  (`work_start_minutes`/`work_end_minutes`) and per-day contexts on the sprint
  (`day_contexts`: normal / ◐ light / ✈ travel / — off): travel days get no deep
  blocks, off days get nothing, light days stay half-empty. Both editable inside
  the Sunday flow.
- **Calibration** (`src/lib/calibration.ts`) — completed blocks are the evidence:
  the proven weekly pace (last 4 weeks) caps the composer (+15% room to grow), and
  the composed week gets a confidence read (planned vs proven, deep-work morning
  share, roll-rate friction per energy). No history → it says so instead of guessing.

After pulling: `supabase db push` (applies migrations 04-09 — incl. the
`recurrences` table) and `supabase functions deploy agent google-events`
(the latter gained native RRULE support for repeating calendar events).

Apple Calendar support (migration `…32_icloud.sql` + the `icloud-*` functions)
also arrives via `supabase db push` and
`supabase functions deploy icloud-connect icloud-sync icloud-events`. No new
`supabase secrets` are required — the credential is each user's app-specific
password, entered in the app.

## Behavior notes

- **Rollover** runs at 00:05 America/Los_Angeles via pg_cron (scheduled at both 07:05
  and 08:05 UTC; the function is idempotent against the current LA date, so the
  off-DST run is a no-op). The client also invokes it defensively on the first open
  of a new day. Rolled tasks: `do_date = today`, `start_time` cleared, duration kept,
  `roll_count + 1`, mirror event deleted, ↻ badge in the Today list.
- **Overdue** = 1 hour after a block's end (start + duration + 60 min grace), styled in
  signal orange and pinned to the top of Today.
- **Mirror calendar** — first Google connect finds-or-creates a calendar named **"Nuvo"**.
  Every scheduled task is reconciled to it (create on block, update on move/resize/
  retitle, ✓-prefix on completion, delete on unblock/trash/roll). One-directional:
  the app's version always wins.
- **Repeating tasks & slots** — a `recurrences` row holds the rule (daily / weekly
  with weekday picks / monthly, an interval, and an optional end) plus the template
  every occurrence is stamped from. Occurrences are *materialized* as ordinary
  `tasks`/`slots` rows up to a 35-day horizon (`HORIZON_DAYS`), topped up client-side
  on every app open and after rollover — so drag, resize, and slot-children all keep
  working with zero special-casing. A recurring occurrence **never rolls over** (a
  missed one is just missed; tomorrow already has its own). If a repeat skips the
  day you drew on (e.g. "every weekday" on a Saturday) the create card says "first
  on Mon Jun 15" and the calendar jumps to that first occurrence so it never seems
  to vanish. Set a repeat from the drag-to-create card or the ↻ chip in a task/slot
  popover; editing one occurrence (drag/resize) pins it so a later "edit all" leaves
  it be. Deleting offers **this occurrence · this & following · whole series**.
  Materialized occurrences are *not* pushed to the Google "Nuvo" mirror calendar —
  firing ~25 concurrent mirror writes raced on the OAuth token refresh and 500'd, so
  series live in Nuvo only for now (phone-mirroring a series is a follow-up).
  Repeating **calendar events** are handled natively by Google (an RRULE on create);
  the read-sync pulls the instances back and the existing THIS/ALL dialog edits them.
- **Slot titles auto-derive** — a time slot's name is an optional override. Unnamed,
  it shows its project, a domain its children share, or a time-of-day label
  ("Morning · 3 tasks") — so you drop a container on the grid and fill it without
  ever naming it.
- **M365** events are read-only: striped fill, dashed border, not draggable.
- **Apple Calendar (iCloud)** is two-way over CalDAV. All of the account's
  calendars are discovered and polled every 15 min (`icloud-sync`, a
  `calendar-query` REPORT per collection whose iCalendar is fed through the same
  `parseIcs` the ICS feeds use). Events render and behave like Google's: drag /
  resize / retitle / delete write straight back via `icloud-events` (CalDAV
  `PUT`/`DELETE`), and new events can be created on an iCloud calendar. Times are
  written as UTC. Editing a *single occurrence* of a repeating series is
  best-effort (the `RECURRENCE-ID`/`EXDATE` are emitted in UTC); whole-series and
  non-recurring edits are exact. A bad or revoked app-specific password flips
  `needs_reconnect`, surfacing the reconnect banner like any other provider.
- **Token failures** flip `needs_reconnect` on the account, which surfaces the orange
  reconnect banner — sync never fails silently. All sync operations write to `sync_log`.

## Keyboard

`⌘K` capture/command bar · `⌘J` Nuvo assistant · `C` focus capture · `P` new project · `I` new initiative ·
`1/2/3` inbox/week/today · `↑↓/jk` navigate · `Enter` open · `E` today · `T` tomorrow · `W` next week ·
`S` pick date/time · `D` done · `X` trash · `#` labels · `Esc` close

The fast composer (`P` / `I`, or any **+ new** button) is a Todoist-quick lane: pick a domain,
name it, then rattle off subtasks — `⏎` drops the next line, `⌘⏎` saves the whole thing in one
write. `more options…` swaps in the full moment (outcome, context, AI-drafted backlog).

Capture syntax: `call David tomorrow 9am 30m #church !high` — chrono-node dates,
`30m/1h/1h30` durations, `#label`, `!low/!medium/!high`.
