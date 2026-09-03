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
7. **`npm test` is red on `master`** — 55 failures across 11 files, every one a
   `ReferenceError: React is not defined` from a JSX-runtime config problem in the test setup, not a
   product bug. **Confirmed pre-existing** by running the suite in a clean worktree at `10bfef2`
   (identical 55). CI (`checks.yml`) runs typecheck + tests on every push, so this has been failing
   for a while and is currently hiding any real regression.

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
