# Schedule UX audit — 2026-10-15

*Status: merged to master 2026-10-15 — 46 of 50 findings fixed: the audit and visual pass,
the write races (D-156), the stale-row fixes, grid selection (D-158), render cost, and the
Realtime broadcast path. Production migrations: 89–90 applied before the push; 91 (closes the
cross-account DELETE leak) goes on once this release is out. The `google-events` /
`icloud-events` server guards (D-156) are not deployed. Open: the decisions in #35, #36 and
#46, and #50 (kept by design). Decisions D-154–D-158.*

**Thesis.** The Schedule wasn't slow because it renders slowly — the 09-03 perf work holds.
It felt slower than thought because of **what happened around each gesture**: a 500ms
bounce before an unschedule landed, a grid re-measured every 30s even mid-drag, a block menu
that couldn't do what the rail's could, keys that acted on a row you couldn't see, and a
week squeezed to 52px columns on a 1024px window. Most of it was one rule broken one
surface over.

The brief (ⓟ): *"calendar view is where i spend most of my time … every interaction click
update feels desktop grade fast, easy, obvious … it's not as fast as my brain"* — then
*"world class UX applied to everything. right order right design removal of unnecessary,
right size, spacing."*

**Scope:** the desktop Schedule — `CalendarPane` (grid, toolbar, menus), `LeftRail` + its
`WeekPanel` crown, `TaskRow`, the block popover (`SlideOver`), `DraftComposer`, and the
write paths under them (`useTasks`, `useSlots`, `useCalendar`, `lib/sync`).

**Method.** Five read-only audits ran in parallel — pointer (drag/resize/select),
keyboard + menus + undo, write latency, inbox↔calendar + projects, and visual design —
each citing file:line. Then every finding below marked **verified** was reproduced or
checked on a **live local account** (below), not inferred. Previous audits were
feature-completeness (2026-08-12) and raw perf (2026-09-03); this one is about *feel*.

**Reproduce it.** The checkout now has a fully local stack and a seeded account —
nothing touches production:

```bash
colima start                 # container runtime (installed via Homebrew)
supabase start               # all migrations, local Postgres/Auth/REST/Realtime
scripts/local/seed-dummy.sh  # dummy@nuvo.test + a lived-in current week
npm run dev                  # auto-logs in via .env.local (DEV only)
```

The seed is relative to today, so re-running it any day gives a fresh week: inbox,
timed/overdue/done work, four projects on the week (placed + loose), two off it, a
sitting, a recurring task, and a Google calendar with every RSVP state. Re-seeding under
an open app leaves ghost rows — that turned out to be a real production defect, fixed on
its own branch (see *Split off*).

Status: ✅ fixed and driven on the dummy account · 🧪 fixed, proven by a test or by reading — not driven (mid-drag states can't be screenshotted, and some paths need data the seed doesn't have) ·
➡️ follow-up · ❓ needs a decision.

---

## P0 — loses or corrupts work

| # | What you experience | Root cause | Status |
|---|---|---|---|
| 1 | **⌫ trashed a task nobody was looking at.** Click a rail row, close its popover, click the calendar, press ⌫: the row was trashed (toast just said "Task deleted"), and its neighbour lit up for the next ⌫. Also `e`, `1–4`, `t`, `v`, `n`, `i` | The rail's click sets an *unlit* cursor that still drove every key (`LeftRail` `cursorId: selectedId`) | ✅ Keys act only on a lit row; a click is only where `j`/`k` start (`homeId`). Reproduced before, gone after. `tests/task-list-keys.test.tsx` |
| 2 | **⌫ in a block's right-click menu trashed the block AND the rail's row** | Both listen on `window` (capture); `stopPropagation` can't stop a sibling listener | 🧪 A press in the calendar puts the rail's cursor down (`data-calendar-pane`); list keys stand down while any `[data-nested-surface]` is open |
| 3 | **A drop joined the wrong slot after the grid scrolled.** Drag near the edge → FullCalendar autoscrolls → "↳ Drop into Morning block" over empty 4pm → the task joins a slot hours away | Slot rects measured once at drag start, never after scroll | 🧪 Re-measured on every scroll mid-drag |
| 4 | **A dropped block flickered back to its old time** (intermittent) | `resumeGridSync` set the overdue clock → a React render ran *before* TanStack's cache notify → the grid sync re-placed the block from stale props | 🧪 Clock catch-up deferred past the cache patch |
| 5 | Re-dragging a Google event within ~1s can jump back and land the wrong final time | Fire-and-forget write-back races the next row write; `external_events` has no per-field LWW | 🧪 Write-backs serialized per event; the function's row write is conditional (D-156) — test-proven against a stubbed transport, not driven (no edge functions locally) |
| 6 | A late Realtime echo / an in-flight refetch can revert a newer edit or resurrect a row you just moved | `mergePending` ignores acked-but-unechoed ops; `patchTask` never cancels in-flight fetches | 🧪 Acked ops held in the merge; in-flight task fetches cancelled before a patch (D-156) |
| 7 | Creating a Google event shows a hatched, undraggable duplicate until refetch; Task → Event overlaps three blocks for the round trip | Temp row has empty `account_id`/`calendar_id`; Realtime echo is added beside it | 🧪 Temp row carries its calendar and is swapped in place; Task → Event trashes optimistically (D-156) |
| 8 | Server-deleted rows survive a reload | A range refetch only upserts into the local replica | 🧪 Refetch is authoritative for rows this device doesn't owe; stale refetches can't re-admit rows queued to leave |

## P1 — speed ("not as fast as my brain")

| # | What you feel | Root cause | Status |
|---|---|---|---|
| 9 | **The whole grid re-measured every 30 seconds — including mid-drag** | `onFcResizeStop` → `resumeGridSync` → `[now]` sat in `calendarElement`'s deps; the 09-03 memo fix undone one callback away | 🧪 Stable identity; `tests/calendar-element-stability.test.ts` now walks deps transitively (fails on the old code with the exact chain) |
| 10 | **Dropping a block on the rail bounced it back for half a second first** | FullCalendar's 500ms `dragRevertDuration`; `eventDragStop` (where the unschedule lived) fires only after it | ✅ Write lands ~25ms after release (measured; was ≥500ms) |
| 11 | Every refetch (60s pull, window focus, post-drain) re-rendered everything even when nothing changed | The sync guards replaced TanStack's `replaceEqualDeep` | 🧪 Sharing restored over the merge; `tests/sync/crud-integrity.test.ts` |
| 12 | Paging to a week warmed >15s earlier refetched in four waves | Range hooks used the 15s default; the prefetch used 60s | 🧪 One `CALENDAR_RANGE_STALE_MS` for all |
| 13 | A slot drag caused 3–4 full renders | `updateSlot` rewrote every task list and refetched every task query | ✅ Only children whose day changes; `settleWrite` |
| 14 | The create card took 540ms to arrive | `.moment` spring | 🧪 `pop-in` (130ms), also the recurrence dialog |
| 15 | Every cache patch reaches React one macrotask late | TanStack v5 default scheduler is `setTimeout(0)` | ✅ Notify on a microtask (`notifyManager`), kept because the rig measured it better |
| 16 | Every task write re-renders the entire app and rebuilds the vertical | `["tasks","all"]` feeds `buildVertical`; the shell subscribes to all of it; mutation objects and Planner callbacks are fresh per render | ✅ A write renders the Planner, not the app: ~2,640 → ~80 renders, long tasks 144–395ms → 0 (`npm run perf`) |

## P1 — interaction

| # | What you experience | Status |
|---|---|---|
| 17 | **A block's right-click was a 5-item copy** (no Tomorrow, Unschedule, Move to, Back to inbox, Commit to week) | ✅ Blocks use the shared `TaskActionsMenu`; Duplicate and → Event ride in as props (D-154) |
| 18 | **Moving a timed task to another day wiped its time** (menu Today/Tomorrow/Next week, `t` presets, the popover's date chip) | ✅ A day picked by hand keeps the clock and says so — *Tomorrow · 11:30am*; *Anytime that day* removes it (D-154). Rollover still clears it (D-141) |
| 19 | Menus weren't keyboard-operable; printed hints (E, T, V, ↵) did nothing while the menu was open | ✅ in `TaskActionsMenu`: ↑↓, ↵, hinted letters, ⌫ asks the series scope. Event/slot menus ➡️ *One menu primitive* |
| 20 | Dropping a block on the rail said nothing about where it went — project work silently left for its backlog | ✅ Cursor chip *↩ Back to Inbox* / *↩ Back to its project*; toast with Undo |
| 21 | The popover's footer said **→ Inbox** for project work (it goes to its project) | 🧪 *→ Its project* |
| 22 | ⌘Z right after drawing or duplicating a task undid some *older* act | 🧪 Opt-in undo on `create`; Duplicate toasts (the copy lands exactly on the original) |
| 23 | After using the capture box, clicking the grid then `w` typed "w" into the box | 🧪 A press in the grid blurs a text field outside it |
| 24 | `w`/`d` swapped the view behind the Week's Plan, shortcuts sheet and menus | 🧪 Gated on any overlay / nested surface |
| 25 | The drag ghost showed no time for anything under ~48 min, never for slots | 🧪 A moving block always says where it would land |
| 26 | Narrow (overlapping) and 15-min blocks were mostly checkbox and resize handle — presses completed the task | 🧪 Short blocks resize from the end only; <44px blocks drop the checkbox; checkbox 14px drawn / 24px hit |
| 27 | Event menu didn't lead with Open; the bottom items clipped near the screen edge | ✅ Open first; menus measure themselves |
| 28 | The rail's post-drag click-swallower never expired (could eat your next click) | 🧪 Expires next task; slop matches the drag's owner (6px rail / 5px grid) |
| 29 | A resize or checkbox press armed the drop feedback ("↳ Drop into…" while resizing) | 🧪 |
| 30 | An anytime chip dragged onto an hour previewed 1h then landed at its own length | 🧪 `defaultTimedEventDuration` |
| 31 | **The grid has no selection and no keys** — no ⌫/e/t/v on a block, no ⌥↑↓ nudge, no ⌘D, no j/k between blocks | ✅ id-based selection, the list's own `useTaskListKeys` over blocks in time order, `keyOwner` for whose ⌫ it is (D-158) |
| 32 | Esc mid-drag hid the feedback but the release still committed (and a 4-row group landed as one) | ✅ *Release to cancel*; every drop handler asks the gesture; the group survives to the drop (D-158) |
| 33 | A drawn draft is frozen — no way to nudge 9:00→9:15 without redrawing; its backdrop eats the next press and double-click | ✅ ghost drags/resizes, ↑↓ ⇧↑↓ from the card, outside-press instead of a backdrop; the dismiss guard now outlives FullCalendar's deferred `dateClick` (D-158) |
| 34 | "Place beside a slot" sized by the default duration, so the result overlaps and disagrees with the preview | ✅ The real length — a task's own, a group's or a project's sitting size — in the preview and the landing alike |
| 35 | **You can't bring a project into the week from the Schedule** (⌘2 → drag → ⌘1, or 4+ clicks into the ritual) | ❓ A *＋ Bring a project in* picker at the crown's foot — reverses a code-comment stance in `WeekPlanFloor.tsx`, not a logged decision |
| 36 | The crown's amber "N with no time" can't be acted on; an unshaped project can't get a sitting | ❓ make it open *Find it time* (proposes, you press — N-01) |
| 37 | *Commit to this week* on a rail row vanishes it with no toast or undo | 🧪 Toast with Undo (exact restore of week + status); shared by the menu and the popover's *This week* |

## P1 — design

| # | Finding | Status |
|---|---|---|
| 38 | **At 1024px the week got ~52px a day** ("De…", "Lu…") — the chrome only yielded when the chat was open, and the chat auto-closes below 1280 | ✅ Squeeze below 1280 regardless: grid 412 → 656px, columns 52 → 83px (measured). Crown header fits at the rail's 240px floor |
| 39 | Week/Day had no title — page forward and nothing said which week; the crown's date is the *planned* week | ✅ Center seat for every view: *Oct 12 – 18* · *Thu, Oct 15* · *October 2026* |
| 40 | A 90-min block printed one truncated title over ~50px of empty tint | ✅ Titles take the lines the block has; the time line is shed first; the repeat mark rides the time line |
| 41 | A project's task block said `▸ Title`, never whose | ✅ `11:30am–12:15pm · Billing migration` (D-109 retired `▸` for sittings; now for tasks too) |
| 42 | Four time spellings on one screen (`2:00pm - 3:00pm`, `11:30 AM`, `12:16pm`, and the composer's ambiguous `11:00–1:00 PM`) | ✅ on blocks, the now-label, the composer and the popover's time chip — all through `at`/`span` (D-122). Remaining copies in `SlideOver`/`dates.ts` ➡️ |
| 43 | The today disc printed raw `#fff` (~2.3:1 on dark-mode coral); destructive confirms were white on `--signal` | 🧪 `--on-signal` token (contrast-gated both themes); confirms on `--danger` / `--on-danger` |
| 44 | A globe glyph at home said "you are where you live" in the busiest strip | ✅ `hideAtHome`, as the phone |
| 45 | Signal diet: the now-line competes with ~12 other `--signal` marks (overdue slab, five amber marks, `!` + "4h late" on one row, today wash + underline + disc) | ✅ The disc is today's one mark (no header wash, underline or signal weekday; the column a faint 5%); an overdue block keeps its fill with an ember **bar**; the crown's amber is `--warn`; a high-priority `!` is ink (priority isn't time); *This week* is `--accent` (D-157) |
| 46 | Rail rows are two heights (54 / 37px) against design-law 5 "one line, one height"; the crown is ~31–38% of the rail | ❓ + ➡️ |
| 47 | Menus: five widths, three hovers, three elevations, two entrance animations, `--signal` destructive at rest | ✅ One row (`min-h-7`, `bg-bg` lit), one width (224), `rise elev-3`, a title header on every menu; destructive in ink at rest, `--danger` when lit (D-101) |
| 48 | RSVP states collide with done/hidden (both 0.5 / 0.3 opacity); dashed means five things; the project sitting is `--slot` teal ("unclaimed") | ✅ Fill = commitment: unanswered/tentative/declined are hollow (tentative adds `?`, declined is struck); dashed only for containers; a project's sitting wears its domain hue (D-157) |
| 49 | The anytime row is unbounded (D-141 sends every rolled task there); `pxPerHour` ignores it, so "fit N hours" is always short | ✅ Anytime row capped at 3 rows (+N); `pxPerHour` subtracts its resting height |
| 50 | `.fc-col-header` is opaque `--bg` over the atmosphere (the frost-seam rule) | Kept — the sticky header has to occlude the grid scrolling under it; transparent would show blocks through the day names. Logged as a deliberate exception |

---

## Split off / proposed

- **Local replica keeps server-deleted rows** — ✅ committed on `claude/gifted-shaw-033c61`
  (not pushed). A refetch now drops server-deleted rows unless this device owes a write.
- **Sync-layer write races** — #5, #6, #7, plus the Google mirror reading a stale row
  (`mirrorTask` fires before the outbox delivers).
- **Write-path render cost** — #15, #16 ✅ (`claude/youthful-kirch-38e370`): the rig drives
  drag / resize / complete / create / rail-drop and counts React renders; a write went from
  ~2,640 renders to ~80, and long tasks from 144–395ms to none. See
  [perf-audit-2026-10-15-writes](perf-audit-2026-10-15-writes.md).
- **Grid selection + block keys** — #31–33: ✅ (`claude/beautiful-allen-bbd1a7`, D-158).
  An id-based selection on the grid, owned by the last-touched pane, with the list grammar
  (e ⌫ t v ↵ ⌘E ⌘D, j/k by time, ⌥↑↓ ±15m, ⌥←→ ±1 day, ⌥⇧↑↓ resize, `.` opens the menu).
- **One menu primitive + visual system pass** — #45, #47–49: ✅ (D-157); #50 kept by design.

## Actions

| Bucket | Items |
|---|---|
| **Fix now** (done) | #1–14, 17–34, 37–45, 47–49 — ✅ driven: 1, 10, 13, 17–20, 27, 31–34, 38–42, 44, 45, 47–49; 🧪 the rest |
| **Bet** (own sessions) | *Sync-layer write races* (#5–7) · *Write-path render cost* (#15–16, perf rig write interactions) |
| **Decision to log** | ✅ D-154–D-158 · ❓ bring a project into the week from the crown (#35) · ❓ amber mark → *Find it time* (#36) · ❓ rail rows one height, per design-law 5 (#46) · ✅ `--danger` for destructive confirms (D-157, extends D-101) |
| **Doc to update** | ✅ glossary (*Anytime*) · `design-language.md` law 5 vs the two-line rows (#46) · planner law 4 vs `--now-band` · `scripts/perf/interactions.mjs` has no write interactions |
