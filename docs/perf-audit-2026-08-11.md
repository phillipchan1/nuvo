# Nuvo — performance audit, 2026-08-11

**Status:** complete · measured, not estimated · nothing was fixed in this pass
**Companion:** [`perf-remediation-prompt.md`](perf-remediation-prompt.md) — the executable fix brief

---

## How to read this

Every number here came off a real Chrome (151.0.7922.76) driven over the DevTools
Protocol against **commit `0d53c202`** with **`src/` unmodified**. No estimates, no
"best practice" filler.

**Provenance for every number below:**

| | |
|---|---|
| Build measured | **prod-profiling** (`react-dom/profiling`, minified, no StrictMode) for interactions; the **real `dist/`** for load |
| Account data volume | **7 domains · 18 initiatives · 25 projects · 333 tasks · 1,467 external events** in one cached range |
| Viewport | 1440×900 desktop · 375×812 dpr3 + touch emulation for mobile |
| Runs | 7 per desktop measurement, 5 mobile, **run 1 always discarded** (JIT/code-cache warmup) |
| Stats | median / p75 / p95 / MAD — **never the mean** (these distributions are bimodal by construction) |
| Machine | M-series Mac, plugged in, `pmset -g therm` clean before and after — no thermal throttling during the sweep |
| Totals | **192 desktop + 40 mobile measurements, 0 errors** |

Two deliberate methodology choices, because they change what the numbers mean:

- **Dev-server timings are never quoted as costs.** React's dev build double-invokes
  every render under `StrictMode` (8 sites in `main.tsx`), so dev numbers run ~2× high.
  The dev server is used *only* to resolve minified script names to real `src/` paths.
- **Latency is measured with the Event Timing API**, which is what INP is defined from —
  so these numbers compare directly to Lighthouse/CrUX and to a post-fix re-run.
  `duration` is bucketed to 8ms by spec; `handler` and `input delay` are recorded at full
  precision separately, which is where synchronous work actually shows up.

---

## Executive summary — the 10 that matter

Ranked by user-perceived impact across all categories, not per phase.

| # | Finding | Measured | Effort |
|---|---|---|---|
| 1 | **The Schedule never unmounts.** `<Planner/>` renders unconditionally; floors are layered *over* it. Every surface — including Settings — keeps a live FullCalendar with 88 event nodes, the LeftRail and its TaskRows rendering underneath. | `Planner`, `CalendarPane`, `TaskRow$1`, `TimeZoneChip` appear in the commit breakdown of **every one of 24 measured surfaces**. 88 `.fc-event` nodes present on `d.settings`. | M |
| 2 | **One 2.07 MB JS chunk, no splitting.** 28% of it is code the current shell can never execute: 414 KB desktop-only shipped to phones, 151 KB mobile-only shipped to desktops. | FullCalendar = **258.8 KB (12.8%)**, `src/components/mobile/**` = **151.5 KB (7.5%)**, react-markdown tree = **107.2 KB**, chrono-node = **44.8 KB** | L |
| 3 | **Caching cannot fix the bundle — only splitting can.** The warm (service-worker) load fetches **0 KB of JS** from the network and still blocks longer than the cold unthrottled load. Parse+execute is the cost, not transfer. | warm TBT **315ms** vs cold-unthrottled **199ms**, both at 0 vs 2,028 KB transferred | — |
| 4 | **`DayCard` is the single most expensive component in the app.** | mobile `tab-to-calendar`: **280ms INP, 185ms blocking, 13 dropped frames**, 150ms commit of which **DayCard = 118.6ms self** | M |
| 5 | **Creating one task costs 616ms of long animation frames.** | `crud/create`: **248–272ms INP**, **211–226ms handler**, **616ms LoAF**, 13–17 React commits | M |
| 6 | **The offline persister serializes the whole query cache on the interaction path.** No `throttleTime` is set, so every cache change re-dehydrates 333 tasks + 1,467 events + 25 projects into IndexedDB on the main thread. | LoAF attributed **130.1ms to `src/lib/sync/idb.ts` during a *cancelled* drag** — a gesture that mutates nothing | S |
| 7 | **`OnDeckPlanner` drag is the worst desktop interaction.** `setState` per `pointermove`, no rAF coalescing, ghost positioned via `left/top`. | **9–10 dropped frames**, **51 commits**, 219.7ms LoAF, 155ms long tasks; `OnDeckPlanner.tsx#up` = **49.9ms in one script** | M |
| 8 | **Cold boot on a mid-range phone is 1.4–2.1s of blocked main thread.** | 4× CPU: **TBT 1,449ms (p95 2,072ms)**, LCP 1,884ms, surfaceReady 1,836ms | L |
| 9 | **A keyboard nav runs a 51ms synchronous handler.** ⌘/Ctrl-2 → Projects blocks the thread before it can paint. | `ctrl-2-projects`: **handler 51.3ms median, 52.8ms p95** | S |
| 10 | **Dead code ships.** 12 unused files (one 3-file dead cluster), a runtime dependency that is never imported, 170 unused exports, 110 unused types. | Two independent tools agree on `@tanstack/query-async-storage-persister` | S |

**What is *not* a problem — verified, so nobody optimizes it by reflex:**
scrolling is clean everywhere (**0 dropped frames** on 8 of 9 desktop scroll surfaces —
it is compositor-driven and stays off the React path); **CLS is 0.000–0.006** on every
load variant; and LCP resolves to real content (`SPAN.min-w-0`), *not* the splash
wordmark — the caveat I expected going in did not materialise.

---

## Phase 1 — Interaction latency

`INP` = input→next-paint (8ms buckets, the user-facing number). `handler` = synchronous
handler time at full precision. n=6 unless noted, prod-profiling, desktop 1440×900.

| interaction | INP med | p75 | p95 | handler med | handler p95 | input delay |
|---|---|---|---|---|---|---|
| `d.project.ondeck/drag-card` | **96** | 96 | 96 | 1.8 | 1.9 | 0.1 |
| `d.keyboard/ctrl-2-projects` | **88** | 88 | 88 | **51.3** | **52.8** | 0.5 |
| `d.day.month/open-event` | **80** | 88 | 96 | 0.1 | 0.2 | 2.8 |
| `d.day.week/spine-to-project` | **72** | 72 | 88 | 0.1 | 0.1 | 0.2 |
| `d.day.week/open-event` | **72** | 72 | 88 | 0.1 | 0.2 | 2.6 |
| `d.project.ondeck/spine-to-day` | **72** | 72 | 88 | 0.1 | 0.2 | 3.6 |
| `d.shortcuts/close` | **72** | 72 | 72 | **20.0** | 20.9 | 0.2 |
| `d.day.week/toggle-rail-tab` | **56** | 56 | 72 | 0.1 | 0.1 | 2.6 |
| `d.day.board/drag-task` | **56** | 56 | 56 | 0.2 | 0.3 | 0.6 |
| `d.day.inbox/back-to-today` | **56** | 72 | 72 | 0.0 | 0.1 | 0.4 |

**Read this carefully:** almost every `handler` is ~0.1ms. The app is *not* slow because
handlers are slow — it is slow because each interaction schedules **8–51 React commits**
that take multiple frames to paint. The exceptions are the two real synchronous blocks:
`ctrl-2-projects` (51.3ms) and `Escape` closing the shortcuts overlay (20.0ms).

Against the brief's "<100ms, ideally <50ms" bar: **nothing on desktop meets the 50ms
ideal**, and one interaction (`drag-card`, 96ms) sits at the edge of the 100ms bar.

---

## Phase 2 — CRUD

Measured on a disposable subtree (`zz-perf-*` tasks) created through the app's own capture
composer, at the account's real data volume. **Every seeded row was deleted and verified
gone; outbox drained to 0** — see the teardown gate at the end.

| entity · operation | behaviour today | time-to-feedback | optimistic? | verdict |
|---|---|---|---|---|
| task · **create** (capture) | cache patched, then `queueWrite` to IndexedDB, then network | **INP 248–272ms**, handler 211–226ms, **616ms LoAF**, 13–17 commits | **yes** | too expensive for an optimistic path |
| task · **create → reconcile (T2)** | outbox acks → `syncNow` invalidates `["tasks"]` **and** `["vertical"]` → `buildVertical` re-runs → second commit storm | 3–4 further commits, `VerticalProvider` + `Planner` re-render | n/a | invisible second render, pure waste |
| task · **update** (toggle done) | `patchCaches` walks **every** cached `["tasks",*]` query twice | not isolated — no inline toggle on inbox rows | yes | see note |
| task · **delete** | popover → **"Trash"** (not "Delete") | — | yes | works; label is worth knowing |
| project/initiative/domain · writes | same `queueWrite` + `invalidate` helpers in `useVertical.tsx` (31 `queueWrite` call sites) | not separately measured | yes | structurally identical to the above |
| all · **read/list** | `["tasks","all"]` is `select("*")` over every non-trashed task, **no `.limit()`** | 333 rows today | n/a | unbounded by design |
| all · **sort/filter** | client-side over cached data | instant | n/a | **not a problem** |

**The mutation architecture, for the record:** only **5 true optimistic `onMutate`
mutations exist in the whole app** (all in `useCalendar.ts`). Everything else is either
invalidate-only `useMutation` (~20) or — the dominant path — **manual `setQueryData` +
`queueWrite`**, ~100+ call sites (`useVertical.tsx` alone has 31). So writes *are*
optimistic; the cost is not the network, it is what each write re-renders.

---

## Phase 3 — Drag, resize, direct manipulation

| surface | mechanism | dropped frames (med/p95) | commits | frame p95 |
|---|---|---|---|---|
| `ondeck/OnDeckPlanner.tsx` | `setState` per `pointermove`, **no rAF**, ghost via `left/top` | **9 / 10** | **51** | 17.6ms |
| `floors/WeekBoard.tsx` | `setState` per `pointermove`, no rAF, ghost via `left/top` | 0 / 0 | **37** | 17.4ms |
| `mobile/deck/MobileDeck.tsx` | `setState` per `pointermove` | (mobile pass) | 2 | — |
| `mobile/Sheet.tsx` | writes `style.transform` directly — off the React path | — | — | **the correct pattern** |
| `hooks/useListReorder.ts` | pointer events, imperative drop chip | — | — | mostly correct |
| `CalendarPane.tsx` | FullCalendar + a per-move `querySelectorAll('.fc-event.evt-slot')` hit-test | — | — | see note |

`WeekBoard` is instructive: it commits **37 times** during a drag yet drops **zero**
frames, because each commit is small enough to fit the budget. `OnDeckPlanner` commits 51
times and drops 9–10. So *commit count alone is not the defect* — commit count × commit
cost is. LoAF named the culprit precisely: **`OnDeckPlanner.tsx#up` = 49.9ms in a single
script**.

Touch/`touch-action`: the mobile sheet is the only surface writing transforms directly,
and it is the only one with no measured jank. No 300ms tap delay was observed
(`viewport` meta is correct).

---

## Phase 4 — Animation & transition

CSS-only (no `framer-motion`). No leaked rAF loops or post-unmount animation were observed
across 232 measurements. `CLS = 0.000–0.006` on every load variant — transitions are not
causing layout shift. **No action needed.**

---

## Phase 5 — Data layer

| aspect | today | assessment |
|---|---|---|
| `staleTime` | 15s global | with `refetchOnWindowFocus: true`, a tab refocus refetches nearly everything |
| `gcTime` | **not set** (5min default) | |
| Persistence | `PersistQueryClientProvider`, **no `throttleTime`** ([App.tsx:279](../src/App.tsx#L279)) | **130.1ms of `idb.ts` on a cancelled drag** — the whole cache re-serialized on the interaction path |
| Post-drain invalidation | `syncNow` invalidates each settled table **plus** `["tasks"]` **plus** `["vertical"]` ([coordinator.ts:91-94](../src/lib/sync/coordinator.ts#L91)) | one write refetches the entire vertical store |
| Realtime | single channel, per-table, **120ms coalesce**, deferred while the outbox is owed ([useRealtime.ts](../src/hooks/useRealtime.ts)) | **well built — leave alone** |
| Pagination / limits | **3 `.limit()` calls in the entire app**, all `limit(1)` | every list query is unbounded |
| Virtualization | **no library present**; every list is a plain `.map()` | `d.day.month` renders **471 `.fc-event` nodes / 3,213 elements** |
| Waterfalls | none material found | queries fan out in parallel |

---

## Phase 6 — Render amplification

Top surfaces by React commit cost (prod-profiling, so these are honest production numbers).

| interaction | commits | commit ms med | p95 | fibers | top component | breakdown |
|---|---|---|---|---|---|---|
| `d.day.month/settle` | 9 | **46.8** | 48.6 | 423 | Spine | Spine:4.7 TaskRow$1:3.0 TimeZoneChip:1.4 **CalendarPane:1.4 Planner:1.4** |
| `d.day.board/drag-task` | 37 | **43.7** | 50.6 | 102 | WeekBoard | **WeekBoard:25.0** TaskRow$1:3.6 Spine:1.0 |
| `d.project.ondeck/drag-card` | 51 | **27.4** | 32.9 | 82 | OnDeckPlanner | **OnDeckPlanner:9.9** DomainCoverage:1.2 DeckCard:1.2 |
| `d.project.ondeck/spine-to-day` | 8 | **27.1** | 28.2 | 166 | Spine | Spine:5.9 OnDeckPlanner:5.6 TaskRow$1:3.5 **Planner:1.6** |
| `d.day.week/spine-to-project` | 8 | **24.9** | 26.9 | 142 | Spine | Spine:5.2 TaskRow$1:3.7 OnDeckPlanner:3.3 **Planner:1.4** |
| `d.project.all/settle` | 8 | **23.4** | 25.4 | 194 | Spine | Spine:4.0 TaskRow$1:2.3 **Planner:0.9** PortfolioFloor:0.7 |
| `d.domain.wall/settle` | 8 | **19.2** | 22.7 | 135 | Spine | Spine:4.7 TaskRow$1:3.3 DomainFloor:2.0 **Planner:1.3** |
| `d.settings/settle` | 6 | **7.3** | 7.9 | 96 | Spine | Spine:2.2 TaskRow$1:1.2 **Planner:0.5 CalendarPane:0.2** |

**The pattern is the finding.** `Spine`, `TaskRow$1`, `Planner`, `TimeZoneChip` and
`CalendarPane` appear on **every single surface**, Settings included. `Spine` is the top
self-time component on 18 of 24 interactions because it consumes `useVertical()`
([Spine.tsx:106](../src/components/Spine.tsx#L106)) and therefore re-renders whenever
anything in the account changes.

Root cause: [`useVertical.tsx:426`](../src/hooks/useVertical.tsx#L426) rebuilds
`buildVertical()` over the **entire account** whenever any of 10 dependencies change, and
`VerticalProvider` sits above `AppShell`. Combined with finding #1 (nothing unmounts),
every write re-renders every surface.

There is **zero `React.memo` in the codebase**, so nothing stops the cascade.

*Separately, worth a fix even though it is not a performance issue:* `buildVertical` is
called with `new Date()` as an argument but `now` is **not** in the dependency array — so
the memo does not rebuild on a clock tick (good for perf) and instead **captures a stale
`now`** for the lifetime of the memo (a correctness question).

---

## Phase 7 — Codebase health

**Bundle — the real `dist/`, 2,020 KB mapped of a 2,068,904-byte chunk:**

| share | size | group |
|---|---|---|
| 41.8% | 845.5 KB | `src/components/**` |
| **12.8%** | **258.8 KB** | **FullCalendar (4 packages + the preact it bundles)** — desktop-only per CLAUDE.md |
| 10.2% | 206.3 KB | `@supabase/*` |
| **7.5%** | **151.5 KB** | **`src/components/mobile/**`** — dead weight on desktop |
| 6.6% | 133.3 KB | `src/lib/**` |
| 6.4% | 129.3 KB | `react-dom` |
| **5.3%** | **107.2 KB** | **react-markdown + unified/remark tree** — agent chat only |
| 2.8% | 55.8 KB | `src/components/rituals/**` — desktop-only flows |
| 2.5% | 50.9 KB | `SlideOver.tsx` |
| **2.2%** | **44.8 KB** | **chrono-node** — capture NLP only |
| 1.7% | 34.5 KB | `SettingsModal.tsx` |
| 1.3% | 25.9 KB | `date-fns` |
| 0.7% | 14.3 KB | `lucide-react` (36 icons via barrel — already efficient) |

Biggest single source files: `SlideOver.tsx` 50.9 KB · `CalendarPane.tsx` 48.4 KB ·
`SundayRitual.tsx` 39.0 KB · `SettingsModal.tsx` 34.5 KB · `floors/parts.tsx` 32.3 KB ·
`useVertical.tsx` 25.3 KB.

**CSS — 197 KB from a 4,209-line hand-written `src/index.css`.** 187 of its 194
theme-selector blocks belong to non-default skins (`terminal` 75, `flat` 56, `eink` 33,
`blueprint` 23). Every user downloads all five materials to use one.

**Service worker precaches 38 entries / 3,196 KiB** on first visit.

**Dead code (verified — knip, cross-checked by hand and by depcheck):**

- **12 unused files.** 8 have zero importers. Three form a *dead cluster* —
  `floors/Standback.tsx` is the only importer of `lib/standback.ts` and `floors/bigRocks.tsx`,
  and Standback itself is unreferenced. Also: `WeekReadiness.tsx`, `lib/brief.ts`,
  `lib/date.ts`, `lib/draftBrief.ts`, `lib/fuzzy.ts`, `lib/weekFinds.selftest.ts`,
  `floors/CommitmentMeter.tsx`, `floors/ProjectPace.tsx`, `floors/WeekFind.tsx`.
- **`@tanstack/query-async-storage-persister`** is in `dependencies`, never imported.
  **knip and depcheck agree.**
- **170 unused exports, 110 unused types**, concentrated in `lib/vertical.ts`.
- One duplicate export: `eventKey` / `eventInstanceKey` in `lib/eventActuals.ts`.

**Known false positives, pre-empted so nobody deletes them:** the three `@fontsource*`
packages are CSS side-effect imports; the `npm:`/`virtual:` "missing" deps are Deno edge
functions and the PWA virtual module; and the **DEV-only harnesses (`?domains`,
`?planweek`, …) are NOT dead** — D-086 makes `?domains` a documented verification surface.

---

## Phase 8 — Mobile (375×812, dpr 3, touch emulation, **4× CPU throttle**)

| interaction | INP med | p95 | LoAF | blocking | dropped | commits | top component |
|---|---|---|---|---|---|---|---|
| `m.calendar/tab-to-calendar` | **280** | 280 | **236.5** | **185.5** | **13** | 150.1ms | **DayCard: 118.6ms self** |
| `m.tasks/tab-to-tasks` | **232** | 264 | 223.9 | 142.6 | 12 | 27.6ms | MobileReadiness: 8.3 |
| `m.projects/tab-to-projects` | **152** | 152 | 106.9 | 55.5 | 4 | 24.5ms | MobileProjects: 14.1 |
| `m.initiatives/scroll` | 88 | 88 | 0 | — | 1 | 1.5ms | MobileDeck |
| `m.domains/tab-to-domains` | 80 | 80 | 0 | — | 0 | 19.0ms | MobileDomains: 7.4 |
| `m.calendar/scroll-calendar` | 32 | 32 | 53.0 | 1.3 | 2 | **44.8ms** | **DayCard: 43.2ms** |

**`DayCard` is the outlier of the entire audit** — 118.6ms of self time in one commit, and
still 43.2ms while merely scrolling. Every other mobile component is an order of magnitude
cheaper.

Three of five tab switches exceed the 200ms INP "needs improvement" threshold; none meets
the 100ms bar.

---

## Phase 9 — Load & Core Web Vitals

Real `dist/`, served locally. **Caveat: localhost is not network-throttleable** (TTFB
stayed 1–3ms under an applied Slow-4G profile), so these isolate **CPU and parse cost**,
not transfer. Real-world figures over a real network will be worse, not better.

| scenario | FCP | LCP (med/p95) | surfaceReady | **TBT** | CLS | JS from network |
|---|---|---|---|---|---|---|
| Cold, unthrottled | 132ms | 900 / 1,292ms | 846ms | **199 / 401ms** | 0.006 | 2,028 KB |
| **Cold, 4× CPU** (mid-range phone) | 148ms | **1,884 / 2,716ms** | **1,836ms** | **1,449 / 2,072ms** | 0.006 | 2,028 KB |
| Warm (service worker) | 136ms | 828 / 868ms | 776ms | **315 / 359ms** | 0.006 | **0 KB** |

- **TBT 1,449ms at 4× CPU** is >7× the 200ms "good" threshold.
- **The warm row is the important one.** Zero bytes fetched, everything served from the
  service-worker cache — and TBT is *higher* than the cold unthrottled run. Transfer was
  never the bottleneck. **No amount of caching will fix this; only code splitting will.**
- `surfaceReady` (navigationStart → first real surface element) tracks LCP closely, which
  confirms LCP is measuring real content — the splash-wordmark caveat did not materialise.
- **CLS is effectively zero everywhere.** Not a problem.

---

## Quick wins — low effort, high confidence, safe to ship

1. **Set `throttleTime` on `persistOptions`** ([App.tsx:279](../src/App.tsx#L279)) — one
   option; removes 130ms of IndexedDB serialization from the interaction path.
2. **Drop `@tanstack/query-async-storage-persister`** from `dependencies` — two tools agree
   it is never imported.
3. **Delete the 12 dead files**, including the 3-file Standback cluster. No importers.
4. **Stop `syncNow` invalidating `["tasks"]` + `["vertical"]` wholesale**
   ([coordinator.ts:91-94](../src/lib/sync/coordinator.ts#L91)) — it already invalidates
   each settled table; the two blanket calls are what cause the T2 storm.
5. **Fix the 51ms `ctrl-2` handler and the 20ms Escape handler** — defer the work off the
   keydown path.
6. **Add `manualChunks`** to split vendor from app — the single highest value-per-line
   change in the repo.
7. **Fix the stale `now`** in `buildVertical`'s memo (correctness, not perf).

## Structural — needs a real refactor

1. **Unmount the Schedule when a floor is open** ([AppShell.tsx:351-352](../src/components/AppShell.tsx#L351)).
   This is the single highest-impact change in the audit: it removes FullCalendar, the
   LeftRail and their TaskRows from the render path of every non-Schedule surface.
2. **Route-split the two shells.** `React.lazy` the mobile tree, the desktop rituals,
   FullCalendar/`CalendarPane`, `SettingsModal`, `SlideOver` and the agent's markdown
   renderer. ~28% of the bundle is unreachable in whichever shell is running.
3. **Break up the `useVertical` fan-out.** Split `buildVertical`'s output so a task edit
   does not invalidate the memo that `Spine` reads, and memoize the always-mounted
   consumers.
4. **Fix `DayCard`.** 118.6ms self time is the largest single component cost measured.
5. **Coalesce drag state into rAF** and move ghosts to `transform` — `OnDeckPlanner`,
   `WeekBoard`, `MobileDeck`. `mobile/Sheet.tsx` is the in-repo reference implementation.
6. **Virtualize the unbounded lists** — the month grid (471 event nodes), the Collection
   table, the shipped wall — and put `.limit()` + pagination on `["tasks","all"]`.
7. **Split `index.css` by skin** so a user downloads one material, not five.

---

## Teardown & integrity

- **CRUD teardown gate: PASSED (after remediation).** The first run left 3 `zz-perf-*`
  tasks behind because the runner assumed an inline delete control that does not exist —
  task deletion lives in the row popover behind a button labelled **"Trash"**. A cleanup
  pass removed all three through the app's own path; final state: **0 seeded rows visible,
  outbox drained to 0.**
- **Outbox verified empty after every sweep** — the desktop and mobile passes mutated
  nothing (drags were cancelled with Esc, never dropped).
- **Repo integrity:** `src/` was unmodified throughout (`srcClean: true` in every
  manifest). The only repo changes from this audit are four analyzer devDependencies and
  these two documents. Rig code, builds, traces and raw results live in the scratchpad;
  the harvested session token never left it and was deleted at teardown.
- **Raw evidence** is append-only JSONL. Every table above is a pure reduction over it and
  can be regenerated without re-running Chrome — and re-run under a new `runId` to diff
  before/after remediation.

### Rig caveats worth knowing before re-running

- Device emulation applied **before** a cross-origin navigation silently breaks input
  dispatch and rAF (looks exactly like a frozen app). Navigate first, then emulate.
- `performance.getEntriesByType('longtask')` returns nothing without a buffered observer
  installed at document-start — an early pass reported a false `TBT=0` because of this.
- `document.documentElement` is null at document-start, so a `MutationObserver` installed
  there throws silently. The `surfaceReady` probe polls instead.
- A stray Chrome holding the profile makes a new launch attach to a **background** tab,
  which receives no rAF and never acknowledges input.
