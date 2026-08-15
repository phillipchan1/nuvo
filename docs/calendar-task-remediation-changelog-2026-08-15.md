# Calendar & Task remediation — round three

**Status:** the Year in · the desktop Agenda out · rank 3's asymmetry closed · 2026-08-15
**Answers:** [`the audit`](./calendar-task-completeness-audit-2026-08-12.md) ·
[`round one`](./calendar-task-remediation-changelog-2026-08-13.md) ·
[`round two`](./calendar-task-remediation-changelog-2026-08-14.md)

Two pieces, and they are opposite in shape. One **adds** a view and has to argue
for its place. One **removes** a view that was shipped three days ago and has to
leave a record so it doesn't come back.

`npm run typecheck` clean · `npm test` **966 passing** (+22) · `npm run build`
green · edge-function parse clean. Everything below was driven in the running dev
app against real data, on the desktop layout and at 375px — except the one thing
that says plainly it could not be, in §5.

---

## 1 · The Year — and the argument it had to win first

Round two skipped the year view on purpose: *"building it because it was on a
list is how a planner turns into a calendar."* Phil asked for it, which changes
the question from *should this exist* to **what does it have to answer to
deserve to** (P10: a new place has to be paid for).

Twelve grids of numerals answers "what day is the 14th", which a phone's status
bar already answers. So the Year does not draw dates. **It draws load.** Each day
is shaded by how much of it is already promised, and the question it owns is one
nothing else in Nuvo answers at day altitude: **where is this heavy, and where is
there nothing.** On Deck answers exactly that for projects across weeks. Below
that altitude there was nothing — which is why "when could this actually go?" has
always meant paging the week grid eleven times.

Three consequences, and they *are* the design (D-106):

**The clear-day count is not the answer; the clear run is.** Forty scattered free
Tuesdays and one free fortnight score identically on a count, and only one of
them is somewhere a week of work fits. The headline names the longest unbroken
clear stretch and its dates — and measures it **forward from today**, because a
clear run last February is a true fact about the shading and a useless answer to
"where could this go". On real data it reads:

> **2026** · 119 of 365 days clear · heaviest **August** (full) · longest clear
> run ahead — **19 days from Dec 13**

**Absence is drawn as absence.** A day with nothing on it is bare paper, not a
tint — the strongest available answer to half the question. Only `over` leaves
the `--accent` ramp, for `--signal`: a day promised more time than it holds is
not "more full", it is wrong, and that is the token this app already uses when
something needs looking at.

**The rule is in the kernel.** `dayLoad` · `spanLoad` · `longestClearRun` ·
`loadLabel` in `_shared/dayShape.ts`, over the same `busyIntervalsFor` /
`toBusyBlocks` busy list every other reader gets. `tests/planning-kernel.test.ts`
now fails if any surface grows its own copy — with one refinement: a file that
*imports* the kernel may still export an adapter over it (`dayPlan.ts` does, for
`dayReadout`), so the guard only fires on a name defined by a file that never
reads the kernel. That is the shape the rule always meant.

### Both shells, one set of marks

`components/calendar/YearParts.tsx` is to the Year what `DomainParts.tsx` is to
the Domain. The single real difference between the shells is the tap target, and
it is a difference in the medium rather than the model: at 375px a day cell is
~22px, half a thumb, so **the month is the target** and the numerals come off
(a numeral at that size is a smudge sitting on the one thing the cell is for).
Desktop cells measure 34px, so they carry their number and open that day.

- **Desktop** — the fifth `CalView`, through the existing `NON_FC_VIEWS` seam.
  No `@fullcalendar/multimonth`: no new dependency, and full control of the
  warm-paper voice. Toolbar pill · **Y** · ⌘K "Calendar: year (where it's heavy)"
  · ‹ › page a year · ⌘T returns. A day opens the Day grid on that date; a month
  name opens Month.
- **Phone** — `MobileYearView`, reached by tapping the month title (iOS
  Calendar's own zoom-out grammar; a chevron marks it, because an invisible
  affordance is worse than a hover-only one and a phone has no hover to fall
  back on). A month taps back down into the grid. Swipe pages a year, matching
  every other lens.
- **Both** carry the legend in words. Colour alone has failed here before — the
  domain coverage strip names its states for the same reason.
- **The empty-grid trap.** A year drawn over an in-flight fetch says "365 clear
  days", which is the one wrong answer this view can give. `eventsLoading`
  (`isLoading`, not `isFetching`) rides in, and the headline says "Reading your
  calendar…" instead.

### One collision the new kernel guard found

`WeekBoard` already had a `dayLoad`, and it measures something genuinely
different: how much of your **work window** is spoken for, **including**
unscheduled intentions and **excluding** evenings — right for a surface you drop
work onto, wrong for a year grid. Two questions, so two names (P11): it is
`dayCapacity` now, with both definitions written down beside it.

## 2 · The desktop Agenda, removed — and why this section is longer than it looks

`CalendarAgenda.tsx` shipped on 2026-08-14 and is gone on 2026-08-15. Phil used
it and didn't want it.

The removal itself was small: the `CalView` union, `NON_FC_VIEWS`, the **A** key,
the ⌘K entry, the toolbar pill, the anchor state, and a heal in
`readNavState` so anyone whose last session ended on `agenda` restores to Week
instead of a view that renders nothing.

**The record is the part that matters.** That view existed *because the audit
asked for it* — rank 10, "no agenda/list view on desktop". Removed without an
entry, someone rebuilds it next quarter citing the same line. So:

- **N-16** in `decisions.md` §2, with the reason: rank 10 was a **symmetry**
  observation, not a user need. The phone has a list because 375px cannot draw a
  week grid. The desktop can, and gets nothing from a list it doesn't already get
  from Week.
- **The audit row itself is amended**, in both places it appears, to say *do not
  rebuild it from this row* — because the row is what a future reader will find.
- **The phone's `schedule` (List) lens is untouched.** It predates all of this,
  it is the phone's native idiom, and it is not what was rejected (D-044).

## 3 · Rank 3 — the asymmetry, closed

`mirror_calendar_id` was set by exactly one line in `google-oauth/index.ts`, so
an iCloud-only user's blocks never left Nuvo. iCloud is a **writable** provider;
that was an asymmetry, not a policy (D-107).

- **`_shared/mirror.ts`** — the pure half, and therefore the tested half: what
  gets a mirror, what it's called, where it lives, and whether an inbound event
  is one of Nuvo's own. **`_shared/mirrorTargets.ts`** is the thin transport,
  kept small precisely because `npm test` cannot reach a CalDAV round trip.
- **The resource is derived, not stored.** Google returns an opaque id that has
  to be kept (`tasks.google_event_id`), so a lost id orphans an event. A CalDAV
  URL is something the *client* chooses, so the iCloud mirror derives its
  resource from the row id: PUT is an upsert, DELETE-404 is already-gone, a
  half-written mirror self-heals. **No new column, and no state to desync.**
- **Stood up lazily**, so an account connected before this existed gets a mirror
  calendar without reconnecting. MKCALENDAR on an existing collection answers
  405, which is read as "already there" — which is what makes it safe to attempt
  on any write.
- **Two teardown paths were stranding blocks.** Recurring-series cancellation
  (`useRecurrence.ts`) and `rollover` both gated on `google_event_id`, so an
  iCloud user's cancelled or rolled block stayed on their phone forever. Both
  now offer every row to the reconciler, where no mirror is a no-op.
- **One name, one definition.** `MIRROR_CALENDAR_NAME` existed in
  `_shared/google.ts`; now that iCloud mirrors too, that would be two providers'
  idea of one name (P11). It lives in `mirror.ts` and `google.ts` re-exports it.
- **`slot-mirror` still hardcoded `America/Los_Angeles`.** The audit caught this
  in `task-mirror` and it was fixed there; the slot twin was missed and carried
  one operator's zone on every user's held block (P16 · D-082). Fixed here.
- **The guard with teeth: Nuvo must never re-import its own mirror.**
  `icloud-sync` re-discovers calendars every poll, so without this every mirrored
  task would exist twice on every surface **and count as busy twice** — the
  double-count that credited four projects' hours to the wrong domains (D-085).
  Two independent nets: the collection is dropped **by URL, never by name** (a
  user is entitled to their own calendar called "Nuvo"), and any inbound UID
  carrying Nuvo's mirror prefix is skipped. `icloud-connect` drops it on
  reconnect too, which is the same hole by a different door.
- **M365 stays out** — it is read-only end to end, which is a different audit row.

**The second half of rank 3 was a question, and it was asked before anything was
built.** Who wins when both sides changed is a model decision, not a bug fix.
Phil chose **app always wins — but say so**, over provider-wins (which would
force Nuvo to start reading back its own mirror, handing Google's quirks power
over planning state) and per-field LWW (which degrades to row-level here, since
neither provider returns per-field timestamps — the exact bug that model exists
to prevent).

The condition is the interesting half. A silent revert is indistinguishable from
data loss, and the user is **not in Nuvo** when they drag a mirrored block —
they are in Apple Calendar on a phone, where no Nuvo UI can reach them. So the
warning went to the only channel that does:

- **Every mirrored block** carries it in its description, after the user's own
  notes: *"Moving or editing this here won't stick: Nuvo replaces it on the next
  sync."* The consequence, not the authorship — "Written by Nuvo" is a label,
  and a label doesn't stop a drag.
- **The mirror calendar** carries it in the provider's own calendar info, set at
  creation on both Google and CalDAV.
- **Settings → Calendars** names the mirror — which, since the calendar is
  deliberately excluded from the synced list, is the only place in the app it
  exists at all. Verified against the live Google account.

What this does not buy: the providers' UIs still allow the drag. We warn, we
can't disable, and **Q-13 stays open** for that residual rather than being closed
outright.

## 4 · `external_events` offline — answered by saying so

The audit: *"Correct given the provider is the source of truth, but the app
doesn't say so: the failure is a toast, not a queued edit."* Both halves of that
are right, and only one of them is fixable.

Queueing was considered and refused. `external_events` is a **cache of somebody
else's truth**; neither provider returns per-field timestamps to merge against,
and the provider can move or cancel the same event while the device is dark. A
queue there converts "this didn't save" into "this saved and then silently
vanished", which is strictly worse.

So the constraint is stated instead — `calendarWriteBlockedReason` ·
`CALENDAR_OFFLINE_NOTE` · `assertCalendarWritable` in `lib/calendarWrite.ts`,
guarding all seven event mutations, and **folded into `editable`** on both
editors so the controls go inert rather than accepting typing they'll lose:

> Offline — your calendar lives with Google/Apple, so events can't be edited
> until you reconnect. Tasks still save here.

That last sentence is the load-bearing one. The failure the old toast produced
was not "I can't edit this", it was "is this app broken?".

## 5 · The chat's twin, and what could not be verified

**`read_calendar_load`** is the Year's twin and reads the same kernel over the
same busy rule, so the chat cannot call a month quiet that the Year paints dark.
It paginates (a year of a real calendar is several thousand rows, and PostgREST
stops at 1000 — a truncated read would report an empty December and send someone
to book over their own week), and it returns only the days worth naming rather
than 400 rows of "clear".

Two scenarios, both **3/3** against the live model:

| Scenario | The wrong answer it forbids |
|---|---|
| `load-reads-past-the-window` | "I can't see that far" — the answer that sends you to Google |
| `load-answers-with-the-run-not-the-count` | "19 days are clear" — true, useless, and exactly what this view exists to replace |

The prompt gained the rule in words (**room is a RUN, not a tally**) and the
static-prompt baseline was re-recorded in the same commit, which is the review
signal that file exists for.

### Could not be verified from here

| # | What | Why |
|---|---|---|
| 1 | **The iCloud mirror has never written to a real Apple account.** | Phil's working calendar is a read-only **ICS feed** (M365 OAuth is blocked by policy), so there is no writable Apple account on this machine to stand a `nuvo-blocks` collection up in. The pure half is pinned by 17 tests; the CalDAV half is shaped like the `icloud-events` paths that do work, and is unproven. It needs one real iCloud account connected, then a task scheduled and checked on the phone. |
| 2 | **Browser screenshots.** | The preview pane's capture path timed out on every attempt this session while JS evaluation, clicks and DOM reads worked throughout. Every visual claim above was verified through computed styles and measured geometry instead — band fills, cell sizes, tap-target rects, overflow — not by looking at a picture. Worth a human glance at the Year before it ships. |

## 6 · Docs kept in step

- **`decisions.md`** — **D-106** (the Year is a view of load), **D-107** (mirror
  to whichever calendar the user has; the resource is derived), **N-16** (the
  desktop Agenda, with the reason), **Q-13** (who wins when both sides changed).
- **The audit** — rank 3, rank 10, the views row, the offline row and the mobile
  parity row all amended in place, with the rank-10 amendment written *at* the
  future reader who would otherwise rebuild the agenda.
- **`glossary.md`** — **Year**. No entry was needed for Agenda; it never had one.
- **`agent-conformance.md`** — two rows under **C · Calendar**.
- **`ShortcutsModal`** — **A** out, **Y** in. `KEYBOARD_SHORTCUTS.md` is **still
  stale** against it; three rounds have now said so.

**Not pushed to `master`.** Pushing runs `release.yml`, which ships a notarized
DMG that installed desktop apps auto-update from — a release, not a commit.
The `agent` function needs a deploy for `read_calendar_load`; `task-mirror`,
`slot-mirror`, `rollover`, `icloud-sync` and `icloud-connect` need one for the
iCloud mirror.
