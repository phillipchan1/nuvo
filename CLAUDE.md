# Nuvo — working conventions

Personal daily planner — **single-player** (one person's funnel, no shared objects),
**multi-tenant** (many independent paid accounts; see `docs/product/overview.md` §2.1).
Subscription: per-account, 14-day trial → $29/mo or $19/mo annual; gating in
`src/components/billing/`, setup in `docs/billing-setup.md`.
**One React SPA, two shells:** a Tauri macOS desktop app
*and* an installable iOS PWA, served from the same `dist/`. Read `readme.md` for the
product model and backend; this file is how we build so the app stays consistent and
**mobile-ready by default.**

## Product truth — read before deciding *what* to build

This file governs **how** we build. **`docs/product/`** governs **what** and **why**, and
[`docs/CLAUDE.md`](docs/CLAUDE.md) is the contract for working with it. Start at
[`docs/README.md`](docs/README.md) for the map. The load-bearing ones:

- **[`docs/product/overview.md`](docs/product/overview.md)** — the canon: what Nuvo is,
  **what it is not**, the core model, how we know it's working. *Wins over any spec.*
- **[`docs/product/principles.md`](docs/product/principles.md)** — 16 rules, each with a
  *violated when*. The audit standard.
- **[`docs/product/personas.md`](docs/product/personas.md)** — who this serves, and the
  **Question Ledger**: the questions in their heads, scored by how honestly we answer them.
  *Ideate from an unanswered row, not from a feature idea.*
- **[`docs/product/decisions.md`](docs/product/decisions.md)** — including what we decided
  **not** to do, so it stops coming back.

### The rules that apply while building — not just while planning

These are here rather than only in `docs/CLAUDE.md` because that file loads when you're
editing docs, and this one loads always. The contract has to be in context during the
build, which is where it actually gets broken.

**Before proposing or building a product change, in one or two sentences each:**

1. **Which Question Ledger row does it close?** Cite the ID (`W3`, `D5`, `O2`…) from
   [`personas.md`](docs/product/personas.md) §5. No row → argue that a human actually asks
   it, or don't build it.
2. **Which principle does it strain?** Cite the number. Most good ideas strain one; naming
   it is the point. Silently straining one is the failure.
3. **Was it already decided?** [`decisions.md`](docs/product/decisions.md) §2 (the N-list)
   and §3 (open questions). If it's there, lead with that.
4. **The four no's** — does it *add a pool* (P10), *add an overlapping name* (P11), *only
   work with clean data* (P7), or *only hold true in the builder's own account* (P16)?
   Any yes → lead with the objection, don't bury it.

**Before calling a product change done:** update the spec's status header the same day ·
add any new user-facing name to [`glossary.md`](docs/product/glossary.md) · log a real
decision or a rejected idea in [`decisions.md`](docs/product/decisions.md) · re-score the
ledger row if it moved.

**Never** invent product facts, fabricate a spec's status, or turn one operator's life into
a default. `/anchor` runs check 1–4 properly; `/product-audit` holds the running app
against all of it.

## Design language — "Warm Paper"

The app is converging on one design language; the full grammar + token vocabulary is in
**`docs/design-language.md`** — read it before building any new surface. The reference
screens are the **Schedule** (`CalendarPane` + `LeftRail`) and the **Domain** wall + open domain.
The rules that prevent regressions:

- **Never paint an opaque `bg-*` over the `.atmosphere` canvas.** Full-bleed structural
  containers (floor wrappers, the calendar pane, the agent rail) stay **transparent** and
  separate with a `border-l/-r` hairline — the one warm-paper gradient must read
  continuously across spine · rail · calendar · floors. An opaque `bg-surface`/`bg-bg`
  there is the "frost seam."
- **Floor / record / day heroes are Fraunces** (`text-display masthead`) — never
  `font-semibold`.
- **Dissolve, don't frame.** Default to hairline-separated rows on the paper; a bordered
  `bg-surface` card is only for things that genuinely *float* (records, modals, board /
  Today cards). Progress tracks use `--line`, never `bg-bg`.
- **Color is semantic and low-saturation** — always a token (`--accent` = intent,
  `--signal` = now, domain color = identity, `--slot` = open/unclaimed). Never a raw hex.
- **Planner surfaces share one grammar.** The Schedule, the project deck and the
  initiative deck are the same act at three clock speeds (pool left → grid of time
  right). Pool = `PlannerRail` (transparent, full-height, crown carries readiness in
  the execution voice, ＋ pill at the foot); grid fills the pane. `--signal` = now,
  `--accent` = intent, `--slot` = open/claimable. Altitude reads through card weight
  and voice, never a different frame. Full law in `docs/design-language.md`.
- **Focus lifts, it doesn't outline.** Floating things rest as glass (`.glass-card` —
  translucent + frost), and the focal element (selected/active/dragged/open) *lifts* from
  it with `--shadow-lift` + a small rise, **no flat ring**: `.glass-lift` (cards/chips),
  `.glass-lift-row` (table/timeline rows), `.glass-grab` (drag ghosts). Colored items
  (calendar events) keep their fill and apply the shadow/transform inline; on the Schedule
  the lift is instant (no transition).

## Golden rule: every UI change ships mobile-ready

The same components serve desktop and a 375–430px phone. A UI change is not done until:

1. It **reflows to a single column at ≤767px with no horizontal scroll** (that's where
   `useIsMobile()` swaps in the mobile shell — breakpoint `MOBILE_BREAKPOINT = 768` in
   `src/hooks/useIsMobile.ts`).
2. Tap targets are ≥44px (`.tap`), safe areas are respected (`pt-safe` / `pb-safe`), and
   content clears the bottom bar + the floating capture (＋) button.
3. Mobile overlays use the bottom **`Sheet`** (`src/components/mobile/Sheet.tsx`) — never
   cursor-anchored popovers (`SlideOver`) on a phone. Shared modals use the responsive
   `Modal` in `ui.tsx` (mobile-first base, desktop restored at `sm:`).
4. No hover-only affordances — every action has a tap path.
5. Verified at **375px** (preview/resize) **and** in the desktop layout.

When unsure whether something needs a mobile variant: if a user can reach it on a phone,
it needs to work on a phone.

## Architecture

- `AppShell` → `ResponsiveShell` renders `MobileShell` (<768px) or `AppShellInner`
  (desktop) via `useIsMobile()`.
- **Mobile UI lives in `src/components/mobile/`.** Bottom bar = five equal navigation
  destinations **Calendar · Tasks · Projects · Initiatives · Domains**, opening on Calendar. Capture
  and Nuvo are *actions*, not places, so neither is a tab: they float above the bar
  (bottom-right) as the **＋ FAB** and the **✦ launcher**, both hidden only while the chat
  is open. Capture and the Nuvo chat are *permanent first-class actions*. Today/Week/Inbox
  are a segmented control inside the Tasks screen; the week's readiness, the **Plan the
  week** card (`MobilePlanWeek` — the phone's weekly ritual: Slate → Pull → Shape) and the
  week's plan card ride the top of the **Week** segment.
- **Every door into the phone shares one launch vocabulary** — `src/lib/shortcuts.ts`.
  The PWA's icon shortcuts (`?shortcut=capture|chat|today`), the iOS lock-screen widgets
  (`nuvo://capture`, `nuvo://chat` — Swift in `src-tauri/ios/NuvoWidgets/`, injected into
  the Xcode project by `scripts/ios-widgets.rb`) and whatever App Intents land next all
  parse through it, and `MobileShell`'s `applyShortcut` is the only thing that acts on
  it. **Never add a second parser or a second applier** — a widget's ＋ and a long-pressed
  icon's ＋ opening different things is the failure. Widgets carry **no data** (P7): a
  glance ships with its "as of" stamp or not at all. See `docs/ios-releases.md`.
- **Shared "floors"** render in both shells. Keep them responsive with Tailwind
  `md:`/`xl:` collapse; add *optional* mobile-routing props (e.g. `onAskNuvo`) rather than
  forking the component. Desktop behavior must stay unchanged when the prop is omitted.
- **The weekly ritual runs on both shells, through one composer.** `useWeekDraft`
  (`src/hooks/useWeekDraft.ts`) owns everything that decides *what* the week is — the pull,
  standing-slot routing, project-slot clustering, `composeWeek`, the commit. `SundayRitual`
  (desktop grid, drag) and `MobilePlanWeek` (phone steps, tap) are layouts over it. Never
  compute a week in a surface.
- **The Domain reads the same on both shells.** The desktop floor
  (`floors/DomainFloor.tsx`) and the phone (`mobile/MobileDomains.tsx` + the open domain,
  `mobile/detail/MobileDomainScreen.tsx`) are two layouts over one voice
  (`lib/domainRead.ts` — state, clarity, Nuvo's read, the week's shape) and one set of
  marks (`components/domain/DomainParts.tsx` — the presence pulse, the clarity mark,
  the week-shape strip, the sigil-form and colour choosers, the grooming workbench).
  **Never re-derive "is this domain quiet" in a surface** — import it. Verify both at once
  at `?domains` (`mobile/DomainHarness.tsx`), which renders the wall, the open domain and
  the desktop floor over the same fixtures — see D-086.
- **The week's slate is a read model, not a component** — `useWeekCrown`
  (`src/hooks/useWeekCrown.ts`) is what the week IS: the projects committed to it, each
  one's verdict, its progress, and its work cut by *placed vs loose*. The Schedule's rail
  crown (`WeekPanel`) and the phone's Calendar crown (`mobile/MobileWeekCrown`) are two
  layouts over it. **Never re-derive the slate in a surface** — that composition
  (`weekPushes` → `pushAsRock` → `priorityWork` → `splitFor`) lived inside `WeekPanel`, and
  that is exactly why the phone couldn't say what the week was carrying at all (D-110).
  On the phone the **shut** crown is the Calendar's ANCHOR: one line of pips, sticky under
  the chrome at every horizon, so the answer to "what am I carrying" survives a change of
  rung — losing it on the way out to the month was half of why standing back felt like
  losing your place (D-122). It still only *opens* on the week-scoped lenses (Agenda · Day
  · Week), the context you read a Tuesday against (D-110); Month and Year answer a
  different question (where is this span heavy / what's on the day you tapped), so there
  the strip anchors and a tap takes you to the Week rung (D-119). Putting it only on Month
  was the original failure; taking the *slate* off Month is not that.
  The phone deliberately differs in three ways and no more: it collapses — and shut
  it is ONE line drawn rather than written (a pip per project in its domain's hue, filled
  when it landed; one amber light when something has no time; a chevron), because a phone
  screen already saying a great deal cannot afford a header that must be *read*; there is
  no ship circle (shipping is the record sheet's act — one vocabulary), and loose work
  **taps** to its sheet instead of dragging. Verify both at once at `?weekcrown`
  (`mobile/WeekCrownHarness.tsx`), which also renders the in-situ Calendar tab at two
  horizons — the frame where "the strip survives the stand-back" is visible.
- **The Build rungs wear the same four faces on both shells** — **On Deck · Groom · All
  (Table) · Shipped**, in that order, at the project *and* initiative altitudes. Desktop:
  `FloorPane`'s `RungTabs`. Phone: the segmented header in `MobileProjects` /
  `MobileInitiatives`. The phone's Groom and Shipped (`mobile/MobileGroom.tsx`,
  `mobile/MobileShipped.tsx`) are **layouts over the same read models** the desktop floors
  use (`readOnDeck` · `allOpenInitiativeLanes` · `readShipped`) — a wall of columns becomes
  a thinnest-first stack of cards. Never re-derive "how shaped is this" in a surface.
  Verify both at `?build` (`mobile/BuildFacesHarness.tsx`) — see D-099.
- **A task wears ONE row wherever it appears** — `TaskRow`, on both shells. Both week crowns
  render a project's work through the *same component* the day lists use, handed down as
  `renderTask` (`RenderCrownTask`, declared in `useWeekCrown.ts` so neither shell owns it):
  `LeftRail` supplies it on the desktop, `MobileShell` on the phone. The mounting surface
  keeps selection, the context menu, open and complete/undo in one place. A surface that
  needs a different trailing mark passes `action`; one that already states the row's *when*
  passes `whenShown`. **Never build a reduced task row** — both crowns had one, and it
  drifted until a project's work could be neither ticked nor touched on *either* shell
  (D-111). Corollary: an act may live on many surfaces, a **move** lives on one — you
  complete anywhere, you re-time a block on the calendar, and other surfaces link to it
  (`revealOnCalendar`) instead of growing a second handle.
- **Capture is ONE door, and it makes both kinds** — `mobile/MobileCapture.tsx` (D-125).
  One free-text line through `parseCapture`, plus a **Task / Event** switch; the sentence
  survives the switch and seeds the event's time. The Calendar's header ＋ is gone: two ＋s
  forty pixels apart, each making a different *kind* of object, made you classify a thought
  before typing it. The switch is not "where does this go" (a scheduled task IS a time
  block, P1) — it is **who else needs to see it**, which is why only the Event branch has
  guests, Meet and a calendar picker (`EventComposer`). **Never add a second ＋**, and never
  let a kind of object be creatable only through a form (P5).
- **A record's lifecycle acts live in one vocabulary** — `src/lib/recordActions.ts`
  (Open · Ship/Reopen · Park/Resume · Delete). The desktop reaches it by right-click
  (`RecordContextMenu`), the phone by long-press *and* the record sheet's visible ⋯
  (`mobile/MobileRecordActions`). **Never build a second menu** — that copy is how Delete
  ended up desktop-only. A hidden gesture is never the only path to an act.
- **Desktop-only (NOT mounted on mobile):** the other rituals (Summit/Blueprint), the Record
  *modal* (the phone has its own detail Sheet), Collection board/table/timeline, and
  the FullCalendar `CalendarPane`. Mobile uses the **mobile Calendar** instead.
- **Each altitude has ONE tap meaning** (D-121). Year: a month opens the Month. Month: a day
 tap **selects** it (the plan under the grid is that day) — a second tap on the selected day,
 or the plan's own header, opens **Day**, because they pointed at a day and not a week; an
 upward flick expands into the last drill-in lens and does *not* overwrite that memory; a
 grey cell selects and follows the date into its month. Week: a day header opens that Day.
 The rule lives in `mobile/monthTap.ts` (`monthDayIntent`, `clampDayToMonth`) — **never
 re-decide select-vs-open in a surface.** Paging a month carries the selection with it,
 clamped, or the month's second question stops having an answer.
- **The mobile Calendar is one chrome, five bodies, two axes** (D-122). `MobileCalendar` is
  only the data wrapper (the live queries, and the span the active lens needs);
  `CalendarSurface` owns the window and the composition; `CalendarChrome` is the
  **horizon ladder** (☰ · D W M Y), travel, and the seven columns — mounted ONCE, so
  nothing in it unmounts when the horizon changes. **The hero is handed UP, not drawn**
  (`onHero` → `MobileShell`'s top bar, D-125): it had a row of its own, and on the Week
  lens that row said "This week" directly above a crown strip already saying it. The top
  bar's date slot exists on every tab, so the span costs no vertical space there — and the
  wordmark yields on that one tab, because a calendar's title bar says the date. The five bodies (`MobileAgendaView`,
  `MobileDayView`, `MobileWeekView`, `MobileMonthView`, `MobileYearView`) render only their
  body, all over one `buildDayPlan` (`dayPlan.ts`) — D-044. Two motions that never overlap:
  `TimePager` **travels** (same horizon, next date), `LensZoom` **zooms** (same date, next
  horizon, cross-dissolving through the column of the selected day). **Never give a lens its
  own header, and never invent a second seven-column geometry** — every band and grid wears
 `ColumnBand`, because a Friday at a different x on the month than on the week is
 exactly the jump the zoom exists to remove. **The columns are a component, not a pair of
 classnames** (D-125): `pr-2` on the band and `mx-2` on the canvas look like the same 8px
 and are not — the band's seven columns and the canvas's seven columns were divided across
 different widths and *diverged* across the row. One `CAL_EDGE`, one `CAL_GUTTER`, one
 `ColumnBand`; everything with columns starts at `CAL_EDGE + CAL_GUTTER`. Every list inside
 the Calendar sits on `CAL_EDGE` too, so the surface has one left edge, not four. Verify all
 five at `?horizon` (`mobile/CalendarHarness.tsx`). The Year's marks (day
 numerals + today's signal ring — no density) are two layouts over
 `calendar/YearParts.tsx` — verify both shells at `?year`
 (`calendar/YearHarness.tsx`). D-127, D-128.
- **A time is spelled ONE way, and a surface that draws a fact doesn't also write it**
 (D-122). `at` / `span` in `dayPlan.ts` are the clock vocabulary — `9am`, `9:30am`,
 `9–9:30am`, `11am–1pm` — and `hourLabel` *is* `at`, so the gutter and everything beside it
 agree by construction. Never add a second time format (the Day canvas printed `9:00 AM`
 next to a gutter reading `9am`, and the record sheet kept a private copy). Then each line
 carries only what its neighbour can't: the Day block says the **place** (position and
 height already say when and how long), the agenda row says the **length** (the rail already
 said when). Exact minutes live in the record sheet. **The chrome obeys this too** (D-123):
 the hero IS the identification (`Today`, or `September 14` when no relative word pins the
 day) and the fact beside it is purely the read — the date was being said by the top bar,
 the hero, the fact AND the lit cell of the week row. The global top bar therefore drops
 its date **on the Calendar tab only**; elsewhere nothing else says it.
- **Nothing in the chrome may appear, vanish or resize as you use it** (D-123). `Today` is
 permanently mounted and quiets rather than unmounts — it used to render only off-today, so
 crossing today's edge mid-swipe shoved the travel arrows sideways under a moving thumb.
 Both states carry a border (one transparent) so the box is pixel-identical, and it is never
 dead: on the current span it re-centres on now (`recenter` → the canvases re-park). A phone
 chrome that rearranges itself is worse than one that is occasionally quiet.
- **Don't rent the Calendar's header to a management act** (D-123). Recurring upkeep sat
 there permanently while its *desktop* home is the calendar's `⋯` overflow — a phone surface
 carrying something purely because it was easy to put there. It lives in **Settings →
 Schedule**. Check the desktop rank before promoting anything into that row.
- **Travel must never wait for data already in hand** (D-123). Range queries
 (`useExternalEvents`, `useScheduledTasks`, `useSlots`) all set `placeholderData: (prev) =>
 prev` — a range change used to return nothing for a whole round trip, so every block
 blanked mid-swipe. The window is wider than the visible span on purpose, so the kept result
 usually already contains the day you swiped to. `useCalendarRangePrefetch` warms both
 neighbours through **`stepCalendarWindow`** — the same function the surface moves by, so
 travel is defined once. **Never compute "the next window" a second time**: a prefetch keyed
 a day off pays, misses, and pays again, and looks exactly like a cold swipe.
- **The zoom is tested, not eyeballed.** 220ms is too short to review, and two versions of
 `LensZoom` have looked correct and animated nothing. It runs on `Element.animate` partly
 *because* WAAPI is observable: `tests/lens-zoom.test.tsx` asserts the keyframes and
 `tests/calendar-zoom-wiring.test.tsx` asserts the ladder produces them. Change the motion,
 update those.

## One rule, two runtimes — the app and the agent must never disagree

Nuvo answers "what is my week" in the SPA (`src/lib/*`) **and** in the agent (Deno,
`supabase/functions/*`). A planning rule written in both places has drifted every time we've
tried it — the agent once reported "no priorities set" over a full deck, and the two
disagreed about which week Saturday plans. So:

- **Planning rules live in the kernel** — `supabase/functions/_shared/planningRules.ts` —
  imported by both runtimes. Zero imports, pure, UTC date math. Full map + the acts registry
  in [`docs/planning-kernel.md`](docs/planning-kernel.md).
- **Never re-implement one.** Need a week rule somewhere new? Import it. Doesn't exist? Add
  it to the kernel, then call it from both ends. `npm test` fails on a second definition.
- **Writes share the *act*, not the client.** The kernel returns a **patch**
  (`bringIntoWeekPatch` / `takeOffWeekPatch`); the browser applies it via `useVertical`, the
  agent via the service role. So a tap and a chat message place a project identically.
- **A new agent tool that writes planning state needs its UI twin in the registry** — or a
  logged decision saying why it doesn't have one.
- `npm test` (vitest) runs the conformance suite; CI (`.github/workflows/checks.yml`) runs
  typecheck + tests + an edge-function parse on every push.

## The chat is held to a battery — [`docs/agent-conformance.md`](docs/agent-conformance.md)

The chat is the one surface that fails **quietly**: it answers fluently whether it was
right or not, so nothing but a person noticing catches it. So it has a conformance battery,
and the same rule as the kernel — **the battery drives the deployed code, never a copy.**

- **The pure half of the agent is importable outside Deno** — `agent/prompt.ts` (the
  identity + every rule), `agent/toolDefs.ts` (the vocabulary), `agent/contextShape.ts`
  (the snapshot + its serializer), `agent/turn.ts` (message assembly), `agent/loop.ts`
  (rounds, tool results, empty-reply rules). `tools.ts` / `context.ts` / `index.ts` keep
  the service role and the HTTP. **Never put a rule where the battery can't reach it.**
- **`npm test`** runs the deterministic half: every tool has a handler, every tool the
  prompt names exists, every context field the prompt reads is actually sent, the loop's
  failure paths, and the harness itself. Milliseconds, no model, every push.
- **`npm run eval`** runs the behavioral battery against a live model — scenarios in
  `tests/agent/scenarios.ts`. **The bar is 100%: every scenario, every run.** The runner
  calls a partial pass **flaky**, which is a bug (the chat drifts, or the assertion is
  loose), not a tolerance. **Gate a prompt change, a new tool or a model swap on
  `npm run eval -- --repeat 5`** — one run is a smoke test. A known-red scenario can be
  parked only with a dated `quarantined:` line, capped at 10% of the suite.
- **A new chat capability ships with its scenario and its row in the map**, in the same
  commit. `npm test` fails when the map and the suite disagree.

## Reuse the logic layer — don't duplicate

- Day shape & availability: `readDay`, `toBusyBlocks`, `fmtMins`, `Gap`, `BusyBlock` in
  `src/lib/now.ts`. The "what counts as busy" rule lives once in `toBusyBlocks` — use it.
- Calendar data: `useExternalEvents(start,end)`, `useScheduledTasks(start,end)`
  (`src/hooks/useCalendar.ts`, `useTasks.ts`). Settings via `useSettings`
  (`work_start_minutes` / `work_end_minutes` default 480/990, `hidden_calendar_ids`).
- **A scheduled task IS a time block** — one `tasks` row (`do_date` + `start_time`). No
  separate event entity for tasks.
- **Which domain a task counts toward: `resolveDomainId` / `taskDomainId` (`lib/vertical.ts`).**
  `tasks.domain_id` is a *denormalized copy* of the parent's domain and goes stale the moment
  a project is re-homed — so **a parented task belongs to its parent's domain**, and its own
  id is authoritative only for a loose task. Never write `t.domain_id ?? project?.domainId`:
  that chain only runs when the copy is *missing*, never when it's *wrong*, which is how four
  projects' hours ended up credited to the wrong domains (D-088).
- **Every Google auth start goes through `src/lib/googleAuth.ts`** — one options object for
  sign-in *and* identity-linking, carrying `redirectTo` and **`prompt=select_account`**.
  Never call `signInWithOAuth({ provider: "google" })` at a call site: without that prompt
  Google silently re-uses the last account in the webview's cookie jar, which on iOS
  outlives a Nuvo sign-out — a signed-out phone landed straight back in the previous user
  and no second Google was reachable at all (D-126).
- Capture via free text: `parseCapture` in `src/lib/nlp.ts` turns
  "call David tomorrow 9am 30m #work !high" into structure.

## Low-data-entry principle

Capture is organic free text (or voice) parsed into structure; **forms are the fallback,
not the front door.** Use plain text `<input>`s so iOS dictation works out of the box.

## Theming & type

- Use **CSS variable tokens** — never hardcode hex. `--accent`, `--accent-soft`, `--line`,
  `--line-strong`, `--surface`, `--surface-2`, `--muted`, `--ink`, `--signal`, etc.
- Semantic type scale: `text-display`, `text-lead`, `text-head`, `text-body`,
  `text-caption`, `text-meta`, `text-micro`, `section-label`; `.mono` lever for numerics.
- Native system font for UI; Jakarta wordmark; Fraunces for ceremony. Respect light/dark
  (`data-theme` on `<html>`).

## Tauri specifics

- **HTML5 drag-and-drop is swallowed by the Tauri webview — use pointer events for all
  drag** (Timeline/board pattern).
- macOS overlay titlebar: reserve traffic-light insets via `html.tauri-macos`
  (`--titlebar-inset-left/-top`). The mobile header uses `.mobile-topbar` for this.
- **Service worker must never run in Tauri.** Registration in `main.tsx` is guarded on
  `'__TAURI_INTERNALS__' in window` + `window.isSecureContext`, and the PWA plugin is
  disabled at build time for Tauri (`TAURI_BUILD=1`).

## Build, verify, deploy

- `npm run dev` — Vite dev server (5717).
- `npm run build` — **desktop bundle** (`tsc -b && vite build`). **Keep this green** —
  typecheck must pass.
- `npm run build:web` — **web/PWA bundle** (`vite build`, skips `tsc`). This is what
  **Vercel** runs (see `vercel.json`).
- `npm run typecheck` — must be clean before shipping.
- `npm run tauri:dev` / `npm run app:install` — desktop. The Tauri build sets
  `TAURI_BUILD=1`, so **no `sw.js` / manifest ships inside the desktop app**.
- **Public releases + auto-update:** every push to `master` (or a version tag
  `git tag v0.2.0 && git push origin v0.2.0`, or Actions → **Run workflow**) runs
  `.github/workflows/release.yml`, which builds a **notarized universal** DMG and
  publishes it + `latest.json` to the public `phillipchan1/nuvo-releases` repo
  (single stable channel). Installed apps background-update via `src/lib/appUpdate.ts`;
  Settings → **Desktop app** surfaces version + manual check + "What's new". Full
  setup (secrets, signing keys, the two-signing-systems note) is in
  `docs/desktop-releases.md`. **Never commit the updater private key** (`~/.tauri`).
- **PWA install (iOS) requires HTTPS** → deploy `dist/` to Vercel. Frontend is static; the
  Supabase anon key (`VITE_SUPABASE_*`) is baked at build time and is safe to embed.
  `start_url` / `scope` = "/". Icons live in `public/`.

### Test against live code — always (don't ship UI you couldn't see)

**The app is auth-gated, but `npm run dev` is not — there is a dev-only auto-login.**
Set `VITE_DEV_EMAIL` / `VITE_DEV_PASSWORD` in `.env.local` (gitignored) and the dev server
signs in automatically (see `useAuth.ts`; guarded by `import.meta.env.DEV`, so it is
**tree-shaken out of every production build** and can never weaken the deployed login).

So: **verify every change against the running dev app with real data, not against a mockup
or a typecheck alone.** Start the dev server, drive the real screen, confirm the behavior,
then report. This is the default loop — reach for it before guessing.
- Start it / reuse it via the preview tooling (`preview_start npm run dev`), then
  `preview_screenshot` / `preview_eval` / `preview_snapshot` to inspect and exercise the
  real component. Auto-login means you land straight in the app, not the login wall.
- Prefer this over visual mockups when proving a UI change — the mockup is for *proposing*
  a design; the dev app is for *verifying* it.
- Don't mutate the user's real data gratuitously (e.g. firing synthetic drag-drops that
  move their tasks). Verify wiring + non-destructive gestures; leave the final
  data-changing action for the user, or ask first.

### Verification checklist (run before calling a UI task done)
1. `npm run typecheck` clean.
2. **Driven in the running dev app** (auto-login) — the actual behavior observed, not assumed.
3. Renders at 375px — no horizontal overflow, tap targets ok, safe areas respected,
   content clears the bottom bar.
4. Renders correctly in the desktop layout.
5. Calendar/availability work reuses `readDay` / `toBusyBlocks`.
6. `npm run build` green.

## Stack quick-reference

React 18 + Vite 6 + TypeScript + Tailwind v4 · Supabase (Postgres/RLS/Auth/Edge/Realtime)
· TanStack Query + Realtime invalidation · Tauri v2 (desktop) + vite-plugin-pwa (iOS PWA).
SPA, **no router** (auth-gated single `index.html`). Errors surface via the global `sonner`
toast.
