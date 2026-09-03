# Nuvo — desktop performance audit, 2026-09-03

**Status:** complete · remediation shipped same day · Tauri/WKWebView focus
**Companion:** [`perf-audit-2026-08-11.md`](perf-audit-2026-08-11.md) (Chrome, commit `0d53c202`) — numbers there do **not** apply to Nuvo.app

---

## How to read this

The August pass measured Chrome over DevTools Protocol. This pass targets the **installed
Tauri macOS app** (WKWebView), where drag on the Schedule was the first user-facing failure:
pointer felt drunk, blocks didn't track reliably, and the app felt slow all around.

Phase 0 instrumentation (Safari Web Inspector → Nuvo.app → Interaction to Next Paint,
Long Animation Frames, `longtask` during calendar drag, rail→grid, ⌘1/⌘2, idle 60s) is the
**operator verification bar** — attach inspector to the running `.app` and repeat the
gestures below. This document records code-level root causes confirmed in source and the fixes
shipped in this pass; before/after INP numbers require that Safari session on Nuvo.app.

**Build verified:** `npm run typecheck` · `npm test` (including new grid-sync tests) ·
`npm run build` green after remediation.

---

## Executive summary — what was wrong on desktop

| # | Finding | Confidence | Fix shipped |
|---|---|---|---|
| 1 | **Three systems on one Schedule gesture.** FullCalendar drag + capture-phase `pointermove` on `document` that `querySelectorAll` + `getBoundingClientRect` every slot/day cell + `useListReorder` `setState` per move. | High | CalendarPane: snapshot rects on pointerdown, rAF-coalesced hit-test; useListReorder: imperative insertion line |
| 2 | **Grid reconcile mid-drag.** `syncCalendarEvents` / `fcEvents` rebuild on 30s `now` tick and all-day create-drag rewrote React state during gestures. | High | `gridSyncPlan` + pause/resume on FC drag/resize/all-day drag; `fcNow` frozen while paused |
| 3 | **PostHog session replay on Tauri.** rrweb + mask-all-text on constant FC DOM mutation. | High (code) | `disable_session_recording: true` when `isTauri()`; exceptions kept |
| 4 | **Hidden floor still reconciled.** `FloorPane` had no `skipWhenAsleep`. | High | `memo(FloorPane, skipWhenAsleep)` + `live={rung !== "day"}` |
| 5 | **Inline FullCalendar callbacks.** Nav-state / 30s tick re-render recreated `dayHeaderContent`, `nowIndicatorContent`, time-grid options → FC `setOption` tax. | Medium | Stabilized callbacks + `timeGridOptions` memo; overdue clock via `fcNow` |
| 6 | **Remaining drag surfaces still on React per move.** Timeline, Sunday ritual grid, LeftRail resize. | Medium | rAF-coalesced state / imperative width during resize |

**Deliberately not re-done:** unmount FullCalendar on ⌘2 — August experiment showed ~111ms construct + full event reconcile; KeepAlive stays.

---

## Phase 0 — verification checklist (Nuvo.app + Safari Web Inspector)

Run on **installed production** (`npm run app:install` or current Nuvo.app), not `tauri:dev`
(StrictMode doubles renders; August refused to quote dev numbers).

1. **Calendar block drag (week grid):** drag a timed task block 30s. Expect pointer to track
   without dropped frames; no long tasks ≥50ms attributed to `pointermove` / layout.
2. **Inbox → calendar:** drag a rail row onto the week grid. Same bar.
3. **⌘2 → ⌘1:** Projects then back to Schedule. Should not feel like a cold page load
   (KeepAlive — grid stays mounted).
4. **Idle 60s on Schedule:** 30s `now` tick should not blank blocks or disturb an in-flight drag
   (`fcNow` updates only when grid sync is not paused).
5. **PostHog A/B:** with session recording disabled in Tauri (now default), drag should feel
   snappier vs a build with recording forced on — if not, inspect FC hit-test and grid sync first.

Note event volume: August cached range had **1,467 external events**; count `.fc-event` nodes
if drag still struggles at high volume.

---

## Phase 1 — Schedule drag (shipped)

### Calendar hit-test (`CalendarPane.tsx`)

- On drag start: snapshot `.fc-event.evt-slot` and day-cell rects once.
- On move: one rAF-coalesced `flushMove` hit-tests the snapshot — no per-move DOM queries.
- All-day range drag: rAF-coalesced `setAllDayDragRange`, pauses grid sync for the gesture.

### Freeze grid during live drag

- `src/lib/calendarGridSync.ts` — `gridSyncPlan(paused, next)` defers reconcile while paused.
- `pauseGridSync` / `resumeGridSync` wired to FC `eventDragStart`/`Stop`, resize, all-day drag,
  and rail-drop reset.
- `fcNow` state: overdue styling updates on the 30s tick only when sync is not paused.
- Tests: `tests/calendar-grid-sync.test.ts`, existing `tests/sync-calendar-events.test.ts`.

### PostHog (`src/lib/posthog.ts`)

- Tauri: `disable_session_recording: true`, no `session_recording` config block.
- Web/PWA: unchanged masked recording posture (D-114).

### Rail reorder (`useListReorder.ts`, `LeftRail.tsx`)

- Insertion line is an imperative DOM node; `top` written on pointermove, not React state.

---

## Phase 2 — all-around tax (shipped)

### Floor asleep (`FloorPane.tsx`, `AppShell.tsx`)

- `memo(FloorPane, skipWhenAsleep)` — hidden project/initiative floor skips reconcile while
  Schedule is in front (`live={rung !== "day"}`).

### Planner / FullCalendar callback stability (`CalendarPane.tsx`)

- `timeGridOptions`, `nowIndicatorContent`, `dayHeaderContent`, `dayCellContent`,
  `handleEventDidMount` stabilized with `useMemo` / `useCallback`.
- `fcNow` decouples overdue/event rebuild from every Planner render; 30s tick still drives
  chrome (`TimeZoneChip`, year cursor) without forcing mid-drag grid sync.

### Remaining drags

- `floors/parts.tsx` — timeline bar + tray: rAF-coalesced drag state.
- `SundayRitual.tsx` — column snapshot + rAF-coalesced `bump()`.
- `LeftRail.tsx` — resize writes width to DOM during drag; commits preference on pointerup.

---

## Done when (this pass)

- [x] Code fixes for ranked causes 1–6 above
- [x] Regression tests for grid-sync deferral
- [x] `npm run typecheck` / `npm test` / `npm run build` green
- [ ] Operator confirms drag + ⌘1/⌘2 on **Nuvo.app** with Safari inspector (Phase 0 bar)

---

## Files touched

| Area | Files |
|---|---|
| Grid sync | `src/lib/calendarGridSync.ts`, `src/components/CalendarPane.tsx` |
| Telemetry | `src/lib/posthog.ts` |
| Floor asleep | `src/components/FloorPane.tsx`, `src/components/AppShell.tsx` |
| Rail | `src/hooks/useListReorder.ts`, `src/components/LeftRail.tsx` |
| Other drags | `src/components/floors/parts.tsx`, `src/components/rituals/SundayRitual.tsx` |
| Tests | `tests/calendar-grid-sync.test.ts` |
