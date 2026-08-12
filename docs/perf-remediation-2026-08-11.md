# Performance remediation — 2026-08-11

Executes [`perf-remediation-prompt.md`](perf-remediation-prompt.md) against the findings in
[`perf-audit-2026-08-11.md`](perf-audit-2026-08-11.md). Baselines below are the audit's
numbers (commit `0d53c202`); "after" numbers were re-measured with the same rig, same
statistics, against the remediated tree.

**Gates at completion: `npm run typecheck` clean · `npm test` 561/561 · `npm run build`
green · Tauri build (`TAURI_BUILD=1`) emits no `sw.js` · driven in the running dev app at
desktop width and 375px with zero console errors.**

---

## P0-1 · The Schedule unmounts while a floor is open — DONE

The gate lives inside `Planner` (not AppShell): LeftRail + CalendarPane + the anchored
popovers mount only when `rung === "day"`, while Planner itself stays mounted for its
app-global tenants (realtime, the rollover guard, ⌘K, Settings, the week plan overlay).
`CalendarPane` remembers its anchor date and time-grid scroll in a module-level cache and
reopens exactly where it was left (`initialDate` + a scroll restore effect).

- Verified in the app: on the Projects floor, `.fc` is gone (`fc-event` nodes 88 → 0, rail
  rows 0); returning to Schedule reopened on the paged-to date (WED 12), not today.
- Side effect worth knowing: the rail's j/k/e/t/f/x hotkeys no longer act on invisible
  tasks while a floor is open — that was a latent bug, not a feature.

## P0-2 · Cache persister throttled — DONE

`createIdbPersister` now holds the latest snapshot and writes it on a 5s trailing edge,
inside `requestIdleCallback` (2s timeout) so serialize+clone never lands inside an
interaction frame. Flushes immediately on `visibilitychange → hidden` (PWA freeze/kill
safety). Both `removeClient` and `clearPersistedCache` cancel any pending write first, so
a throttled persist can't re-write a signed-out account's cache after the wipe.

## P0-3 · Post-drain invalidation storm scoped — DONE

`DrainReport` now carries `sentTables` — the tables a drain actually delivered — and
`syncNow` scopes its refetches to that set: `["tasks"]` only when tasks/task_labels were
delivered (the db966cc double-tap guard stays), `["vertical"]` only when
projects/initiatives/domains/key_results were. Also fixed en route: deferred invalidations
used to be released only for tables in the pre-drain snapshot, which could strand keys for
a table that started owing mid-drain — release is now "everything that no longer owes."

## P0-4 · Bundle code-split — DONE

Zero `React.lazy` before; the entry chunk was one 2,068.9 KB file.

| chunk | size (before → after) |
|---|---|
| entry | **2,068.9 KB → 478.8 KB** (gzip 286.8 → 146.4 KB) |
| vendor-react (initial, parallel) | 143.0 KB |
| vendor-supabase (initial, parallel) | 211.4 KB |
| FullCalendar + CalendarPane (desktop, on Schedule) | 214.6 + 132.5 KB |
| MobileShell (phone only) | 156.3 KB |
| FloorPane + floors (on first floor open) | 125.9 KB + satellites |
| chrono-node (loads post-boot, off the entry) | 172.7 KB |
| react-markdown chain (first chat reply) | 118.5 KB |
| SlideOver / SettingsModal / rituals / WeekPlanFloor / Spotlight / RecordModal … | on demand |

Split points: `CalendarPane`, `SettingsModal`, the three `SlideOver` popovers,
`NuvoSpotlight`, `WeekPlanFloor`, `RecurringUpkeepPanel` (Planner); `MobileShell`,
`SundayRitual`, `SummitRitual`, `FloorPane`, `RecordModal`, `CreateRecord`, `CapacityRun`,
`Orientation` (AppShell — Orientation is also gated on `useOrientation().visible`, so an
onboarded account never fetches the walkthrough chunk); `ReactMarkdown`
(AgentMessageBubble); `SpotlightHost` (App — only the ⌥Space webview loads it); chrono-node
(nlp.ts, dynamic — in the sliver before it lands, parseCapture handles deterministic
tokens and skips natural-language dates; the next keystroke self-heals).

Three entry leaks had to be cut for the split to land: `plainTextFromHtml` moved out of
SlideOver into `lib/text.ts` (the mobile event sheet was dragging the whole desktop popover
module into the phone path), `PROJECT_STATUS_COLORS` out of `floors/parts.tsx` into
`floors/statusColors.ts` (Spine → ReadinessBanner anchored the 32 KB grab-bag into the
entry), and `ORIENTATION_VERSION` out of `orientation/steps.tsx` into
`orientation/version.ts` (useOrientation dragged the step visuals in).

**Load metrics (rig `run-load.js`, 5 runs, real dist + service worker):**

| metric | audit | target | after |
|---|---|---|---|
| warm TBT | 315 ms | <150 ms | **~20 ms median** (13–28) |
| cold 4×CPU TBT | 1,449 ms | <600 ms | **~265 ms median** |
| cold 1× TBT | ~199 ms | — | **0 ms** (zero long tasks ≥50 ms at boot) |
| CLS (load) | 0.000–0.006 | no regression | 0.013 — the calendar chunk mounting; still far under the 0.1 "good" bar, but honest to name |

Tauri build (`TAURI_BUILD=1`) verified green with no `sw.js`/manifest; web build still
emits both. All chunks are far below the workbox 2 MiB per-file precache ceiling.

## P1-5 · DayCard — DONE

The cost wasn't in DayCard's JSX — `buildDayPlan` re-filtered **every** event and block
(with fresh `Date` allocations per row) once per day: 21 agenda days × 1,467 events. Fix:
a per-ctx `WeakMap` index in `dayPlan.ts` buckets timed events and blocks by day key and
pre-parses all-day spans once; `buildDayPlan`'s per-day work is now O(that day's items).
All three lenses (month grid, agenda, Day lens) share it with zero call-site changes.
DayCard itself is memoized with stable per-day `innerRef` callbacks (`onTapEvent` was
already a stable setState ref).

## P1-6 · Drag surfaces rAF-coalesced — DONE

`OnDeckPlanner`, `WeekBoard`, `MobileDeck` all follow the Sheet.tsx pattern now: the
latest pointer event is stashed in a local, ONE flush runs per rAF (including the
`elementFromPoint` hit-test), React state changes only when the derived drop target
actually changed, and the ghost's position is a direct `transform: translate3d()` write on
a ref'd node (`will-change: transform`, identity set once at pickup). `pointerup` cancels
the rAF and runs a final flush so the drop lands on the last pointer position, not the
last painted frame. Re-measured: **0 dropped frames** on the board and OnDeck drags.

## P1-7 · useVertical fan-out — DONE

- **Correctness fix:** `buildVertical` was handed a raw `new Date()` that wasn't a memo
  dependency — the derive froze at whatever instant the last data change happened (an app
  left open overnight kept yesterday's "today"). Now a 5-minute ticking `buildNow` state,
  kicked immediately on `visibilitychange → visible`.
- **Spine split:** the Spine (top self-time component on 18 of 24 audited interactions)
  is now a thin wrapper — `useVertical` + `readSpine` + a JSON-signature identity hold —
  over a memoized `SpineBody`. A vertical rebuild whose spine reading is equivalent no
  longer re-renders the Spine's DOM. Its two door props (`openSettings`/`openShortcuts`)
  are `useCallback`-stabilized in AppShell.
- **TimeZoneChip** memoized (Intl work on every toolbar re-render, answer changes at most
  per 30s clock tick).
- **TaskRow deliberately not memoized:** every call site hands it fresh inline closures,
  so a memo would compare and never bail — and P0-1 already removed its always-mounted
  cost on non-Schedule surfaces, which is where the audit measured it.

## P1-8 · Synchronous keydown handlers — DONE

⌘1–4 / ⌘↑↓ rung changes and the shortcuts overlay's Escape-close are wrapped in
`startTransition` — the nav write is all that happens before paint; the floor render
happens concurrently instead of blocking the keydown handler for 51 ms / 20 ms.

## P2-9 · Queries bounded; virtualization deliberately deferred

- `["tasks","all"]` had a silent correctness cliff, not a perf one: a bare select is
  capped at PostgREST's `max_rows` (1000), the exact silent-truncation failure of D-085.
  One shared `fetchAllTasks` (useTasks + useVertical) now **pages to completion** via
  `.range()` with an `id` tiebreak for a total order.
- **DOM virtualization was not added — a deliberate deviation.** The Collection table's
  marquee/range selection hit-tests live row DOM rects (`useCollectionSelection`), which
  virtualization breaks; at real data volume the table renders ~43 rows and measured
  clean, and the brief's own rule 5 forbids optimizing what is fine + regressing clean
  scroll. The `d.day.month` fiber count is FullCalendar-internal (a React renderer per
  event) and not reachable by a list-virtualization library. A follow-up task chip was
  filed for when record counts actually grow.

## P2-10 · Dead code — DONE

All 12 files grep-verified (only importers were inside the dead cluster itself) and
deleted; `@tanstack/query-async-storage-persister` removed from dependencies; the
`eventKey`/`eventInstanceKey` duplicate export collapsed to `eventKey` (lib/now re-export
and both consumers updated). Do-not-delete list respected (harnesses, fontsource imports,
vite-plugin-pwa, npm:/virtual: specifiers all untouched).

## P2-11 · index.css split by skin — PARTIAL (by the numbers), DONE (by mechanism)

The four non-default materials (133 rule blocks, ~71 KB source) moved to
`src/skins/{terminal,flat,eink,blueprint}.css`, loaded on demand by `useSkin` the first
time a material is chosen — the attribute lands only after the stylesheet is in, so the
app never paints half-skinned. `tests/token-contrast.test.ts` reads the skin files
alongside index.css (still the deployed values, never a copy).

- Initial CSS: **197.1 KB → 165.9 KB** (gzip 38.8 → 32.1 KB); skins are 3.2–14.6 KB each,
  deferred.
- The <80 KB target is **not reachable** without breaking Tailwind v4's single-pass
  utility layer: the audit's "187 of 194 theme-selector blocks are non-default skins"
  counted *blocks*, but skins were only 73 KB of the 182 KB source — the remainder is
  Tailwind utilities + the default material + fonts, all needed for first paint.
- Verified live: switching to Terminal loads its stylesheet on demand and applies fully;
  a boot already on a non-default skin pays one small fetch (SW-cached thereafter).

---

## Re-measurement

Same rig, same statistics as the audit (medians, run 1 discarded). Interactions were
measured on the same **prod-profiling build variant** as the baseline (react-dom/profiling,
no SW); results live beside the audit's raw data as `results/post-prod2/`, `post-crud/`,
`post-mobile/`. Load numbers above under P0-4.

| target (audit § / brief) | baseline | target | after |
|---|---|---|---|
| ctrl-2-projects handler | 51.3 ms | <8 ms | **0.9 ms** |
| Escape-close shortcuts handler | 20.0 ms | <8 ms | **<1 ms** (off the slow-handler table entirely) |
| OnDeck drag-card: commits / LoAF / dropped | 51 commits · 219.7 ms LoAF · 9–10 dropped | 0 dropped | **9 commits · 0 LoAF · 0 dropped**; INP 96→56 ms |
| WeekBoard drag: commit total | 43.7 ms | — | **13.0 ms**, 0 dropped |
| T2 post-ack reconcile | 3–4 commits | 0–1 | **2 commits, 4.6 ms total** (~90 % cheaper) |
| m.calendar tab-to-calendar (4× CPU) | 272 ms INP · 148.4 ms commits · 13 dropped | <150 ms INP, DayCard <20 ms | **80 ms INP · 20.2 ms commits · 0 dropped** |
| m.calendar scroll commits | 43.5 ms | — | **3.5 ms** |
| every mobile tab switch | up to 200 ms INP, 4–13 dropped | — | **64–80 ms INP, 0 dropped** |
| d.day.month/settle commits · fibers | 46.8 ms · 423 | <20 ms · <150 | **24.5 ms · 203** — better, not fully met: the remaining fibers are FullCalendar's per-event React renderers, out of a list library's reach |
| d.project.all/settle commits | 23.4 ms | <10 ms | **20.9 ms** — see note below |
| Spine as top self-time component | 18 of 24 interactions | off the slot | **0 of 24** (readSpine now memoized on data identity + memoized body; Spine appears in no breakdown) |
| Planner/CalendarPane/TaskRow under floors | in all 24 breakdowns | absent on non-day | **absent from steady-state**; what remains in floor *settle* windows is the one-time Schedule-unmount + floor-mount commits of the transition itself |

**On the two floor-settle targets that didn't fully land:** the audit's evidence for them
was the Schedule re-rendering *under* every floor forever. That tax is gone — the numbers
that remain in a settle window are the transition's own mount/unmount work (OnDeckPlanner
mounting is ~7–10 ms of it), which happens once per navigation rather than on every
subsequent interaction. Scroll frame health stayed clean everywhere it was clean before,
and drag surfaces went from 9–10 dropped frames to zero.

**CRUD teardown note:** the rig's cleanup path failed to find its inline delete control on
this pass (the popover it drives is lazy now); the five `zz-perf-*` rows it created were
trashed by hand through the same status write the app's Trash button issues, and verified
gone. If the rig is re-run, its teardown selector needs a beat of patience for the lazy
popover chunk.
