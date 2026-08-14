# Calendar & Task remediation — what shipped, and what didn't

**Status:** P0 complete · P1 partial · background push shipped · 2026-08-13
**Answers:** [`calendar-task-completeness-audit-2026-08-12.md`](./calendar-task-completeness-audit-2026-08-12.md)
**Plan + the trades it took:** [`calendar-task-remediation-2026-08-12.md`](./calendar-task-remediation-2026-08-12.md)

47 files, ~2,900 lines. Four migrations (57–60), applied. Three edge functions
deployed (`agent`, `icloud-events`, `task-mirror`). `npm run typecheck` clean,
`npm test` 855 passing (+55 new), `npm run build` green.

Every line below was **driven in the running dev app against real data**, on the
desktop layout and at 375px, except where the row says otherwise.

---

## 1 · Shipped — P0

### P0-1 · Reminders (closes: Calendar §Reminders ❌ · Tasks §Reminders ❌ · **rank 1**)

Nuvo can speak first, for the first time — and only about a commitment that is
minutes away.

| | |
|---|---|
| Kernel | `supabase/functions/_shared/reminderRules.ts` — one implementation, both runtimes. Takes an anchor instant and a lead, **and nothing that could express a nudge** |
| Data | `user_settings.reminder_prefs` (defaults; `enabled: false`) · new syncable `reminders` table (overrides only) · migration 57 |
| Anchors | a meeting starting · a block you scheduled starting · a deadline arriving. Three, and no more |
| Delivery | one `setTimeout` armed for the single next fire, re-armed on wake. No polling, no per-item timers, nothing on the render path. Stale reminders are dropped, not queued (`REMINDER_GRACE_MS`). **Foreground only** — see §3 |
| Desktop | Settings → **Reminders** · a Remind row on the event, task and slot popovers |
| Mobile | the same control in `MobileEventSheet` and the task Sheet — a native `<select>`, so it is iOS's own wheel, not a cursor-anchored popover |
| Keyboard | **B** on a focused row opens the Remind picker (arrow/Enter/Esc); listed in `?` |
| Agent | `set_reminder` · `clear_reminder` · `list_reminders`, with the lead vocabulary shared with the picker |
| Tests | `tests/reminders.test.ts` — 27, including one that fails if the kernel ever grows an input that could express a nudge |

**Verified:** turned on in Settings → the permission state read back honestly
("Notifications are blocked" under headless Chrome) → set a task's lead to 30m →
**survived a full page reload** → restored to default → turned back off.

> Reminders are **off** in your account. I turned them on only to verify and
> turned them back off, because off is the designed default and I wasn't going
> to have the app start talking to you overnight. Settings → Reminders.

### P0-2 · Calendar search (closes: Calendar §Search ❌ · **rank 2**)

"When did I last meet Sam" is answerable inside Nuvo.

- `lib/eventSearch.ts` — two bounded queries, *next matches ahead* and *most
  recent behind*, because a calendar question is almost always one or the other.
- `SearchHitData.kind` gains `"event"`; `SpotlightNav` gains an event intent
  carrying the **date**, because the grid has to travel before the row is loaded.
- `lib/calendarReveal.ts` — a one-shot bus, so ⌘K, the ⌥Space window and the
  phone all land the same way. It fires again for the same date (searching one
  meeting twice must work) and holds a reveal for a grid that mounts a frame later.
- Local hits stay instant; calendar hits arrive async into their own group, last,
  so nothing under the cursor moves when they land. Offline says so.
- Agent: `search_events`.
- Tests: `tests/event-search.test.ts` (6).

**Verified:** ⌘K → "sync" → a **Calendar** group of real meetings → clicked one →
the grid travelled to Fri Aug 14 and opened the event's popover.

### P0-3 · Trash and restore (closes: Tasks §Archive ⚠️ · **rank 8**)

`status = "trashed"` had been written since the beginning and listed nowhere.

- Migration 58: `tasks.trashed_at`, backfilled, indexed.
- A **Trash** face on the rail's existing tab strip and on the phone's Tasks
  segmented control — appearing only when it holds something, so it is not a
  sixth destination (P10). Restore · Delete forever (confirm-in-place).
- Restore lands via `restingStatus()`, never on a date that has since passed.
- Keyboard: **U** restores; **X** is inert on the trash face, because permanent
  deletion never rides a bare keystroke.
- Agent: `list_trashed_tasks` · `restore_task` · `purge_task` (confirm-gated,
  and it searches the **trash**, never live tasks).

**Verified:** your account had **100+ tasks sitting in this state, invisible**.
Restored one → it left the trash and appeared in the Inbox → Undo put it back.

### P0-4 · Recurrence ceiling (closes: Calendar/Tasks §Recurring ⚠️ · **rank 4**)

- `freq` gains `yearly`. `bysetpos` + `bymonth` added — "the last Friday of the
  month", "the fourth Thursday of November".
- `-1` counts back from the end, so "last Friday" doesn't drift a week in
  five-Friday months. A day-of-month a month can't hold is skipped, not rolled.
- **The lossy round-trip is fixed**: `fromGoogleRRULE` now reads both `BYSETPOS`
  and the `BYDAY=-1FR` shorthand. An inbound Google series no longer degrades to
  "every Friday" on an ALL-scope edit.
- Picker: a **Year** tab, and the sentence "On the 14th of the month" became a
  *control* — by-date or by-position. New presets surface both by name.
- Migration 59, with a check making by-date and by-position mutually exclusive.
- Agent: `create_recurring_task` gains `freq: yearly`, `bysetpos`, `byweekday`.
- Tests: +15 in `tests/recurrence.test.ts`.

**Verified:** the repeat menu on a real task now offers *Monthly on the second
Thursday* and *Annually on August 13*.

### P0-5 · Subtasks / checklists (closes: Tasks §Subtasks ❌ · **rank 5**)

A task is no longer a leaf — and a step is **not** a task.

- Migration 60: `tasks.parent_task_id`, plus a CHECK forbidding a step every
  field that would make it schedulable, a trigger keeping steps one level deep,
  and rollover taught to skip them.
- **Every task read now excludes steps** — the load-bearing line, enforced by a
  test that walks the query files rather than trusting anyone to remember.
- `TaskSteps.tsx`: one component, both shells. Hairline rows, a progress bar,
  and Enter / ⌫-on-empty / Esc.
- Agent: `add_step` · `complete_step` · `list_steps` · `remove_step` — and a test
  asserting no step tool accepts a scheduling argument.
- Tests: `tests/task-steps.test.ts` (7).

**Verified:** added two steps to a real task, watched the progress read 0/1,
removed them. Caught and fixed a real bug doing it — `createTask` seeded its
optimistic row into *every* task cache, which flashed a checklist line into the
Inbox.

### P0-6 · Undo on calendar writes, and redo (closes: Calendar §Undo ⚠️ · **rank 7**)

- `useUndoStack` grows a redo stack and **⇧⌘Z**. Cleared by any new act.
- `track()` now takes the forward patch instead of a closure — so **every task
  act is redoable**, not a hand-picked few.
- `useCalendar` recorded *nothing* before. Now: event create, delete, RSVP,
  move-to-calendar and field edits all name their inverse. Geometry is
  deliberately excluded — drag/resize record their own, and a second entry would
  make ⌘Z take two presses.
- The delete confirmation stopped saying "This can't be undone", because for a
  single occurrence it now can. It still says so for a whole series, and says
  plainly that a cancellation notice can't be recalled.

---

## 2 · Shipped — P1

| Fix | Closes |
|---|---|
| **RSVP reaches iCloud.** `useCalendar` no longer hardcodes `google-events`; `icloud-events` gained an `rsvp` action that rewrites the user's own `ATTENDEE` PARTSTAT and PUTs it back (`setPartstat` in `_shared/icalwrite.ts`, folding-aware, touches nobody else's line) | rank 9 |
| **The agent can say yes.** `rsvp_event` (accepted/tentative); `decline_event` keeps its confirm gate and now routes by provider, naming M365/ICS as read-only instead of failing generically | rank 9 |
| **Event duplication** — on the desktop event menu and as `duplicate_event`. Guests and recurrence deliberately don't carry | Calendar §Event duplication |
| **`task-mirror` no longer stamps `America/Los_Angeles`** on every user's block. The device zone rides the request through one `mirrorTask()` helper, so no call site can forget it | part of rank 3 |
| **`update_task` widened** — `duration_minutes`, `energy`, `project_id`, `domain_id`. Filing carries initiative + domain together, so it can't reproduce D-088 | Cross-cutting §Agent coverage |

---

## 3 · Not done — and why

**These are honest gaps, not oversights.** Each was in the plan; each was cut
against the clock, in this order.

| Gap | Why it isn't here |
|---|---|
| **Completion-anchored repeat** ("every 3 days *after I last did it*") | The rest of P0-4 shipped. This one changes *materialization*, not the rule: it needs one open occurrence at a time, regenerated on completion, which touches `useRecurrence`, the rollover function and the agent's series creation. Half-done it produces a series that displays but doesn't exist — the exact failure N-15 was reverted for. Column not added; nothing half-built to clean up. |
| **Filters and saved views** (rank 6) | Untouched. The design in the plan holds: a `TaskQuery` value type with one pure `matchesQuery` shared by rail, table and agent, saved into `user_settings` (not a new table, not a new pool). |
| **Bulk actions beyond four verbs; any bulk on the phone** | Untouched. |
| **Desktop agenda view · phone week grid · year view** (rank 10) | Untouched. Both halves are layouts over `buildDayPlan`, which already exists — this is the cheapest remaining item. |
| **Attendee free/busy** (rank 10) | Untouched. Needs a provider free/busy call per attendee; a real feature, not a fix. |
| **Two-way mirroring** (rest of rank 3) | The timezone half shipped. Making a Google-side edit survive the reconcile is a genuine model change (who wins), and mirroring to iCloud at all needs a `mirror_calendar_id` equivalent that only `google-oauth` sets today. |
| **Search depth** — notes body, completed tasks, operators | Title-only still. |
| `.ics` import/export · M365 write-back · per-event timezone · event attachments · event templates · place autocomplete · Zoom/Teams minting · per-weekday hours · sections · task kanban · per-task history · multi-day timed events · queuing external-event writes offline | P2 in the plan; unchanged. |

### Shipped after this changelog was first written

- **Background push** (D-105, [`push-notifications.md`](./push-notifications.md)).
  Reminders now reach a closed app. The interesting half is reconciliation:
  nothing speaks without winning an atomic claim on `(user, reminder, fire
  instant)` — the unit is the PERSON, not the device — and the dispatcher gives
  an open app a 30s head start, so someone in front of Nuvo gets the in-app
  notification and no push at all.

### What still needs a human, in priority order

| # | What | Why it needs you |
|---|---|---|
| 1 | **No push has reached a real device** | The VAPID pair is set and *proven to sign* (`{"selfTest":true}` → `ok`, `matchesClient`), but signing is not delivering. Needs a phone with the PWA installed to the Home Screen and permission granted — §4 of `push-notifications.md`. Until someone sees a notification on a lock screen, this feature is unverified. |
| 2 | **Reminders are off** in Phil's account | Turned on only to verify, then back off, because off is the designed default. Settings → Reminders. |
| 3 | **The Tauri shells get no notifications at all** | Mac and iOS run no service worker by design. While running they *could* show native ones via `tauri-plugin-notification` (not installed); quit-state on iOS needs APNs. Neither is built, and the Mac app being usually-open is the only reason this isn't louder. |
| 4 | **`icloud-events` RSVP never answered a real invite** | Deployed, shaped like the existing CalDAV paths, never exercised. Phil's working calendar is ICS (read-only), so it couldn't be. |
| 5 | **`npm run eval` never run** | 13 new agent capabilities are pinned by deterministic tests only. Worth `npm run eval -- --repeat 5` before leaning on the new chat verbs. |

---

## 4 · Docs kept in step

- [`agent-conformance.md`](./agent-conformance.md) — 13 new rows across the
  Capture and Calendar groups. Every one is `◐` with its reason: they are pinned
  by deterministic tests, not by live-model scenarios. `npm run eval` was **not**
  run (it costs tokens and needs a live model) — worth running before you lean on
  the new chat capabilities.
- The agent prompt gained three sections (the trash · reminders · RSVP and
  duplication) and its baseline was re-recorded in the same change, per the rule.
- `ShortcutsModal` gained **B**, **U**, ⌘Z and ⇧⌘Z. `KEYBOARD_SHORTCUTS.md` is
  still stale against it — the audit noted that, and it is still true.

**Shipped to `master`.** Migrations 57–61 applied; `agent`, `icloud-events`,
`task-mirror` and `push-dispatch` deployed. Pushing to `master` runs
`release.yml`, so this is live in installed desktop apps.
