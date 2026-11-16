# Mobile audit — after the Instrument redesign (2026-11-15)

**Status:** fixes applied in the working tree (uncommitted), including open item 1 (D-224); the rest are open below.
**How:** the running dev app (local Worker + test account) driven at 375×812 dark and
320×568 light in the browser pane, every bottom-bar tab and their faces, the record /
task / domain / capture / chat / memory / settings / search sheets, an overflow probe on
every tab, plus a code-only scan of `src/components/mobile`, the kit and the shared
surfaces. The desktop shell was re-checked after the changes.
**Not covered:** the iOS Simulator (this Mac has Command Line Tools only, no Xcode),
Playwright's `iphone` project (WebKit isn't installed), and real data-changing acts
(ship, park, delete, drag) — wiring only, by design.

## Verdict

The phone shell came through the redesign in good shape. All five tabs reflow with
**no horizontal scroll at 375 or 320**, tap targets on the main chrome are 44px, light
and dark both read, and sheets follow the sheet kit. What broke was smaller and more
scattered: CSS-specificity traps the redesign tripped, states that only show with
imperfect data (P7), and new features (Memory, the kit Dialog) whose phone branch was
never driven.

## Fixed

| # | Where | What was wrong | Fix |
|---|---|---|---|
| 1 | Tasks → **Week** | A week with no sprint row yet sat on a skeleton **forever** — a disabled TanStack query is `isPending` indefinitely. Every fresh week. | `MobileShell`: no sprint → not pending. Now says "Nothing committed". |
| 2 | Every loading list | `SkeletonRows` used `.shimmer`, a *text-clip* gradient — on empty bars it drew nothing, so loading looked like three blank hairlines. | `Skeleton.tsx` → `.pop-skeleton`. |
| 3 | Projects → **All**, Initiatives, desktop bars | A project with no steps showed a bare **"%"**: `progress` isn't a column in the Neon schema, so `p.progress` was `undefined`. | `lib/vertical.ts`: `progress ?? 0` for projects and initiatives. |
| 4 | Project / initiative sheet → **Status** | The chevron wrapped under the value ("●Active" / "⌄"). The unlayered `.ph-field { display:block }` beat Tailwind `flex` — the CLAUDE.md CSS trap. | `!flex` in `StatusSelect`. |
| 5 | Record sheet **⋯** | Offered **"Open"** while you're already in the record, and its handler was a no-op — a dead button. | `useRecordActions(…, { inRecord: true })` drops it in the detail sheet. |
| 6 | Domain wall + open domain | "0.3h this week" beside **"0h this quarter"** — quarter rounded to whole hours, week to tenths. | `quarterHours` in tenths. |
| 7 | Kit **Dialog** on the phone (Memory panel, RhythmIntro) | The Sheet body didn't scroll (capped at 88dvh, page locked), so a tall dialog pushed its footer acts off-screen; and the footer double-padded the home bar (~34px dead). | Dialog passes a scrolling `contentClassName`; footer sticky, no second `pb-safe`. |
| 8 | **Memory** tabs *(not on `master` yet — this fix waits in the working tree with the Memory work)* | "What Nuvo uses / Still watching / You said no" wrapped to two lines at 375 and the underline lost its tab. | Phone labels: Noticed · In use · Watching · Said no. |
| 9 | Kit **xs buttons** / tappable **chips** on touch | xs = 36px, chips = 20px — under the 44px rule (Memory's domain picker, Settings zoom, Draft-the-path steer chips). | Coarse-pointer hit-area bloom in `kit.css`; drawing unchanged. |
| 10 | Settings → Appearance → Zoom | Keyboard hint "⌘+ · ⌘− · ⌘0" on a phone. | Hidden on mobile. |
| 11 | **Capture** sheet | A stray scrim tap / swipe threw the typed line away — and the sheet *shrinks* as chips replace the When/Time rows, which makes the next tap likely to land on the scrim. | `MobileShell` holds the unsent line (a ref) and restores it on the next plain ＋; cleared once added. A Day-canvas tap opens fresh and leaves the hold alone, so an old sentence's clock never overrides the tapped one. (`TaskComposer`/`CaptureDoor` take `initialText`.) **New behaviour — a product call to confirm.** |
| 12 | Calendar chrome at **320px** | The travel row ran 21px off-screen and clipped **›** — the kit's coarse `min-width:44px` beat the 320px narrowing. | Arrows draw at 32px with an outward 44px bloom. |
| 13 | Project list subtitles at 320px | Hard-clipped mid-word ("this qua") — an `inline-flex` wrapper is atomic to `truncate`. | `projectContext` truncates its words with an ellipsis. |
| 14 | Settings → Schedule | Day-view hours spelled "6:00 AM" against the one clock vocabulary (`6am`, D-122). | `formatHourLabel` speaks `at`'s vocabulary. |
| 15 | Settings → Billing → Share | Showed the raw "Edge Function returned a non-2xx status code". | Human sentence instead. |

## Open — recommended, not changed overnight

1. ~~**On Deck chrome eats the screen.**~~ **Done — D-224.** The crown is two lines
   at most (the read + Coverage toggle; the debt + *Block time*), the Coverage grid opens
   under the strip. Pager 361 → 438px at 375×812; at 320×568 the first initiative is in
   full view. On the way: on a Sunday, a Monday-start person's current week was named
   "Last week" / "−1" (the week names snapped to Sunday weeks) — fixed with
   `asWeekStart`, `tests/week-names.test.ts`.
2. **Calendar Week lens says "This week" twice** — the hero and the shut crown strip
   directly under it (the D-125 complaint, back at the Week rung).
3. **Task sheet reminder row** reads "🔔 Default (off)" with no label, between rows that
   all have one (Project / Repeat / Deadline).
4. **Settings list rows sit at a 12px inset** while the sheet title sits at 20px — two
   left edges.
5. **Tasks → Inbox**: "Or forward a mail" sits at 12px while the list above is at 16px.
6. **Capture "When" chips** wrap raggedly (Next week alone on row two) — the sheet kit's
   rule is a `ChipGrid`, never a ragged wrap.
7. **Chat's Memory icon** reads as ⊕ at 18px — easy to take for "new chat".
8. **The welcome loses its Ladder on the phone** (`.st-visual { display:none }` ≤899px),
   and the walkthrough card has no height cap on a 667px phone (from the code scan; not
   driven).
9. **The ✦ launcher's "new" dot** points at a chat whose Memory button carries no dot
   (code scan).
10. **Projects deck**: *Block time* is left-aligned on On Deck, right-aligned on Groom.

## Found on the way, not mobile

- **`worker/schema/neon.sql` is behind the client.** It has no `recurrences.freq`…
  (the whole rule), `slots.recurrence_*`, `reminders.fire_at` / `updated_at`, or
  `projects.progress` / `initiatives.progress`. The local test DB matched it and threw
  toasts on every screen; I patched the **local** DB only. If production was built from
  `neon.sql` rather than the Supabase copy, it has the same gaps — worth one
  `\d` check on Neon.

## Checks run

- `npm run typecheck` clean · `npm run build` green.
- `npx vitest run`: 2462 passed, 21 failed in two suites this work doesn't touch —
  `guard-public-ci` (trips on the already-modified `.github/workflows/release.yml`) and
  `maintenance` (`localStorage` undefined in the test env). `mobile-capture` caught a
  draft leaking between tests in a first version of #11; fixed, 9/9.
- Every fix above re-driven in the dev app after the change.
- Environment left as found: the `.env.local` I copied in for auto-login is removed (with
  it present, `worker-seam` fails by design). The **local** Postgres gained the missing
  `recurrences` / `slots` / `reminders` columns so screens stopped toasting.

## Verify again

- `?sheets`, `?build`, `?domains`, `?weekcrown`, `?horizon` harnesses at 375 and 320.
- On a device or Simulator once Xcode is installed: the capture draft hold, the
  Memory dialog scroll + sticky footer, and the 320px travel-arrow blooms.
