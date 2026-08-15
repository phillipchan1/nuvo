# Nuvo — visual design audit

**Date:** 2026-08-15 · **Method:** driven in the running dev app (auto-login, real data) at
1280×720, 1440×900 and 375×812, plus direct DOM/computed-style measurement.
**Scope:** analysis only — no application code was modified.

---

## Overall impression

Nuvo is a genuinely well-designed application with an unusually coherent point of view — the
"Warm Paper" language is real, not aspirational: the spacing scale is a clean 4px system, motion
runs on essentially one easing curve with nine `prefers-reduced-motion` rules, the keyboard focus
ring is correctly gated on `:focus-visible`, and the accessibility plumbing (`pressable()`,
worded `aria-label`s on the Year's day cells) is better than most shipping products. The problems
are not conceptual; they are **calibration problems in the light palette, an unenforced type
scale, and a desktop layer that never inherited the mobile shell's discipline about size.** Three
things do real damage: two status color tokens (`--warn`, `--ok`) fail WCAG AA everywhere they
appear in the default light theme, the desktop has *no* minimum touch-target policy at all
because `.tap`/`.tap-bloom` are scoped inside a phone-only media query, and opening the agent
chat — a permanent first-class action — squeezes the Schedule to 34px per day column and visibly
breaks the new Year view. The mobile shell, notably, is the stronger of the two shells: bigger
type, honest targets, better legends. Most of what follows is the desktop catching up to it.

---

## Cross-cutting (affects every surface)

### 1. `--warn` and `--ok` fail WCAG AA as text in the light theme
- **Issue**: Measured against the app's own backgrounds, `--warn` `#d97706` yields **2.82:1** on
  `--bg`, **3.13:1** on `--surface`, **2.96:1** on `--surface-2`. `--ok` `#0d9488` yields
  **3.32 / 3.68 / 3.47**. Both are used as *text* — "7 to ready", "4 to ready", "no outcome",
  "no steps", "9d overdue", "shipped", "at risk" — and almost always at `--text-micro`
  (**9.5px**). The dark theme is fine (every token measures 6.1–7.9:1), so this is purely a
  light-palette calibration issue in the default theme.
- **Why it matters**: WCAG 1.4.3 requires 4.5:1 for body text. These are precisely the strings
  that carry *state* — the words a user scans to decide what needs attention. The least legible
  text in the app is the text that says something is wrong.
- **Severity**: **Critical**
- **Fix direction**: Darken the light-theme values to hit 4.5:1 on `--bg` — approximately
  `#a8560a` for `--warn` and `#0a6f66` for `--ok` (verify with the same compositing check; note
  `--surface` is *lighter* than `--bg` here, so `--bg` is the binding constraint). Do not fix this
  per-component; fix the two tokens. Then add a unit test in the spirit of the existing CSS
  contrast test that asserts every text-bearing token clears 4.5:1 against `--bg`/`--surface` in
  both themes, so the palette can't regress.
- **Location**: `src/index.css:84` (`--warn`), `--ok` in the same light block; consumed in
  `src/components/floors/`, `src/components/ondeck/`, `src/components/LeftRail.tsx`

### 2. There is no error/danger token — `--signal` carries four different meanings
- **Issue**: `--danger`, `--err` and `--error` are not defined (they resolve to inherited ink).
  Error styling borrows `--signal` (`src/index.css:2558-2560`). But `--signal` is already
  documented as "now", is used for the current-time line and overdue blocks, and is used again in
  the Year view for the **overcommitted** band. One hue now means: *now*, *overdue*,
  *overcommitted*, and *error*.
- **Why it matters**: Semantic color only works if a hue maps to one meaning. A user cannot tell
  "this is happening now" from "this is wrong" without reading the surrounding text, which
  defeats the point of the encoding.
- **Severity**: **Major**
- **Fix direction**: Introduce a real `--danger` token distinct from `--signal`, and reserve
  `--signal` for temporal "now". Route the sonner `--error-*` overrides and the Year's `over`
  band to `--danger`. Add both to the glossary/design-language color-role table so the next
  surface doesn't reach for `--signal` again.
- **Location**: `src/index.css:56-61, 2549-2560`; `src/components/calendar/YearParts.tsx:41`

### 3. The type scale is defined but not enforced
- **Issue**: `@theme` defines an 8-step scale (22 / 18 / 15 / 13 / 12 / 11 / 10.5 / 9.5px).
  Components add **27 arbitrary `text-[Npx]` declarations across 14 distinct values** (8, 9, 10,
  11, 12, 15, 18, 22, 26, 28, 30, 32, 42, 44px). Eight of those simply re-declare a value the
  scale already owns (`text-[22px]` = `--text-display`, `text-[15px]` = `--text-head`,
  `text-[12px]` = `--text-caption`, `text-[11px]` = `--text-label`, `text-[18px]` = `--text-lead`).
  Three sit *below* the scale floor. A single Schedule screen renders **29 distinct
  size/weight/line-height/family combinations**, including 12 distinct sizes; 12px alone appears
  with three different line-heights (12px, 16.2px, 16.5px) and 11px with four variants.
- **Why it matters**: The scale is the thing that makes a dense planner feel authored rather than
  accumulated. Every arbitrary value is a small break in the rhythm, and duplicated values mean a
  future change to `--text-head` silently misses five call sites.
- **Severity**: **Major**
- **Fix direction**: Replace the 8 duplicate arbitrary sizes with their tokens mechanically. For
  the sub-9.5px cases, either add one honest `--text-nano` step or (better) raise them to
  `--text-micro`. Then add a lint rule banning `text-[Npx]` outside a documented allowlist.
  Separately, normalize line-heights: 12px text should have one line-height, not three.
- **Location**: `src/index.css:289-319`; worst offender `src/components/TaskRow.tsx:100`
  (`const META = "text-[12px] md:text-[8px]"`), `src/components/floors/` (`text-[9px]` ×7)

### 4. Desktop has no minimum-target policy at all
- **Issue**: `.tap`, `.tap-h` and `.tap-bloom` are **all defined inside
  `@media (max-width: 767px)`** (`src/index.css:2596-2617`), deliberately — the comment explains
  the bloom would swallow neighbouring clicks on desktop. The consequence is that desktop inherits
  no floor whatsoever. Measured on the Week view: **51 interactive elements under 24×24 CSS px**,
  including 13 "toggle done" checkboxes at **13×13**, "Ship project" at 16×16, and the entire
  view switcher (Day / Week / Month / Year / Spread) at **15px tall**. The Settings modal has 54.
- **Why it matters**: WCAG 2.2 SC 2.5.8 sets 24×24 as the minimum for pointer targets regardless
  of device, with a spacing exception that a 13px checkbox sitting flush against its row title
  does not satisfy. This is also the single biggest reason the desktop feels less confident than
  the phone.
- **Severity**: **Major**
- **Fix direction**: Add a desktop-safe floor — a `.tap-desk { min-height: 24px; min-width: 24px }`
  applied to icon buttons and segmented controls, and bump the bare `h-[13px]`/`h-4` checkboxes to
  a 24px hit box with a 13px drawn mark (padding on the button, not the glyph, so the visual
  density is untouched). The existing `keyboard-operability.test.ts` is the natural place to add a
  target-size assertion.
- **Location**: `src/index.css:2596-2617`; `src/components/TaskRow.tsx`,
  `src/components/CalendarPane.tsx` (view pills)

### 5. Three parallel border-radius systems
- **Issue**: CSS tokens define `--radius-sm: 4px / --radius: 8px / --radius-lg: 14px`. Components
  also use Tailwind's own six-step scale (`rounded-full` ×392, `rounded-md` ×134, `rounded-lg`
  ×127, `rounded-xl` ×87, `rounded-2xl` ×13, `rounded-sm` ×10) *and* 41 arbitrary
  `rounded-[Npx]` values (2, 3, 4, 5, 6, 18px). One viewport renders 9 distinct radii, and the
  most common single value is **7px** (`rounded-md`) — which matches neither `--radius-sm` (4px)
  nor `--radius` (8px).
- **Why it matters**: Adjacent components landing 1px apart on corner radius is exactly the
  "almost but not quite" effect that makes a screen feel subtly unresolved without an obvious
  cause.
- **Severity**: **Minor**
- **Fix direction**: Pick one system. Map Tailwind's `rounded-sm/md/lg/xl` onto the three CSS
  tokens in `@theme` so `rounded-md` *is* `--radius`, and retire the 41 arbitrary values.
- **Location**: `src/index.css:264-266`

### 6. What is already right (do not regress these)
Worth stating explicitly so the fixes above don't trample them: the spacing scale is a clean 4px
system (`--spacing: 0.25rem`, verified across `gap-0.5`→`gap-10`); motion uses one easing
(`--ease-out`) with a single spring variant and only four durations, plus **nine
`prefers-reduced-motion` blocks**; the keyboard focus ring is a correct 2px `--accent` outline at
2px offset, gated on `:focus-visible` and measuring 4.75:1; and `pressable()`
(`src/lib/a11y.ts:33`) gives non-button click targets a real `role`, tab stop and Enter/Space
handling. The Year view's day cells carry full worded `aria-label`s ("Saturday, August 15 — busy,
4h claimed"), which is better than most calendar heatmaps manage.

---

## Calendar / Schedule

### 7. The "overcommitted" band is invisible in grayscale
- **Issue**: The Year view's load ramp is deliberately lightness-only up to `full`, then switches
  hue for `over`. Measured composited over `--bg`: `full` = `rgb(187,151,178)`, relative luminance
  **0.3598**; `over` = `rgb(209,148,110)`, luminance **0.3592**. The luminance contrast between
  them is **1.00** — they are separated by hue alone (purple vs orange), which is the classic
  red-green confusion axis.
- **Why it matters**: `over` is the one band that means *something is wrong* — a day promised more
  time than it holds. For a deuteranope, or anyone on a dim/glare-washed screen, the most
  important state in the view is indistinguishable from the state next to it. The file's own
  docstring argues `over` "earns" its hue change; the execution doesn't deliver the distinction.
- **Severity**: **Major**
- **Fix direction**: Keep the hue change but *also* break luminance — take `over` materially
  darker or lighter than `full` (e.g. `--signal` at 78% rather than 55%), and add a non-color mark
  the ramp doesn't otherwise use: a 1px inset ring or a single corner dot on `over` cells only.
  The month caption already names the band in words; the cell should too.
- **Location**: `src/components/calendar/YearParts.tsx:36-41` (`LOAD_FILL`)

### 8. The Year view breaks when the agent chat opens
- **Issue**: `CalendarYear` lays its months out with **viewport** breakpoints
  (`grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4`). Opening the Nuvo chat takes 380px from the
  *pane* without changing the viewport, so at a 1280px viewport the grid still resolves to
  `lg:grid-cols-3` inside a **282px** container. Measured result: month sections **80.7px** wide,
  day cells **10.66px** wide, rendering two-digit numerals at 9.5px. The day numbers overflow
  their cells and run together into unreadable strings ("2223242526271234567891011").
- **Why it matters**: This is visible corruption, not graceful degradation, on a brand-new
  surface. The design language explicitly promises the calendar "genuinely reflows into the
  space" when the chat opens.
- **Severity**: **Critical**
- **Fix direction**: Make the month grid container-aware rather than viewport-aware — a CSS
  `@container` query on the scroll wrapper is the smallest change and needs no JS. Failing that,
  pass the measured pane width down and pick the column count from it. Add a hard floor: below
  ~150px per month, drop `showNumbers` (the component already supports this for the phone) so the
  view degrades to a pure heat grid instead of colliding text.
- **Location**: `src/components/CalendarYear.tsx:130`;
  `src/components/calendar/YearParts.tsx:78-84` (`showNumbers` already exists)

### 9. Opening the chat makes the Schedule unusable, not just smaller
- **Issue**: With the chat open at a 1280px viewport, FullCalendar measures **298px** wide and
  each day column is **34.1px**. Event titles collapse to a single character plus an ellipsis
  ("c.", "K.", "O."). Neither the task rail (≈220px) nor the left navigation rail (≈180px)
  collapses to make room; the chat simply takes its 380px from the calendar.
- **Why it matters**: The chat is documented as a *permanent first-class action*, not an
  occasional panel. If using it costs the primary surface, users learn not to use it — which
  undermines the product's central bet.
- **Severity**: **Major**
- **Fix direction**: Give the calendar pane a min-width and make the *rails* yield first — collapse
  the left rail to its icon state automatically when the chat opens below ~1600px (the shell
  already has a collapse mode and a 1280px flattening threshold to model this on). Alternatively
  let the chat overlay as a sheet below a width threshold rather than reflowing.
- **Location**: `src/components/AppShell.tsx:157` (`AppShellInner`), `.app-chat-slot` in
  `src/index.css`

### 10. Month view hides most of its own content
- **Issue**: The month grid renders **40 "+N more" links** in a single viewport, with counts up to
  **"+20 more"**. Cells show roughly four events; several days have 20+ hidden. Visible titles
  truncate to ~8 characters ("Covenan…", "Get Day…", "Freedo…").
- **Why it matters**: A month view whose cells hide 80% of their contents can't answer the
  question it exists for ("what does this month look like?"), and the truncation means even the
  visible four aren't identifiable.
- **Severity**: **Major**
- **Fix direction**: This is the gap the new Year view fills at year altitude — apply the same
  thinking one level down. Replace the event-list-per-cell with a load band plus a count
  ("6 things · full"), and let the cell drill into the day. That reuses `dayLoad` and makes month
  and year read as one family instead of two idioms.
- **Location**: `src/components/CalendarPane.tsx` (`dayGridMonth` config)

### 11. Mobile month: the next seven days show no load at all
- **Issue**: Every week row renders three load dots per day — except the forecast week. Measured
  on the August grid: weeks 1, 2, 5, 6 have **7 dot-cells and 0 icons**; week 4 (Aug 16–22) has
  **7 weather icons and 0 dot-cells**. The legend beneath the grid reads "• tasks • events",
  which describes nothing in that row.
- **Why it matters**: The same cell position silently changes meaning for one row, and it is the
  row a planner user most needs — the next seven days, the window in which everything is still
  movable. The user loses the busy/free signal exactly where they're deciding.
- **Severity**: **Major**
- **Fix direction**: Show both — dots for load, weather as a small glyph in the cell corner (or
  behind a toggle). If space genuinely forbids it, invert the priority: load is the planner's
  data, weather is the garnish. Either way, the legend must describe every encoding on screen.
- **Location**: `src/components/mobile/MobileCalendar.tsx`

### 12. Mobile month screen leaves half the viewport empty
- **Issue**: On a 375×812 screen the month grid plus legend plus the "Saturday, Aug 15 · 5h 17m
  open →" drill-in row end at y≈513. Roughly **460px of the 812px screen** below that is empty.
- **Why it matters**: The landing surface of the phone app spends half its height on nothing,
  while the day's actual agenda is one tap away.
- **Severity**: **Minor**
- **Fix direction**: Inline the selected day's agenda beneath the drill-in row (the data is
  already built by `buildDayPlan`), so the month screen answers "what's today?" without a
  navigation step.
- **Location**: `src/components/mobile/MobileCalendar.tsx`

---

## Projects

### 13. The primary create action is effectively invisible at rest
- **Issue**: The "+ project" affordance pinned in each week column of the On Deck planner uses
  `.slot-hint`, which is `--muted` at 50% alpha — measured at **1.96:1** against the column
  background, at 9.5px. It only becomes legible on `.group/col:hover`, and there is **no
  `:focus-within` or `:focus-visible` equivalent** (grep confirms zero matches).
- **Why it matters**: 1.96:1 is below the threshold at which text is reliably perceivable at all.
  More pointedly, `docs/design-language.md` states the rule this breaks in its own words — that
  hover-revealed actions "come back on `:focus-within`, because otherwise they stay focusable and
  *invisible*." A keyboard user can tab the column (correctly — `pressable()` gives it a tab stop)
  and the label explaining what Enter will do stays unreadable.
- **Severity**: **Major**
- **Fix direction**: Raise the resting state to at least 3:1, and add
  `.group\/col:focus-within .slot-hint` alongside the existing hover rule.
- **Location**: `src/index.css:985-990`; `src/components/ondeck/OnDeckPlanner.tsx:518`

### 14. The same act wears three different controls
- **Issue**: "Create a project/initiative here" is rendered three ways: a non-interactive `<span>`
  inside a `pointer-events-none` wrapper over a `pressable` div (`OnDeckPlanner.tsx:515-521`); a
  real `<button className="slot-hint tap …">` (`InitiativeDeck.tsx:401-409`); and a solid accent
  `+ new project` button on the Table rung (`PortfolioFloor.tsx:103`). The first two look
  identical and behave differently in the DOM; the third looks like a different product.
- **Why it matters**: Component consistency is what lets a user learn an interface once. Two
  visually identical affordances with different implementations is a maintenance trap; the same
  action ranging from 1.96:1 ghost text to a filled primary button is a hierarchy contradiction —
  the user can't tell how important creating a project is supposed to be.
- **Severity**: **Major**
- **Fix direction**: Extract one `SlotCreateButton` and use it in both decks (the
  `InitiativeDeck` version is the correct model — a real button with `.tap`). Decide once whether
  in-grid creation is a primary or tertiary act and let the Table rung match.
- **Location**: `src/components/ondeck/OnDeckPlanner.tsx:515-521`,
  `src/components/ondeck/InitiativeDeck.tsx:401-409`,
  `src/components/floors/PortfolioFloor.tsx:103`

### 15. The Groom readiness meter uses the warning color to mean "done"
- **Issue**: The three-pip meter fills a met criterion with `var(--warn)` and leaves unmet ones
  `var(--line)`. So amber = achieved, neutral gray = missing. Everywhere else in the app amber
  means a problem — "9d overdue", "no outcome", "no steps", "N to ready", "at risk".
- **Why it matters**: The same hue means "good" on one surface and "bad" two panels away. (The
  meter's *positional* logic is correct — it lights the specific criterion met, which I initially
  misread as a fill-from-left progress bar; the ambiguity between "checklist" and "progress"
  reading is itself worth designing out.)
- **Severity**: **Minor**
- **Fix direction**: Fill met pips with `--ok` (once its contrast is fixed) or `--accent`, and
  reserve `--warn` for the count when it's below target. Consider a check glyph in the met pip so
  the checklist reading is unambiguous.
- **Location**: `src/components/grooming/` (readiness meter markup — three `h-[7px]` spans with
  inline `background: var(--warn)`)

### 16. The Groom rung silently drops the floor's left rail
- **Issue**: On Deck and Table render the `PlannerRail` (≈220px, "Next 4 weeks / 4 of 9 ready");
  switching to Groom removes it entirely and the content reflows to the window edge. The rung tabs
  are the only thing that stays put.
- **Why it matters**: Switching a tab within one floor shifts every element on screen horizontally
  by ~220px. Tabs should change content, not the frame around it.
- **Severity**: **Minor**
- **Fix direction**: Either keep the rail mounted across all four rungs (with Groom-appropriate
  content), or move Groom out of the rung set if it's genuinely a full-bleed workbench.
- **Location**: `src/components/FloorPane.tsx` (`RungTabs`), `src/components/floors/`

### 17. The week strip clips its third column with no scroll affordance
- **Issue**: The On Deck week strip has `clientWidth` 580 against `scrollWidth` **960** — 380px of
  content sits outside the viewport, and the third week column is cut mid-card. With macOS overlay
  scrollbars there is no resting indication that more weeks exist.
- **Why it matters**: A planner whose horizon is "next 4 weeks" showing two and a half of them,
  with the fourth invisible and undiscoverable, misrepresents the plan.
- **Severity**: **Minor**
- **Fix direction**: Add a persistent edge affordance — a gradient mask plus ‹ › paging buttons, or
  narrow the columns so all four fit at 1280px.
- **Location**: `src/components/ondeck/OnDeckPlanner.tsx`

---

## Initiatives

### 18. Unlabeled warning glyphs in quarter headers
- **Issue**: Quarter column headers read "7/3 ⚠ · 3⚑" and "4/3 ⚠ · 1⚑". Measured: these elements
  have **no `title` and no `aria-label`**. Nothing on the surface defines the glyphs or the
  numerator/denominator.
- **Why it matters**: Two unexplained symbols carrying counts on the header of the primary
  planning column — a new user must guess, and a screen reader announces "3 warning sign".
- **Severity**: **Minor**
- **Fix direction**: Add `title` + `aria-label` ("3 at risk", "1 flagged"), and spell the first
  number pair out on hover ("7 committed of 3 slots").
- **Location**: `src/components/ondeck/InitiativeDeck.tsx` (quarter header)

### 19. Positive: the shelf empty state is the model to copy
- The rail's "NEEDS A QUARTER · 0" state reads *"Every initiative has a quarter. Drag one here to
  shelve it."* — it explains the rule, names the gesture, and doesn't scold. This is the standard
  the rest of the app's empty states should be held to.
- **Location**: `src/components/ondeck/InitiativeDeck.tsx`

---

## Tasks

### 20. Inbox triage controls are 8px type on 12px-tall targets
- **Issue**: On desktop, each inbox suggestion row carries "Accept" at **40×12px** and a dismiss
  "✕" at **14×12px**, both rendering at **8px** font size, separated by ~4px. (Mobile is handled
  correctly — `min-h-[44px] md:min-h-0` gives phones a proper 44px target; the collapse is
  desktop-only.)
- **Why it matters**: 8px is below any legibility floor, and 12px-tall targets are half the WCAG
  2.5.8 minimum. Accept and Dismiss are opposite decisions sitting 4px apart at identical size —
  a misclick discards the AI's guess. This is the highest-frequency triage loop in the product.
- **Severity**: **Major**
- **Fix direction**: Raise `META`'s desktop size from 8px to `--text-micro` (9.5px) at minimum, and
  give both controls a 24px-tall hit box. Separate Accept and ✕ by at least 8px, and consider
  making dismiss hover-revealed so the destructive-ish option isn't permanently adjacent.
- **Location**: `src/components/TaskRow.tsx:100` (`META`), `TaskRow.tsx:483-498`

### 21. Inconsistent row heights in the inbox list
- **Issue**: Rows carrying a domain chip ("Frontier", "Stampede") wrap to two lines; rows without
  one ("Redo Obi Video") stay single-line. The right-hand cluster (duration · Accept · ✕) stays
  pinned to the title baseline, so it sits optically high on two-line rows.
- **Why it matters**: Ragged row rhythm in a list meant for fast sequential triage costs scanning
  speed, and the misaligned action cluster is the "almost aligned" effect that reads as sloppy
  without an obvious cause.
- **Severity**: **Minor**
- **Fix direction**: Give inbox rows a fixed min-height covering the two-line case and
  vertically center the action cluster against the whole row rather than the title line.
- **Location**: `src/components/TaskRow.tsx`, `src/components/LeftRail.tsx:644`

---

## Navigation / sidebar

### 22. Readiness counts are the least legible text in the navigation
- **Issue**: "7 to ready" / "4 to ready" under Projects and Initiatives render `--warn` at 9.5px
  on the rail background — **2.79–3.05:1**.
- **Why it matters**: These are the navigation's only status signals, and they're the first thing
  the eye should be able to pick up. Fixed automatically by finding #1, but flagged separately
  because the 9.5px size compounds it.
- **Severity**: **Major**
- **Fix direction**: Fix the token (#1), and raise these two labels to `--text-meta` (10.5px).
- **Location**: `src/components/LeftRail.tsx`, `src/components/Spine.tsx`

### 23. Information architecture reads clearly — one note
- The EXECUTE / BUILD split (Schedule above; Projects · Initiatives · Domains below) maps cleanly
  onto the altitude model, and the four Build rungs (On Deck · Groom · Table · Shipped) are
  identical at both altitudes, which is exactly right. The one ambiguity a new user hits is that
  **Tasks has no top-level destination on desktop** — it lives as tabs inside the Schedule's
  middle rail (Today / Inbox / Trash), while the phone gives Tasks its own bottom-bar tab. A user
  moving between shells has to relearn where tasks live.
- **Severity**: **Minor**
- **Fix direction**: Either surface a Tasks entry in the desktop rail that focuses the same panel,
  or rename the phone tab so the two shells describe the same place the same way.
- **Location**: `src/components/LeftRail.tsx`, `src/components/mobile/MobileShell.tsx`

---

## Modals / forms

### 24. The Settings close control is 30×18px
- **Issue**: The "esc" chip at the modal's top-right is a real `<button>` measuring **30×18px**.
  It's also the only visible close affordance, and it's styled as a keyboard hint, which reads as
  a label rather than a control.
- **Why it matters**: The primary dismissal control for the app's largest modal is under half the
  minimum target size and doesn't look clickable. (Escape does work.)
- **Severity**: **Minor**
- **Fix direction**: Give it a 24px minimum box, or replace with a conventional ✕ button and move
  "esc" to a `title`.
- **Location**: `src/components/SettingsModal.tsx`

### 25. 54 sub-24px controls inside Settings
- **Issue**: The Appearance pane alone renders 54 interactive elements below 24×24 — chiefly the
  ~10px radio indicators on the theme/material/mood preview cards.
- **Why it matters**: Same root cause as #4. Mitigated because the whole preview card is
  clickable, so the radio is decorative in practice — but it is still exposed as a target.
- **Severity**: **Polish**
- **Fix direction**: Mark the indicators `aria-hidden` / `pointer-events-none` and let the card be
  the only control, so the target count reflects reality.
- **Location**: `src/components/SettingsModal.tsx`

### 26. Positive: form structure and the zoom stepper
- The Settings left-nav grouping is logical, the preview-card pattern for theme/material/mood is
  genuinely good (it shows rather than names), and the zoom stepper's buttons measure 42×40 —
  correctly sized. Worth noting as the in-house example of what a control should measure.

---

## Agent chat

### 27. Layout cost — see #9
The chat panel itself is well composed: the suggestion chips are numbered and scannable, the
composer has a clear affordance line ("Enter to send · Shift+Enter newline · drag files anywhere"),
and per the design language it correctly has no divider against the shell. Its problem is
external — it takes its 380px entirely from the calendar (#9). One additional note below.

### 28. The chat's suggestion list has no loading or error state visible in the resting UI
- **Issue**: The resting panel shows four canned prompts plus "Other…". I could not reach a
  loading or failure state without sending a message (which would mutate data), so this is flagged
  as *unverified* rather than asserted: the codebase has `AgentThinking.tsx` (a thinking
  indicator), but I did not confirm what renders when the edge function errors or times out.
- **Why it matters**: Per `docs/agent-conformance.md`, the chat is "the one surface that fails
  quietly." Its failure presentation deserves the same scrutiny as its correctness.
- **Severity**: **Minor** (unverified — worth a deliberate check)
- **Fix direction**: Drive a forced failure in dev and confirm there's a visible, recoverable
  error state with a retry, not a silent empty reply.
- **Location**: `src/components/AgentSidebar.tsx`, `src/components/AgentThinking.tsx`

---

## Empty & error states

### 29. A toast can cover the onboarding card's primary action
- **Issue**: Measured during first run: the sonner toast renders at z-index **999999999** occupying
  x 900–1256 / y 652–696; the onboarding coach card sits at z-index **80**, x 920–1260 / y
  487–700. The toast covers a **336×44px** region at the bottom of the coach card — the strip
  holding its action. Their right edges are also 4px apart (1256 vs 1260) and their bottoms 4px
  apart (696 vs 700), so even when they don't overlap they read as misaligned.
- **Why it matters**: A first-run walkthrough is the one moment the app controls completely, and a
  background notification can occlude the step's only control. The near-miss edge alignment is
  additionally the classic "feels off" defect.
- **Severity**: **Major**
- **Fix direction**: Suppress or reposition toasts while the onboarding overlay is mounted (the
  simplest fix is offsetting the sonner container above the coach card's height when
  `FirstRun` is active). Align both to the same 20px inset from the right and bottom.
- **Location**: `src/components/FirstRun.tsx`, sonner `[data-sonner-toaster]` config in
  `src/App.tsx` / `src/index.css:2549-2595`

### 30. The error boundary leaks raw JavaScript identifiers to the user
- **Issue**: Observed live (the working tree carried an in-progress Agenda→Year refactor): the
  error screen rendered *"Something broke. / Nuvo hit an error it couldn't recover from. Your data
  is safe — reloading usually fixes it."* followed by the raw string **"agendaAnchor is not
  defined"**, then Reload / Copy details.
- **Why it matters**: The first two lines are excellent — calm, specific, and they answer the only
  question that matters ("is my data safe?"). The third line is a variable name from a minified
  React tree, which means nothing to a user and slightly undercuts the reassurance above it. The
  "Copy details" button already exists to carry that payload.
- **Severity**: **Minor**
- **Fix direction**: Move the raw message behind "Copy details" (and/or a collapsed disclosure).
  Keep the two-line human explanation as the visible content.
- **Location**: `src/components/ErrorBoundary.tsx`

### 31. Empty-state coverage is uneven
- **Issue**: Quality ranges widely. Best: the initiative shelf (#19). Weakest observed: the Spread
  view's past day columns (Sun 9) render as simply blank with no copy and no affordance. (The
  Trash tab displays a "100+" count in the tab strip; I did not open it, so its contents and any
  retention messaging are unaudited.)
- **Why it matters**: Empty is a state, not the absence of one. A blank column in a planning grid
  is ambiguous between "nothing scheduled", "nothing loaded yet", and "broken".
- **Severity**: **Minor**
- **Fix direction**: Give every pool/column a one-line resting message in the shelf's voice. For a
  past empty day, "Nothing was kept here" reads very differently from "Nothing planned" — the
  distinction already exists in `domainRead.ts`'s `unstarted` vs `drifting` logic and is worth
  reusing.
- **Location**: `src/components/floors/WeekBoard.tsx`, `src/components/LeftRail.tsx` (Trash tab)

---

## Cross-feature consistency

### 32. The two shells disagree about density, and the phone is right
- **Issue**: Reading the surfaces back to back, the phone and the desktop feel like different
  products calibrated by different people. Mobile: 16–18px type, 44px targets, a legend under the
  month grid, generous spacing. Desktop: 8–11px type, 12–15px targets, no legends, no minimum
  size. The gap is structural (#4) rather than stylistic.
- **Why it matters**: The design language, the component library and the read models are genuinely
  shared — this is the one axis where the two shells diverge, and it's the axis a user feels
  immediately.
- **Severity**: **Major** (aggregate of #1, #3, #4, #20)
- **Fix direction**: Treat the desktop's density as a deliberate choice with a floor, not an
  absence of one: minimum 9.5px type (already the scale floor), minimum 24px targets, and status
  colors that clear AA. None of that costs meaningful vertical space — the current 8px/13px values
  are roughly 1–3px below where they need to be.

---

## Top 10 highest-leverage fixes

Ranked by perceived-quality gain per unit of effort.

| # | Fix | Finding | Effort | Why it's high leverage |
|---|-----|---------|--------|------------------------|
| 1 | Recalibrate `--warn` and `--ok` in the light palette to clear 4.5:1 | #1 | **~1 hour** | Two hex values. Fixes every failing status string across every surface at once, in the default theme. Nothing else in this audit has a comparable ratio. |
| 2 | Add a desktop minimum-target floor (24×24) for icon buttons, checkboxes and view pills | #4, #20, #24 | Half a day | Removes ~51 violations per screen and closes most of the desktop/mobile quality gap. Padding-on-the-button keeps the visual density identical. |
| 3 | Make the Year view container-aware and floor its cell size | #8 | Half a day | Turns visible text corruption into graceful degradation on a brand-new surface. One `@container` query plus reusing the existing `showNumbers` flag. |
| 4 | Raise `META` from `text-[8px]` and give Accept/✕ real hit boxes | #20 | ~2 hours | The highest-frequency loop in the product (inbox triage) currently runs on 8px type and 12px targets. |
| 5 | Collapse a rail when the chat opens; give the calendar a min-width | #9 | 1 day | Makes the product's central bet — chat as a permanent first-class surface — actually usable at 1280px instead of a tradeoff against the Schedule. |
| 6 | Break `over` from `full` on luminance and add a non-color mark | #7 | ~2 hours | Restores the only "something is wrong" signal in the Year view for colorblind and low-contrast viewing. |
| 7 | Raise `.slot-hint` to ≥3:1 and add `:focus-within` | #13 | ~30 min | A two-line CSS change that makes a primary create action perceivable and honors a rule the design doc already states. |
| 8 | Replace the 8 duplicate `text-[Npx]` values with their tokens; add a lint rule | #3 | Half a day | Mechanical, low-risk, and stops the scale eroding further. The lint rule is the part that lasts. |
| 9 | Extract one `SlotCreateButton` for both decks | #14 | ~2 hours | Collapses three treatments of one action into one, and removes a real DOM/maintenance trap. |
| 10 | Show load dots *and* weather in the mobile forecast week; fix the legend | #11 | ~2 hours | Restores the busy/free signal for the seven days the user is actually deciding about. |

**Deliberately not in the top 10:** the radius consolidation (#5) and empty-state sweep (#31) are
real but diffuse — worth doing as background cleanup rather than a prioritized push. The Groom
rail behavior (#16) needs a product decision before a visual one.

---

## Method notes and limits

- Findings are stated only where I drove the running app and measured; where I could not verify a
  state without mutating real data (chat failure states, #28) it is labelled unverified.
- Several plausible-looking issues were checked and **dismissed** rather than reported: the
  persistent review toast (an artifact of the headless pane — `document.hidden` was `true`, which
  pauses sonner's 8s timer); uneven Shipped card widths (the grid measured an exact 277+277px);
  an off-grid spacing scale (`--spacing` is a clean 0.25rem); a keyboard-inaccessible On Deck
  column (`pressable()` supplies `role`, `tabIndex` and Enter/Space); and a mis-filled Groom
  readiness meter (it is position-accurate — it lights the criterion actually met).
- Audited primarily in the default **light** theme, `paper`/Aurora material, `daybreak` mood.
  Dark theme was verified at the token level (all text tokens measure 6.1–7.9:1 — no contrast
  findings) but not walked screen by screen. The other four materials (Flat, Terminal, Blueprint,
  E-ink) were not audited.
- Widths exercised: 1440×900, 1280×720 (with and without the chat open), 375×812.
- The working tree carried an in-progress Agenda→Year refactor during the audit; `npm run
  typecheck` was clean at the time of the pass, and the Year view was audited as it currently
  stands. Findings #7 and #8 concern that new, uncommitted code.
