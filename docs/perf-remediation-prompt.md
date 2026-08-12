# Nuvo — performance remediation brief

**Paste this to a coding agent with full repo access. It is self-contained.**

Source of every number: [`perf-audit-2026-08-11.md`](perf-audit-2026-08-11.md), measured
over Chrome DevTools Protocol against commit `0d53c202` with `src/` unmodified —
192 desktop + 40 mobile measurements, 0 errors, 7 runs each (run 1 discarded),
medians and p95 reported, at a real data volume of **7 domains · 18 initiatives ·
25 projects · 333 tasks · 1,467 external events**.

---

## Rules for this work — read before touching anything

These come from `CLAUDE.md` and from what the audit found. Violating them turns a
performance fix into a product regression.

1. **Every UI change ships mobile-ready.** Reflows to one column at ≤767px, no horizontal
   scroll, ≥44px tap targets, safe areas respected, no hover-only affordances. Verify at
   **375px and** in the desktop layout. A change that only helps desktop is not done.
2. **Verify against the running dev app with real data**, not a typecheck. `npm run dev`
   auto-logs-in from `.env.local`. Drive the actual screen and observe the behaviour.
3. **Planning rules live in the kernel** (`supabase/functions/_shared/planningRules.ts`),
   imported by both the SPA and the agent. Never re-implement one to make it faster.
   `npm test` fails on a second definition.
4. **Design language is load-bearing.** Never paint an opaque `bg-*` over `.atmosphere`;
   floors/rails/calendar stay transparent with hairline borders. Focus *lifts*
   (`.glass-lift`), it does not outline. Colour is always a token, never a raw hex.
   Full law in `docs/design-language.md`.
5. **Do not "optimize" what is already fine.** Verified healthy: scrolling (0 dropped
   frames on 8 of 9 desktop scroll surfaces), CLS (0.000–0.006), the Realtime layer
   (120ms coalesce + outbox-aware deferral), `lucide-react` icon usage.
6. **Gates:** `npm run typecheck` clean, `npm test` green, `npm run build` green. If you
   touch the chat/agent, `npm run eval -- --repeat 5` at 100%.

### Do NOT delete — these look dead and are not

- **DEV-only harnesses** reached via `?domains`, `?planweek`, `?daycal`, `?chat`, `?meet`,
  `?emblem` in `main.tsx`. D-086 makes `?domains` a documented verification surface.
- **`@fontsource-variable/fraunces`, `@fontsource-variable/inter`,
  `@fontsource/plus-jakarta-sans`** — CSS side-effect imports; every analyzer calls them
  unused.
- **`vite-plugin-pwa`** — must stay in the plugin list even when disabled, or
  `virtual:pwa-register` fails to resolve and the build breaks.
- **The `npm:` / `virtual:` "missing" dependencies** — Deno edge functions and the PWA
  virtual module.

---

## Work items, in dependency order

Each item states the measured justification and the threshold it must hit. Re-measure
after each — do not batch and hope.

### P0-1 · Unmount the Schedule when a floor is open · **M**

**File:** `src/components/AppShell.tsx:351-352`

`<Planner/>` renders unconditionally and `{rung !== "day" && <FloorPane/>}` layers over it.
So every surface — Settings included — keeps a live FullCalendar (88 `.fc-event` nodes),
the LeftRail and its TaskRows mounted and re-rendering.

**Evidence:** `Planner`, `CalendarPane`, `TaskRow$1` and `TimeZoneChip` appear in the React
commit breakdown of **all 24 measured surfaces**. `d.settings/settle` still commits
`Planner:0.5ms CalendarPane:0.2ms TaskRow$1:1.2ms`.

**Do:** render `<Planner/>` only when `rung === "day"`, or keep it mounted but genuinely
inert. Beware: the Schedule holds scroll position and FullCalendar view state — preserve
them across unmount (lift to nav state or a ref cache) or the Schedule will feel *worse*.
Check `CalendarPane`'s `updateSize()` path on remount.

**Target:** `Planner`/`CalendarPane`/`TaskRow$1` absent from commit breakdowns on all
non-`day` surfaces. `d.project.all/settle` commit total **23.4ms → <10ms**.

---

### P0-2 · Throttle the cache persister · **S**

**File:** `src/App.tsx:279`

`persistOptions` sets no `throttleTime`, so every cache change re-serializes the entire
query cache (333 tasks + 1,467 events + 25 projects) into IndexedDB on the main thread.

**Evidence:** LoAF attributed **130.1ms to `src/lib/sync/idb.ts` during a *cancelled*
drag** — a gesture that mutates nothing.

**Do:** add `throttleTime` (start at 5000ms) to `persistOptions`. Consider tightening
`shouldDehydrateQuery` in `src/lib/sync/persist.ts` so the 1,467-row `external_events`
ranges are not re-serialized wholesale. **Offline-open must still work** — that is what
the persister exists for (`docs`/header in `persist.ts`); verify by loading offline after
the change.

**Target:** no `idb.ts` frame >16ms on any interaction path.

---

### P0-3 · Stop the post-drain invalidation storm · **S**

**File:** `src/lib/sync/coordinator.ts:91-94`

```
if (report.sent > 0) {
  for (const table of settled) qc.invalidateQueries({ queryKey: [table] });
  qc.invalidateQueries({ queryKey: ["tasks"] });      // <-- blanket
  qc.invalidateQueries({ queryKey: ["vertical"] });   // <-- blanket
}
```

The per-table loop is already correct; the two blanket calls re-fetch everything and
re-run `buildVertical` over the whole account.

**Evidence:** the T2 measurement — after a create acks, 3–4 further commits fire with
`VerticalProvider` and `Planner` re-rendering, invisible to the user.

**Do:** delete the two blanket calls, or scope them to the tables actually settled. Keep
`invalidateWhenSafe`'s outbox-aware deferral — that part is well built.

**Target:** T2 reconcile commits **3–4 → 0–1**.

---

### P0-4 · Code-split the bundle · **L**

**Files:** `vite.config.ts` (no `rollupOptions`/`manualChunks` today), plus `React.lazy` at
the split points. There is currently **zero `React.lazy` and zero `<Suspense>`** in the repo.

**Evidence:** one **2,068,904-byte** chunk. **28% is unreachable in whichever shell is
running** — 414 KB desktop-only shipped to phones, 151.5 KB mobile-only shipped to desktops.
And crucially: **the warm service-worker load fetches 0 KB and still blocks 315ms**, worse
than the cold unthrottled load's 199ms. Parse+execute is the cost. **Caching cannot fix
this; only splitting can.**

**Split, in value order:**

| target | size | note |
|---|---|---|
| FullCalendar + `CalendarPane` | **258.8 KB** | desktop-only; mobile uses `MobileCalendar` (D-044). Highest value split in the app. |
| `src/components/mobile/**` | **151.5 KB** | never executes on desktop |
| react-markdown + unified/remark | **107.2 KB** | agent chat only (2 files) |
| `src/components/rituals/**` | 55.8 KB | Sunday/Summit, desktop-only |
| `SlideOver.tsx` | 50.9 KB | desktop popovers |
| chrono-node | 44.8 KB | capture only — lazy-load on first capture |
| `SettingsModal.tsx` | 34.5 KB | rarely opened |

`ResponsiveShell` already branches on `useIsMobile()` — that is the natural split point.
**Watch the workbox 2 MiB precache ceiling** (a known trap in this repo) and keep the
Tauri build green (`TAURI_BUILD=1` must still emit no `sw.js`).

**Target:** initial chunk **<800 KB**; cold 4× CPU TBT **1,449ms → <600ms**; warm TBT
**315ms → <150ms**.

---

### P1-5 · Fix `DayCard` · **M**

**File:** `src/components/mobile/` (DayCard, used by `MobileCalendar`/`ScheduleView`)

**Evidence:** the single most expensive component measured anywhere — **118.6ms self time**
in one commit on `tab-to-calendar` (280ms INP, 185ms blocking, 13 dropped frames), and
still **43.2ms while merely scrolling**.

**Do:** profile what it recomputes per render. Likely candidates: per-render day-plan
derivation instead of a memo over `buildDayPlan` (`dayPlan.ts`), and re-deriving layout for
every event. Reuse `readDay`/`toBusyBlocks` (`src/lib/now.ts`) rather than recomputing
"what counts as busy".

**Target:** DayCard self time **118.6ms → <20ms**; `m.calendar/tab-to-calendar` INP
**280ms → <150ms**.

---

### P1-6 · Coalesce drag state into rAF; animate `transform` · **M**

**Files:** `src/components/ondeck/OnDeckPlanner.tsx` (worst), `src/components/floors/WeekBoard.tsx`,
`src/components/mobile/deck/MobileDeck.tsx`

All three call `setState` on every `pointermove` with no rAF coalescing and position drag
ghosts with `left/top`.

**Evidence:** `OnDeckPlanner` drag = **9–10 dropped frames, 51 commits, 219.7ms LoAF,
155ms long tasks**; LoAF named **`OnDeckPlanner.tsx#up` at 49.9ms in a single script**.
Note `WeekBoard` commits 37 times and drops **zero** frames — so commit *count* is not the
defect, commit count × cost is. Fix `OnDeckPlanner` first.

**Do:** hold drag position in a ref, commit once per rAF, and move ghosts to
`transform: translate3d()`. **`src/components/mobile/Sheet.tsx` is the in-repo reference** —
it writes `style.transform` directly and is the only drag surface with no measured jank.
Keep pointer events (Tauri swallows HTML5 DnD). Add `will-change` only during the gesture
and remove it after.

**Target:** **0 dropped frames** on all drag surfaces; `drag-card` INP **96ms → <50ms**.

---

### P1-7 · Break up the `useVertical` fan-out · **L**

**File:** `src/hooks/useVertical.tsx:426-441`

`buildVertical()` re-runs over the entire account whenever any of 10 dependencies change,
and `VerticalProvider` sits above `AppShell`. There is **zero `React.memo` in the
codebase**, so nothing stops the cascade.

**Evidence:** `Spine` is the top self-time component on **18 of 24 interactions** — it
consumes `useVertical()` (`Spine.tsx:106`) and re-renders whenever anything changes.

**Do:** split the context so a task edit does not invalidate what `Spine` reads
(separate selectors/providers, or `useSyncExternalStore` with per-slice subscriptions).
Memoize the always-mounted consumers. **Apply `React.memo` only where the profiler shows
it costs real time** — the audit named them: `Spine`, `TaskRow$1`, `TimeZoneChip`,
`Planner`.

**Also fix (correctness, not perf):** `new Date()` is passed as an argument at line 426 but
is **not** in the dependency array, so the memo captures a stale `now` for its lifetime.

**Target:** `Spine` off the top-component slot for surfaces that do not display it;
`spine-to-project` commit total **24.9ms → <12ms**.

---

### P1-8 · Kill the two synchronous handlers · **S**

**Evidence:** `ctrl-2-projects` runs a **51.3ms median (52.8ms p95)** synchronous handler;
`Escape` closing the shortcuts overlay runs **20.0ms**. Every other handler in the app is
~0.1ms, so these two are outliers, not the norm.

**Do:** find what runs synchronously on those keydown paths (`AppShell.tsx` shortcut
handler) and defer it — the nav state change should be all that happens before paint.

**Target:** both handlers **<8ms**.

---

### P2-9 · Virtualize the unbounded lists, bound the queries · **L**

**Evidence:** no virtualization library is present; every list is a plain `.map()`. The
month grid renders **471 `.fc-event` nodes / 3,213 elements**; the Collection table renders
2,489 elements with 223 buttons. `["tasks","all"]` is `select("*")` over every non-trashed
task with **no `.limit()`** — 333 rows today, unbounded by design. Only **3 `.limit()`
calls exist in the whole app**, all `limit(1)`.

**Do:** add `@tanstack/react-virtual` to the long lists (Collection table, shipped wall,
task lists) and paginate `["tasks","all"]`. **Scrolling is currently clean** — do not
regress it; virtualization is for the render/commit cost and future data growth, not for a
scroll problem that does not exist today.

**Target:** `d.day.month/settle` commit **46.8ms → <20ms**, fibers **423 → <150**.

---

### P2-10 · Delete dead code · **S**

Verified by knip, cross-checked by hand and by depcheck.

- **Remove `@tanstack/query-async-storage-persister`** from `dependencies` — in the bundle,
  never imported. Two independent tools agree.
- **Delete these 12 files** (8 have zero importers; `Standback.tsx` + `lib/standback.ts` +
  `floors/bigRocks.tsx` form a self-referential dead cluster):
  `src/components/WeekReadiness.tsx`, `src/lib/brief.ts`, `src/lib/date.ts`,
  `src/lib/draftBrief.ts`, `src/lib/fuzzy.ts`, `src/lib/standback.ts`,
  `src/lib/weekFinds.selftest.ts`, `src/components/floors/CommitmentMeter.tsx`,
  `src/components/floors/ProjectPace.tsx`, `src/components/floors/Standback.tsx`,
  `src/components/floors/WeekFind.tsx`, `src/components/floors/bigRocks.tsx`.
- **Fix the duplicate export** `eventKey` / `eventInstanceKey` in `src/lib/eventActuals.ts`.
- 170 unused exports / 110 unused types (concentrated in `lib/vertical.ts`) — prune
  opportunistically; several are used only by `tests/`, so check before removing.

**Confirm each deletion with a grep before removing it.** Re-check the do-not-delete list
above.

---

### P2-11 · Split `index.css` by skin · **M**

**Evidence:** 197 KB of CSS from a 4,209-line hand-written `src/index.css`. **187 of its
194 theme-selector blocks belong to non-default skins** (`terminal` 75, `flat` 56, `eink`
33, `blueprint` 23). Every user downloads all five materials to use one.

**Do:** move each `[data-skin="…"]` block to its own stylesheet, loaded on demand when
`useSkin` switches material. Keep the default (Warm Paper) inline so first paint is
unaffected. Also: the service worker precaches **38 entries / 3,196 KiB** — reconsider what
belongs in the precache manifest.

**Target:** initial CSS **197 KB → <80 KB**.

---

## How to verify

**Re-run the rig, don't re-derive.** The measurement harness lives in the session
scratchpad under `rig/` (`cdp.js`, `probe.js`, `run.js`, `run-mobile.js`, `run-load.js`,
`analyze.js`) and writes append-only `raw.jsonl`. Re-run under a new `runId` and diff the
two files — same scenarios, same statistics, directly comparable.

Per item: hit its stated target, then confirm no regression in **scroll frame health**,
**CLS**, or the **agent conformance battery**.

Four rig traps, all of which cost real debugging time and will bite again:

1. Applying device emulation **before** a cross-origin navigation silently breaks input
   dispatch and rAF — it looks exactly like a frozen app. Navigate first, then emulate,
   then `Page.bringToFront`.
2. `performance.getEntriesByType('longtask')` returns nothing without a **buffered observer
   installed at document-start** — this produced a false `TBT=0` on the first pass.
3. `document.documentElement` is **null** at document-start, so a `MutationObserver`
   installed there throws and silently kills the whole init script. Poll instead.
4. A stray Chrome holding the profile makes a new launch attach to a **background tab**,
   which receives no rAF and never acknowledges input.

And two app facts worth knowing: task deletion is a button labelled **"Trash"** in the row
popover (there is no inline delete control), and the mobile shell cannot be driven by
history injection — `useMobileOverlayHistory` treats history as an observer, so tabs must
be clicked via the `[data-teach="mtab-*"]` anchors.
