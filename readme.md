# Nuvo

A single-user daily planning app: GTD inbox + task list + Google/M365 calendars on one
planning surface with drag-and-drop time blocking. Phase 1 of LifeOS — the daily driver
that replaces Akiflow.

**Core model decision:** a scheduled task IS a time block. One row in `tasks`:
`do_date` set + `start_time` null = planned for the day (unblocked); both set =
scheduled on the calendar. There is no separate event entity for tasks.

## Stack

- **Frontend** — Vite + React 18 + TypeScript + Tailwind CSS 4. Pure SPA, static bundle,
  zero server runtime (Tauri-ready). Calendar UI is FullCalendar (timegrid + interaction),
  chosen over Schedule-X because external drag-in from the task rail is natively supported.
- **Backend** — Supabase: Postgres + RLS, Auth (email), Edge Functions (Deno), pg_cron,
  pg_net, Vault, Realtime.
- **State** — TanStack Query + Supabase Realtime invalidation. Boring on purpose.

## Repo layout

```
src/                        SPA source
supabase/migrations/        schema, RLS, vault wrappers, rollover fn, cron jobs
supabase/functions/         edge functions (all server-side logic)
  google-oauth/             OAuth consent + callback, mirror-calendar setup
  google-sync/              full/incremental sync, watch channels, poll fallback
  google-webhook/           push notification receiver
  google-events/            write-back for real Google events (move/resize/retitle)
  task-mirror/              scheduled task → "Nuvo" Google calendar reconciler
  m365-oauth/               Microsoft identity platform OAuth
  m365-sync/                Graph calendarView delta polling (read-only)
  rollover/                 00:05 LA rollover + mirror cleanup
```

## Setup

### 1. Supabase project

```sh
supabase link --project-ref YOUR_REF
supabase db push                  # applies migrations
supabase functions deploy google-oauth google-sync google-webhook google-events \
  task-mirror m365-oauth m365-sync rollover agent
```

In the SQL editor, seed the two Vault secrets that pg_cron uses to invoke edge functions:

```sql
select vault.create_secret('https://YOUR_REF.supabase.co', 'project_url');
select vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'service_role_key');
```

Auth → disable signups after creating your account (single-user app). New-user trigger
seeds the four domains (Work / Church / Trading / Family) and the settings row.

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

After pulling: `supabase db push` (applies migrations 04-06) and
`supabase functions deploy agent`.

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
- **M365** events are read-only: striped fill, dashed border, not draggable.
- **Token failures** flip `needs_reconnect` on the account, which surfaces the orange
  reconnect banner — sync never fails silently. All sync operations write to `sync_log`.

## Keyboard

`⌘K` capture/command bar · `⌘J` Nuvo assistant · `C` focus capture · `1/2/3` inbox/week/today · `↑↓/jk` navigate ·
`Enter` open · `E` today · `T` tomorrow · `W` next week · `S` pick date/time ·
`D` done · `X` trash · `#` labels · `Esc` close

Capture syntax: `call David tomorrow 9am 30m #church !high` — chrono-node dates,
`30m/1h/1h30` durations, `#label`, `!low/!medium/!high`.
