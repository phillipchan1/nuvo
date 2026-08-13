# Calendar & Task remediation — phased plan

**Status:** in progress · 2026-08-12 · closes rows in
[`calendar-task-completeness-audit-2026-08-12.md`](./calendar-task-completeness-audit-2026-08-12.md)

The audit read the code and found 10 ranked gaps plus a long tail. This is the plan that
answers it: what we fix, in what order, and — for the three places where the fix argues with
a decision we already made — what the trade is, stated before any code was written.

**The one rule that shapes every design below:** Nuvo is not becoming a general-purpose
calendar or a general-purpose to-do app. Every fix here has to close the gap *in the
planner's own vocabulary*, or it isn't the fix. Where the mature-app answer would add a
fifth pool or a second name, we take the smaller version deliberately and say so.

---

## 1 · Triage

**P0 — breaks something a user takes for granted.** Data loss, a promise the app makes and
then doesn't keep, or a thing that cannot be expressed at all.

| # | Gap | Audit row | Why P0 |
|---|---|---|---|
| **P0-1** | No reminders or notifications of any kind | Calendar §Reminders · Tasks §Reminders · rank 1 | The app holds your deadlines and never speaks. It quietly reinstates a second reminder system. |
| **P0-2** | The calendar is unsearchable on every surface | Calendar §Search · rank 2 | "When did I last meet Sam" is unanswerable inside Nuvo. |
| **P0-3** | A trashed task is unrecoverable after ~6s | Tasks §Archive · rank 8 | Silent data loss with no floor. |
| **P0-4** | Recurrence ceiling: daily/weekly/monthly-by-date only | Calendar §Recurring · Tasks §Recurring · rank 4 | "Last Friday of the month" and "every year" are *unrepresentable*, and inbound Google series round-trip lossily. |
| **P0-5** | No subtasks / checklists | Tasks §Subtasks · rank 5 | A task is a leaf. Table stakes in every comparable app. |
| **P0-6** | Calendar writes record no undo; no redo anywhere | Calendar §Undo · rank 7 | Event delete is explicitly permanent — data loss again. |

**P1 — materially behind a mature app, but workable today.**

| # | Gap | Audit row |
|---|---|---|
| **P1-1** | RSVP is Google-only; the agent can only decline | Calendar §Attendees · rank 9 |
| **P1-2** | No Duplicate on an external event | Calendar §Event duplication |
| **P1-3** | Agent tool coverage holes (14 human-only paths) | Cross-cutting §Agent tool coverage |
| **P1-4** | No filters or saved views | Tasks §Filters · rank 6 |
| **P1-5** | Bulk actions: four verbs, desktop-only | Tasks §Bulk actions |
| **P1-6** | Views split across shells (no desktop agenda, no phone week grid) | Calendar §Views · rank 10 |
| **P1-7** | `task-mirror` hardcodes `America/Los_Angeles`; mirroring is Google-only | Cross-cutting §Time-blocking · rank 3 |
| **P1-8** | Search is title-only, no notes body, no completed | Tasks §Search |

**P2 — polish, deferred with reasons.** Year view · attendee free/busy · `.ics`
import/export · M365 write-back · per-event timezone · event attachments · event templates ·
place autocomplete · Zoom/Teams link minting · per-weekday working hours · user-created
sections · task kanban by status · per-task completion history · multi-day *timed* events ·
all-day drag-resize · queuing external-event writes offline · per-task comments.

Everything the audit marked **(by design)** — sharing, custom fields, task dependencies —
stays unbuilt. Those are correct.

---

## 2 · Conflicts with decisions we already made

Three of the P0/P1 fixes argue with something in
[`decisions.md`](./product/decisions.md). Each is stated as a trade, not resolved by
silence.

### 2.1 · Reminders vs **N-07** ("Push notifications for planning nudges — no") and **Principle 9** ("Quiet by default … no notification theater")

**The conflict is real and it is the biggest one in this plan.** N-07 refused notifications
outright. Principle 9 names "notification theater" as a violation by example.

**But N-07 wrote its own escape clause**, verbatim: *"Would change if… Time-critical **now**
signals only, opt-in."* And Principle 9's why-clause reserves signal for exactly one thing:
`--signal` is *now*.

**The trade we're taking.** Build reminders strictly inside that clause, and encode the
clause in the code rather than in a comment:

- **Only three anchors may ever fire**: a meeting about to start, a block you scheduled
  about to start, a deadline arriving. All three are facts about the next few minutes, not
  opinions about your week.
- **Never a nudge.** No "you haven't planned your week", no "3 tasks are overdue", no
  streaks, no re-engagement. The kernel that decides what fires (`reminderRules.ts`) has no
  input that could express one — it takes an anchor instant and a lead, and nothing else.
- **Opt-in, off by default.** A fresh account gets silence until it asks. Not "on with a
  dismiss".
- **One line, no theater.** Title + when. No emoji, no counts, no badges.

**What we give up:** the app now speaks first, which it never did. That is a genuine change
to the identity, and it is the reason this is written down here and logged as a decision
rather than shipped quietly. If it feels like theater in use, the kill switch is one
setting, and the ledger row it closes (A2) goes back to ◐ honestly.

Ledger: closes part of **A2** ("What's about to blow up?", ◐) and reinforces **D4**.
Strains **P9**. Not a pool (P10) — it adds no noun to the funnel.

### 2.2 · Subtasks vs **Principle 10** ("Don't add a pool, a name, or a place without paying for it")

A subtask looks like a fifth pool and reads like a second name for "task".

**The trade we're taking: a subtask is not a task.** It is a *step* — a checklist row on the
task that owns it — and the schema enforces the difference by what a step is forbidden to
have:

| A step may have | A step may **never** have |
|---|---|
| a title, a done state, an order | a `do_date`, a `start_time`, a `duration`, a `deadline` |
| its parent | a project / initiative / domain / sprint / priority of its own |
| — | a recurrence, a slot, labels, a mirror event |

So a step never appears on the calendar, never enters the inbox, never counts in capacity,
never reaches the funnel's rollups, and can't be planned. It cannot become a second task
pool by accident, because none of the fields that make a task schedulable exist on it. One
level only — a step has no steps.

This is why the implementation reuses the `tasks` table (`parent_task_id`) rather than
minting a `steps` table: one row of truth (P1), and the guard lives in a single predicate
(`isStep`) that every read filter already has to call.

Ledger: **Q4** ("What are the actual steps?", ◐) at the task altitude. Strains **P10**;
paid for by the field ban above, which is what keeps the vocabulary at four pools.

### 2.3 · Calendar search vs **the `external_events` doctrine** (N-15's "still NOT syncable" note)

`external_events` is deliberately a mirror the sync job rewrites wholesale, and it is
deliberately outside the offline outbox. Search wants to read *all* of it — including
months the calendar grid never asked for.

**The trade we're taking: search reads the server, live, and says so.** It does not
pre-cache the mirror into IndexedDB (that would grow the local database without bound and
re-introduce exactly the write amplification that caused the splash-hang outage). Instead:

- Vertical hits (tasks/projects/initiatives/domains) stay **instant and local**, exactly as
  today — typing never waits.
- Event hits arrive **asynchronously, from a bounded server query**, and render into their
  own group as they land. The list never blocks, never reorders under the finger, and never
  shows a spinner in place of results you already have.
- Offline, the event group renders one honest line ("Events need a connection") rather than
  lying by omission.

That keeps the "butter smooth" constraint literally true: the keystroke path is unchanged.

---

## 3 · Designs

Each design states data → API → UI (both shells) → keyboard → agent. Anything without all
five is not done.

### P0-1 · Reminders

**Kernel.** `supabase/functions/_shared/reminderRules.ts` — pure, zero imports, importable
by the SPA and the agent, per the one-rule-two-runtimes law. It owns:

- `ReminderLead` — the vocabulary of leads (`0 | 5 | 10 | 15 | 30 | 60 | 120 | 1440`, plus
  `off`).
- `resolveFireAt(anchorISO, leadMinutes)` → the instant.
- `remindersFor(items, settings, overrides, now)` → the *derived* set. **Most reminders are
  never rows.** Defaults in settings produce them from the day plan; a row exists only when
  the user overrode or silenced one item. That is the low-data-entry principle applied to a
  notification system.
- `reminderCopy(item)` → `{ title, body }`, one line, no theater.
- `dueNow(set, now, alreadyFired)` → what to fire this tick.

**Data.**
- `user_settings.reminder_prefs jsonb` — `{ enabled, event_lead, block_lead, deadline_lead,
  deadline_time_minutes }`. `enabled` defaults **false**.
- New syncable table `reminders` — the override/one-off row: `{ id, user_id, target_kind
  ('task'|'slot'|'event'), target_id, event_key, lead_minutes (null = silenced),
  fire_at, created_at, updated_at, field_ts }`. Joins `SYNC_TABLES` and the `apply_patch`
  allowlist (migration 57), so a reminder set on a plane still lands.
- `event_key` (not a FK) for external events, because the mirror row id is not stable
  across a resync — the same reason `hidden_events` is keyed that way.

**API.** None new. The SPA writes through the outbox; the agent writes through the service
role, both against the same kernel.

**UI — desktop.** The event popover and the task record grow one **Remind** row (the same
detail-popover grammar the last commit unified). Settings → Notifications holds the
defaults and the permission prompt.
**UI — mobile.** The same row inside `MobileEventSheet` / the task detail Sheet, as a
`Sheet`-based picker (never a cursor-anchored popover), 44px targets.

**Delivery.** `useReminders()` — one hook, mounted once in the shell. It reads the caches
already loaded (no new query), asks the kernel what fires next, and arms a **single**
timer for that instant. Firing = `Notification` when permission is granted, an in-app
`--signal` toast otherwise. Fired keys live in `localStorage` so a refresh doesn't re-fire.
One timer, recomputed only when the day plan actually changes — no polling loop, no
per-item timers, nothing on the render path.

**Keyboard.** `M` on a focused task/event row opens the Remind picker; the picker is
arrow-navigable and `Esc`-dismissable. Registered in `ShortcutsModal`.

**Agent.** `set_reminder` (target + lead, field-level), `clear_reminder`, `list_reminders`.

### P0-2 · Calendar search

**Data.** None. `external_events` already has `title` and `location`; a trigram index on
`title` is added for the bounded query.

**API.** None — a direct PostgREST `ilike` with a hard `limit`, ordered by `start_at desc`
(most recent first is what "when did I last meet Sam" wants).

**UI.** `buildSearchHits` grows a fifth kind, `event`, with a nav intent that lands on the
calendar at that date with the event's popover open. Desktop ⌘K and ⌥Space share the
builder (they already do); `MobileSearch` grows an Events group. Async, per §2.3.

**Keyboard.** Already covered by ⌘K's existing arrow/enter model — the new group joins it.

**Agent.** `search_events` (query, optional date window, limit).

### P0-3 · Trash & restore

**Data.** None — `status = "trashed"` already exists; nothing lists it. Add
`tasks.trashed_at` so a trash view can sort by when, and so a future auto-purge has an
anchor.

**UI.** Trash is **not a sixth navigation destination** (P10). It is a face inside the
existing Inbox surface — one more segment on the rail's band control and on the phone's
Tasks segmented control — holding trashed tasks newest-first with **Restore** and **Delete
forever**. Restore uses `restingStatus()`, so a restored task lands where the state machine
says it belongs, not where it was.

**Keyboard.** `U` restores the focused row; `⌫` on an already-trashed row deletes forever
(with a confirm). Reuses the rail's existing `J/K` focus model.

**Agent.** `list_trashed_tasks`, `restore_task`, `purge_task`.

### P0-4 · Recurrence ceiling

**Kernel** (`_shared/recurrence.ts`, both runtimes):
- `freq` gains `"yearly"`.
- `bysetpos` + `byweekday` for monthly/yearly — "the 3rd Tuesday", "the last Friday". Stored
  as `{ bysetpos: 1|2|3|4|-1, byweekday: [n] }`; `bymonthday` and `bysetpos` are mutually
  exclusive and the picker enforces it.
- `toGoogleRRULE` / `fromGoogleRRULE` round-trip both, so an inbound Google series stops
  being lossy on an ALL-scope edit.
- Task-only: `repeat_from_completion` — the next occurrence is anchored on `completed_at`,
  not on the rule's grid. Materialization for these series produces exactly **one** open
  occurrence at a time (a "water the plants every 3 days after I last did" task cannot have
  a backlog), which is also what keeps it out of capacity math.

**UI.** `RecurrencePicker` grows a Year tab and, on Month/Year, a two-option day-rule
control ("on day 14" / "on the 3rd Tuesday") derived from the anchor. One extra row, no new
screen. Mobile picker inherits it — it's the same component.

**Agent.** `create_recurring_task` gains `freq: yearly`, `bysetpos`, `byweekday`,
`repeat_from_completion`; new `update_recurrence` and `end_recurrence` close the audit's
"can create a series but never change or end it".

### P0-5 · Subtasks

Per §2.2. `tasks.parent_task_id uuid references tasks(id) on delete cascade`, plus
`isStep(t)` / `stepsOf(parent)` in `lib/vertical.ts` next to the existing derives, and a
`stepProgress(parent, steps)` rollup. **Every existing task read filters steps out** — that
is the single most important line of this fix, and it is enforced by a test that walks the
task queries.

UI: a checklist block on the record (desktop) and the task Sheet (mobile) — hairline rows on
the paper, not a card. `Enter` adds the next step, `⌘⏎` completes, `⌫` on empty removes.
Agent: `add_step`, `complete_step`, `remove_step`, and `list_tasks` gains `include_steps`.

### P0-6 · Undo on calendar writes + redo

`useCalendar`'s mutations each gain a `recordUndo` with the inverse act — create→delete,
delete→recreate (from the row we already snapshot for the optimistic rollback),
RSVP→previous status, move→previous calendar, field edit→previous values. Delete stops
saying "This can't be undone", because it can.

`useUndoStack` grows a redo stack: an undone entry moves to `redoRef` with its *inverse*
recorded at record time, and `⇧⌘Z` replays it. The stack clears on any new action, which is
the model every editor uses and the one users predict.

### P1 designs

Stated more briefly; same five-part shape.

- **P1-1 RSVP** — route `rsvp` through `eventsFunctionFor(provider)` exactly as `update`
  and `delete` already do (the fix is deleting a hardcoded string), teach `icloud-events`
  the CalDAV `PARTSTAT` write, and add `accept_event` / `rsvp_event` to the agent so it can
  say yes.
- **P1-2 Duplicate** — one entry on the event context menu and the mobile record-actions
  sheet, reusing `create`; agent `duplicate_event`.
- **P1-3 Agent parity** — `update_task` gains `do_date`, `duration_minutes`, `deadline`,
  `project_id`/`initiative_id`/`domain_id`, `energy`, `notes`; new `add_label`,
  `remove_label`, `update_event`, `set_calendar_visibility`.
- **P1-4 Filters & saved views** — a `TaskQuery` value type (labels, priority, status,
  date window, domain/project) with one pure `matchesQuery` predicate shared by rail, table
  and agent; saved views live in `user_settings` (not a new table, not a new pool).
- **P1-5 Bulk** — the rail's bulk bar gains label / priority / schedule / move, and the
  phone gets long-press multi-select feeding the same bar.
- **P1-6 View parity** — a desktop Agenda view over the phone's `buildDayPlan`, and a phone
  week grid over the same read; neither forks the model.
- **P1-7 Mirror** — the device zone rides the mirror request instead of a hardcoded
  `America/Los_Angeles`, per the locked device-zone doctrine.
- **P1-8 Search depth** — notes body + done tasks in `buildSearchHits`.

---

## 4 · Verification bar (every fix, before it counts as shipped)

1. `npm run typecheck` clean · `npm test` green.
2. Driven in the running dev app with real data — the behavior *observed*.
3. 375px: no horizontal overflow, ≥44px targets, clears the bottom bar.
4. Desktop layout unchanged where it should be.
5. Keyboard path exercised, and listed in `ShortcutsModal`.
6. Agent twin exists, with its row in [`agent-conformance.md`](./agent-conformance.md).
7. No new work on the render path — interaction latency unchanged.
