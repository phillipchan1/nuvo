# Nuvo — working conventions

Single-user daily planner. **One React SPA, two shells:** a Tauri macOS desktop app
*and* an installable iOS PWA, served from the same `dist/`. Read `readme.md` for the
product model and backend; this file is how we build so the app stays consistent and
**mobile-ready by default.**

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
  destinations **Now · Calendar · Plan · Tasks · Nuvo**. Capture is an *action*, not a
  place, so it isn't a tab: it's the **floating ＋ (FAB)** anchored above the bar
  (bottom-right), hidden only on the Nuvo tab where it would hit the composer. Capture
  and the Nuvo chat are *permanent first-class actions*. Today/Week/Inbox are a segmented
  control inside the Tasks screen.
- **Shared "floors"** (e.g. `NowFloor`) render in both shells. Keep them responsive with
  Tailwind `md:`/`xl:` collapse; add *optional* mobile-routing props (e.g. `onAskNuvo`)
  rather than forking the component. Desktop behavior must stay unchanged when the prop is
  omitted.
- **Desktop-only (NOT mounted on mobile):** rituals (Sunday/Summit/Blueprint), Record
  screens, Domain chapel, Project/Initiative floors, Collection board/table/timeline, and
  the FullCalendar `CalendarPane`. Mobile uses **`MobileCalendar`** (agenda + availability)
  instead of FullCalendar.

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

- `npm run dev` — Vite dev server (5173).
- `npm run build` — **desktop bundle** (`tsc -b && vite build`). **Keep this green** —
  typecheck must pass.
- `npm run build:web` — **web/PWA bundle** (`vite build`, skips `tsc`). This is what
  **Vercel** runs (see `vercel.json`).
- `npm run typecheck` — must be clean before shipping.
- `npm run tauri:dev` / `npm run app:install` — desktop. The Tauri build sets
  `TAURI_BUILD=1`, so **no `sw.js` / manifest ships inside the desktop app**.
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
