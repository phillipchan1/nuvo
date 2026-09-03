# Nuvo — Schedule performance audit, 2026-09-03 (measured)

**Status:** root cause found, fixed and measured · `npm run typecheck` · `npm test` · `npm run build` green
**Supersedes the open question in:** [`perf-audit-2026-09-03.md`](perf-audit-2026-09-03.md) (same day, code-read only —
its Phase 0 "operator confirms" box was never ticked, and the headline finding below is the reason the
fixes in it did not make the app feel faster)

---

## The one-line answer

**`@fullcalendar/react` re-measures the entire grid on every React re-render of `CalendarPane`,
whether or not a single prop changed.** Everything else on this page is a rounding error next to it.

`node_modules/@fullcalendar/react/dist/index.js`:

```js
componentDidUpdate() {
  this.isUpdating = true;
  this.calendar.resetOptions({ ...this.props, handleCustomRendering: this.handleCustomRendering });
  this.isUpdating = false;
}
```

…and `resetOptions` in `@fullcalendar/core` (line 1347), called with `changedOptionNames === undefined`:

```js
if (changedOptionNames === undefined || changedOptionNames.length) {
  this.actionRunner.request({ type: 'NOTHING' });   // <- unconditional full re-render
}
```

There is **no prop diffing**. A React re-render of the pane — caused by opening a popover, a query
settling, the 30-second clock tick, a drag frame — runs `SimpleScrollGrid.handleSizing` →
`computeShrinkWidth` → `computeSmallestCellWidth`, `TimeColsSlats.updateSizing`,
`TableRow.querySegHeights`. Stack-attributed in the running app, that is thousands of forced
synchronous layouts per re-render.

This is why "I can't drag things": during a gesture, every re-render that reached the pane paid a
full grid re-measure *between pointer frames*. It is also why the previous pass's remedies —
stabilising `dayHeaderContent`/`timeGridOptions`, pausing grid sync, disabling session replay —
moved so little. They reduced the number of re-renders somewhat; the cost of each surviving one was
untouched, and `resetOptions` ignores the stabilised props anyway.

---

## Measurement

Chromium, dev server, real account data, 88 events on the week grid, StrictMode disabled for the A/B
so dev double-rendering did not inflate either arm. The metric is
`Element.prototype.getBoundingClientRect` calls per interaction — a direct count of forced
synchronous layout, and unlike wall-clock timing it is deterministic and immune to the throttling in
a backgrounded pane.

The probe is **one focus-mode toggle (⌘.)** — a pure UI re-render of the pane with no network and no
data change, which isolates exactly the mechanism above.

| Arm | Layout reads per re-render | Spread over 4 runs |
|---|---|---|
| `10bfef2` (before) | **6,681** | 6,416 – 6,681 |
| this change (after) | **1,010** | 1,010 every run |

**−85%.** The residual 1,010 is legitimate: ⌘. changes the calendar's *width*, so the grid genuinely
has to re-measure once. For re-renders that do not change size, FullCalendar is now untouched.

### What was *not* reproduced

An early single sample showed 11,470 reads on one popover open. With a warm-up click excluded (the
first click pays for the lazy `SlideOver` chunk) both arms sit near each other on that path, so
**popover-open is not fixed by this change** — see "Still open" below. The honest headline is the
re-render number above, not that one.

---

## The fix

`src/components/CalendarPane.tsx` — the `<FullCalendar>` element is built once, in a `useMemo` whose
dependencies contain only things that genuinely require reconfiguration (`isMonth`, first-day,
`timeGridOptions`, the content renderers). Unrelated pane re-renders now leave it alone entirely.

That is only sound if nothing dynamic is passed as a prop, so:

- **The grid was already driven imperatively** and this change leans on it: `events` is seeded once
  from `eventsOptionRef` and thereafter reconciled by `syncCalendarEvents`; the view by `changeView`;
  the date by the API. No behaviour moved.
- **Ten handlers were inline arrows** — `onSelect`, `onDateClick`, `onReceive`, `onDrop`, `onResize`,
  `onDragStop`, `onClick`, `onEventHover`, `onEventUnhover`, `handleDatesSet` — recreated every
  render. They now go through `useStableHandler` (`src/hooks/useStableHandler.ts`): stable identity,
  latest body, same contract as `useEffectEvent`.
- **`plugins={[…]}`** was a fresh array literal on every render. Hoisted to `FC_PLUGINS`.
- **`fcNow` (30s tick) fed `timeGridOptions.scrollTime` and the now-indicator label**, so the element
  was rebuilt — and the grid re-measured — every 30 seconds forever. Both now read `fcNowRef`.
  The clock still ticks: FullCalendar's own `NowTimer` re-renders the indicator each minute
  (verified live — the label advanced 12:00pm → 12:06pm).
- `initialView` / `firstDay` read from refs, since FullCalendar only consumes them at mount.

`src/hooks/useAppNavigation.tsx` — the context `value` was a **fresh object literal on every provider
render**, so all 25 consumers re-rendered whenever anything re-rendered the provider, not only when
navigation actually changed. All 27 members were already `useCallback`, so wrapping it in `useMemo`
is free.

### Guardrail

`tests/calendar-element-stability.test.ts` asserts the invariants against the source: one
`<FullCalendar>` tag, inside the memo; no ticking or per-render value in its deps; hoisted plugins;
every handler stable. **Verified to fail** when `fcNow` is put back in the deps and when the plugins
array is re-inlined — this win is invisible in a screenshot and would otherwise rot silently.

---

## Verified functionally

Week / Day / Month / Year all render (88 / 27 / 417 events), 7 vs 1 day headers, now-indicator
present in time-grid views and absent in Month, paging forward and back reloads the right week
(88 → 73 → 88), popovers open. Screenshot in the session.

---

## Still open — ranked, not fixed here

1. **Opening a popover still triggers three FullCalendar sizing passes.** The element is memoized and
   the pane's own props are stable (`taskAccent`, `slotTitle`, `slotProject`, `slotTasksBySlot` are
   all memoized in `Planner`), and the host does **not** change size (1338×816 before and after) — so
   this is inside FullCalendar's own click handling (`selectable` + `unselectAuto={false}` clearing a
   selection, or the `handleCustomRendering` → `setState` → `requestResize` loop in the React
   adapter). Worth ~150ms per click. Next step: hook `requestResize` and find the caller.
2. **`fcEvents` depends on `fcNow`.** Every 30 seconds the whole event set is rebuilt and pushed
   through `syncCalendarEvents`. It exists for overdue tinting; it should be a per-event class
   toggled imperatively, not a reason to rebuild every block.
3. **The ResizeObserver calls `updateSize()` on every callback**, including ones where the box did not
   actually change (`CalendarPane.tsx` ~line 583). Gate it on a changed width/height.
4. **`skipWhenAsleep` promises more than `memo` can deliver.** `memo` cannot stop a re-render caused by
   context or a query subscription, and the asleep surfaces read plenty of both — `FloorPane` calls
   `useAppNavigation()`; `CalendarPane` calls `useHiddenEvents`, `useEventDetails`, `useRecurrences`,
   `useWeather`, `useUiScale`. With KeepAlive, the Schedule *and* every visited floor stay mounted:
   DOM grew 1,907 → 2,300 nodes after visiting all three floors, and popover cost rose with it. The
   ⌘1–4 instant-switch goal is right; the mechanism needs `useSyncExternalStore`-style subscriptions
   or genuine unmount for the floors you are not on.
5. **`flushSync` was called from inside a lifecycle method** — logged repeatedly by FullCalendar's
   React adapter (its own `runFunc` picks `flushSync` when re-rendering frequently). Harmless today,
   but it is React telling us this integration is fighting the scheduler.
6. **The entry chunk regressed.** 479 KB after the August remediation → **827 KB** now. The August
   memory warns exactly how this happens: a tiny shared constant anchors a big module into the entry
   graph. Worth re-running the sourcemap attributor.
7. ~~`npm test` is red on `master`.~~ **Retracted — this was wrong, and the way it was wrong is
   worth keeping.** `checks` on this very commit ran the identical `npm test` and reported 101 files
   / 1,489 tests, zero failures. The 55 `ReferenceError: React is not defined` failures were purely
   local: installed `vitest` was **2.1.9** while the lockfile pins **4.1.11**, and the two differ in
   how they transform JSX in `.tsx` test files. `npm ci` fixed it — 101 files / 1,545 tests, all
   green.

   The bad step was the control. "Confirmed pre-existing" came from running the suite in a clean
   worktree at `10bfef2` — but that worktree **symlinked the same stale `node_modules`**, so it
   reproduced the failure for the wrong reason and looked like proof. A worktree only controls for
   *source*; to control for the environment it needs its own `npm ci`. The contradicting evidence was
   already on screen and got explained away: the previous commit's `checks` run was green.
   **When local and CI disagree about the same command, suspect the install before the tree.**

---

## What this pass could not measure

The Browser pane used for verification stayed hidden for the whole session, which pauses
`requestAnimationFrame` and clamps timers. That makes **frame rate and wall-clock INP untrustworthy
here**, which is why the result above is stated in forced-layout counts. Two things therefore remain
for an operator run:

- **Drag frame rate.** Synthetic pointer events never armed FullCalendar's own dragger, so the drag
  gesture was never driven end-to-end. The mechanism it was jamming on is fixed and measured, but the
  felt smoothness is unconfirmed.
- **WKWebView.** Everything here is Chromium. Nuvo.app is WebKit, where forced layout and
  `backdrop-filter` are markedly more expensive — the win should be *larger* there, but that is an
  inference, not a measurement. Safari Web Inspector → Nuvo.app, Phase 0 of the companion audit.

---

## Round two — the paint cost nobody had measured (2026-09-03, later)

The memo fix above is real but the app still felt slow, and the clue that mattered was "it was
**not always** this slow." Both prior audits profiled **Chromium** and measured **JS** (TBT, long
tasks). Nuvo.app runs **WKWebView**, and the cost that was actually there is one neither metric can
see: **compositing**.

On a normal week the Schedule was painting **92 `backdrop-filter` layers covering 3,185,201 px² —
2.5x the viewport** — every one recomputed when anything beneath it moves. That is every frame of a
drag.

| | Layers | Blurred area |
|---|---|---|
| before | 92 | 3,185,201 px² |
| after | **3** | **9,732 px²** |

Three separate things, found by walking the live DOM rather than the stylesheet:

1. **`.app-shell` — `blur(26px)` across the whole window, rendering nothing.** The only thing behind
   it is `.app-ground`, a flat colour (`background: none` over the flat body in Tauri). Blurring a
   constant field returns the same constant.
2. **`.app-canvas` — `blur(20px)`, nested inside it, also rendering nothing.** Its backdrop is
   `.app-shell`'s 155deg linear gradient, and a blur is a symmetric convolution: blurring a linear
   ramp returns the same ramp everywhere but the edges.
3. **`.fc-event` — `blur(5px)` × 87**, one compositing layer per event block. This one *was* visible
   design intent (cf2cc32, "a pane of tinted glass, not a slab"), so it was Phil's call, and he
   chose to drop it. The tinted-glass read comes from the translucent fill (`blockColors`, inline);
   only the softening of the gridlines behind it is gone.

**Verified by screenshot, not by argument** — the Schedule at 1440x900 with each filter on and off,
pixel-identical every time. (1) and (2) are therefore pure cost removal with no design change at
all; the `@media (max-width: 1279px)` branch already set both to `none`, so they were never
load-bearing.

`.fc-event.evt-focused` keeps its `blur(14px)`: one element at a time, and it does real work —
letting the lifted block read cleanly over whatever it overlaps.

**Provenance.** (1) and (2) landed 2026-08-02 in `c557404` ("Aurora: the app is three planes"). The
August 11 perf pass came *after* that and did not see it, because it measured TBT — a JS metric that
is blind to compositing. That is the whole lesson of this round: **when the complaint is "everything
feels slow" and the JS numbers look fine, measure paint, and measure it on the engine the user
actually runs.**

### Still unmeasured here

The win is stated in layers and area, not milliseconds, because the verification browser pane in
this session had no visible viewport — which pauses `requestAnimationFrame` and makes frame timing
meaningless — and because WKWebView could not be profiled from here at all. The reasoning for *why*
it was free to remove is airtight (screenshot-identical); the size of the speed-up on Nuvo.app is
an inference from how WebKit handles backdrop-filter, and only Phil's hands on the DMG can confirm
it.

---

## The top remaining item, now properly characterised

Opening one popover fires **20-60 `flushSync` renders of the FullCalendar subtree**, and the event
data does not change while it happens.

Measured by reaching the `FullCalendar` class instance through the React fiber tree and wrapping its
`setState`:

```
CustomRenderingStore.set            (@fullcalendar/core)
  -> handleCustomRendering          (@fullcalendar/react:66)
    -> flushSync                    (react-dom)
      -> this.setState({customRenderingMap})
```

- popover open, **event data byte-identical, 0 of 88 events changed** -> **20-60 flushes**
- focus-mode toggle (a real width change) -> 20 flushes
- idle -> **0** (so there is no background storm; it is strictly interaction-driven)

**Why.** `eventContent={renderEvent}` returns React elements, so every event's content crosses
FullCalendar's Preact tree back into React as a "custom rendering" — 95 of them live on a normal
week. Whenever FullCalendar re-renders for any reason, each visible event re-requests its rendering,
and the adapter services each request inside `flushSync` — a blocking, synchronous React render and
commit, dozens per interaction. This is the same thing React was complaining about in the console
from the first minute of the audit (`flushSync was called from inside a lifecycle method`), which I
wrongly waved off early as low-volume.

**The direction, not yet taken.** Have `renderEvent` (and `dayCellContent` / `dayHeaderContent`)
return DOM nodes or an `{ html }` string instead of React elements. FullCalendar then renders event
content natively and the custom-rendering bridge — all 95 portals and every `flushSync` — disappears.
`renderEvent` is ~100 lines of rich JSX, so this is a real piece of work with real regression risk
(month vs time-grid variants, the done-toggle, the recurrence mark), and it should be done
deliberately with the harness open, not tacked onto a perf pass. It is, however, the single biggest
remaining cost on this surface.

**Do the cheap thing first:** the two blur commits above removed ~99.7% of the blurred area, and that
is the change most likely to be felt on WKWebView. Confirm whether the Schedule still feels slow
before paying for this one.

---

## Tried and rejected: patching FullCalendar's componentDidUpdate

The `flushSync` storm is a **feedback loop**, not a one-way cost. Each custom-rendering request
calls `setState` on the `FullCalendar` component; its `componentDidUpdate` then calls
`resetOptions` unconditionally — *even when only state changed* — which re-renders the Preact tree,
which requests more custom renderings, which call `setState` again.

The obvious lever is to break the loop: subclass `FullCalendar` and skip `resetOptions` when the
props are shallow-equal (a state-only update has nothing to re-push). Tested by patching the
prototype at runtime and A/B-ing four popover opens each way:

| | setState calls | `resetOptions` | blocked ms (median) | blocked ms (samples) |
|---|---|---|---|---|
| stock | 60 | runs | 327 | 327, 342, 146, 144 |
| patched | 40 | **0** | 256 | 256, 139, 147, 351 |

It does exactly what it claims — a third fewer `setState` calls, `resetOptions` never runs on a
state-only update. **But the blocked-time distributions overlap almost completely** (both arms
produce ~140ms and ~340ms samples), so the median difference is noise, not a win. Forced-layout
counts were unchanged too (~1,046 vs ~1,019).

**Not shipped.** Overriding a library's lifecycle is a permanent maintenance cost — it silently
breaks on any `@fullcalendar/react` upgrade — and it must not be paid for an improvement that cannot
be demonstrated. Recorded here so the next person doesn't spend the afternoon rediscovering it.

The conclusion stands: the cost is the **existence** of 95 React custom renderings, not the loop
that re-triggers them. Removing the bridge (`renderEvent` returning DOM or `{ html }`) is still the
only fix with real headroom.

---

## Round three — the app-wide interaction audit (Phil: "it still feels a little laggy just navigating around")

### Fixing the instrument first

The previous rounds were measured in a browser pane that was **hidden**, which clamps
`setTimeout` to 1000ms and **never runs `requestAnimationFrame` at all**. That is why earlier
timing data was noisy, why drag could never be driven end-to-end, and why one fix was assessed on
numbers that could not support the claim.

Replaced with a **headless Chrome driven over CDP** (`scratchpad/rig/`, zero dependencies — Node 25
has a global `WebSocket`). Verified visible: timers land at ~110ms for a requested 100ms, rAF runs
every frame. Because CDP input events are **trusted**, real INP and real frame drops are finally
measurable. Per interaction it records: long-task blocked ms, React commit ms (root `Profiler`),
**forced style/layout reads** (every `getBoundingClientRect`, `offsetTop`-family getter, and
`getComputedStyle` is wrapped and counted), dropped frames and worst frame.

### The finding

A **constant ~1,092 forced layouts and ~74ms** was charged to *every* interaction — including a rail
tab switch, which has nothing to do with the calendar. That constant is the "everything is a bit
laggy" signature.

It was **not** what I had assumed. Ruled out by measurement, in this order:
- FullCalendar's props changing → **no**: `componentDidUpdate` showed `propChangedUpdates: []` on
  every interaction. The `calendarElement` memo holds perfectly.
- `updateSize` → **no**: stubbing it out entirely left the layout count unchanged (1,092 → 1,012).
- The React custom-rendering bridge → **no**: swapping `eventContent` for plain HTML at runtime
  moved 1,092 → 1,081 and made the popover *worse*. **This retires the "rewrite `renderEvent` to
  return DOM" plan recorded above** — it was the wrong target and would have been a large, risky
  refactor for ~4%.

The real cause: **`syncCalendarEvents` mutates the grid one event at a time.** Every `addEvent`,
`setDates` and `setProp` is a separate FullCalendar action that re-renders and re-measures the whole
grid. Paging one week re-adds 71-84 events and patches the rest.

Micro-benchmarked on the live calendar:

| 80 events | wall ms | forced layouts | blocked ms | worst frame |
|---|---|---|---|---|
| add, one at a time | 548 | 8,184 | 547 | 542ms |
| add, `batchRendering` | **37** | **284** | **0** | 33ms |
| add + mutate, one at a time *(what the app does)* | 1,475 | 24,184 | 1,475 | **1,467ms** |
| add + mutate, `batchRendering` | **73** | **284** | 73 | 67ms |

A single 1,467ms frame is a visibly frozen app.

### The fix

`syncCalendarEvents` now runs its whole reconcile inside `api.batchRendering()` (FullCalendar v6,
`core/index.js:2148` — it pauses the render runner). One line of structure, guarded by
`tests/sync-calendar-events.test.ts` which asserts every mutation happens inside the batch and that
an api *without* `batchRendering` still reconciles identically.

| interaction | forced layouts | blocked ms | worst frame |
|---|---|---|---|
| week travel | 19,171 → **1,770** | 310 → **61** | 308 → **58** |
| rail tab switch | 1,092 → **192** | 74 → **0** | 66 → **17** |
| lens Week↔Day | 1,092 → **192** | 74 → **0** | 67 → **17** |
| popover open | 1,192 → **292** | 102 → **68** | 100 → **58** |

Full sweep afterwards: **every interaction except week travel now blocks 0ms** — navigation ⌘1-4,
all five lenses, rail tabs, popover open/close, Settings, the Nuvo rail.

### What is left

| interaction | blocked | react ms | forced layouts |
|---|---|---|---|
| `cal prev/next week` | 54-72ms | 47-96 | 2,154-2,784 |
| `focus mode ⌘.` | 0ms | 24-44 | 9,833-11,492 |

Week travel is still the most expensive thing in the app, but it is now a tenth of what it was. Focus
mode does a genuine width change so a re-measure is legitimate, but ~10k forced layouts for one
toggle is worth a look; it blocks nothing today, so it is not urgent.
