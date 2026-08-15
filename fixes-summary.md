# UX audit — remediation summary

**Date:** 2026-08-15 · **Source:** [`ux-audit-nuvo.md`](ux-audit-nuvo.md)
**Verified:** driven in the running dev app (auto-login, real data) at 1280×720 with and
without the chat open, 1440×900, and 375×812, with direct DOM/computed-style measurement
before and after each change.

**Gates at the end of the pass:** `npm run typecheck` clean · `npm test` **1043 passed / 41
files** (was 966 / 40 — the delta is new regression gates) · `npm run build` green.

---

## The approach: root causes before screens

The audit's own diagnosis was that Nuvo's problems are *calibration*, not concept — so the
work started at the token layer and only then touched surfaces. Three of the four foundation
items turned out to be **gates that already existed but didn't cover the thing that broke**,
which is the most durable kind of fix available:

| Foundation | What was actually wrong | What now prevents recurrence |
|---|---|---|
| Colour | `tests/token-contrast.test.ts` existed and was good — `--ok`/`--warn` simply weren't in its `TEXT_TOKENS` list | They are now, plus `--danger` and hue-separation assertions |
| Targets | `.tap`/`.tap-bloom` are phone-scoped *by design*; desktop had no floor at all | `.tap-desk*` + a static gate in `keyboard-operability.test.ts` |
| Type | The 8-step scale existed; 27 arbitrary `text-[Npx]` bypassed it | New `tests/type-scale.test.ts` |

---

## Fixed — Critical

### #1 · `--warn` and `--ok` failed WCAG AA in the light theme
Two token values, and they fixed every failing status string in the app at once.

| Token | Was | Now | Worst-case contrast |
|---|---|---|---|
| `--warn` | `#d97706` | `#8a5a10` | 2.79 → **5.19:1** |
| `--ok` | `#0d9488` | `#0b6b62` | 3.28 → **5.59:1** |

`--warn` was moved to hue ~36° rather than the ~29° a straight darkening lands on: at AA
weight an amber and `--signal`'s ember collapse into the same brown otherwise. 36° against
signal's 22° is the same separation the **dark** theme already had (`#e9960f` vs `#ff8a4c`),
so the two themes now agree about the relationship.

**Measured live afterwards** on the real Projects deck: "9d overdue" 4.78:1, "no steps" /
"no outcome" 5.24:1. Rail readiness counts render `rgb(138,90,16)`, up from `#d97706`.

**Regression net:** `TEXT_TOKENS` in `tests/token-contrast.test.ts` now includes `--ok`,
`--warn` and `--danger`; `ON_PAIRS` checks ink-on-fill in both directions; two new tests
assert `--danger` and `--warn` stay hue-distinct from `--signal` (contrast alone can't see
that — two reds of equal darkness score 1.0). **412 contrast assertions**, all passing.

### #8 · The Year view broke when the agent chat opened
`CalendarYear` sized its month grid on **viewport** breakpoints while living in a pane that
loses ~380px to the chat without the viewport moving — so `lg:grid-cols-3` was answering for
a 1280px window inside a 282px box.

Replaced with a Tailwind v4 **`@container`** query (`@[300px]` / `@[660px]` / `@[980px]`),
chosen so the narrowest month any breakpoint can produce still holds a two-digit numeral.
Added `overflow-hidden` + `tabular-nums` on the day cell as a structural guard.

**Measured at 1280 with the chat open:** day cells **10.66px → 17.14px**, overflowing
numerals **0** (was the run-together `"2223242526271234567891011"`).

---

## Fixed — Major

### #9 · Opening the chat made the Schedule unusable
The chat took its 380px entirely out of the calendar and neither rail yielded. Introduced
**squeeze mode** — below 1600px with the chat open, the *chrome* gives way first:

- `Spine` gets `forceRail` → renders at 64px instead of 188 (−124px)
- `LeftRail` gets `squeezed` → clamps to its own `MIN_RAIL_WIDTH` 240 (−120px)
- Calendar `min-w` raised **280 → 420px** (280 was a floor too low to be one)

Both are **render-only clamps that never touch the user's saved preference**, and both
controls that would otherwise lie are hidden while forced (the spine's Expand toggle, the
rail's resize handle).

| At 1280, chat open | Before | After |
|---|---|---|
| FullCalendar width | 298px | **542px** |
| Day column | 34.1px | **69px** |

**Round-trip verified:** closing the chat restored spine 188, rail 360 (the saved
preference), calendar 614px, resize handle back.

### #7 · The Year's "overcommitted" band was invisible in grayscale
`over` and `full` measured a **1.00** luminance ratio — separated by hue alone, on the
red/green confusion axis, on the one band that means something is wrong.

- Routed `over` to the new `--danger` at **85%** (was `--signal` at 55%): now clears `full`
  by **1.49–2.22×** in all six paper theme/mood combinations
- Added `--on-danger` so the numeral stays ≥5.09:1 — the ink has to *flip* between themes
  (near-white on light, near-black on dark), which is why a token was needed
- Added a **non-colour mark**: a hairline inset ring on `over` cells only, composed so it
  stacks with the today ring rather than competing. The legend swatch wears it too.

### #2 · No error/danger token — `--signal` meant four things
Added `--danger` / `--danger-soft` / `--on-danger` (light `#b3261e`, dark `#ff7a7a`, hue ~3°
against signal's ~22°). Routed the sonner `--error-*` overrides and the Year `over` band to
it. `--signal` keeps only its temporal roles. E-ink overrides it to greyscale ink so the
"no colour at all" material stays honest.

This also fixed a real ambiguity *inside* `YearParts`: the today ring and the overcommitted
fill were the same hue in the same grid.

### #4 / #32 · Desktop had no minimum-target policy
Added `.tap-desk` / `.tap-desk-h` / `.tap-desk-bloom` **outside** the phone media query. The
bloom is centred and clamped to `max(100%, 24px)` rather than a fixed negative inset, so it
grows a control to exactly the floor and never further — which is what stops it swallowing
neighbouring clicks the way its 44px phone cousin would.

Applied to: the done checkbox, the Day/Week/Month/Year/Spread switcher, inbox Accept/✕, both
"Ship project" buttons, the week-plan row, the Settings close, the error-boundary
disclosure, the chat retry.

**Measured on the Week view: 51 → 24 sub-24px targets. On mobile: 0.**

### #20 / #21 · Inbox triage ran on 8px type and 12px targets
The highest-frequency loop in the product.

| | Before | After |
|---|---|---|
| `META` desktop size | `text-[8px]` | `text-micro` (9.5px) |
| Accept | 40×12 | **49×24** |
| Dismiss ✕ | 14×12 | **24×24** |
| Accept↔✕ gap | ~4px | **8px** (`md:gap-2`) |

For #21 I found the audit's premise was slightly off but the defect real: the action cluster
wasn't pinned *high*, it rode whichever content line the stats landed on — measured **9.8px
below** the row centre on two-line rows, dead centre on one-line ones. Moved `acceptControls`
out of `StatsCluster` to be a sibling of the content column, so the row's own `items-center`
centres it. **Now −0.5px on every row**, and two-line rows shrank 65.5 → 54.9px as a
side-effect.

### #13 / #14 · The create affordance was invisible, and existed three ways
- `.slot-hint` raised from `--muted` 50% to **80%** — **1.96:1 → 3.38:1** (verified live)
- Added the missing `.group\/col:focus-within` rule beside the hover one, the exact rule
  `docs/design-language.md` already states
- Extracted `src/components/ondeck/SlotCreateButton.tsx`

On the extraction I deliberately **shared the voice, not the element**. The initiative deck's
quarter gets the real `<button>`; the planner's week column is *itself* a `pressable()`
control, so it gets `SlotCreateHint` (presentational). Nesting a button inside a
`role="button"` grid cell would have put two tab stops on one act. One `SLOT_CREATE_CLASS`
means they can't drift apart again.

### #11 · Mobile forecast week showed no load at all
Weather **replaced** the load dots (`{wx ? <WeatherIcon/> : <dots/>}`), so the one row where
everything is still movable — the next seven days — lost its busy/free signal. Weather now
rides the cell corner and the dots keep their slot. Legend gained a "forecast" entry, shown
exactly when weather is. **Verified at 375px: all six week rows carry dots.**

### #22 · Readiness counts were the least legible text in the nav
Fixed by #1 at the token level; additionally raised from `--text-micro` to `--text-meta`.

### #29 · A toast could cover the onboarding card's action
`useOrientation` now stamps `<html data-orientation="on">` — the toaster is mounted *outside*
the orientation provider (sibling of `AppShell`, so it survives every shell state) and can't
read it in React. CSS steps the stack above the docked panel for the duration. Also set
sonner's inset to **20px** to match the panel's `bottom-5 right-5`, killing the 4px near-miss
alignment the audit flagged as a separate "feels off" defect.

---

## Fixed — Minor / Polish

- **#3 · Type scale** — 20 arbitrary sizes replaced with tokens; sub-floor `text-[9px]` →
  `text-micro`, `text-[10px]` → `text-meta`. New `tests/type-scale.test.ts` asserts the eight
  steps exist, each owns a line-height, and **no `text-[Npx]` at or below the scale's 22px
  top step**. Above 22px stays allowed as ceremony (the Domain serif hero, orientation
  masthead) — the ladder governs UI type, not one-per-screen display moments.
- **#15 · Groom readiness meter** — met pips now always `READY` (`--ok`) instead of inheriting
  the lane's tier colour, which made amber mean "achieved" here and "at risk" everywhere
  else. This also fixed a latent bug: on the `raw` tier met pips were `--line-strong` against
  `--line` unmet — nearly indistinguishable.
- **#17 · Week strip clipping** — measured 750 client vs 960 scroll. Added a right-edge fade
  that appears only when there is genuinely more to the right, driven by a passive scroll
  listener + `ResizeObserver` that only sets state when the boolean flips (no per-scroll
  re-render on a drag surface).
- **#18 · Quarter header glyphs** — one worded `aria-label` + `title` covering the ratio, the
  cap and the at-risk count; glyphs `aria-hidden` (a screen reader was announcing "3 warning
  sign").
- **#24 · Settings close** — the 30×18 `.keycap` "esc" became a conventional ✕ at a real
  target size, with the shortcut moved to `title`. `.keycap` itself is untouched (it's a
  legitimate keyboard-hint style used elsewhere).
- **#25 · Settings radios** — pips marked `aria-hidden`; went further and added
  `aria-pressed={active}` to all three preview cards, which had **no** selection state in the
  accessibility tree at all.
- **#28 · Chat failure state** — it *does* have a visible error bar and retry, so the audit's
  "unverified" reads as mostly fine. Two real problems fixed: the bar wore `--signal` (now
  `--danger`), and the per-message retry only appears under the newest **assistant** bubble —
  but a request that dies before one streams removes its placeholder, so the hardest failure
  had no way back but retyping. Added "Try again" to the bar itself (`retry` rewinds to the
  last *user* turn, so it's correct there) plus `role="alert"`.
- **#30 · Error boundary** — the raw identifier moved behind a "Technical details"
  disclosure. Kept reachable rather than deleted: a user who can paste it into a bug report
  is worth more than one who can't.
- **#31 · Empty states** — the Spread's past day columns rendered as *nothing*. Past now
  reads "Nothing was kept here", future "Nothing planned" (was `—`), keeping the drop well
  only where dropping is possible.

---

## Deliberately deferred — and why

### #5 · Border-radius consolidation *(needs your call)*
Mapping Tailwind's `rounded-*` onto the CSS tokens changes **`rounded-lg` from 8px to 14px
across 127 usages** and `rounded-md` from 6px to 8px across 134 — roughly **380 elements
restyled at once**. The audit itself rates this Minor and explicitly puts it outside the top
10 ("background cleanup rather than a prioritised push"). It's also the one change here I
could not verify surface-by-surface. The 42 arbitrary `rounded-[Npx]` values (2/3/4/5/6px)
are mostly *proportional* choices — a 2px radius on a 7px pip and 6px on a 24px chip are not
obviously the same mistake — so snapping them needs design judgement per site, not a script.

### #10 · Month view hides most of its content
Replacing per-cell event lists with a load band + count is a **product change** to what the
month view answers, not a visual fix. It wants the `/anchor` pass (which Question Ledger row,
which principle, already decided?) before implementation.

### #12 · Mobile month leaves half the viewport empty
Inlining the day's agenda collapses part of the month → List/Day drill-in that **D-044 logged
as a deliberate decision**. Changing what that surface answers is your call, not a quiet
edit.

### #16 · Groom rung drops the floor's left rail
The audit says outright this "needs a product decision before a visual one". Agreed — is
Groom a rung or a full-bleed workbench?

### #23 · Tasks has no top-level desktop destination
An IA change across both shells.

### #21 (partial) · Uniform inbox row heights
I fixed the alignment defect but **did not** force all rows to a uniform min-height. Doing so
costs ~20px of vertical space on every sparse row to even out a difference that is genuine
content (a domain chip line). Given how deliberately dense this app is, that read like your
call. The gap narrowed from 20.5px to 9.9px as a side-effect of the alignment fix.

---

## Wants human review

1. **`--warn: #8a5a10`** — this is the one judgement call with real aesthetic weight. AA on a
   light warm ground forces any amber toward brown; I chose hue 36° over the audit's
   suggested `#a8560a` (29°) specifically to keep it apart from `--signal`. **Worth eyeballing
   against a project card carrying both "no outcome" and "9d overdue".** If you'd rather have
   the warmer amber, `#a8560a` still passes at 4.60:1 — but it will read closer to signal.

2. **Squeeze mode's 1600px threshold** — picked because it's where spine + rail + chat +
   a usable calendar stop fitting. It means anyone on a 1440 laptop now sees the spine rail
   itself whenever they open the chat. That's the intended trade, but it's a visible behaviour
   change you should feel before it ships.

3. **The `over` band at `--danger` 85%** — mathematically it's the only value clearing both
   the luminance separation *and* AA ink in all six theme/mood combinations, but 85% is a
   strong red. Please look at a genuinely overcommitted month in both light and dark.

4. **The calendar event checkbox is still 13×13 — deliberately skipped.** It lives *inside* a
   draggable/resizable FullCalendar event block, and a 24px bloom there could plausibly eat
   the top resize handle or the event-open click. You told me not to regress drag, so I left
   it and am flagging it rather than silently shipping a risky bloom. It accounts for 13 of
   the 24 remaining sub-24px desktop targets. **Needs a careful pass with real drag testing.**

5. **`SlotCreateHint` vs `SlotCreateButton`** — I split the audit's "one `SlotCreateButton`"
   into a shared class + two elements, because a real button inside the planner's `pressable`
   column would mean two tab stops for one act. Reasonable people could prefer removing
   `pressable` from the column instead; that route needs the keyboard-operability gate taught
   about it, which felt like gaming a test I'd rather keep honest.

---

## New files

- `src/components/ondeck/SlotCreateButton.tsx` — the shared create affordance
- `tests/type-scale.test.ts` — the type-scale gate

## Notes

- Nothing in the drag/keyboard/perf surface was touched except additively. The one new
  listener (the week-strip fade) is passive and only sets state on a boolean flip.
- One bug was introduced and caught **by driving the app**: the first version of the
  week-strip fade was a `float-right` element inside a `flex-col` scroll container, which made
  it a flex row and collapsed the On Deck grid to zero height. It is now an absolutely
  positioned sibling outside the scroller. Typecheck and tests were green while that bug was
  live — it only showed on screen, which is the argument for the live pass.
- The dev-server console retains stale HMR errors across reloads; the OnDeckPlanner 500 in
  the buffer was from that intermediate state. Confirmed resolved by requesting the module
  directly (`HTTP 200`) and by a clean production build.
