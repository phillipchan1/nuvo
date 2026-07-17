# Nuvo design language — "Warm Paper" + glass

The look every screen is converging on. **Read this before building any new surface.**
Tokens live in [`src/index.css`](../src/index.css); this file is the *grammar* — why the
tokens are used the way they are, and the rules that keep new work coherent.

The thesis, in one line: **one continuous sheet of warm paper, written on with an
editorial hand — and the things you touch are panes of glass that lift toward you.**
It is not a color theme. It is spacing, hierarchy, flatness, restraint, type, and a
single, physical idea of "focus." Reference screens: the **Schedule** calendar
(`CalendarPane` + `LeftRail`) and the **Domain** wall/chapel (`DomainFloor`). When in
doubt, go look at those.

---

## The grammar (six moves)

1. **One continuous paper, no panels.** Surfaces dissolve into spacing, not boxes.
   Borders are hairlines (`--line`) at the edge of perception, often replaced by
   whitespace entirely. A wall of bordered cards is the old idiom.
2. **Serif for ceremony, system for work.** Fraunces (`masthead` / `serif`) carries the
   things that *matter* — the date, the greeting, a floor's name, a vow, a record's
   title. The system font does everything else and recedes.
3. **Color is a whisper, and always semantic.** Nothing is colored for decoration. Every
   hue means something (roles below) at low saturation. If you can't name what a color
   *means*, it shouldn't be there.
4. **Soft tonal blocks, not cards.** When something must be set apart, prefer a
   low-saturation tinted fill with no border over a bordered container.
5. **Calm hierarchy.** Tracked small-caps eyebrows (`section-label`), generous air, the
   eye never jostled. Density is fine (the planner is dense); *visual noise* is not.
6. **The thing in focus lifts.** Selection / drag / active / open is shown by a glass
   pane physically rising toward you — never a flat outline or color swap. (See **Focus**.)
   **While you drag-and-hold, the thing you're holding is glass in your hand and the
   destination is always shown** — no exceptions. (See **Drag-and-hold**.)

---

## The material — the atmosphere is sacred

The warm paper is `--bg`; the **`.atmosphere`** class lays a whisper of dawn (top-left)
+ dusk (bottom-right) light over it. It is applied **once**, high in the shell
(`AppShellInner`), and must read continuously across spine · rail · calendar · floors ·
Nuvo rail.

> **Cardinal rule: never paint an opaque background over `.atmosphere`.** `bg-bg` /
> `bg-surface` on a full-bleed container is the "funky seam" — it covers the one canvas
> and the surface beneath reads as a different, flatter tone (the calendar "frost" that
> was lighter than the rail). Full-bleed structural containers (floor wrappers, the
> calendar pane, the agent rail) stay **transparent** and separate with a `border-l/-r`
> hairline only.

---

## Glass — the resting material AND the focus system

This is the layer that makes "focus lifts" actually read. Two ideas, one material:

**1. The resting material is already glass.** Cards and event blocks are *translucent*
(so the atmosphere gradient reads through them), frosted by a backdrop blur, with a
faint top-light sheen. Lift only reads as elevation because there's a glass plane to
rise *from* — **never lift a solid-white card; make it glass first.**

**2. Focus = the same glass, lifted.** The focal element rises with a real shadow
(`--shadow-lift`) and a small translate. No outline, no ring, no color swap.

### The token vocabulary (all in `src/index.css`)

| Token | Is | Used on |
|-------|----|---------|
| `--shadow-lift` | the deep, warm focal shadow (per-theme) | every lift |
| `.glass-card` | resting glass: translucent + blur + sheen, **no** border/shadow | board cards, Today hero cards (the "right now" block, open-time offer, focus/done moment) |
| `.glass-lift` | selected / active / open: glass + `--shadow-lift` + `translateY(-3px) scale(1.015)` + inset top highlight. **No accent ring.** | board cards & calendar chips when selected (via `itemSelectClass`) |
| `.glass-lift-row` | the row variant: same glass + shadow, `translateY(-2px)`, **no horizontal scale** (so a wide row can't overflow) | selected table rows & timeline name-column rows (via `itemSelectRowClass`) |
| `.glass-grab` | the "picked up" variant: more blur, `scale(1.04) rotate(-0.5deg)` | drag ghosts (board, timeline tray, reorderable lists — Week's Plan priorities) |
| drop indicator | a 2px `--accent` bar (`h-0.5 rounded-full`) at the landing gap | reorder lists; the "where it lands" half of the drag contract |
| `.lift-anim` | springs the lift in/out (`transform` on `--ease-spring`) | board cards, table/timeline rows |
| `.is-dragging` | the vacated slot left behind: `opacity .4` + dashed border | the source card while its ghost is dragged |

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
   lands.

Reference implementation: the Week's Plan priority reorder (`WeekPlanFloor.tsx` —
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
   `text-display masthead` name, the Review's date, a domain's vow (serif is for a *name*,
   never a *number*). An *execution* surface anchors with a **functional header** — a
   tracked-caps eyebrow over a quiet status line, numbers in `mono`, the meter idiom the
   spine and Standing gauges use. The Schedule rail's crown is execution: "THIS WEEK · JUL
   13–19" over "0 of 2 landed" + a thin landed meter — **not** a serif scoreboard (a count
   in `masthead` reads like a marketing stat). If a second hero of either voice appears
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
   distinct group ("Needs you"). If the calendar sits right beside a "Scheduled" list, the
   list is redundant — cut it.
4. **Altitude reads through type, not chrome.** Serif = intent (the week, a floor's name);
   system = execution (the day, the rows). A change of altitude should feel like a change
   of voice, marked by **one** `--line-strong` divider — not a pile of hairlines.
5. **Persistent actions float; they don't take a hierarchy slot.** Capture interrupts every
   mode, so on the rail it rides low as a pill (mirroring the mobile ＋ FAB), and on mobile
   it's the FAB — never a titled row competing with the content.

Reference: the **Schedule rail** (`WeekPanel` crown → one `--line-strong` zone divider →
flat Today list → floating capture) and the **Projects/Initiatives floors** (`FloorHeader`
hero → `FloorStanding` gauges + quiet synthesis → the Collection). They obey the same law.

## Typography

| Use | Class | Notes |
|-----|-------|-------|
| Floor / record / day heroes | `masthead` (+ size) | Fraunces, the editorial voice. Every floor `<h1>` uses this — never `font-semibold`. |
| Ceremony (vows, plaques) | `serif` | Fraunces, softer terminals — the Domain chapel register. |
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
- **Grid views go single-plane, full-height.** The collection **Calendar** and **Timeline**
  do *not* wear a `bg-surface` frame — the grid IS the paper (transparent, gridlines carry
  structure), and they **fill the floor** via `flex-1` (Timeline body) / `grid-auto-rows:
  minmax(72px, 1fr)` (Calendar). Use `flex-1` to fill a flex parent, **not** `min-h-full`
  (a percentage min-height doesn't resolve against a flex-derived height — that was the
  "why won't it fill" bug). Bigger nav controls (≥36px targets); serif month label.
- **Progress track**: `--line` (never `bg-bg`, which vanishes against the paper).
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
- **The components**: `Field` (label-left / control-right row that stacks full-width ≤`sm`),
  `FieldGroup` (hairline-divided stack), `TextInput`, `Select` (native select + our own
  chevron — pass width via `className` on the *wrapper*), `Toggle` (a 44px hit area around a
  28px pill — the app's on/off switch), `Checkbox`, `Stepper` (−/value/+ for bounded
  numbers), `Segmented` (2–4 exclusive choices). Settings is the reference surface.
- A settings **row** is `<Field title desc>…</Field>`; a group of them is a `<FieldGroup>`.
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

## Layout signatures

- **Spine left, Nuvo right, work between** — all the same paper, divided only by
  `border-l/-r` hairlines. The Nuvo agent rail (`AgentSidebar`) is the one home for chat
  on desktop (⌘J); it stays transparent like the spine.
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

---

## Checklist before you ship a surface

- [ ] No opaque `bg-*` on a full-bleed container — the atmosphere reads through.
- [ ] The hero `<h1>` is `masthead` (Fraunces), not `font-semibold`.
- [ ] Every color is a token and names a role; nothing colored for decoration.
- [ ] Borders are hairlines or absent; no box where whitespace would do.
- [ ] Eyebrows are `section-label`; numerics are `mono`.
- [ ] Floating things rest as glass (`.glass-card`); focus **lifts** (`.glass-lift` /
      `.glass-lift-row` / `.glass-grab`) — no flat outline, no accent ring.
- [ ] Grid views fill the floor and sit single-plane (no `bg-surface` frame).
- [ ] Holds up on the warm paper *and* in dark mode, and reflows to one column ≤767px.

---

## Open threads (as of this writing)

Applied: foundation seam fix · portfolios (calm ledger) · floor heroes → masthead · Nuvo
rail · Record modal · Timeline & Calendar (single-plane fill-height) · `Btn` sizing ·
glass focal system (board, calendar, table, timeline) · Today hero cards → glass.

Not yet done / open questions:
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
