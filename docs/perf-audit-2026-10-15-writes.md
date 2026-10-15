# What a calendar write costs — perf audit, 2026-10-15 (measured)

**Status:** fixed and measured · `npm run typecheck` · `npm test` · `npm run build` green · budgets
re-baselined in `scripts/perf/budgets.json`
**Closes:** [`schedule-ux-audit-2026-10-15.md`](schedule-ux-audit-2026-10-15.md) #15 and #16
**Builds on:** [`perf-audit-2026-09-03-schedule.md`](perf-audit-2026-09-03-schedule.md) (its "still open"
#2 and #4) · the standing rules in [`performance.md`](performance.md)

---

## The one-line answer

**Checking one block off re-rendered the whole app, about ten times.** Not because rendering is
slow, but because the shell — the component above every screen — subscribed to things every write
changes, and each subscription took every screen below it along. One write: 8–10 React commits and
~2,640 component renders, 144–395ms of long tasks. Now: 3–5 commits, ~80 renders, no long task.

## Measurement

`npm run perf`, 5 repeats, median, on the **local dummy account** (`scripts/local/seed-dummy.sh`, 34
events on the week) — never production data, because the write interactions really write and undo
themselves. Dev build, StrictMode on, headless Chrome for Testing 155 at 1440×900. *Before* is the
source at `1722c0d` (the audit fixes, before any of this), measured with this branch's rig; *after*
is this branch.

| Interaction | Renders | Commits | Forced layout | Long tasks | Dropped frames |
|---|---|---|---|---|---|
| drag a block +1h | 2,634 → **75** | 8 → **3** | 301 → 299 | 144ms → **0** | 5 → **0** |
| resize a block +30m | 2,634 → **75** | 8 → **3** | 227 → 225 | 395ms → **0** | 5 → **0** |
| complete a block | 2,639 → **80** | 9 → **4** | 162 → 160 | 149ms → **0** | 4 → **0** |
| draw-create a task ↵ | 3,016 → **79** | 9 → **4** | 312 → 235 | 267ms → **0** | 6 → **0** |
| drop a rail task on the grid | 2,662 → **115** | 10 → **5** | 311 → 308 | 271ms → **0** | 4 → **0** |
| week travel | 513 → **87** | 3 → 3 | 729 → 729 | 72ms → **0** | 1 → **0** |
| open an event popover | 552 → **175** | 5 → 5 | 49 → 48 | 66ms → **0** | 1 → **0** |
| rail Today ↔ Inbox | 457 → **77** | 2 → 2 | 0 → 0 | 60ms → **0** | 1 → **0** |
| focus mode ⌘. | 479 → **102** | 20 → 20 | 6,725 → 6,654 | 0 → 0 | 1 → **0** |
| ⌘1 → Schedule | 168 → **109** | 2 → 2 | 0 → 0 | 0 → 0 | 0 → 0 |

The forced-layout column barely moves, and that is the point of adding the render count: almost
none of this waste reached the DOM. The ~300 reads a drop costs are FullCalendar's own drop
processing; the 2,500 renders around them were React re-running components that then changed
nothing — invisible to `forcedLayout`, invisible in a screenshot, and 150–400ms of main thread.

## Where the renders came from

Found by hooking React's commit (the probe now does this — `renders` / `commits`, `--why`) and,
per commit, naming the components whose own state or context changed:

| Multiplier | Per write | Fix |
|---|---|---|
| `useParkedAlert` in `ResponsiveShell` read the whole outbox status — pending ↑, syncing, pending ↓, idle | 4–5 whole-app renders | `useOutboxParked()`: the count it actually alerts on |
| `useReminderDelivery` (every task, a 60s tick) and `useEventRouter` were hooks of the shell | 1–2 whole-app renders (+1 a minute, idle) | moved into `ShellEffects`, a leaf that renders null |
| Shell, Spine, agent panel, status bar read `useVertical()`; `data` is rebuilt on every task write | 1 whole-app render | `useVerticalSelector` (a slice), `useVerticalActions` (+ `getData()` at call time) |
| `AppShell` / `AppShellInner` weren't memo'd, so `Shell`'s own state cascaded through every provider | every Shell render | `memo` |
| mutation bags (`useTaskMutations` & co.) and Planner callbacks were fresh every render | rail + grid re-render on every Planner render | `useStableActions`, `useStableHandler` |
| the Year lens stays mounted once visited and took `now` + two inline arrows | 365 day cells × every pane render (2,190 per drag) | `memo`, stable props, a day-stable `now` |
| the grid's colours/names were callbacks over the whole vertical | `fcEvents` rebuilt for a progress change or the 5-minute tick | `gridLookups` over the vertical's **directory** (`useVerticalDirectory`) |
| `fcEvents` depended on the 30s clock | a full rebuild + reconcile twice a minute | depends on the set of overdue ids |
| KeepAlive'd floors read the live vertical under the Schedule | every visited floor, invisibly | `VerticalFreeze` while asleep |
| TanStack's default notify scheduler is `setTimeout(0)` | ~2 extra commits; one re-ran the reconcile (+~73 layouts) | `notifyManager.setScheduler(queueMicrotask)` — A/B'd below |

**Two-tab finding, not visible in the rig** (one profile, one document): `useAuth`'s `storage`
listener matched any key containing `-auth-token`, which includes the auth lock's own key
(`nuvo.auth.lock:…-auth-token`). Every `getSession()` takes that lock and the outbox reads one per
drain, so a write made in one tab re-hydrated the session in every other tab — a new session object
at the very top of the tree — and re-rendered that app from the root two to four times. Seen in the
dev app with a second tab of the same origin open. Now only the session key re-hydrates, and an
unchanged session keeps its identity.

### The scheduler, A/B

Same build, same account, only the scheduler changed:

| | drag | resize | complete | create | rail drop |
|---|---|---|---|---|---|
| commits, `setTimeout(0)` | 5 | 5 | 6 | 6 | 7 |
| commits, `queueMicrotask` | **3** | **3** | **4** | **4** | **5** |
| forced layout, `setTimeout(0)` | 372 | 298 | 160 | 308 | 381 |
| forced layout, `queueMicrotask` | **299** | **225** | 160 | **235** | **308** |

Every other interaction was identical to the run. A write patches several task lists with one
`setQueryData` each; on `setTimeout(0)` each list's notification was its own timer, React could
commit between them, and one of those extra commits re-ran the grid reconcile. On a microtask they
all land before React renders. Kept.

## Residual — not fixed here

- **The hidden On Deck floor still renders ~15 components per write.** It reads capacity through its
  own TanStack queries, which `VerticalFreeze` can't hold. Fixing it needs the floors' query hooks to
  stand down while asleep (or React's `Activity`), not another context.
- **The week crown re-renders its rows on every write** (~40 of the ~80). It legitimately reads the
  vertical — a completed task moves a project's pips — but rows whose project didn't change could
  be memo'd.
- **Lens switches and travel cost 600–730 forced layouts** — FullCalendar re-laying a new view. Same
  before and after; the budgets now say so (see below).

## Budgets

Re-baselined on the dummy account, with `renders` added as a budgeted metric. Four layout ceilings
went **up** — `cal:day` 300 → 950, `cal:month` 300 → 850, `cal:travel` 50 → 1,000, `cal:today`
50 → 400 — and not because of this change: the pre-change code measures the same in this rig (755,
606, 729, 295). The old ceilings were recorded by a sweep that wasn't exercising those controls:
`__btn` matched buttons by substring, and a repeated trial that doesn't alternate measures nothing
(five ⌘2 presses on Projects median to zero — every nav row read 0). The rig now uses exact handles,
starts each nav trial from the other rung, undoes ⌘. and Settings outside the window, and verifies
each write landed before it counts it.

## Guardrail

`tests/write-render-cost.test.tsx` — drives the selector, the freeze and the stable actions, and
reads the wiring from source: no `useVertical()` in the shell or the rail, the shell's background
hooks in the leaf, `AppShell`/`AppShellInner`/`CalendarYear` memo'd, no inline arrow or object reaching
`<LeftRail>` / `<CalendarPane>`, the mutation bags stable, the grid's lookups from the directory,
`fcEvents` off the clock, the scheduler on a microtask. 13 of its first 15 tests fail on the
pre-change source.
