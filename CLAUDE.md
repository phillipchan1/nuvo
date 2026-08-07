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
  marks (`components/domain/DomainParts.tsx` — the faithfulness pulse, the clarity mark,
  the week-shape strip, the sigil-form and colour choosers, the grooming workbench).
  **Never re-derive "is this domain quiet" in a surface** — import it. Verify both at once
  at `?domains` (`mobile/DomainHarness.tsx`), which renders the wall, the open domain and
  the desktop floor over the same fixtures — see D-086.
- **Desktop-only (NOT mounted on mobile):** the other rituals (Summit/Blueprint), Record
  screens, Project/Initiative floors, Collection board/table/timeline, and
  the FullCalendar `CalendarPane`. Mobile uses **`MobileCalendar`** instead of
  FullCalendar: month grid → drill into **List** (agenda + Free chips) or **Day** (one
  day as a proportional time grid), both over one `buildDayPlan` (`dayPlan.ts`) — see
  D-044.

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
- **The same law covers *filing*.** Six paths decide which domain something belongs to (chat,
  inbox grooming, the calendar router, the project router, the offline matcher, the proposal
  engine). How a domain describes itself to any of them lives once, in
  `supabase/functions/_shared/domainRouting.ts` — **never serialize `domains.context` by hand**,
  and never re-derive "can Nuvo route here" in a surface (`routingStrength`). A field added to
  `enrichDomain` that isn't emitted by the kernel's serializer reaches nobody; that is exactly how
  `keywords` and `exemplars` came to be generated and read by no router at all. Full law in
  [`docs/domain-routing.md`](docs/domain-routing.md) · D-087.
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
