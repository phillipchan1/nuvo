# Nuvo design language — Instrument (D-189)

**Read this before building any new surface.** Tokens: [`src/index.css`](../src/index.css)
(Light and Dark). Chrome and motion: [`src/styles/instrument.css`](../src/styles/instrument.css).
This file is the grammar.

The thesis: **exact chrome, heroes that mean it.** The perfectionism of a precision tool, with
the boldness of the people who use it. Reference screens: the **Schedule** (`CalendarPane` +
`LeftRail`) and the **Domain** wall + open domain (`DomainFloor`).

*History: until D-189 this was "Warm Paper" (a cream gradient, Fraunces heroes, glass that
lifts) across five materials and 27 schemes. Sections below that still describe glass describe
class names that now render as solid surfaces; the rules in this header win.*

---

## The grammar (eight moves)

1. **One flat ground per theme.** `--bg` is the ground (chrome, pools, the grid ride it);
   `--surface` is the sheet (things that float). No gradient, no frost. Structure is a 1px
   hairline at an exact weight, never a tinted panel.
2. **Inter does the work.** One face on every shell, with cv02–04 and cv11. No serif, no
   italic (only the upright axis ships). Emphasis is weight and ink.
3. **One hero per surface, and it is loud.** `text-display masthead`: 28px desktop / 25px
   phone, 700, tracked −0.03em. It states a fact or an intent. Everything around it is quiet.
4. **Say it once.** No eyebrow over a heading that says the same thing, no sentence explaining
   what the control shows, no keyboard-hint rows (shortcuts live in the Shortcuts sheet and on
   the control as a keycap), empty states in two or three words. If a visual says it, words
   don't.
5. **Colour is semantic.** `--accent` (saturated mulberry) = intent and its landing. `--signal`
   (ember) = now, only. Domain hue = identity and the work it moved. `--slot` = open time.
   Never a raw hex.
6. **State fills, focus rings.** Selected / current = an accent wash with an accent edge, in
   place. Keyboard focus = a crisp 2px accent ring. Drag ghosts still lift (a thing in your hand
   looks picked up).
7. **Motion answers the hand.** Ladder 110 / 180 / 260 / 380ms. Arrivals ease quint-out;
   popovers and menus scale from their origin (`.pop-in` + `--pop-origin`); modals settle on a
   spring. Hover is instant in, fades out. Every control gives under a pointer press.
   Transform and opacity only; nothing blurs.
8. **What you do lands.** A ticked box, a placed block, a committed week resolve on a real
   spring (~9% overshoot) in under 300ms, as the consequence of your act and nothing else
   (Momentum, below).

---

## The kit (D-190)

Every page is built from [`src/components/kit/`](../src/components/kit/) and drawn by
[`src/styles/kit.css`](../src/styles/kit.css). Every part in every state, Light and Dark side by
side: **`?kit`** (`KitHarness`, dev server).

| Group | Parts |
|---|---|
| Controls | `Button` (primary · secondary · ghost · danger · danger-solid; xs 24 · sm 28 · md 32; `icon`, `shortcut` keycaps) · `IconButton` (label required: it is the name and the tooltip) · `Kbd` |
| Fields | `Input` · `Textarea` · `SearchField` · `FormField` (label, hint, error in the hint's slot) · `Select` |
| Choice | `TaskCheck` (round, lands on `--ease-land`) · `Checkbox` (square, mixed) · `Switch` · `Segmented` (radio group, ←/→) · `Tabs` (underline, ←/→) |
| Marks | `Chip` / `ChipButton` (tones: accent · signal · danger · ok) · `Dot` (identity) · `Readiness` (raw → 1 → 2 → ready pie) · `Avatar` / `AvatarStack` · `PaceTrack` |
| Structure | `SectionHeader` (disclosure) · `Row` (32 or 38px; `onActivate` makes it focusable + ↵) · `EmptyState` · `Property` (label / value-that-opens-a-picker) · `Card` |
| Floating | `Popover` (anchor = element, rect or cursor point; flips; grows from `--pop-origin`) · `Menu` + `MenuItem` / `MenuSeparator` / `MenuLabel` / `MenuSearch` (`useMenuFocus`, `data-nested-surface`) · `Picker` (search past 7) · `MiniMonth` · `Dialog` (a Sheet on the phone) |

**Geometry is not a choice a part makes.** Radii `--r-chip 4 · --r-ctl 6 · --r-card 8 ·
--r-dialog 12` (nested corners step down by their inset: a 5px item in an 8px menu). Heights
`--h-xs 24 · --h-sm 28 · --h-md 32 · --h-row 38 · --h-bar 48`. Surfaces by role: `--ground`
(window) · `--panel` (work) · `--raised` (floats) · `--sunk` (wells). Hairlines `--line-1/2` are
alpha. Shadows `--sh-1 · --sh-pop · --sh-modal`.

**States.** Hover is instant in and fades out; press gives 2% on a pointer; focus is a 2px
accent ring outside a 2px panel gap; selected is an accent wash (rows) or an accent ring + lift
(cards); disabled is 45%. Popovers are desktop only: a phone overlay is the Sheet.

## The frame (D-190)

The window is `--ground`. The **sidebar** (`Spine.tsx`, `styles/frame.css`) sits on it: the
workspace mark, Schedule, then *Build* (Projects · Initiatives · Domains) with each floor's one
cue in its tone (a calm floor shows its ⌘-key on hover), then **This week** — the week's
committed projects with pieces landed, from `useWeekCrown` — and Settings · Shortcuts · Collapse
(⌘\\, a 52px icon rail). All the work sits in one **inset panel** (`.app-panel`, 12px corner,
`--panel`); every `.atmosphere` inside it paints the panel. Every page wears one **PageBar**:
breadcrumb (the last word is the page, or the span on screen) · tabs · drag gap · actions. The
chat slot sits on the ground beside the panel. Verify the whole frame at `?rail=frame`.

On the Mac the traffic lights rest over the sidebar, on the wordmark's edge. With the sidebar
railed or hidden they are **hidden** (⌘W / ⌘M still close and minimise), and the rail's mark
rises onto the page bar's line — no band is kept for buttons that aren't there. Every other
home for them was tried and read as wrong: a band over the panel, an 84pt rail, the panel's
corner. A full-screen flow brings them back, at rest.

## Statement pages (D-192)

The small pages that frame the app — sign-in, first run, the welcome, the paywall — are
**statement pages** (`components/statement/StatementPage.tsx`, `styles/statement.css`). The
**stage** (left; a top band on a phone) is always ink: the mark, one statement set huge
(800 weight, −0.06em) and ending on the **ember full stop** (`Stop` — the mark's own dot), and a
landing week whose blocks land one by one before the now-line glides into place, once. The
**door** (right; a sheet on a phone) is the theme's panel and holds the one thing to do, its
acts 44px. The door never fades in — what you came to press is there on the first frame. A door
title wears the same full stop ("Sign in."). Check them at `?login` and `?statement=…`.

## The mark (D-191)

**Statement**: a geometric N with an ember full stop on the mulberry field — the way every hero
ends ("Ship onboarding."). Mulberry is the accent (intent), the full stop is the signal (now). One
in-app drawing, `NuvoMark` (`src/components/kit/Mark.tsx`), with two optical sizes (≤32px thickens
the stems and grows the dot). The icon masters are `src-tauri/app-icon.svg` (macOS, rounded) and
`src-tauri/app-icon-ios.svg` (full-bleed, for every OS-masked icon); `public/favicon.svg` is the
small size. `npm run tauri:icon` regenerates every icon, the PWA set and the launch screens from
them (needs Pillow). Never draw the mark by hand anywhere else.

## Shipped — the landed seal

**Shipped wears `--landed`, never `--ok`.** `--ok` is *ready to place* (the readiness pie at
full); shipped is the intent made true, so it takes the intent's own colour, like a ticked task
(D-187). The kit's `Readiness step="shipped"` and `ShipStamp` are one drawing: a solid `--landed`
disc with the tick knocked out. On a deck card a shipped project says it three ways that agree:
the seal leads the name, the name ends on a `--landed` full stop ("Move church accounts to named
owners." — the way every statement ends, D-191; skipped when the name already ends in
punctuation), and the status word speaks in the `landed` tone. Full ink, not receded. Before
this, a full teal pie meant both *ready* and *shipped*, and the only difference on the deck was
one small word. Check at `?kit` (Marks · Structure) and `?build`.

## The six layouts and six popovers (D-190)

Every page is one of six layouts, every floating surface one of six kinds — all built on the kit.

| Layout | Pages | Where it lives |
|---|---|---|
| **Planner** | Schedule (Day · Week · Month · Year · Spread), On Deck, the initiative deck | `CalendarPane` + `.evt-shell` blocks, `LeftRail`/`WeekPanel`/`TaskRow` (`styles/rail.css`), `ondeck/*` (`styles/decks.css`) |
| **List** | Table (projects, initiatives), Inbox, Today, week archive | `floors/Collection` — 38px rows, a sticky filter row, groups on `--sunk` (`styles/floors.css`) |
| **Board** | Groom ×2, Domains wall, Shipped wall | kit Cards in columns with a 32px head; the hero states a fact ("N to shape", "N shipped") |
| **Document** | Record (project, initiative, task, domain), open domain, create | main column + 288px property panel (`record/recordFrame`, `styles/documents.css`) |
| **Dialog** | Settings, Shortcuts, billing, confirms | kit Dialog (a Sheet on the phone); Settings is two panes |
| **Flow** | Plan the week, Summit, Week's Plan/Review, capacity, orientation, login | `rituals/FlowShell` — stepper bar, one hero per step, keycapped primary (`styles/flows.css`) |

Popovers (`PopoverParts`, `styles/popovers.css`): **Menu** · **Picker** · **Date** (typed line
over `MiniMonth`) · **Inspector** (352px, flush: head · strip · 36px rows · ghost footer) ·
**Tooltip/Toast** · **Command** (⌘K / ⌥Space: 54px line, parsed chips, Task·Event·Slot). The
phone (`styles/phone.css`) is the same kit at touch size. Verify: `?rail=frame`, `?gather`,
`?docs`, `?build`, `?domains`, `?horizon`, `?sheets`, `?planweek`, `?login`, `?kit`.

*Sections below this point predate D-190; where they describe glass, lifts or Fraunces, the
grammar at the top of this file wins.*

## Momentum — the ambition axis (D-187)

**Status:** built 2026-11-13 on branch `claude/ambition-design-language` (not merged).
Tokens and keyframes: [`src/styles/momentum.css`](../src/styles/momentum.css) · WAAPI half:
[`src/lib/motion.ts`](../src/lib/motion.ts) · each material's idiom: the `MOMENTUM (D-187)`
block in [`src/skins/*.css`](../src/skins/) · guard: `tests/momentum.test.tsx`.

Nuvo is sold as **task management for ambitious people — ambition, down to the hour**
(D-186). Warm Paper, as written, could say where everything was and how calm it was; it had
no way to say that anything *moved*. Completing a task faded a row out in 270ms. The week's
projects were five-pixel dots. Committing a week ended in a sentence. The heroes were set at
the weight of a caption. Ambition was in the copy and nowhere in the grammar.

**Ambition here is momentum, weight, and things landing — never hustle.** The satisfaction
of a block placed, a task done, a project moving on pace, a week committed. It is drawn from
the same facts the app already measures (P6), it happens only as the consequence of
something *you* did (P3), and it is over in well under a second. What it is not, ever: a
streak, a score, confetti, a count-up, a red "behind", a pulse that wants your attention, an
animation on data that merely arrived (N-04, P4, P9).

### What changed, and what it replaced

| Axis | Warm Paper said | Momentum says | Why |
|---|---|---|---|
| **Type — the hero** | `text-display` 22px, Fraunces 500, softened terminals (`SOFT 32`) | **28px desktop / 25px phone, `--hero-weight` (600), `SOFT 0`** on `.masthead.text-display` | A floor, a record, the committed week is a *name that means it*. 500 at 22px read as a caption set large. Only the one hero per surface changes — rows keep their size and weight (Hierarchy rule 11 stands). |
| **Colour — `--signal`** | now · urgency | **now, as the leading edge**: the now-line, and the pace tick on a track | Still never success, never "behind". The phone's "no time yet" light was `--signal` and is now `--warn`, like the rail's — signal is spent on *now* only. |
| **Colour — `--accent`** | your intent | intent **and its landing**: `--landed` (the ticked box, the commit seal, the slate meter) | The moment an intent becomes true wears the intent's own colour. |
| **Colour — domain hue** | identity | identity **and the work it moved**: the fill of a progress track | The thing moving is that world's work. |
| **Density** | — | unchanged | Ambition is not more on screen. |
| **Progress** | the rail: 5px pips; the phone: a 40px bar — two drawings of one fact | **one `PaceTrack`** on both shells: a track of pieces (≤10) or a fill, `--track-h` thick (3px), plus the **pace tick** | Progress has mass — 2px read as a hairline, i.e. structure. The tick makes pace *visible* without a word. |
| **Motion** | ad hoc: `.bloom` 180ms, `.rise`, `block-in`, a 270ms row fold, nothing on progress | **a named vocabulary** (below), every duration derived from the material's own ladder | A motion with a name has a meaning and a place it is forbidden. |

### The pace tick — pace, drawn, not said

A project's track is its **work done** (pieces, in the domain's hue) on a `--line` rail, and a
2px **`--pace-tick`** where its committed span's clock stands today (`spanElapsed` in
`lib/pace.ts`: start of its first On Deck day → end of its target day, clamped). **Fill past
the tick is ahead; short of it is behind.** Nothing says so in words and nothing turns red —
the reader compares two measured facts. A finished row, or one with no span, has no tick (P7:
no clock, no guess). Known limits, stated rather than hidden: the tick is linear (it assumes
nothing about which days the work was planned for) and the fill counts pieces, not hours. The
On Deck card's rule stands — the pace *read* (`behind` / `stalled`) is never printed on a card.

### The motion vocabulary

Durations are **derived** — `calc(var(--d-base) * 1.6)` and so on — so a material that
changes its ladder changes these with it, and D-096's rule (change the easing, change the
durations) holds by construction. The ms below are Paper's.

| Motion | Token(s) | Paper | Means | Used on | Forbidden |
|---|---|---|---|---|---|
| **Press** | `--d-fast`, `--ease-out` | 130ms | "I heard you" — the control gives under the finger | every `:active` (native.css) | as decoration on anything that isn't a control |
| **Land** | `--d-land`, `--ease-land` | 352ms, a spring with ~8% overshoot | **a thing you did became true** — set down with weight | the ticked box (`.land-stamp`) + the drawn strike (`.land-strike`); a block dropped on the Schedule (`landBlock`); a project's slate pip filling (`landMark`) | on load, on a refetch or realtime echo, on a write the assistant made, on the lift (the pick-up stays instant on the Schedule) |
| **Let go** | `--d-task-complete` | 440ms total; the fold starts at 55% | a finished row leaves the list — only *after* it has visibly landed | `.task-completing` (TaskRow) | moving rows that aren't done; the one sanctioned non-transform property here is the row's measured height (`task-fold`), as before |
| **Advance** | `--d-advance`, `--ease-momentum` | 680ms, fast off the mark, long glide | **progress catches up** from where it was to where it is | `PaceTrack` (a piece's segment grows in; a fill scales from its old value); the slate meter past ten projects | on mount (data arriving is not progress); backwards — **an undo snaps**; counting numbers up |
| **Commit** | `--d-commit`, `--d-stagger` | bands land 72ms apart, then the seal sweeps (≈860ms) | **the week is locked** | `WeekSetMoment` — Plan the week's last screen, both shells | anywhere but a commit; more than once per commit |
| **Arrive** | `--d-slow`, `--ease-out` | 340ms, 6px rise, **no fade** | a hero takes its place | `WeekSetMoment`'s hero (`.arrive`); floors already rise on `floor-enter` | fading a hero in (it must be readable on frame one) |
| **Now** | — | **static** | which way time is moving | the now-line's **wake** (a `--signal-soft` band over the minutes just gone, `--now-wake-h`) on the desktop Schedule and the phone's Day canvas | a pulse, a breathe, a glow that animates — the line moves only with the clock |
| **Reach** | `--d-advance`, `--ease-momentum` | one 8px mark in the project's hue, arcing from what you touched to the bar it moved | **where the change came from**: an act climbs one altitude to the reading it moved (D-202) | `reachToCrown` from a held plan block, a loose piece dropped on the grid, the phone's Put in a slot | more than one mark per project per act, more than one altitude, a chat or assistant write, to anything off-screen or unmounted |
| Travel · Zoom · Lift | existing | — | unchanged: `TimePager`, `LensZoom`, `.glass-lift` | | |

Laws that hold for every row of that table:

1. **Transform and opacity only**, one element per act — never per row of a list at once
   (perf rule 2). `tests/momentum.test.tsx` fails on any other property in a momentum keyframe.
2. **Only what you did, when you did it.** Momentum is the visible consequence of the user's
   own act. A tap and a chat message place a project identically (one kernel), but only the
   tap *lands* — the assistant proposes; it is never celebrated (P3).
3. **Forward only.** Progress advances; a reversal snaps.
4. **Reduced motion wins**, everywhere: CSS through the global rule in `index.css` and the
   block in `momentum.css`; WAAPI through `motionOff()`, which also treats a material whose
   ladder is under 30ms (E-ink) as reduced motion. TaskRow then writes at once.

### Instrument's idiom

The vocabulary is **roles**. `momentum.css` declares the defaults; `instrument.css` restates
every role in its `MOMENTUM (D-187)` block (the guard fails if one is missing). Instrument
**lands**: a ~9% spring on `--ease-land`, progress gliding in on `--ease-momentum`, a 700 hero, a
3px track, no now-line wake (no gradient to draw it with).

### Where it lives

- `src/styles/momentum.css` — the tokens (`--d-land` · `--d-advance` · `--d-commit` ·
  `--d-stagger` · `--d-task-complete` · `--ease-land` · `--ease-momentum` · `--hero-weight` ·
  `--track-h` · `--pace-tick(-w)` · `--landed` · `--now-wake-h`), the hero rule, and the
  keyframes (`land-stamp`, `land-strike`, `commit-band`, `commit-seal`, `arrive`, `.now-wake`,
  `.pace-*`). Durations are `@property`-registered so `getComputedStyle` resolves them.
- `src/lib/motion.ts` — `motionOff`, `motionMs`, `landBlock`, `landMark`, `advanceFill`,
  `advanceSegment`, `markLanding` / `consumeLanding` (a drop marks the block; whichever
  element draws it first lands it).
- `src/components/progress/PaceTrack.tsx` — `PaceTrack` + `SlatePips`, the one drawing of the
  week's progress on both shells (`WeekPanel`, `MobileWeekCrown`), over `useWeekCrown`
  (which now carries `elapsed`).
- `src/components/plan/WeekSetMoment.tsx` — the commit, on `PlanRail` and `MobilePlanWeek`.
- Verify: `?weekcrown` (tick a piece in either crown — the harness's ticks are local state,
  so the track advances under a real tick), `?planweek` (the commit frames, with Replay),
  `?rail` (land + let go), `?gather` (the now-line's wake, a drop's land).

---

## Surfaces and focus (replaces "the material", "the three planes" and "glass")

- `.atmosphere` still marks the one continuous ground, painted once; it is flat `--bg` now.
- The app is edge-to-edge. The DOM keeps its three planes (ground · shell · sheet) for the chat
  reveal; none of them is painted.
- `.glass`, `.glass-card`, `.glass-tint` render as an opaque `--surface`. `.glass-lift` /
  `.glass-lift-row` are the **selection fill** (accent wash + accent edge, no rise).
  `.glass-grab` is the drag ghost: solid, `--shadow-lift`, still picked up.
- `backdrop-filter` is off globally (`index.css`, one `!important` rule). A full-bleed overlay
  that relied on a blur for opacity is painted `--bg` instead.

### Drag-and-hold — the contract (universal, no exceptions)

Any press-and-hold drag interaction — reorder, move, drag-to-schedule, board, timeline,
tray — owes the user **two things at all times**, or it feels lost:

1. **The held thing lifts into glass.** The element under the pointer becomes a real
   picked-up card — `.glass-grab` (or, for a colored item, the inline lift: heavier frost
   + `--shadow-lift` + transform, keeping its fill). It **follows the pointer** (inline
   `transform: translateY(Δ)`, composed with the grab scale). You must always be able to
   see *what* you're holding and that it's airborne. A faint inline shadow is **not**
   enough — it must read as lifted-off-the-paper glass. **It's glass, so it stays
   translucent** (`.glass-grab` is ~60% surface + a strong backdrop blur): whatever you
   drag *over* stays visible (frosted) underneath — you never lose sight of the target.
2. **The destination is shown.** Where it will land is always visible — either a **drop
   indicator** (a 2px `--accent` bar at the target gap, for reorder/insert), the
   **vacated slot** (`.is-dragging`, dashed + faded, for move-between-containers), or the
   live target cell highlight (calendar). Never leave the user guessing where a release
   lands. **On the Schedule, a block that holds work has two answers** (D-170): its
   **edges place beside** (a 3px `--accent` caret on the side you're on, chip
   `Beside "…"`), its **middle gathers** — a slot lifts at once; a task's bar widens through
   a ~300ms pause, then the task lifts and a dashed `--slot` preview (`.block-gather-preview`)
   draws the slot it becomes, at its real size. Never a ring on the target: it lifts.
3. **Only where it will hold, and never by moving the list.** Two failure modes, both
   found in the Schedule rail (**D-063**). *(a)* A drop indicator is a promise — show it
   only where the new position is genuinely ours to store. A row ordered by its clock (a
   time-blocked task) gets **no line**: it moves on the calendar, where its position means
   something. Offering the line everywhere is the friendlier lie. *(b)* Drop chrome
   **never enters the list.** No banner, strip, or placeholder that unfurls over the rows
   you're dragging between — overlaying reads the same as reflowing. Arm something already
   in the layout instead (the Schedule rail arms the **Inbox tab**: permanent, already
   labelled, costs zero reflow and covers zero rows).

4. **The destination is named when it isn't obvious, and undoable when it's a write**
   (**D-063a**, extended by the app-wide undo stack). If a target can route somewhere
   *this* surface doesn't render — the Inbox tab sends a **parented** task to its
   project's backlog, not to the triage inbox — the row will simply vanish. So a
   **cursor chip** states the real destination before release (the slot-chip idiom, in
   `--accent` for an act rather than `--slot` for a container), and a **toast with Undo**
   names it again after. A target may not be labelled one thing and do another.

   Undo is two channels, not one toast-per-write:

   | Channel | When | Recovery |
   |---------|------|----------|
   | **Toast + Undo** (Tier A) | Complete / reopen, trash, keyboard triage, ambiguous routing (rail tab drop), file-to-project | Toast button (mobile's only path) · ⌘Z |
   | **Silent stack** (Tier B) | Calendar drag-drop, resize, in-rail reorder | ⌘Z on desktop · drag back on mobile |

   Never toast every mutation — calendar drags stay quiet. One coalesce window (~1.5s)
   merges a rapid family (e.g. three completes → "3 tasks marked done"). ⌘Z stands down
   in text fields so native edit undo wins. Implementation: `useUndoStack` +
   `src/lib/undoTiers.ts`; task acts record at `useTaskMutations`.

And when the gesture ends, **it ends** — a drag is a move, not a selection. Nothing may
stay lifted, armed, `cal-dragging`, or `user-select`-locked after the release, and that
includes an abandoned drag: Escape and `pointercancel` reset the same as a drop.

Reference implementation for a list that shares its rows with another drag system:
`useListReorder` (`src/hooks/useListReorder.ts`, used by `LeftRail`) — passive by design
(no `preventDefault` / `stopPropagation`) so it rides alongside FullCalendar's `Draggable`
on the same rows; FC keeps the cursor ghost, the hook owns the line, geometry decides.

Reference implementation for a list that owns its rows outright: the Week's Plan priority reorder (`WeekPlanFloor.tsx` —
`ReorderablePriorities`): pointer-events (Tauri swallows HTML5 DnD — see
`nuvo-tauri-dnd`), grip handle with `touch-action: none`, `.glass-grab` + pointer-follow
on the held row, `--accent` drop bar at the computed gap, persist on release.

### Rules that took iterating to get right

- **No accent ring on focus.** Just the lifted shadow. The checkbox/checked state already
  signals selection; the ring read as the old "outline."
- **Colored items keep their fill** — don't put `.glass-card`/`.glass-lift` on a calendar
  event (those paint a *neutral* glass). Instead the event gets a translucent *tinted*
  fill (`blockColors` mixes the hue with **transparent**, not surface) + the `.fc-event`
  blur, and on focus applies the lift *inline*: `transform: translateY(-3px)` +
  `box-shadow: var(--shadow-lift)` + a **heavier** frost (`blur(14px)`) so whatever it
  overlaps blurs out instead of bleeding through. **No solid backing** (that flashed a
  white edge), **no scale** (it grew past its harness and showed a white edge).
- **On the Schedule, the lift is instant.** `.fc-event` only transitions `filter` (the
  hover brightness); shadow + transform apply with no delay. Board cards keep the spring
  (`.lift-anim`) — animate where it's a deliberate select, snap where it's a live click.
- **The drag ghost is a full card, not a pill.** It mirrors the real card (title,
  subtitle, progress, accent edge) in `.glass-grab`, sitting under the cursor.
- **Focus clears on outside click.** A `pointerdown` anywhere that isn't a `.fc-event`
  drops the focused calendar block (it was sticking until you clicked another event).
- **Preview ≠ focus.** A "will-select" marquee preview stays a light dashed hint; only the
  committed focal element lifts.

---

## Hierarchy — one hero per surface

Density is fine; *competing anchors* are not. Every surface — a floor, the rail, a
mobile screen — gets **exactly one hero**, and everything else recedes below it. This is
the rule that keeps a dense screen calm.

1. **One anchor, in the surface's own voice.** Each surface has a single element at the top
   of its hierarchy, and nothing else competes with it. **The voice matches the surface:**
   a *ceremony/identity* surface anchors with a Fraunces `masthead` — a floor's
   `text-display masthead` name, the Review's date, a domain's name (serif is for a *name*,
   never a *number*). A domain's mandate sits **below** that one hero, demoted to a muted
   single-line caption (`text-body`/`text-caption` italic, `line-clamp-1` until tapped) —
   stacking it at hero size made two headlines, which this rule forbids. An *execution*
   surface anchors with a **functional header** — a
   tracked-caps eyebrow over a quiet status line, numbers in `mono`, the meter idiom the
   spine and Standing gauges use. The Schedule rail's crown is execution: "THIS WEEK · AUG
   17–23" over the week **drawn** — one pip per project in its domain's hue, filled when it
   landed, plus the amber count when something has no time (D-110, D-111) — **not** a serif
   scoreboard (a count in `masthead` reads like a marketing stat). The sentence it replaced
   ("0 of 4 landed") survives in `aria-label` and `title`: the drawing is for the eye, the
   words are for the screen reader. If a second hero of either voice appears
   below the anchor, demote one (see `FloorStanding`'s `quietSynthesis`: under the "Table"
   masthead its synthesis drops to `text-body text-muted`). Never stack two near-equal peers
   and hope the eye picks one — it won't.
2. **Counters fold into the hero, or into one quiet signal.** A scoreboard doesn't earn
   its own header. The week's "N priorities, M landed" lives *in* the crown, not as a
   separate "Priorities" label + count. Status that isn't the hero collapses to a single
   line that **names the first gap and vanishes when clean** — the "Loose ends" and "N done
   today" pattern. Four counters in a column is the smell; two disappearing lines is the fix.
3. **Sections earn their label, or they don't get one.** Don't title-and-count a list just
   because it's a list. Merge sub-lists that do one job (the rail's Today work is one flat
   list, not Planned · Scheduled · Done); reserve a `section-label` for a genuinely
   distinct group — the rail's **`Overdue`**, whose members need a *decision* while
   everything below needs execution. The label **states a fact, it doesn't address the
   reader**: "Needs you" was an imperative aimed at a human (Principle 4), and it cost a
   word the glossary already owned. And **a label must say how far it reaches** — over an
   *unlabeled* sibling list it always over-claims, so it carries its **count** and the zone
   is **closed** by one `--line-strong` hairline (the last row inside gives up its own
   `border-b`, so it's one line, not two). If the calendar sits right beside a "Scheduled"
   list, the list is redundant — cut it.
4. **At most one `--signal` item per row, and it is a number, not a word.** This is rule 2
   at the grain of a single line, and it's the one that actually broke: a rail row could
   spend signal five times over (title tint · the word "overdue" · a bordered `↻Nd` chip ·
   a `⚑` deadline flag · the date label), and "today" was tinted unconditionally, so a
   *healthy* task wore the alarm of a late one. An overdue row spends its one signal on the
   **time it was for**; the title keeps its ink, and the group label carries the state.
   History (`↻N`, `wk N`) is muted — old is not urgent. D-054.
5. **A list row is ONE line, one height, one order.** `title … state · weight · ⟨area⟩`,
   right-aligned, `mono` numerics, every row the same height with no exceptions. **Calm in a
   dense list comes from uniformity, not from showing less** — this is the rule that took
   three attempts to find. Six tasks on two-line rows are *eleven* eye stops across three
   indents (some rows one line, some two; the area chip at a different x each time); six
   one-line rows are six stops in one column. The list we benchmark against shows *more*
   metadata than ours did and still reads quieter, purely because its rows are identical.
   **So before you cut information from a crowded surface, check whether it's ragged** —
   ragged reads as noise however little is on it, and tidy reads as calm even when it's
   full. The title truncates; that's the price, and a title you can open beats a column you
   can't scan. Enclosure goes to the one *categorical* fact (the area chip) — numerics don't
   need a boundary, they align. And the row's title carries **one weight step** over its
   metadata (`font-medium`, 500 vs 400) — a title with the same weight as its own footnotes
   reads as a caption describing the task rather than the task itself. **Buy that hierarchy
   with weight, not size:** the resolved row went *down* a size step and *up* a weight one
   (`text-caption` at 500), which reads calmer than 13/500 and truncates less than 13/400
   did. 14px and 15px were both driven against real data and were overcompensation.
   Contrast can't buy it either — ink is already 15.29:1 of a possible 18.62:1. D-054.
6. **A `hover:bg-*` on a transparent surface must be checked against what the row sits
   on.** The rail is transparent, so its rows sit *on* `--bg` — and they were
   `hover:bg-bg`, painting each row the exact colour it already was. Measured 0.8808
   luminance against 0.8808: hover and selection were **literal no-ops**, which is why a
   perfectly good list felt untouchable. And when you fix it, **hover is a wash, not a
   surface swap** — a full `--surface` row is a +11.6% jump that reads as the row lighting
   up; `.row-hover` is 40% of it (+4.6%), which leaves `.glass-lift-row` as the louder focal
   state. Reach for a **fraction of a token, not the next token along**: the surface ramp
   inverts between themes (light `bg < surface-2 < surface`, dark `bg < surface <
   surface-2`), so `--surface-2` would be subtle in light and loud in dark. Focus still
   lifts and never outlines.
7. **Altitude reads through type, not chrome.** Serif = intent (the week, a floor's name);
   system = execution (the day, the rows). A change of altitude should feel like a change
   of voice, marked by **one** `--line-strong` divider — not a pile of hairlines.
8. **Persistent actions float; they don't take a hierarchy slot.** Capture interrupts every
   mode, so on the rail it rides low as a pill (mirroring the mobile ＋ FAB), and on mobile
   it's the FAB — never a titled row competing with the content.
9. **A door to a major surface wears one shape in every state.** The week's plan guides the
   whole week, so its entry can't be the quietest thing in the crown — it was 9.5px muted
   `open ▸` in `view` while `plan` and `review` got accent pills. One pill, one position,
   three verbs (`Plan the week` · `The plan ▸` · `Review`): **the state changes the word,
   never the weight.**

10. **One grammar per noun, wherever it appears.** A task is a task: the same row, the same
   checkbox, the same drag, whether it hangs under a project in the crown or sits loose in
   the day. Not "the same design" — the **same component**. The crown once had its own
   reduced list (a bare `<li>`, a truncated title) and it drifted until you could neither
   tick nor touch a project's work; a surface that needs a different *trailing mark* takes a
   prop for that mark, never a second row (D-111). The corollary: **an act may live on many
   surfaces, but a *move* lives on one.** Completing works everywhere, because completing
   isn't moving; moving a block belongs to the calendar, and the other surface links to it
   rather than growing a second handle.

11. **A name outranks its neighbours by WEIGHT, not by a step up the ramp.** "Scope reads as
   mass" means the row — a spine, a second line, indented children — not a bigger font. A
   heading one step up the type scale inside a dense list reads as a headline dropped into
   it, and juts. Before setting a size, measure the two things it sits between: **the rows
   beside it and the rows inside it.** The rail crown shipped its project name at
   `text-head` over `text-caption` rows and it stood out like a subhead; worse, the phone's
   crown was `text-body` over `text-head` children, so the parent was drawn *smaller than
   its own work* — an inversion that only appeared once the crown started rendering real
   rows. Both now sit at their neighbours' step in `font-semibold` (D-111). The desktop's is
   `text-body`, which is also `DeckCard`'s hero: the same object at two densities should
   speak at the same size.

Reference: the **Schedule rail** (`WeekPanel` crown → one `--line-strong` zone divider →
flat Today list → floating capture) and the **Projects/Initiatives floors** (`FloorHeader`
hero → `FloorStanding` gauges + quiet synthesis → the Collection). They obey the same law.

## Planner surfaces — one grammar, three registers

The Schedule, the project deck (On Deck) and the initiative deck are **the same act
at three clock speeds**: a pool of unclaimed things on the left, a grid of time on
the right, and you drag from one into the other. Only the unit of time changes.

| Altitude | The pool | The grid | The act | The mode you're in |
|---|---|---|---|---|
| Day | Inbox / Today (`LeftRail`) | hours, vertical | block a task | **Operator** — "what now" |
| Project | "Needs a week" (`OnDeckPlanner`) | weeks, ruled columns | time-box a project | **Foreman** — "can next week hold this" |
| Initiative | "Needs a quarter" (`InitiativeDeck`) | quarters, ruled columns | commit a bet | **Strategist** — "are these the right bets" |

The law, so a new planner surface can't drift:

1. **Position is fixed.** Pool **left**, full height, **transparent**, one `border-r`
   hairline; grid **right**, single plane, filling the pane. The pool is *structure*,
   never a floating panel — the things that float are the things you pick up, and if
   the container floats too, nothing reads as graspable. (`PlannerRail` is the one
   implementation; it wears the width `LeftRail` persists, so the edge doesn't jump
   between rungs.) The floor shell drops its padding + scroll for these faces
   (`FloorPane`'s `workspace`); the surface owns its own scrolling.
2. **The crown IS the readiness, and it is the surface's only hero.** Execution voice,
   never a serif scoreboard: tracked-caps eyebrow · one mono count · one thin meter ·
   one gap line that names the first debt and vanishes when clean. It reads "how ready
   is this altitude for the floor below" — "0 of 2 landed" / "5 of 9 ready" / "2 of 4
   on track". No page hero above it, no second strip, no gauge row. (This is why the
   decks lost their `masthead` + pip legend and why `ProjectReadinessStrip` /
   `InitiativeReadinessStrip` now ride only the *document* faces — Groom keeps the
   strip, Table has `FloorStanding`.)
3. **Gesture is fixed** — press-hold → `.glass-grab` ghost following the pointer, and
   the destination always shown (column wash / drop bar / vacated slot).
   **"Which shape am I looking at" has one control and one home:** the calendar's
   view pill idiom (`rounded-full`, `--surface-2` trough, the active face lifted onto
   `--surface` in the accent), right-aligned in the toolbar over the grid. The floor's
   faces (On Deck · Groom · Table · Shipped) wear it too — number keys in the tooltip,
   not printed in the pill. Don't invent a second switcher shape; the band's left is
   the window-drag zone, and the crown below already names the surface.
4. **Now is `--signal`; intent is `--accent`; open time is `--slot`.** The current
   week / quarter band matches the calendar's now-line. An empty, claimable cell —
   an unbooked column, an uncovered domain cell, the pool you drop into to *release*
   time — wears `--slot` (`.slot-open` / `.slot-col`). Never accent for "now".
5. **One deck card, and the altitude tell is structural** (`DeckCard.tsx`, D-048).
   Both decks render the same object in the same geometry and the same type ramp:

   ```
   [identity]  The name — the hero, text-body, nothing to its left
               area · weight                    status word   ● ● ●
   ```

   - **The name is the hero.** No control, no dot, no meter competing with it.
   - **One meta line** carries the rest: the area *by name* (colour alone fails for
     anyone who hasn't memorised the palette — P16), the **weight** (remaining hours;
     null when nothing is sized, never a guess), then a **single status word** and the
     **readiness pips**, right-aligned so the wall has one column to scan down.
   - **Readiness is subordinate** — 4px pips, not full-width bars. Full-width bars read
     as *progress* when they're a grooming checklist, and grooming is the deck's
     question, not the timeline's (D-023, Principle 8).
   - **Quiet by default.** A healthy card says only its name, its area and its weight.
     The status word appears only for a *fact* — a passed date, a missing outcome, a week
     that can't hold it. Never the pace read: `behind`/`stalled` fire on nearly every
     honest dated project, and "no motion" dresses absence of history up as bad news.

   **The altitude tell is the SPINE, and nothing else.** A project and a bet are the
   same object — a thing you pick up and drop on a column of time. They differ only in
   scope, so they may differ only in **weight**, by as little as will register:

   | | Domain spine | Weight | Time relation |
   |---|---|---|---|
   | Task | — (one row + time) | — | fills a slot |
   | Project | **marked** — 3px, rounded, inset from the card's ends: a mark *on* the card, the bar it occupies on the grid | remaining hours | **spans** weeks (resize handles) |
   | Initiative | **bounded** — same colour at 5px, square, full-height: the mark *becomes* the card's left edge | KRs · attainment | **belongs to** a quarter (no resize) |

   Everything else is identical — same glass, same hairline, same radius, same type ramp,
   same meta line. Scope reads as mass.

   **Two rejected tells, both wrong the same way** — they made altitude a difference in
   *kind* rather than degree, so a bet stopped reading as a bigger sibling and started
   reading as a different species:

   - a **serif** name — altitude as a font choice, an arbitrary signal a reader can't decode;
   - an **enclosed** card (domain-tinted border + wash) — a different silhouette entirely.

   Resize handles only where duration is real is the same kind of honest, minimal tell.
   Don't reach for a different frame, fill, or face to say "this is a bigger thing."
6. **On a phone the same surface ROTATES INTO A SWIPE — it does not become a list.**
   The grammar is preserved by turning the horizontal axis into pages, not by
   shrinking the grid or flattening it into rows: **page one is the pool, then one
   page per column of time**, so swiping right walks forward through time exactly as
   the eye walks right across the desktop grid. One implementation —
   `src/components/mobile/deck/MobileDeck.tsx` — carries all of it; the rungs pass
   columns, cards, and what a drop writes.

   | Desktop | Phone | Same because |
   |---|---|---|
   | pool rail, left | page 0, reached by the strip's ◇ cell | dropping there *releases* time — `--slot` wash on both |
   | crown above the pool | crown above the strip | one readiness hero per surface, execution voice |
   | column headers | the **strip**: every column at once, load as a bar, `--signal` on now | it is also the navigation *and* the drop target |
   | coverage strip aligned over the columns | same grid, collapsed by default, gutter = the ◇ cell's width | a lit cell still points at its column |
   | **By domain** (both decks, one set of parts in `ondeck/DomainLanes.tsx`): one lane per domain, the gutter carries the lane's name, an empty week is a card-sized **socket** (soft hollow, `--slot` on hover, never dashed), and the lanes replace the strip | *not yet: the phone pages a week at a time* | a gap is a shape before it is a word (D-179) |
   | press-drag a card onto a column | **press-and-hold** → `.glass-grab` ghost → drop on a strip cell | the destination is always shown (the pager follows the finger) |
   | click a card → record | tap a card → record, whose picker makes the same move | never a drag-only affordance on a phone |

   A bar spanning weeks becomes the **same card on each of those pages** with ◀ / ▶
   continuation marks. Placement writes through one shared rule (`sprintSpanFor` in
   `lib/onDeck.ts`), so a project lands identically whichever surface moved it.

## Typography

| Use | Class | Notes |
|-----|-------|-------|
| Floor / record / day heroes | `text-display masthead` | Fraunces, the editorial voice. Every floor `<h1>` uses this — never `font-semibold`. **Since D-187: 28px desktop / 25px phone at `--hero-weight` (600 on Paper), `SOFT 0`** — the material decides the weight (Flat 700 sans, Terminal 700 at one cell, E-ink 500 at 26px). |
| Ceremony (mandates, plaques) | `serif` | Fraunces, softer terminals — the Domain floor's register. |
| Everything else (UI, lists) | system (`--font-sans`) | The default. Recedes by design. |
| Section eyebrows | `section-label` | Tracked uppercase, `--muted`, the only "chrome." |
| Aligned numerics (times, %) | `mono` | System sans with tabular figures — *not* monospace. |
| Brand wordmark only | `wordmark` (Jakarta) | The "Nuvo" mark. Nothing else. |

Sizes: `text-display`, `text-lead`, `text-head`, `text-body`, `text-caption`,
`text-label`, `text-meta`, `text-micro`. Pair a size with `masthead` for a serif hero.

---

## Color — roles, not decoration

Use the **CSS variable tokens**. Never hardcode a hex.

| Token | Role | Don't use it for |
|-------|------|------------------|
| `--accent` (mulberry) | *Your intent* — committed, active, the app's hand | generic emphasis |
| `--signal` (warm orange) | *Now* — the live moment, the time bar, urgency | success/affirmation |
| domain color (`domain.color`) | *Identity* — inherited domain → initiative → project → task | anything cross-domain |
| `--slot` (dusty teal) | *Open / unclaimed* time, AI-proposed-not-yet-committed | committed work |
| `--landed` (→ `--accent`; ink on E-ink) | *Intent made true* — the ticked box, the commit seal | progress fills (those are the domain hue) |
| `--pace-tick` (→ `--signal`; the cursor `--text` on Terminal, ink on E-ink) | *Now, on a span* — where a project's clock stands on its track | "behind" — the tick is a position, never a verdict |
| `--muted` | secondary text, done/quiet states | primary text |

Progress bars, status dots, and chips take the **domain accent** — the blue/pink you see
*is* SCE/Family, already semantic. Keep fills low-saturation. Light + dark are both
first-class (`data-theme` on `<html>`); never write a raw hex that won't flip.

---

## Surfaces — dissolve, don't frame

- **Default: no container.** Content flows on the paper as hairline-separated rows (the
  Today "up next" list, the Domain initiatives list, the portfolio **table**) — not a
  bordered card holding a table.
- **A floating object is a glass card** — a single bounded thing on Today, a board card,
  a key-result tile. Use `.glass-card` + `rounded-lg` + a `--line` hairline (optional
  1.5px domain-color edge). The **Record modal** is a warm-paper sheet (`bg-bg` + `moment`
  + `elev-3`), title in `masthead`.

### The record — one spine, and a rail that annotates (D-050)

Both records wear one skeleton: **identity → the work → the Log**, with a rail of standing
beside it. A project and a bet are the same object at two clock speeds, so they differ in
what fills the slots, never in the frame. Four rules, and they're the ones that break:

1. **One spine.** Every control — checkbox, `＋`, `✎` — hangs in a **26px gutter**, so the
   section label, every row and every composer share one left edge. Text is on the spine;
   controls hang left of it. Three left edges (label, composer box-padding, checkbox) is
   what "disjointed" actually means, and it is measurable: they must all report the same
   `getBoundingClientRect().left`.
2. **One input idiom.** Every composer on the sheet is the same hairline row with a glyph
   in the gutter. Never a raised card next to a bordered row next to a filled box.
3. **The rule under a section heading IS its meter** — track `--line`, fill the domain hue,
   2px. Progress is drawn, not dialled: **no ring**. A dial in the header is a second hero
   beside the masthead, and one dial can't honestly carry two different bases.
4. **The rail is annotation, so it holds no enclosure and no chroma.** No bordered chips,
   no fills, no ghost buttons, no green — muted text and hairline tracks only, resting at
   ~78% opacity and coming full on hover/focus. **Weight follows importance**: the work is
   what the reader came for, so the only saturated things on the sheet are the section
   meter and a ticked checkbox. A scale of four bordered chips with one accent-filled is
   the single loudest thing you can put in a rail — draw it as a **track with the span
   filled** instead, which is also truer (on the deck it *is* a bar across time).

The sheet's **left edge carries the altitude**, exactly as `DeckCard` does: a project wears
a 3px rounded spine inset from the ends, a bet the same colour at 5px, square, full-height.
Scope reads as mass — never a different silhouette, a different font, or a different frame.

**Composer position follows content:** below the rows once there are rows to read, on top
(and autofocused) only while the list is empty. A populated surface must not open on an
empty box; a keystroke (`t` / `k` / `p` / `l`) is cheaper than a slot in the hierarchy.

**Creating a thing wears this same frame (D-055).** The create sheet is not a form — it is
the record with a draft inside it, so committing is *visually inert*: the name stays in
place, the rows stay on the spine, the draft rows already wear the unchecked box they'll
have a second later. The frame is **shared code, not a convention** —
`record/recordFrame.tsx` exports `Sheet · Head · Body · Sec · RailSec · ReadyTicks` plus the
Escape/Tab/focus contract, and both `RecordModal` and `floors/CreateRecord.tsx` import it. A
layout convention that lives in two files has already drifted.

Create earns exactly three additions, and nothing else:

| Addition | Why it earns a slot the record denies it |
|---|---|
| A footer with **one** commit | The record has no footer because `esc` / `✕` / the scrim all close it, so a "Done" was the loudest thing on the sheet. Here the commit *is* the surface. No Cancel — the three close paths already exist. |
| A placement band over a **draft** | Same `sprintSpanFor` / `quarterEndISO` kernel via `onPlace`, so a tap here and a drop on On Deck place a thing identically. A default placement must not imply `in_progress` — only one the human chose. |
| Readiness ticks | They fill in as you type, which is the one thing a record can show that a form's "required field" asterisk can't. |

Everything with nothing to say pre-creation stays **silent** — no Log, no "Belongs here", no
Activity. An empty section is worse than an absent one (D-035). And AI is **opt-in**: a
`✦ Draft the first steps` button, never a cold list that fires as you type.
- **Grid views go single-plane, full-height.** The collection **Calendar** and **Timeline**
  do *not* wear a `bg-surface` frame — the grid IS the paper (transparent, gridlines carry
  structure), and they **fill the floor** via `flex-1` (Timeline body) / `grid-auto-rows:
  minmax(72px, 1fr)` (Calendar). Use `flex-1` to fill a flex parent, **not** `min-h-full`
  (a percentage min-height doesn't resolve against a flex-derived height — that was the
  "why won't it fill" bug). Bigger nav controls (≥36px targets); serif month label.
- **Progress track**: `--line` (never `bg-bg`, which vanishes against the paper), `--track-h`
  thick, and drawn by `PaceTrack` wherever it is a project's work (see **Momentum**).
- **Buttons** (`Btn` in `ui.tsx`): comfortable tap targets — `px-4 py-2`.

## Forms & inputs — one field surface

Every text box, select, time input, switch, and stepper comes from the primitives in
`src/components/form.tsx` — **never hand-roll `border border-line px-2 py-1`.** The old
per-input recipe (cramped 4px padding, `text-caption`, inconsistent `bg-bg`/`bg-surface`)
is retired.

- **The `.field` class** (in `index.css`) owns the input surface: `--field-h` tall (40px
  desktop, **44px on a phone** for tap), `--surface` fill, `--line` hairline, `--text-body`,
  and the soft `--accent-soft` focus ring + `--accent` border. It's all tokens, so every
  material/skin inherits it. Sizing/width lives on the element (`w-full sm:w-28`).
- **The components**: `Field` (label-left / control-right row, or `layout="stack"` for a
  form grid cell), `FieldGroup` (hairline-divided stack), `TextInput`, `Select` (native
  select + our own chevron — pass width via `className` on the *wrapper*), `Toggle` (a 44px
  hit area around a 28px pill — the app's on/off switch), `Checkbox`, `Stepper` (−/value/+
  for bounded numbers), `Segmented` (2–4 exclusive choices). Settings is the reference.
- **A tall settings modal** centers (`<Modal align="center">`) and goes multi-column where
  content tiles (Schedule's stacked form grid, the Calendars account columns); list-style
  panes cap at a readable width.
- Long lists collapse their off/hidden items behind a small disclosure (see the Calendars
  pane's "N hidden calendars" drawer) — a wall of controls is clutter, not information.

---

## Collection views — same entity, four shapes

Projects/initiatives render in **Table · Board · Calendar · Timeline** (`Collection.tsx`).
They are *deliberately different shapes* — a Gantt bar, a card, a chip, an event block.
Don't try to make them look literally identical. What IS shared, and must stay shared:

- the **glass material** (translucent + frost),
- the **domain accent** (the colored bar / dot),
- the **active/selected state** — the lift, routed through `itemSelectClass`
  (cards/chips → `.glass-lift`) and `itemSelectRowClass` (rows → `.glass-lift-row`).

Each view's unscheduled work uses the same **tray** pattern: a `section-label` band with a
horizontal scroll of larger chips you drag onto the grid.

---

## Detail popovers — one grammar (D-101)

The event, task and slot popovers are the **same card** at three subjects — and so is the
**quick-create composer** (`DraftComposer`), which is the same card *before* the thing exists.
The parts live in `src/components/PopoverParts.tsx` — build the next one out of them, don't
hand-roll a fifth stack of `border-t` sections.

```
┌───────────────────────────────────────────────┐
│ ● Title                                     ✕ │  PopMast — dot + title +
│   Thu Aug 13 · 9:00 – 9:30 AM · ↻ Weekly      │  ONE muted meta line
├───────────────────────────────────────────────┤
│ [ Join Google Meet ]   Going? [✓Yes][?][✕]    │  PopStrip — at most TWO acts
├──────────────────────┬────────────────────────┤
│ WHEN · WHERE · FILING│ GUESTS · NOTES         │  PopBody → PopCol left/right
│ (the facts)          │ (the people and words) │  each scrolls on its own
├──────────────────────┴────────────────────────┤
│ ↗ Google Cal  Hide  → Task           Delete   │  PopFooter — quiet left,
└───────────────────────────────────────────────┘  destructive right
```

- **The meta line is the read; the fields are the edit.** They deliberately overlap — the
  masthead says "↻ Weekly on Thursday" even on a read-only feed, and the chip that *changes*
  it lives in the When field. A fact the card knows must never go unsaid because you can't
  edit it.
- **The strip holds at most two acts**, and the filled one is the reason the card was opened
  (Join · Done). A rarely-touched control (All day) is a chip in its own field, never a
  full-width switch — that inversion is what made the old event card unreadable.
- **Width is earned:** `POP_W_WIDE` (560) when there's something for the right column,
  `POP_W_NARROW` (380) when there isn't. Decide it from something known *synchronously* so
  the card never resizes under the cursor.
- **Destructive acts are text** (`PopFootAct danger`, or `quiet` on the recurrence delete
  buttons) and turn `--signal` only once they ask which occurrences you meant.
- **A card that has been put somewhere stays there.** It centres on its anchor *once*, then
  follows the anchor and is only nudged to stay on screen (`src/lib/anchoredTop.ts`). Async
  content extends a card downward; it never re-positions it. Anything that arrives late gets
  a `PopSkeleton` holding its shape, and the width is decided before the card is on screen —
  never from data still in flight.
- **The composer wears it too, one step earlier.** Its kind switcher and title input are the
  masthead (the tabs *are* the identity, so it has no separate heading), the meta line reads
  the when, and Create is the footer's one primary. Only an Event has people, so only an Event
  goes wide — a Task or a Slot would open a 560px card with an empty half.
- **Verdict tokens mark, they don't label.** `--ok` / `--warn` carry an RSVP or a priority as
  the tint, border and dot; the label stays `--ink`. They're ~3.3:1 on the light paper grounds
  — a legible *mark* (1.4.11 wants 3:1), illegible 11px *text*. This is why the control needs
  no per-skin exception.
- **On a phone it is one column, from the same parts (D-162).** `mobile/sheetKit.tsx` renders the
  mast / strip / sections / footer as a single scroll: the name is a borderless, auto-growing
  field at `text-lead` weight 600 with ONE muted `mono` line under it (*Today · 2–3:30pm · ↻ Weekly
  on Wed*); the Sheet's own title row says what KIND it is at rest and takes the name once the hero
  scrolls away; "Going?" is `Yes · Maybe · No` at 44px with verdict tokens as marks; rows that open
  something wear a chevron (Remind used to look like text beside a Repeat row that had one); an
  act on the **footer** is text, and the destructive one swaps for Cancel / Delete **at the same
  height**, so nothing under it jumps. Many-of-many is a Sheet (`PickSheet`), never a chip per item
  and never a cursor-anchored menu.

---

## Layout signatures

- **Spine left, Nuvo right, work between** — all the same paper, divided only by
  `border-l/-r` hairlines, and all of it inside the one sheet (see *The frame*). The Nuvo
  agent rail (`AgentSidebar`) is the one home for chat on desktop (⌘J); it stays
  transparent like the spine and separates with a single `border-l`.
- **Only the user's line gets a bubble.** Nuvo's half of the conversation is *the page* —
  no box, no fill, generous leading, straight on the paper (`.agent-turn`). A reply boxed
  in `--surface-2` reads as a quotation from somewhere else, and it nests a frame around
  the record cards that follow it. What you typed keeps `.agent-bubble-user`, because a
  quotation is the one thing in the transcript that genuinely came from elsewhere. Per-turn
  actions (copy · try again) rest at `opacity: 0` and come up on hover — always visible on
  touch, where there is no hover to reveal them with. Shared by all three chat surfaces:
  the rail, the phone's `ChatPane`, and the ⌘K spotlight.
- **The spine has two widths, and one vocabulary.** 188px named, 64px railed (⌘\ or the
  footer control, persisted in `nuvo-spine-rail`); focus mode (⌘.) is a third state that
  shuts it entirely. Railed, the glyph *is* the row — readiness survives the narrowing as
  a status dot on the shoulder and the meter as a hairline underscore, and the label comes
  back as a glass flyout on hover, never a native tooltip. Anything positioning against
  the spine reads `--spine-width`, which the component keeps in sync with both states.
- **The altitude glyphs live in one file.** `src/components/icons.tsx` draws task ·
  schedule · project · initiative · domain in one hand — 20×20 field, hairline stroke,
  round caps — and *every* surface that says "what kind of thing is this" imports from
  there: the spine, the phone's bottom bar, the command palette, the mis-filed list. They
  read as span, widening up the ladder: one box and a tick → a day's column → staggered
  bars → the mark being aimed at → the wall it all stands on. Never draw a fifth set
  inline. A domain's own **mark** is identity, a different thing entirely.
- **A domain has one mark, elaborated by scale.** `domainSymbols.ts` owns the curated
  Lucide centers; `domains.icon` stores the chosen key, never native emoji artwork.
  Compact rows draw that center through `DomainSymbol.tsx`. The wall and open domain draw
  the same center and color through `DomainMark.tsx`, with thirteen weeks of presence as
  its generated halo. The domain page offers one **Mark** door for symbol + color. There
  is no second form chooser and no separate sigil identity. D-135.
- Floor heroes: `section-label` eyebrow → `text-display masthead` title → a muted
  `text-body` line (`FloorHeader` encodes this).
- Mobile parity is non-negotiable — see the golden rule in [`CLAUDE.md`](../CLAUDE.md).
  The mobile pass for the glass language hasn't been done yet.

---

## Where it lives in code

- Tokens / classes: [`src/index.css`](../src/index.css) — palette blocks (`--shadow-lift`
  per theme), `.atmosphere`, `.masthead`/`.serif`/`.section-label`, `.glass-card`/
  `.glass-lift`/`.glass-grab`/`.glass-lift-row`/`.lift-anim`/`.is-dragging`, and the
  FullCalendar restyle (`.fc-event`, `.evt-focused`, `.fc-event-mirror`).
- Selection visuals: `src/components/floors/collectionSelection.tsx` (`itemSelectClass`,
  `itemSelectRowClass`).
- The four views + drag ghosts: `src/components/floors/Collection.tsx`; the Gantt +
  shared `Bar`/`FloorHeader`/`StatusPill`: `src/components/floors/parts.tsx`.
- Calendar event color + focus logic: `src/components/CalendarPane.tsx` (`blockColors`,
  `focusedEventId`).
- **The record frame — shared by the record AND create:**
  `src/components/record/recordFrame.tsx` (`Sheet`, `Head`, `Body`, `Sec`, `RailSec`,
  `ReadyTicks`, `RecordScrim`, `useRecordKeys`, `GUT`). Consumers:
  `record/RecordModal.tsx` and `floors/CreateRecord.tsx`. Placement for a saved row *or* a
  draft: `record/PlacementBand.tsx` (`store` vs `onPlace`).

---

## Checklist before you ship a surface

- [ ] No opaque `bg-*` on a full-bleed container — the atmosphere reads through.
- [ ] The hero `<h1>` is `masthead` (Fraunces), not `font-semibold`.
- [ ] Every color is a token and names a role; nothing colored for decoration.
- [ ] Borders are hairlines or absent; no box where whitespace would do.
- [ ] Eyebrows are `section-label`; numerics are `mono`.
- [ ] Floating things rest as glass (`.glass-card`); focus **lifts** (`.glass-lift` /
      `.glass-lift-row` / `.glass-grab`) — no flat outline, no accent ring. (The one
      exception is the keyboard ring on `:focus-visible` — see **Glass**, point 3. Never
      paint it on plain `:focus`.)
- [ ] Anything clickable is reachable by Tab and acts on Enter/Space — a `<div onClick>`
      needs `pressable()` from `src/lib/a11y.ts`. Anything dismissible closes on Escape
      (`useEscape`). Anything hidden until hover reappears on focus.
- [ ] Grid views fill the floor and sit single-plane (no `bg-surface` frame).
- [ ] **If the surface creates something, it wears that thing's own frame** — import from
      `recordFrame.tsx`, don't restyle a form to look close (D-055).
- [ ] Borderless inputs on a spine carry `nuvo-inline-input` — otherwise the global
      `input:focus` ring paints the flat outline the language forbids.
- [ ] Holds up on the warm paper *and* in dark mode, and reflows to one column ≤767px.
- [ ] Any motion is one of the named ones in **Momentum**, plays only on the user's own act,
      moves transform/opacity only, and reads its timing from tokens — never a hard-coded ms.
      A new token is restated in every material's `MOMENTUM` block.

---

## Open threads (as of this writing)

Applied: foundation seam fix · portfolios (calm ledger) · floor heroes → masthead · Nuvo
rail · Record modal · Timeline & Calendar (single-plane fill-height) · `Btn` sizing ·
glass focal system (board, calendar, table, timeline) · Today hero cards → glass ·
**planner surfaces unified** (shared `PlannerRail` + crown on both decks, ruled quarter
columns, now → `--signal`, open time → `--slot`, deck cards → glass) · **create unified with
the record** (three create surfaces → one `CreateRecord` over the shared `recordFrame`).

**Momentum (D-187)** applied: the task tick (land + let go), the week crown on both shells
(one `PaceTrack` + pace tick, slate pips that land), the Schedule's drop (land) and now-line
(wake, both shells), the commit (`WeekSetMoment`, both shells), the hero type step.

Not yet done / open questions:
- **Momentum, not yet carried:** the On Deck / initiative deck drop (cards don't land yet),
  the record's section meters (still the 2px rule), the old walk's `SundayRitual` close (it
  keeps its own `block-in` bands — trial surface), the phone's tap-to-place (no drag, so no
  drop to land; the Day canvas could land a block placed from the sheet). Ship stamp
  (`ShipStamp`, D-093) predates the vocabulary and keeps its own timing.
- The **rails aren't resizable on the decks** — they read the width the Schedule
  persisted, but you can't drag their edge yet. Lift `LeftRail`'s resize handle into
  `PlannerRail` when it starts to itch.
- **Mobile has no planner rail.** The decks are desktop-only; `MobileProjects` /
  `MobileInitiatives` read the same libs but render their own list. If the pool→grid
  gesture ever ships on the phone, the pool should be a bottom `Sheet`, not a rail.
- **Mobile pass** for the whole language (375px) — untouched.
- Carry glass to the **Today day-spine blocks** (left column), the **Record modal inner
  cards**, and the **Step-back / Gain** face.
- **Calendar event opacity** is tunable in one place (`blockColors`, the `fillPct + 10`)
  — heavy-overlap days can read busy; dial if needed.
- **Board cards don't hover-lift** (events do) — minor inconsistency, easy to add.
- Decision pending: should the **table at rest** become glass cards (full parity), or stay
  a ledger? (Recommendation: stay a ledger; parity is material + active state, not shape.)
- Gotcha: `parts.tsx` exports both components *and* constants, so editing it breaks Vite
  Fast Refresh (white screen) — a browser reload fixes it; the build is unaffected.
  Splitting the constants out would make HMR clean.
