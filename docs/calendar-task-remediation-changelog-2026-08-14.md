# Calendar & Task remediation — round two

**Status:** rank 10 · rank 6 · bulk actions shipped · the claimed-but-unproven verified · 2026-08-14
**Answers:** [`the audit`](./calendar-task-completeness-audit-2026-08-12.md) ·
[`the plan`](./calendar-task-remediation-2026-08-12.md) ·
[`round one`](./calendar-task-remediation-changelog-2026-08-13.md)

Round one's §3 table — "what still needs a human" — was the backlog. This picks it
up. `npm run typecheck` clean · `npm test` **927 passing** (+2) · `npm run build`
green · `npm run eval` **54/54 at 100%, ×5, nothing blocking**.

That last number took **four** full runs to reach honestly, and the three red
ones are the most useful thing in this document — see §1.

Everything below was **driven in the running dev app against real data**, on the
desktop layout and at 375px, except the two rows in §1 that say plainly they
could not be.

---

## 1 · Verifying what was already claimed

Round one shipped five things nobody had watched work. Three are now proven,
two cannot be proven from here and say so.

### `npm run eval` — run, and it found a bug

The battery had **never been run** against the 13 new verbs. Running it revealed
two separate facts:

**The 41 existing scenarios still pass** — so the three new prompt sections (the
trash · reminders · RSVP and duplication) regressed nothing. That was worth
knowing and is now recorded.

**But the 13 new verbs had no scenarios at all.** They were pinned by
deterministic tests, which prove a handler exists and prove *nothing* about
whether the chat ever reaches for it. So the map's `◐ no scenario` rows were
accurate and the feature was genuinely unverified. **Twelve scenarios added**,
each written as a way the chat would plausibly go wrong:

| Scenario | The wrong answer it forbids |
|---|---|
| `trash-read-is-not-the-live-list` | telling you it's gone, because `list_tasks` can't see the trash |
| `trash-restore-is-not-a-recreate` | re-creating the task — identical in the reply, silently drops its history, project and roll count |
| `trash-purge-asks-before-the-one-act-with-no-undo` | purging on the first ask |
| `step-breakdown-is-not-four-tasks` | answering "split that into…" with `create_task`, which makes a step a fifth pool by accident (P10) |
| `step-read-before-answering-whats-left` | inventing a checklist, since steps are excluded from every task read |
| `search-events-reaches-past-the-window` | "I can't see that far back" — the answer that sends you to Google |
| `rsvp-can-say-yes` | reaching for `decline_event`, the only RSVP verb that used to exist |
| `reminder-sets-one-lead-not-a-standing-rule` | — |
| `reminder-silence-is-not-a-clear` | `clear_reminder`, which hands the item *back* to the defaults it was being silenced from |
| `reminder-refuses-the-nudge` | rebuilding a nag out of per-item leads, one call at a time (N-07's clause) |
| `duplicate-does-not-recreate-from-scratch` | a hand-built copy that loses the location, the notes and the Meet link |
| `filter-asks-the-list-not-the-snapshot` · `bulk-moves-the-set-in-one-act` | (new, this round) |

**And `--repeat 5` found a pre-existing flaky scenario a single run had hidden.**
`week-overload-names-the-cost` was passing **2 of 5** — and the chat was *right*
every time it failed ("something needs to wait or come off", "the sermon series
is the clearest candidate to defer"). The assertion was a word list, and a word
list can only chase whichever synonym the model picked. It now asserts the
behavior its own title claims — **name what comes off** — by requiring the reply
to name an existing commitment, not an adjective. 5/5, with a *stricter* test.

> This is the whole argument for `--repeat 5`, demonstrated: one green run said
> 41/41 and was wrong about one of them.

**A second ×5 pass, over the new scenarios, found two more things** — and only
one of them was the chat's fault:

- **`bulk_update_tasks` could silently drop a task.** The model sent *six* ids
  where five were meant, one of them a malformed UUID (`…-877777777771`, a
  hyphen group short). That is an inherent hazard of any array-of-ids tool, and
  the handler was reporting `changed: ids.length` — i.e. claiming six. It now
  validates and de-duplicates the ids, `select`s what the update actually
  matched, and returns a `not_changed` count with an instruction not to round
  up. **A bulk act that claims rows it didn't change is the one thing this
  product can't do.** The scenario was also wrong to assert five exact ids —
  that asserts an LLM transcribes UUIDs flawlessly. It now pins *one call, not
  five*, which is the behavior that matters.
- **`trash-purge-asks-before-the-one-act-with-no-undo` was mine to fix, not the
  chat's.** It forbade *reaching for* `purge_task`; the actual guard is
  structural and lives in `confirmDestructive.ts` — purge is in
  `CONFIRMABLE_TOOLS`, so a call without a token minted on an **earlier** turn
  is refused before the handler runs and nothing is deleted. Calling the tool
  and receiving the gate is the designed path. It now asserts the thing that
  would really destroy data: **no `confirm_token` on the first ask.** Round
  one's claim that purge is confirm-gated is correct — I checked the mechanism
  rather than the description.

### Still unverified — and cannot be verified from here

| # | What | Why it is still open |
|---|---|---|
| 1 | **No push has reached a real device** | Unchanged from round one. The VAPID pair signs (`{"selfTest":true}` → `ok`), and signing is not delivering. It needs **Phil's phone**: the PWA installed to the Home Screen, permission granted, then a reminder fired against it (§4 of [`push-notifications.md`](./push-notifications.md)). Nothing in this repo can stand in for a lock screen. |
| 2 | **`icloud-events` RSVP has never answered a real Apple invite** | Unchanged. The CalDAV `PARTSTAT` write is deployed and shaped like the CalDAV paths that do work, but Phil's working calendar is a **read-only ICS feed**, so there is no invite here to answer. Needs a real iCloud invite on a writable iCloud account. Its conformance row now reads **⚠️ UNVERIFIED** rather than `◐`. |

### One thing round one got wrong about itself

The changelog claimed "13 new rows across the Capture and Calendar groups". It
was 11 — **the four step tools (`add_step` · `complete_step` · `list_steps` ·
`remove_step`) had no row in the map at all**, which is the rule in root
`CLAUDE.md` ("a new chat capability ships with its scenario and its row in the
map, in the same commit"). They have rows now.

---

## 2 · Shipped — rank 10 · view parity across the shells

Both halves are **layouts over `buildDayPlan`**. Neither derives a day; that was
the whole point.

**Desktop Agenda** (`CalendarAgenda.tsx`) — a fifth `CalView`, following `board`'s
precedent as a non-FullCalendar view. Hairline-separated days on the warm-paper
canvas, all-day chips, the day's readout, and — the half a plain agenda doesn't
have — **the open windows beside the commitments**. A row opens the same popover
the grid does, so nothing about an event reads differently because you found it
in a list. Keyboard **A**; `⌘K` → "Calendar: agenda (list)"; ‹ › and ⌘T page it
by the week.

**Phone Week grid** (`MobileWeekView.tsx`) — the third drill-in lens beside List
and Day. Seven columns on one shared time axis, the `--signal` now-line, slots
dashed teal, swipe to page a week, 44px day headers that drill into the Day lens.

`layoutDay()` moved into `dayPlan.ts` so the Day grid and the Week grid pack an
overlapping Tuesday **identically** rather than each with its own copy.

**Year view was NOT built.** The plan called it the weakest item on the list and
nobody has asked for it; building it because it was on a list is how a planner
turns into a calendar. Say the word and it's an afternoon.

## 3 · Shipped — rank 6 · filters and saved views

One value type, one predicate, three callers — exactly the design in the plan.

- **`supabase/functions/_shared/taskQuery.ts`** — `TaskQuery` + `matchesQuery`,
  pure, zero imports, both runtimes. `tests/planning-kernel.test.ts` now fails if
  any surface grows its own `matchesQuery` / `matchesWindow` / `describeQuery`.
- **Every date is relative** (`this_week`, `overdue`, `undated`) — a saved view
  holds a *question*, so it still means the same thing next month. There is
  deliberately no way to store an absolute range.
- **Saved views live in `user_settings.saved_views`** (migration 62). Not a
  table, not a pool: a view files nothing and holds nothing.
- **Desktop**: a pill on the rail's tab strip → anchored popover. **Phone**: the
  same body in a bottom `Sheet`. **Keyboard**: `/` opens it, `Esc` clears it
  (before it clears a selection — the one state that can silently hide work
  should be the first thing an instinctive Escape removes). Listed in `?`.
- **Agent**: `list_tasks` widened to take the same query. No new tool.
- **The live filter is never persisted.** A filter left on from last Tuesday,
  quietly hiding work, is the failure mode every list tool has — and in a planner
  a short list reads as "you're on top of it".
- **Filtered empty states say so** — "Nothing in the inbox matches overdue.",
  never "Inbox zero."

### The bug this found, which is the reason the kernel exists

The first build defined `overdue` as `do_date < today`. Driving it in the dev app,
the filter chip labelled **Overdue** returned nothing while the rail's **Overdue**
section, three lines above it, showed a task — because the rail counts a *block
that ran an hour past its end* (`isOverdue`) and the filter was counting a stale
date. **Two meanings of one word in one panel (P11).**

Both are genuinely late, so overdue is the union, and `isOverdue` **moved into
the kernel**; `src/lib/dates.ts` is now a one-line adapter over it. The filter and
the rail can no longer disagree, because they are the same function.

## 4 · Shipped — bulk actions, and the phone finally has them

`BulkBar.tsx` + `useBulkOps.ts` — **one bar, both shells.** The four verbs it had
(today · inbox · done · trash) moved in unchanged; the four the audit named are
new: **When · Priority · Label · Move**.

- **Filing carries the whole chain.** Moving tasks to a project writes the
  project's initiative *and* domain alongside `project_id`. Writing the project
  alone is D-088 exactly — four projects' hours credited to the wrong domains.
- **One undo entry for the whole set.** Each task's write is its own queued op
  (idempotent, offline-safe), but they record as a single reversible act: a bulk
  edit needing eight ⌘Z presses is a worse trap than no bulk action.
- **Label is additive only.** A bulk *clear* wearing the same control is how you
  lose labels you never looked at.
- **The phone gets multi-select** — hold a row (450ms, the same gesture the
  record sheet and the deck already use, with a haptic), then tap to add. The
  bar's menus open as `Sheet`s. Selection drops when you leave the screen or
  change segment, so it can never act on rows you can no longer see.
- **Agent**: `bulk_update_tasks`, with the same filing rule. Deliberately cannot
  delete — that stays `trash_task`, one at a time, so nobody loses a list.
- Caught in the dev app: the ＋ FAB and the ✦ launcher **covered the bar's last
  two actions** on a phone. They now stand down during a selection, the same way
  they do for the chat.

---

## 5 · Not done — and why

| Gap | Why it isn't here |
|---|---|
| **Completion-anchored repeat** ("every 3 days *after I last did it*") | **Deliberately not started.** It is now *unblocked* — N-15's escape clause ("materialisation moves to a pure client-side computation") was met when offline sync landed, so `materializeSeries` no longer reads server state to decide what to write. But it is a full vertical slice: a `repeat_from_completion` column, a kernel rule for "next from completion", a materialisation branch that keeps **exactly one** open occurrence, a hook on completion, a rollover exclusion, the picker control, the agent flag, and tests. Half of that produces a series that displays but does not exist — the exact failure N-15 was reverted for — so it was left whole rather than started. It is the next thing to pick up, and §6 below is the order to do it in. |
| **Year view** (part of rank 10) | Not built, on purpose — see §2. |
| **A task filter on the project record's backlog** | The plan said "rail, collection table and agent". The rail, the phone and the agent have it. `floors/Collection.tsx` turns out to hold **projects and initiatives, not tasks** (the audit says so too), so a task predicate has no home there; the third *task* list is `floors/TaskList.tsx`, a single project's backlog, where a filter is worth much less. Not forced. |
| **Attendee free/busy · two-way mirroring · search depth · `.ics` · M365 write-back · per-event timezone** | Unchanged from round one. |

## 6 · If you pick up completion-anchored repeat

In this order, and don't ship a prefix of it:

1. **Kernel first** — `_shared/recurrence.ts` gains `nextFromCompletion(completedISO, rule)`. Pure, one date out.
2. **Migration 63** — `recurrences.repeat_from_completion boolean not null default false`. `recurrences` is already in `SYNC_TABLES`.
3. **Materialisation branch** — in `useRecurrence.materializeSeries`, a completion-anchored series ignores `expandRule` entirely and guarantees **exactly one** open occurrence. That single invariant is what keeps it out of capacity math and stops a backlog forming.
4. **The completion hook** — ticking an occurrence generates the next from `completed_at`. Without this the series only advances on app open, which is visibly wrong the moment someone ticks and looks.
5. **Rollover** — the SQL function must skip these series; a completion-anchored occurrence must never roll.
6. **Then** the picker control, the agent flag on `create_recurring_task`, a scenario, and its row in the map.

Steps 1–5 with no 6 is a feature nobody can reach. Step 6 with no 3–4 is the
half-build N-15 named.

---

## 7 · Docs kept in step

- [`agent-conformance.md`](./agent-conformance.md) — 11 rows moved `◐ no scenario` → ✅; four **missing** step rows added; `list_tasks` and `bulk_update_tasks` rows added; the iCloud RSVP row now reads **⚠️ UNVERIFIED** with what it would take.
- `ShortcutsModal` gained **A** (agenda) and **/** (filter). `KEYBOARD_SHORTCUTS.md` is **still stale** against it — the 2026-08-12 audit said so, round one said so, and it is still true.
- New: `docs`-adjacent kernel `_shared/taskQuery.ts` is documented in its own header, which is the house pattern for a kernel.

**Not pushed to `master`.** Pushing runs `release.yml`, which ships a notarized
DMG that installed desktop apps auto-update from — that's a release, not a commit,
so it's Phil's call. Migration 62 is **written but not applied**; `agent` needs a
deploy for `list_tasks` and `bulk_update_tasks`.

---

## 8 · Fixed after the fact — Month's header row read the same seven dates forever

Month view's header row said **SUN 4 · MON 5 … SAT 10** over every month, and
paging didn't move it. In September 2026 the row under it correctly began 30, 31,
1 — so the header and the grid disagreed, in a surface whose whole job is
answering "what day is that."

**Cause.** A month header spans five or six rows, so it names a *weekday*, not a
day. FullCalendar renders those cells from `TableDowCell`, which builds a dummy
date — `addDays(new Date(259200000), dow)`, i.e. Sun 04 Jan 1970 → Sat 10 Jan
1970. `dayHeaderContent` was reading `.getUTCDate()` off that marker, so it
printed 4…10: not a stale date, never a real one. The same dummy explains the
earlier `timeZone: "UTC"` patch on the weekday label — a local read of a
1970 UTC-midnight marker lands a day back, which was the visible half of this
same bug being treated as its own thing.

**Fix.** `CalendarPane`'s `dayHeaderContent` now branches on `arg.view.type` and,
in Month, renders the weekday alone — the day *cell* already carries the real
number — taking the label from `arg.dow` through a module-level `DOW_LABELS`
built off a known Sunday read in UTC, so no marker is interpreted as a date and
no label can slide across the date line. Week and Day are untouched: weekday +
real date number, today's signal disc, weather chip.

Also removed the `.fc-dayGridMonth-view .fc-col-header-cell.fc-day-today`
override in `index.css` — month dow cells are built with `isToday: false`, so it
never matched anything and documented a mental model that was wrong.

Verified in the dev app against real data: August and September 2026 both show
`SUN…SAT` with no numerals and a correct first row; Week shows `SUN 30 … SAT 5`;
Today returns to the current week with **FRI 14** on the signal disc.
`npm run typecheck` clean · `npm test` 927 passing · `npm run build` green.
Desktop-only surface — `CalendarPane` is not mounted on the phone, which draws
its own month grid from real dates in `MobileCalendar`.
