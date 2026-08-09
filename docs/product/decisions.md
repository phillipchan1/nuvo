# Decision log

**Status:** living · append-only in spirit (supersede, don't delete)
**Why this exists:** so we stop relitigating. The most valuable half of this file is §2 —
the things we **decided not to do** and why. An idea that comes back with no new
information gets pointed at its entry and closed.

**Format:** `D-nnn · date · decision — why → consequence.` Status is `standing`,
`superseded by D-nnn`, or `revisit (trigger)`.

> Entries D-001…D-018 were reconstructed from the repo on 2026-07-25 (readme, `CLAUDE.md`,
> and `docs/` specs). Dates are approximate where the original decision wasn't dated.
> **New entries should be written at the time of the decision.**

---

## 1 · Standing decisions

### Model

**D-001 · A scheduled task IS a time block.** One `tasks` row; no separate event entity.
→ Rollover, mirror sync, capacity math, and the Review's evidence are all cheap. Reversing
this would double every sync path. *Status: standing — foundational.*

**D-002 · Four pools, one gate.** `inbox → backlog → Week → Day`, with backlog
**deliberately undated**. → Project work can't leak onto Today; the Sunday commitment number
means something. *Status: standing.*

**D-003 · Single-*player*, not single-*tenant*.** No assignees, permissions, or shared
state **inside a funnel**. → Every altitude stays sharp and the arithmetic stays honest
(pace and calibration both break if a task's progress depends on someone else). Costs us
the team market on purpose. **Clarified 2026-07-25:** this was written as "single-user
only," which conflated a product refusal with a deployment shape and was being used to
argue against things it doesn't actually forbid. Serving many independent accounts is
explicitly *in* scope — see D-024 and [`overview.md`](./overview.md) §2.1.
*Status: standing (restated).*

**D-004 · Priorities bind to projects along a crystallization line** rather than being
either "just a sentence" or "always a project." A priority is always a real node that *can*
own tasks, and may stay a pure intention forever. → No nagging to "grow up." Spec:
[`priorities-and-projects.md`](../priorities-and-projects.md). *Status: standing.*

**D-005 · The assistant proposes into quiet pools; only the human promotes toward the
calendar.** → No auto-scheduling, ever. This is the story's Hero test, not just a taste
call. *Status: standing — Principle 3.*

**D-006 · No farming or pastoral metaphors.** "Harvest" rejected for the weekly ritual;
"tend" rejected for grooming. Named **the Review** (agile *sprint review* lineage — the
demo half, not the retro half). → Voice stays agile-plain.
*Status: standing. Code debt: `TendingFlow`, `src/lib/tending.ts`.*

**D-007 · Accepted naming drift, documented.** Priorities = `big_rocks`; Week = `sprints`.
→ Renaming the columns isn't worth the migration; [`glossary.md`](./glossary.md) is the
contract instead. *Status: standing — revisit only during an unrelated migration.*

**D-008 · Recurrence is materialized, not computed.** A `recurrences` row holds rule +
template; occurrences are stamped as ordinary `tasks`/`slots` rows to a 35-day
`HORIZON_DAYS`, topped up on app open and after rollover. → Drag, resize, and slot children
need zero special-casing. *Status: standing.*

**D-009 · A recurring occurrence never rolls over.** A missed one is just missed — tomorrow
already has its own. → No infinite pile-up of yesterday's habit. *Status: standing.*

**D-010 · Recurring series are not mirrored to the Google "Nuvo" calendar.** ~25 concurrent
mirror writes raced on OAuth token refresh and 500'd. → Series live in Nuvo only.
*Status: **revisit** — trigger: a batched/queued mirror writer.*

### Platform

**D-011 · FullCalendar over Schedule-X** — external drag-in from the task rail is natively
supported. *Status: standing.*

**D-012 · One SPA, two shells, no router.** Auth-gated single `index.html`; `ResponsiveShell`
picks `MobileShell` (<768px) or the desktop shell. → One `dist/` serves the Tauri app and
the iOS PWA. *Status: standing — Principle 15.*

**D-013 · Pointer events for all drag.** The Tauri webview swallows HTML5 drag-and-drop.
*Status: standing — non-negotiable.*

**D-014 · The service worker never runs in Tauri.** Guarded on `'__TAURI_INTERNALS__'` +
`isSecureContext`, and the PWA plugin is disabled at build time (`TAURI_BUILD=1`).
*Status: standing.*

**D-015 · Calendar providers by capability, not parity.** Google two-way + mirror · M365
read-only (striped, dashed, not draggable) · iCloud two-way over CalDAV with an
app-specific password in Vault · ICS read. → We ship what each API honestly supports and
*show* the difference rather than faking parity. *Status: standing.*

**D-016 · All model/API keys live in Supabase secrets, never the frontend.** The agent edge
function is the only path to the model. *Status: standing — security-load-bearing.*

**D-017 · Dev auto-login, tree-shaken from production.** `VITE_DEV_EMAIL`/`VITE_DEV_PASSWORD`
in gitignored `.env.local`, guarded by `import.meta.env.DEV`. → Every UI change can be
verified against the *running app* with real data. *Status: standing.*

**D-018 · Marketing is a separate Vite app in the same repo** (`marketing/`, own Vercel
project), sharing tokens but not the SPA shell. → Design truth stays close; the product
bundle stays clean. *Status: standing.*

### Design

**D-019 · Warm Paper: the canvas is continuous.** Full-bleed structural containers stay
transparent and separate with hairlines; opaque backgrounds over `.atmosphere` are the
"frost seam." *Status: standing.*

**D-020 · Focus lifts, it doesn't outline.** No flat focus rings on focal elements — glass
+ `--shadow-lift` + a small rise. *Status: standing.*

**D-021 · At most one Find per Review, hidden when nothing is notable.** Confidence +
unexpectedness gates. → No manufactured profundity. *Status: standing — Principle 6.*

**D-022 · Marquee's vocabulary is data, not code.** Targets live in a client-side registry
sent to the agent per request; the edge function only relays "point at `<key>`". → It never
changes as targets grow. *Status: standing — the pattern to copy for any future agent
vocabulary.*

**D-023 · On Deck is the start of grooming, not the deck.** Portfolio-level timeline first
(coarse calls), then the per-project card run. → Sorting by *when it's needed* rather than
*how unready it is.* *Status: standing.*

**D-048 · 2026-07-28 · The deck card: one object, two altitudes — *marked* vs *enclosed*.**
The project and initiative On Deck cards are now one component
(`src/components/ondeck/DeckCard.tsx`): identity · **name** · one meta line
(`area · weight`, then a status word and readiness pips, right-aligned). What changed and
why:

- **The name is the hero.** It's the only thing you read while scanning a wall, so nothing
  sits to its left any more — the completion check and the second domain dot are gone.
- **Readiness is subordinate, not co-equal.** The old three full-width bars were the
  loudest thing on the card, read like *progress* when they're a grooming checklist
  (Principle 6), and answered the **Groom deck's** question on a surface whose question is
  "when does this land, and what collides" (Principle 8, D-023). They're now 4px pips at
  the right margin.
- **The card carries its weight in hours.** Remaining effort is the currency the pinch math
  actually runs on, so a column of weights explains an over-committed sprint the way `5/2`
  never could (W1/Q2). Null when nothing is sized — never a guess.
- **One status word, by precedence, and only when there's something to say** (Principle 9).
  Deliberately *not* said: the pace read. `behind`/`stalled` fire on nearly every honest
  dated project, so a wall of "behind" says nothing, and "no motion" dresses *absence of
  history* up as bad news — Principle 6's corollary. Drift stays where it can be explained.
- **The altitude tell is the spine, and nothing else.** A project and a bet are the *same
  object* — a thing you pick up and drop on a column of time — differing only in scope, so
  they may differ only in **weight**. A project is **marked**: a 3px rounded spine inset
  from the card's ends, the bar it occupies on the grid. A bet is **bounded**: the same
  colour at 5px, square, full-height, so the mark becomes the card's left edge. Everything
  else is identical. *Scope reads as mass.*

  Two tells were tried and rejected on the way, both wrong in the same direction — they
  made altitude a difference in **kind**, so a bet read as a different species rather than
  a bigger sibling: a **serif** name (altitude as a font choice, an arbitrary signal a
  reader can't decode) and an **enclosed** card (domain-tinted border + wash — a different
  silhouette). Recorded so neither comes back.

**Shipping stays reachable** from right-click ("Ship it…") and the record, and still derives
on its own once every task is done — so removing the check cost an act nothing, and bought
the card's left edge. *Status: standing.*

**D-049 · 2026-07-28 · A planner grid fills its pane.** The deck's sprint/quarter columns
were short stubs in a tall pane. That, not the coverage strip, was what made On Deck feel
out of balance: with no structure running down beside it, the coverage strip's label gutter
read as a *hole* in the middle of the page rather than the grid's own margin. Columns now
`flex-1` to the floor (the design language's "grid views go single-plane, full-height" rule),
the gutter is as narrow as the domain names allow with its labels right-aligned against the
grid, and column widths were cut so the **whole horizon fits without scrolling** — a deck
that exists to show you a collision three weeks out shouldn't hide week four. Coverage kept
all of its information and lost weight instead: micro labels, tighter rows, and unlit cells
at ~half their old contrast, because empty cells are always the majority and at full
contrast a block of *nothing* out-shouts the cards. *Status: standing.*

**D-050 · 2026-07-29 · The record is a document with one spine, and the rail is
annotation.** Both records (`src/components/record/RecordModal.tsx`) are now one skeleton —
identity → the work → the Log, with a rail of standing beside it — because a project and a
bet are the same object at two clock speeds (D-048) and may differ in what fills the slots,
never in their frame. The sheet's own left edge carries the altitude tell: a project wears
DeckCard's 3px inset spine, a bet the same colour at 5px full-height. What changed and why:

- **One spine.** Every control hangs in a 26px gutter, so the section label, every row and
  every composer share one left edge. Previously the label, the composer's box padding and
  the checkbox each started at a different x — three ragged left edges, which was most of
  what read as *disjointed*.
- **One input idiom.** Tasks, key results, projects and the Log compose through the same
  hairline row with a glyph in the gutter. There were three (a raised card, a bordered row,
  a filled box) stacked in one column.
- **The rule under each heading IS the meter**, and it retires the 54px ring. The ring was a
  second hero beside the masthead, and it meant two different things — ticked tasks for a
  project, KR attainment for a bet, silently falling back to child progress with no KRs. An
  undisclosed basis switch is Principle 6.
- **Placement, not dates.** `start ▸ … → target ▸ …` in a muted strip was the only thing
  deciding which sprint column a project occupies on On Deck, set smaller than a task's
  duration. **D-030's sprint-centric record editing finally exists on desktop**: both shells
  now wear `record/PlacementBand.tsx`, hoisted out of the phone's detail sheet, writing
  through `sprintSpanFor` (D-032).
- **Weight follows importance.** Every enclosure and every saturated colour had ended up in
  the rail — four bordered sprint chips with an accent fill, a dashed ghost button, a
  bordered stepper, a coloured badge — while the work was hairlines and muted 13px. The eye
  went right, to the auxiliary half. The rail is now borderless, fill-less and chroma-less
  and rests at 78% opacity; the only saturated thing on the sheet is the section meter and a
  ticked checkbox. The sprint scale became a **hairline track with the span filled**, which
  is also the truer drawing — on On Deck it *is* a bar across columns of time.
- **The composer moved below the rows** it feeds, and stays on top (autofocused) only while
  the list is empty. Composer-first was built for scaffolding a new project and still wins
  there, but on a populated record it meant the column opened on an empty box with the work
  buried third. `t` reaches it in one keystroke instead of a slot in the hierarchy.
- **The footer is gone.** `esc`, the scrim and ✕ all close, so a mulberry *Done* was the
  loudest element on a sheet where `--accent` means *your intent*. Delete and status moved
  into the ··· overflow, where a destructive act belongs.
- **Prose became visuals**: readiness reads as ticks against two named axes instead of a
  sentence (the finish line isn't among them — the placement band right above says whether
  one is set, and a thing is named once, D-041); "Belongs here" is a count, a title and a
  ＋; the runway lost its caption.

→ Consequence: `TaskList` gains a `spine` layout and optional `keyboardNav`; `DeckCard` is
reused for the projects feeding a bet, so the record shows the same object as the deck
behind it. **Rejected: `⌥↑/⌥↓` reorder** — `tasks` has no sort column, so there is nothing to
write; adding one is a migration, not a keybinding. *Status: standing — driven in the dev
app against real records at 1500px and 375px.*

**D-051 · 2026-07-29 · A surface that owns the screen suppresses the hotkeys behind it.**
Two global bindings steered the floor *behind* an open record: `⌘↑/⌘↓` travelled a rung you
couldn't see (`AppShell.tsx`), and `↵` opened the *selected task* from the left rail and
navigated straight over the record you were reading (`Planner.tsx` — `anyModalOpen` listed
every other modal but not the two record overlays). Both are now gated on an open overlay;
`⌘[` stays live because it is a legitimate way *out* of one. Relatedly, **a field owns
Escape first**: the record's handler listened in capture phase without checking the target,
so Escape in the task composer cleared your draft *and* closed the whole record. Leaving a
field and leaving the record are now two presses, as everywhere else. *Status: standing —
both reproduced and re-verified in the dev app.*

**D-052 · 2026-07-29 · The spine collapses to iconography, and the altitude glyphs live
in exactly one file.** The spine now has two widths — 188px named, 64px railed (⌘\, the
footer control, persisted) — with focus mode (⌘.) still the third state that shuts it
entirely. Railed, readiness survives the narrowing rather than being dropped: the cue
becomes a dot on the glyph's shoulder, the meter a hairline underscore, and the label
comes back as a glass flyout on hover. What made this worth a decision is what the audit
found on the way: **the same four things were being drawn four different ways** — `▦ ▤ ◆ ❖`
in the phone's bottom bar, `✓ ◆ ▲ ❖` in the command palette, `◆ ▸ ·` in the domain's
mis-filed list, ordinals in the spine. `src/components/icons.tsx` is now the only place
they're drawn, and every surface imports from it. Rejected along the way: a **calendar
glyph carrying today's date** for the Schedule rung — the date is already on that screen
twice, it would be the one glyph carrying text and changing daily (so the eye lands there
first), and 8px numerals inside a 19px frame are mush at 1×. Also rejected: a *summit* for
Domains (collides with the Summit ritual) and *pillars* (reads as a bar chart).
*Status: standing — typechecked, built, 74 tests green, driven in the dev app on both
widths, in paper/flat/terminal skins, light and dark, and at a 375px layout with no
horizontal overflow.*

**D-053 · 2026-07-29 · "Chapel" is retired vocabulary.** The entered single-domain view
was called *the chapel* in comments, in `DomainFloor`'s component name, in the marketing
visual, and in six docs — including `CLAUDE.md` and `design-language.md`, which is exactly
why it kept coming back into conversation. It never reached a user's screen, but house
vocabulary becomes product vocabulary, so it's gone: the two halves of the Domain floor
are **the wall** and **the open domain** (`DomainDetail`, `DomainFloorVisual`). The
ceremonial *register* — Fraunces, vows as inscriptions — is unchanged; it just isn't named
after a building any more. *Status: standing — zero occurrences left in `src/`, `docs/`,
`supabase/`, `marketing/`, or `CLAUDE.md`.*

**D-054 · 2026-07-29 · Late tells once, as a number — and the week's door wears one
shape.** Held against a real Wednesday, the Schedule rail answered *what's late* louder
than **D1** (*"what's the one thing today that actually matters?"*), which is the question
it exists for. A single row could spend `--signal` five times (title tint, the word
"overdue", the `↻Nd` bordered chip, the `⚑` deadline flag, the date label), and
`dateLabel === "today"` was tinted **unconditionally** — so a perfectly healthy task
planned for today wore the same alarm as one three hours late. That is Principle 4's named
violation verbatim, *"red-alert styling appears for a non-urgent state,"* and it had gone
unnoticed for the reason the principles file warns about: nobody wrote the rule down at the
grain where it broke. So, written down:

- **At most one `--signal` item per row, and it is a number, not a word.** An overdue row
  spends it on the time it was for (`6:15 AM`). The title keeps its ink — a late title is
  still just a title. The word "overdue" comes off the row entirely: the group label says
  it once (D-041's "the week is named once", applied to a state instead of a date).
- **The group earns the label; the label states a fact.** *"Needs you"* → **Overdue**, the
  glossary's own term. One word, and it addresses the work rather than the reader.
- **A label must say how far it reaches.** First pass shipped `Overdue` above an
  *unlabeled* sibling list, and it read as a claim about the whole panel — every row below
  looked overdue. A label over an unlabeled sibling always over-claims. The fix costs no
  extra words: the **count** sits beside the label (`OVERDUE 3`) and a single
  `--line-strong` hairline **closes** the zone (the last row inside gives up its own
  `border-b` to `last:border-b-0`, so it's one line, not two). That's the rail's second
  and last zone divider — intent · decide · execute — and the reason it earns `--line-strong`
  rather than another hairline is that it marks a change in *what the rows want from you*.
- **`pinned` is overdue-only.** It also caught `roll_count > 0 && !start_time`, which put
  work that was merely *old* under a label about being *late* — the label lied (Principle
  6). A rolled task dated today is today's plan; its `↻N` rides the gutter.
- **Roll count is history, not urgency.** `RollBadge` loses its square `--signal` border
  and becomes a bare muted `↻N`. It was the loudest thing in the rail, on work whose only
  crime was being old. So does `PriorityRow`'s `wk N` carry marker.
- **Calm comes from UNIFORMITY, not from showing less — this is the whole finding.** Three
  shapes were tried in one day: a two-line row with a right gutter of free text, then a
  two-line row with chips on line 2, and finally **one line, one height, one order** —
  `title … state · weight · ⟨area⟩`, every row 44px, no exceptions. Only the third one
  reads calm, and the reason is measurable rather than aesthetic: the two-line versions put
  6 tasks at **11 eye stops across 3 different indents** (some rows one line, some two, the
  area chip landing at x=223 on one row and x=496 on the next). One line is 6 tasks at 6
  stops in 1 column. **The reference list we kept losing to shows *more* metadata than we
  did and still reads quieter, because every row of it is identical in shape.** The lesson
  generalises: before cutting information from a dense surface, check whether the surface is
  *ragged*. Ragged reads as noise no matter how little is on it, and tidy reads as calm even
  when it's full.
- **The title truncates, and that's the right price.** Two-line rows were chosen earlier
  specifically to protect title width at a 360px rail — and that protection was what blocked
  the calm. A title you can open beats a column you can't scan; the reference list truncates
  hard and is liked anyway. `title` attributes and the record carry the full text.
- **A row states three facts: where it belongs, how long it takes, and — only when
  abnormal — what state it's in.** Enclosure goes to the one *categorical* fact (the area
  chip); the numerics stay plain right-aligned text, because a number doesn't need a
  boundary — it aligns. Chipping the numerics too is how you get the wall of chips this
  avoids. Cut in the process: user labels off the row (they fall back into the area slot
  when a task has no project or domain, so nothing uncategorised goes mute), the recurrence
  glyph, and the second line itself.
- **A chip spends its hue once.** First chip pass used the domain colour for *both* the
  ground and the label, at medium weight — two colour signals stacked on the quietest line
  of the row, which is how a chip meant to whisper identity ended up dominating the surface
  (the exact complaint that started this). Fixed: the ground carries the hue at a **9%
  wash**, and the text is that hue **pulled 55% of the way to `--muted`** at normal weight.
  Still unmistakably Frontier-vs-SCE, at a fraction of the ink — 4.57:1 against the paper,
  *better* than `--muted`'s own 3.7:1 house baseline. Weight is a neutral chip: the hue on
  that line means *place*, so a coloured "30m" would claim to be one.
- **No clock time on the row.** `6:15 AM` was the gutter's first fact, and on the Schedule
  the calendar sits inches away rendering the very same block — design-language's own rule
  3 already kills a list that restates the calendar. Overdue rows say **how far gone** they
  are instead (`fmtLateness` in `lib/dates.ts`, beside `isOverdue`/`endOf` so they can't
  drift): "2d late" is the fact you decide on, where "10:45 AM" makes you do the
  subtraction. This is also the competitor's idiom ("48d ago") and it's better than ours was.
- **`D-050`'s no-chroma rule does not reach here.** It governs the **record modal's**
  annotation rail, where a scale of four bordered chips with one accent-filled was the
  loudest thing in the column. It was mis-cited to flatten this row's chips; a single
  low-wash identity chip on a task row is a different object on a different surface.
- **The week's plan is a *key* entry, so its door can't be the quietest thing on screen.**
  In `view` mode it was 9.5px muted `open ▸` while `plan` and `review` got real pills. Now
  all three modes wear the same accent-soft pill in the same position; only the verb
  changes (`Plan the week` · `The plan ▸` · `Review`). The state changes the word, never
  the weight.

**D-054a · same day · weight, not size — and hover was a no-op.** Held against the
running app once the shape was right, the rows still felt un-actionable, and the reason
measured out rather than being a matter of taste:

- **The title had a 2.5px size gap and a ZERO weight gap over the metadata annotating
  it** — both were 400 — while the chips carry fills, so 10.5px chip text had visual mass
  that unfilled 13px title text didn't. The title barely outranked its own footnotes.
  **Weight carries the hierarchy, not size** — and the resolved title goes the *opposite*
  way from the obvious fix: **down** a size step (13 → 12, `text-caption`) and **up** a
  weight step (400 → 500). 14px and 15px were both driven against real data and read as
  overcompensation; they bought less than the weight step and cost real title characters.
  12/500 lands calmer than 13/500 *and* truncates less than 13/400 ever did — a title that
  fits is worth more than a title that shouts. **Contrast was never the lever** and
  is worth recording so nobody tries it: the title is already 15.29:1 against the paper
  out of a possible 18.62:1, so darkening is spent. Tracking is already negative
  (−0.078px) and tightening further hurts legibility at 13px.
- **Hover and selection were literal no-ops in the rail.** Rows were `hover:bg-bg` /
  `selected:bg-bg`, but the rail is transparent — its rows already sit *on* `--bg`.
  Measured: canvas 0.8808 luminance, hover target 0.8808. Nothing happened on either.
  The first fix then **overshot** — a full `bg-surface` row is a **+11.6%** luminance jump,
  which reads as the row *lighting up* rather than answering the pointer. Settled on
  `.row-hover`: a **wash** at 40% of `--surface`, **+4.6%** — perceptible, not loud, and it
  leaves `.glass-lift-row` as the louder focal state, which is the right order. Focus
  **lifts** rather than gaining a flat ring, per the house idiom.
  Two lessons worth keeping. **On a transparent surface, a `bg-*` hover must be measured
  against what the row actually sits on**, not against `--surface`'s neighbours in the token
  list. And **use a fraction of a token, not the next token along**: `--surface-2` looked
  like the obvious subtler pick (+4.9% in light) but the surface ramp **inverts between
  themes** — light is `bg < surface-2 < surface`, dark is `bg < surface < surface-2` — so it
  would read subtle in light and loud in dark. A percentage of `--surface` is a partial step
  toward whatever that theme's raised surface is, so it stays a whisper in both. (Relative-
  to-paper percentages are meaningless in dark, where the paper is near-black — compare
  absolute steps there, not ratios.)
- **The inbox wears the same row now.** A grooming guess had its own silhouette — a
  small-caps parent eyebrow, a third line for energy + estimate, `items-start`, 67px — so
  the inbox mixed 44px and 67px rows and was exactly as ragged as Today had been. A guess
  is still obvious, but through the thing that actually differs: it carries **Accept / ✕**.
  The suggested parent takes the area chip in its own hue (a proposal still reads as a
  proposal), the estimate takes the weight slot, and the energy read survives in the row's
  tooltip. *Uniformity is the rule, so it has to hold on every tab — not just the one you
  were looking at.*

Also fixed in the same pass: the **double hairline** under the list (every `TaskRow` had
`border-b` with no last-child suppression, and the done group added its own `border-t` 4px
below it), and the tab strip's discontinuous baseline. *Deliberately not done:* the type
scale. Readability at 10.5/9.5px is a real complaint and it deserves its own pass against
a running app, not a ride-along. *Status: standing — typechecked, built, driven in the dev
app at 240 / 360px rail widths and at 375px mobile with no horizontal overflow; verified in
the DOM that no row title resolves to `--signal` and that healthy rows resolve zero signal
items.*

**D-055 · 2026-07-29 · Creating a thing wears the same frame as owning it.** A project had
**three** create surfaces and a fourth appearance once it existed: `QuickCreate` (a bordered
form — eyebrow + instructional headline, a pill row per domain, a boxed name field with a
flat 3px focus ring, hardcoded px type), `NewProject` / `NewInitiative` (a "full moment"
with a borderless composer, dropdown chips and an auto-firing AI draft), a `more options…`
fork between them, and then `RecordModal` — a document with a Fraunces masthead on one 26px
spine. **The object changed typeface at birth**, and the fork silently discarded every
subtask already typed (it carried only domain / initiative / name across).

- **A different *layout* for creating is correct; a different *grammar* is not.** Create is
  one field and a commit; a record is accumulated state. Nobody good makes create a clone of
  the record — Linear's new-issue dialog isn't its issue view. But both must be the same
  object, drawn the same way, or committing hands you a stranger.
- **So the frame is now shared code, not a convention.** `record/recordFrame.tsx` owns
  `Sheet · Head · Body · Sec · RailSec · ReadyTicks` + the Escape/Tab/focus contract;
  `RecordModal` and the new `floors/CreateRecord.tsx` both import it. A convention that
  lives in two files has already drifted — this is the same reasoning as the planning
  kernel, applied to layout.
- **Commit should be visually inert.** Press Create and the sheet you're looking at becomes
  the record: name in the same place, tasks on the same spine, the draft rows already
  wearing the unchecked box they'll have a second later. Continuity across birth is the
  whole point, and it's what makes the create sheet worth building this way.
- **Create earns exactly three things the record doesn't.** (1) A footer with **one**
  commit — the record has none because `esc` / `✕` / the scrim all close it, so a "Done"
  button was the loudest thing on the sheet; here the commit *is* the surface. (2) One
  placement band, which now drives a **draft** through the same `sprintSpanFor` /
  `quarterEndISO` kernel (`onPlace`), so a tap here and a drop on On Deck place a thing
  identically (D-032 holds). (3) Readiness ticks you watch fill in as you type.
- **The AI scaffold survives, opt-in.** `NewProject` fired `scaffoldDraft` on a 1500ms
  debounce as you typed — a cold AI list at the front door. It's now a `✦ Draft the first
  steps` button, disabled until there's a name worth thinking about. The human drives;
  Nuvo enriches.
- **Only a placement the human *chose* puts the thing in motion.** An initiative still
  pre-fills quarter-end (a bet without a finish line is a wish), but a pre-filled default
  must not claim `in_progress` — that's tracked separately from the dates.
- **`nuvo-inline-input` now reaches the record's own composers.** A global
  `input:focus { box-shadow: 0 0 0 3px }` was painting the flat ring the design language
  forbids onto every borderless field on the spine — including `TaskList`'s, where the card
  around it already lifts. Fixing create meant either copying the violation or diverging,
  so it's fixed in both.

*Status: standing — typechecked, built, and driven in the dev app: both variants opened from
the rail's `＋ project` / `＋ initiative` and the `P` / `I` hotkeys, tasks composed with `⏎`
(duration token parsed off the title), a draft placed on Sprint 32 through the band, the
draft discarded on `esc` with nothing written, compared side-by-side against a live project
record, and verified at a sub-`lg` width where the rail stacks — zero overflow from the
sheet. Deliberately not created: a real row, so no test data landed in the account.*

**D-057 · 2026-07-30 · The marketing site speaks to the person's situation, not to a
segment — and a domain is called a "life" outside the app, "domain" inside, and nothing
else.**

**The rejected idea first, because it's the one that keeps coming back.** The proposal was
a rotating identity card in the hero: *"The todo app for Solopreneurs / Business Owners /
Renaissance / Overemployed."* Three reasons it dies:

1. **"Todo app" caps the claim at the ceiling this product exists to break.** The task
   minimalist is an *anti-persona* ([`personas.md`](./personas.md) §4 — "Things 3 is better
   at this and cheaper"), and the category carries a one-time-$50 price expectation against
   a $29/mo subscription. The whole pitch is altitude: a todo app can't tell you a project
   is behind.
2. **The four labels aren't one kind of thing**, so the rotation breaks. Solopreneur and
   business owner are *business structure* (and half of P1 is employed); Renaissance is
   aspiration; Overemployed is a **covert** subculture whose members do not want a public
   brand pillar. A rotating slot only works when the reader perceives interchangeable
   contents.
3. **P1 has no name for itself.** "Multi-domain operator" is a doc word nobody has typed
   into a search box. That absence isn't a gap to paper over with a borrowed label — it
   means **identity is the wrong axis**, and situation is the right one. People recognize
   their life faster than their label.

**What shipped instead.** `You live more than one life. One system should hold all of them.`
Beat one is recognition with no jargon and no label to accept; beat two is the promise.
*Hold*, deliberately not *keep up* — the itch is an **incomplete** system (a five-tool stack
that holds the paid work well and everything else badly), not a slow one, and keeping up is
table stakes every competitor already meets. "System" is insider vocabulary and that is
*correct here*: this buyer has an Akiflow + Notion + four-calendars stack and calls it "my
system" out loud. **`Your system should keep up` survives as the OG/social title**, where
the job is earning a click rather than making a claim — and where it was observed landing.

**The naming consequence, which is the load-bearing half.** "Lives" would have been the
**third** name for one concept: the site said *worlds*, the app says *domains*. That's
P11 — an overlapping name — and the collision was one line deep, since the subhead directly
under the hero read *"every world you run."* Resolved at **two** names, not three:

| Where | Word | Why |
|---|---|---|
| Marketing (nuvo.day) | **life / lives** | A cold reader has no word for themselves and doesn't know what a "domain" is. |
| The app, code, every doc | **domain** | Unchanged. No app surface says "life." |
| Anywhere | ~~world~~ | Retired. It was a marketing-only invention that was vaguer than both. |

Swept from `marketing/src` **including the identifiers** — `WorldsVisual` → `LivesVisual`,
`.worlds-*` → `.lives-*`, the row field `world` → `life` — because a stale identifier is
exactly how a retired word gets back into copy ([[nuvo-banned-vocabulary]]'s lesson, D-053).

*Status: standing — typechecked and driven in the running marketing dev server at 1440×900
and 375px; hero, the plane diagram, the domain-floor section, the author line and the
closing CTA all read in the new vocabulary, with no horizontal overflow at 375. Not changed:
`HOME_TITLE` / `HOME_DESC` in `routes.ts` (already said "life"), and the prerenderer, which
swaps `<title>`/description/canonical per route but leaves `og:*` at the homepage's values —
a pre-existing limitation, not a regression.*

### Tenancy

**D-024 · 2026-07-25 · Nuvo is a multi-tenant product.** Many independent operators, one
deployment, each account isolated by RLS on `user_id`. → The data model already supports
this; the *product* doesn't yet ([`overview.md`](./overview.md) §5, "Tenancy state").
Consequences we're accepting:

- **Defaults become product decisions.** The new-user trigger's four seeded domains
  (Work / Church / Trading / Family) stopped being a convenience and became a claim about
  the user's life. **Resolved in D-026** — signup now seeds none.
- **Timezone and working hours can't be assumed.** Rollover is scheduled against
  America/Los_Angeles; 480/990 working hours are one operator's day.
- **Signup stays open**, which reverses the "disable signups after your account exists"
  guidance in the root `readme.md` — that guidance now describes a *personal deployment*,
  not the product.
- **Cold start becomes load-bearing.** Principle 7 was always true; multi-tenancy makes it
  the difference between a product and a personal tool, because the builder's account is
  never empty and so day-one breakage is invisible to the only person testing.
- **Aggregate signals become available and necessary** ([`overview.md`](./overview.md) §6) —
  internal only, never surfaced to operators (Principles 4 and 9).

*Status: standing — the direction. Implementation is unbuilt; see
[`roadmap.md`](./roadmap.md).*

**D-029 · 2026-07-26 · Nuvo is a paid subscription** — 14-day no-card trial, then $29/mo
or $19/mo annual, per account (`supabase/functions/stripe-*`, migration 41,
`docs/billing-setup.md`). Everyone goes through the same trial/paywall, including the
builder — no founder override. → Multi-tenancy stops being a direction and becomes the
business model; **each account is a paying customer, so every Principle 16 default is now
a revenue-affecting bug, not a tidiness issue.** Signups must stay open (this reverses the
old personal-deployment guidance). Aggregate signals in [`overview.md`](./overview.md) §6
gain a real use: activation and second-week are now trial-conversion inputs.
*Status: standing — decided on master, recorded here after the fact.*

**D-025 · 2026-07-25 · Persona zero is evidence, not the definition.** The builder is a
verified instance of P1, cited as ⓞ; the archetype is what we design against.
→ Instance-level details are examples, never defaults (Principle 16). Claims marked ⓞ are
**unvalidated beyond N=1** and get tested against real operators two and three.
*Status: standing.*

**D-026 · 2026-07-25 · Signup seeds no domains; the account names its own.** *(Resolves
Q-06 → option B, "pick from kinds".)* `handle_new_user()` no longer inserts Work / Church /
Trading / Family; it seeds the settings row only (migration
`00000000000038_domain_seed.sql`). Zero domains is the client's signal to run the first-run
picker (`src/components/FirstRun.tsx`), which offers the **five domain kinds** from
[`personas.md`](./personas.md) §1 — work · community · discipline · people · stewardship —
each with examples and an editable name, plus "add your own".
→ Rejected: *start empty* (Principle 7 — the concept is too unusual to survive zero
examples, and a blank canvas is something we refuse elsewhere) and *blander defaults*
(Work / Personal / Health — the same mistake with worse names, and generic defaults are
precisely the ones nobody edits). → Consequence: the weakest moment in the product becomes
the moment that teaches what a domain is, and it teaches **by asking rather than
asserting**. Closes ledger O2, and part of O1 and O6.
*Status: standing. Migration written; **not yet applied to any project** — needs
`supabase db push`.*

**D-027 · 2026-07-25 · The register: convictions drive the product, vocabulary doesn't
gate it.** *(Resolves Q-08.)* Nuvo is built on Christian convictions about time,
responsibility, and doing work well — **and you don't have to share them to use it.**
Explicit language is out (*called · calling · what God has given you · ministry* as a
default); tangential language stays (*steward · faithful · vow · gain · discipline ·
presence · showing up*), because it carries the moral seriousness the product runs on and
is fully usable by anyone. **The excellence is the witness; the copy doesn't have to be.**
→ Applied: Domain is now *"where you've committed to show up."* Marketing lost "the
calling", "called to be faithful", and Church-as-a-default-tile. The `faithfulness()` code
identifier stays (D-007 precedent — documented drift, not a rename).
→ The test for any future copy: *would a reader who shares none of these convictions still
find this the most precise word, or would they feel addressed as an outsider?*
*Status: standing — full rule in [`brandscript.md`](./brandscript.md) §10.*

**D-028 · 2026-07-25 · The first-value moment is "capture three things and watch them land
on a real calendar."** *(Resolves Q-09.)* → Onboarding is designed backward from that
moment; anything that delays it is cut. It's also the honest one — it demonstrates the
capture→calendar path that no competitor's vertical reaches.
*Status: standing — nothing built against it yet.*

**D-030 · 2026-07-26 · The phone gets the planner decks, as decks — not as lists.**
*(Partially resolves Q-01: the strategic altitudes are on mobile, and they now* edit *.)*
The Projects and Initiatives tabs were read-only rankings; they are now the same surface
the desktop runs, **rotated into a swipe**: page one is the pool, then one page per sprint
(projects) or quarter (initiatives). Press-and-hold a card and drop it on the column strip
to time-box it — the desktop drag, on a thumb — with a tap path through the record for
every move, so nothing is drag-only (mobile golden rule #4). Editing is **sprint-centric**:
a project's record now opens on a scale of the next four sprints with its span lit across
them, not two date fields; a bet's opens on quarters with its runway counted in sprints.
Both surfaces and the desktop deck write placement through one function
(`sprintSpanFor`), so the same drop lands the same way anywhere.
→ Consequence: the pool is named **"Needs a sprint"** at the project altitude on both
shells (it read "Needs a week" on desktop while the columns said "Sprint 31" — an
overlapping name, Principle 11). → Rejected: *vertical sprint sections* (loses the time
axis, and the phone stops being the same surface) and *keeping the demand-ranked list*
(it answered Q1/Q2 but could not make the call the deck exists to make). → Watch: the
long-press threshold (260 ms) and whether one-handed reach to the strip holds up for real
thumbs. *Status: standing — built and driven at 375px in a render harness; **not yet
driven in a real account on a real phone**.*

**D-031 · 2026-07-26 · Plan the week is a phone act too — and the agent plans from the
same slate the app does.** *(Further narrows Q-01: the phone now runs the weekly ritual;
grooming — shaping a single project — is still the open half.)*
Two halves of one problem. **(a)** Asking Nuvo to "help me plan this week" produced a read
that never mentioned the projects already committed to the week — it said *"no week
priorities set yet"* while the deck held several. The cause was a model mismatch, not a
prompt gap: the app derives the week's priorities from each project's On Deck span
(`weekPushes`), while the agent could only see the sprint's `big_rocks` jsonb — which is
just the per-week **verdict** and is usually empty. The agent's context now derives the
same slate (`weekSlate`, plus `needsASprint` / `nextWeekSlate` and each slate project's
open tasks), and the priority tools move the **project**: `create_priority` with a
project_id writes its Mon–Fri span (the same write as dropping its card on this week's
column), `delete_priority` clears it, `complete_priority` can record a verdict for a slate
project that has no stored record yet. A priority written with no project is now reported
back as what it is — a note that appears on no planning surface. *Tension with D-004
(priorities bind along a crystallization line and may stay pure intention): the model still
allows an unbound priority, but every built week surface — the Priorities editor, the phone's
slate, the week's plan card — renders the derived slate, so an unbound one is invisible in
practice. The agent now says so instead of writing one silently. Where that lands for good is
[`priorities-and-projects.md`](../priorities-and-projects.md), flagged there, not decided
here.* **→ Decided 2026-07-30 in D-060: it narrows. A priority is a project.** The Week's
Plan floor — the last surface still reading `big_rocks` as a list — now derives from
`weekPushes` like everything else, and the free-text priority box is gone. **(b)** The desktop had a
weekly ritual and the phone had none, so the phone's only route into the week was the chat.
`src/components/mobile/MobilePlanWeek.tsx` runs the same act in three thumb-sized steps —
**Slate → Pull → Shape** — entered from a card at the top of the Week segment.
→ Consequence: the composer is now shared. Everything that decides *what* the week is (the
pull, standing-slot routing, project-slot clustering, `composeWeek`, the commit) moved out
of `SundayRitual` into **`useWeekDraft`**; each shell owns only its layout and gestures. Two
surfaces computing their own week would have been two answers to "what is my week" — the
exact drift (a) was caused by. → Also fixed on the way: dropping a project-slot block
removed nothing (the block id isn't a task id), and a fresh install read UI zoom as
`Number(null)` → clamped to **0.8**, rendering the whole app at 80% on any new device.
→ Rejected: a phone port of the week *grid* (a seven-column time grid can't be tapped at
375px; the day-by-day list is the same information at thumb scale) and teaching the agent to
write `big_rocks` more cleverly (it would still be writing to a surface nobody reads).
*Status: standing — typechecks, builds, and driven at 375px in a render harness
(`?planweek`); **not yet driven in a real account**, so W1/W2 stay scored as they were.*

**D-032 · 2026-07-26 · Planning rules have exactly one implementation, and a test that fails
when a second appears.** The app and the agent run in different runtimes over the same data,
and every rule we wrote twice drifted: the agent read `big_rocks` while the UI derived the
slate from spans (D-031), and `planningWeekStart` shifted Saturday to next Monday in the app
but to *this* Monday on the server — so on Saturdays the two planned **different weeks**. None
of it failed a typecheck, a build, or a review; both surfaces just answered confidently and
differently. → The week's rules now live in a dependency-free kernel
(`supabase/functions/_shared/planningRules.ts`) imported by both; writes share the **act** as a
returned *patch* (`bringIntoWeekPatch` / `takeOffWeekPatch`) that each runtime applies with its
own client, so a tap and a chat message place a project identically;
`tests/planning-kernel.test.ts` holds it three ways — agreement (client derivation vs the
agent's, over one fixture set in both shapes), behavior (the weekend rule, shipped-inside-the-week,
the Sunday-boundary leak), and a **drift guard** that scans the tree and fails if any file
outside the kernel defines a rule it owns. CI runs it on every push
(`.github/workflows/checks.yml` — the first non-release workflow; ~1 min, releases stay manual).
→ The kernel lives under `supabase/functions/_shared/` because the edge bundler only guarantees
that path, not because it is server code. → Rejected: *Postgres RPCs as the one implementation*
(genuinely single-sourced, but it moves planning logic into migrations and away from the pure
functions the UI needs synchronously — revisit if a third client appears) and *generating the
server copy from the client* (a copy with a checksum is still a copy). → **Known gap, named
rather than hidden:** `_shared/nlp.ts` is still a reduced re-implementation of `src/lib/nlp.ts`,
so the same capture parses differently in the two paths; and the composer (`composeWeek`, the
pull, calibration) is client-only, so the agent can propose a week's shape but never computes
the same one. Both are listed in [`planning-kernel.md`](../planning-kernel.md) §5.
*Status: standing — 25 conformance tests green; each guard verified by deliberately
reintroducing the drift and watching it fail.*

**D-033 · 2026-07-26 · Task duration is a preset sitting, never a free-text 20m stamp.**
Getting projects in (GroomWall, QuickCreate, `addTask`) was defaulting every step to
**20 minutes** — fiction that wrecks W1 (can I carry this week?). Duration now uses one
shared preset list (`DURATION_PRESETS`: 15 · 30 · 45 · 60 · 90 · 120 · 180 · 240) as a
dropdown chip wherever a sitting is sized; project-backed steps default to **45**
(matches `MIN_PROJECT_BLOCK`); loose/quick stays **30**. AI still *proposes* durations
on scaffold / New Project / plan-week tools (Principle 3 — human promotes); the human
edits via the same presets on the proposal and on Plan-the-week Pull (desktop + phone).
→ Closes the "duration accuracy is a grooming property" gap named in
[`priorities-and-projects.md`](../priorities-and-projects.md). → Rejected: free-text
minute fields (thumb-hostile, invites nonsense) and gating the week until every task is
groomed (Principle 7 — useful on day one). *Status: standing.*

**D-034 · 2026-07-26 · Plan the week is named after what it holds, not after our
mechanics — and both shells run the same four steps.** *(Supersedes the step names in
D-031; the shared-composer half of D-031 stands unchanged.)*

The flow spoke three vocabularies for one act: the phone stepped **Slate → Pull →
Shape**, the desktop said **"Slot the projects" → "Slot the work"** and railed its
sources as *Carrying forward · The projects · Clear the inbox*. Every one of those
verbs was ours, not the operator's — "slate", "pull" and "shape" appear nowhere else in
the product, so the flow's own navigation taught a first-time reader nothing about what
they were being asked to decide. Said out loud, the act is plain: **you're deciding on
projects, on the stuff that didn't get done, and on new captures — then when it all
happens.** → The steps are now **Projects · Leftovers · Inbox → The week**, identical on
both shells, each opening with the question it answers rather than a verb. Code names
(`suggestPull`, `PullSuggestion`, `weekSlate`, the `loose` lane key) are untouched —
documented drift, per D-007.

**Leftovers, chosen over "Loose ends", with the honesty moved into the question.** The
lane also holds work that's *due* this week and one small task per quiet domain
(`suggestPull` sources 4 and 5), neither of which is literally a leftover. Operator's
call; the mitigation is that the step asks **"What didn't get done, and what's due?"**
and labels its two groups *Carried over* and *Due, or going quiet*. Also avoids a
collision: "Loose ends" is already the name of an unrelated line on `WeekPanel`
(Principle 11).

**The funnel is drawn, not implied.** `WeekIntakeBar` (over `src/lib/intake.ts`) is one
component on both shells: the four steps as lanes with live counts, over a single
capacity track — the immovable calendar, then each source stacked on it, against
Calibration's proven pace, with the room left in `--slot` and any overrun in `--signal`.
Nuvo already *had* a funnel (inbox → backlog → Week → Day) and the weekly plan is its
gate; this just shows it. → **W1** ("can I carry this week?") is now answered *while*
you decide instead of only at the commit bar, which is where it was useless. `laneOf`
is the single lane rule — carried beats project attachment, because a slipped task is a
leftover to re-time, not a fresh push, and burying it under its project is how
carry-forward stopped being a decision.

**Four steps, but deliberately not a wizard.** The desktop's five *gated* steps were
removed once before and must not come back: every lane here is clickable at any time
(including backwards from the grid), the week is fully composed on open, and the
capacity track carries the live read on every step. That last part is what pays for
splitting the sources off the grid — you no longer need them side by side to see the
consequence of keeping something.

**Then cut the prose out of it.** A first pass named the steps well and then explained
each one in two or three sentences — instructions you learn once and re-read fifty-one
times a year. Removed: every "tap to drop anything…", "Nuvo can group like with like…",
"it rolled forward with no time yet…" and the desktop's step-of-four eyebrows (the
intake bar already says where you are). What replaced them, in order of preference:
**nothing** (an empty day strip doesn't need the word "open"; a filled readiness dot
doesn't need "ready to schedule"), then a **shape** (the phone's per-day strip draws the
working window with immovable time in `--line-strong` and placed blocks in their domain
color — the answer to "how full is Tuesday?" arrives before you read a time), then a
**glyph** (`PullKind` on `PullSuggestion` + `workBadge` turn "slipped 10× — give it a new
time" into `↻10`, with the sentence surviving as the row's `title`), then a **number**.
The capacity track animates its segments, so keeping or dropping a task *shows* what it
costs rather than saying so. The composer's per-block reasoning moved to `title` on the
phone: you want it when something looks wrong, which is not most weeks.

**Strains Principle 10** (don't add a name without paying for it): "Leftovers" is one
new user-facing name, paid for by retiring five (*Slate*, *Pull*, *Shape*, *Slot the
projects*, *Slot the work*) and by being a step rather than a pool.
→ Also fixed on the way: the `?planweek` harness crashed on open (its rows called
`useVertical` outside a provider), so the step components are now fully prop-driven;
and the phone's "group carried work into blocks" action was a 14px tap target.
→ Left open: the ceremony's *doc* name is still **Sunday** while every surface says
**Plan the week**. Flagged in [`glossary.md`](./glossary.md), not decided here.
*Status: standing — typechecks, builds, and driven at 375px and desktop density in the
`?planweek` harness; **not yet driven in a real account** (no credentials in the build
environment), so W1/W2 stay scored as they were.*

**D-035 · 2026-07-26 · Plan the week is one screen: the sources on the left, the week
on the right, always.** *(Supersedes D-034's four **pages**; D-034's step **names**,
its lane rule and its one-composer half all stand.)*

D-034's four steps were the right nouns in the wrong shape. Driven in a real account
for the first time, the flaw was structural, not cosmetic: you spent three pages
keeping work and only learned on page four that the week had no room for it. The
observed run — 5 projects on the slate, 12 pieces of their work kept — ended at
`4 scheduled · 5 with no time yet · 52 immovable`, and every one of the five that
couldn't be placed was a *project*, each reading "the week is full — slack protected."
**A planner that reveals the cost of a decision one screen after you make it is asking
you to decide blind.** → The three sources now take turns in a planner rail while the
week grid holds the right half of the screen permanently. Every keep or drop re-shapes
the grid beside your cursor. This is also the grammar the Schedule and both decks
already use (pool left → grid of time right, `design-language.md`), which the four-page
version had quietly broken.

**The phone can't hold two panes, so it holds the same fact.** `CapacityMeter` rides
under the step rail on every step and reports both what the week is being asked to
carry *and* how much of it found no room — the "5 couldn't fit" arrives while you can
still act on it. The phone keeps its fourth step (the day-by-day read); the desktop
does not need one.

**One arithmetic, one place.** The header said `19.2h of ~26.7h` while the commit bar
said `11.8h planned vs your ~23.3h/wk pace` — two loads and two budgets for one week,
on one screen. The header counted everything kept (the Week is the gate — Principle 2,
so unplaced work is still weight); the footer counted only what found a slot, against
the raw pace instead of the compose budget. The kept-work reading is the honest one and
is now the only one: `CapacityMeter` owns it, over the grid it measures, and the commit
bar carries the goal line and the click.

**Why the old bar "didn't look right", precisely.** Three compounding misreads, all
fixed: a capacity track mounted directly beneath four numbered steps reads as *step
progress*; it spanned the full width while the steps spanned half, so it belonged to
nothing; and its largest segment — time already on the calendar, at 20% ink — read as
*unfilled*, so the meter looked half-broken. It now sits over its subject, is labelled
("This week asks"), carries a legend that holds the hours rather than restating a key,
draws the pace mark always instead of only when you're past it, and paints "already
set" at 34% ink so a full week looks full.

**And the projects step lost two thirds of itself.** It was answering three questions
at three cadences: how did last week go (a **Review** question), which initiatives lead
this quarter (a **Summit** question), and what moves this week. Both strangers are gone
from the flow — nothing was moved to a new home, they already have one. What's left is
one row per project (domain dot · name · what it's asking of the week) with its work
folded underneath, opened only when you want to argue with what came along. Readiness
is now a **silence**: "ready to slot" printed on all five rows was five identical words
carrying no information, so only a *gap* speaks.

**Strains Principle 8** — the screen now shows a pool and a calendar at once, which
looks like two questions. It isn't: the question is "can I carry this week," and the
grid is the answer half. The mitigation is that the grid is never editable *as* a
source — you keep and drop in the rail, and the grid only reports.
→ Left open: the desktop's project rows expand one at a time; the phone still expands
every project's work inline (it has no hover and more vertical room). Fine for now,
worth revisiting if the phone step gets long.
*Status: standing — typechecked, `npm test` green, and **driven in a real account**:
switching lanes, and dropping one leftover moved the week 19.2h → 17.7h and
"5 couldn't fit" → 4, live. Verified at 375px (no horizontal overflow) and at 1440px.*

**D-036 · 2026-07-26 · Plan the week is a walk: one primary button that steps you
through the sources, and a week that reveals itself one source at a time.**
*(Extends D-035, same day, after driving it.)*

D-035 put the week beside the decision. Driving it showed the next thing: with the
whole week drawn from the first screen, the Projects step was *still* asking you to
judge your projects against a grid already crowded with leftovers and captures. So
the grid now reveals by source — projects land in an otherwise empty week, then
leftovers fill in around them, then the inbox — and **it accumulates, never resets**
(`REVEALED_BY_LANE`, `src/lib/intake.ts`, shared by both shells). The composer still
solves the *whole* week, so a block never jumps once you've seen it; only what's
drawn changes.

**Revealing is not hiding.** Sources you haven't reached ghost on the capacity meter
at their real width, and the hours read at the top ("19.2h of your ~26.7h pace")
stays honest from the first screen. You can always see what's still coming
(Principle 6). Arriving blocks animate down out of their start time, staggered
(`.block-in`), because "where did that go?" is a question motion answers better than
copy — information, not decoration (Principle 9).

**One primary button, and it moves you forward:** *Leftovers → · Inbox → · Commit
the week →*. A permanent "Commit the week" invited you to commit a week you'd seen a
third of, and left the forward move as a grey text link in the rail — the least
important-looking control doing the most important job. The source switch still
jumps anywhere at any time: **a walk, not a wizard.** A step-progress hairline sits
on the footer's top edge, which it can now do *precisely because* capacity moved
over the grid under its own heading — two bars, two meanings, neither able to be
mistaken for the other. That confusion is what made the old header read as broken
(D-035).

**A sitting opens.** A block that says "· 5 tasks" and nothing else is the one
moment you most want to look inside, so a click (a press that didn't move — drag is
untouched) opens what's in it. **And grouping is one act in both lanes** — carried
work was already grouped in the week it slipped out of, so re-grouping it is the
natural move, not a special case. Leftovers used to group *silently*: you pressed
it, blocks appeared somewhere, and the lane never said what it had done. Both lanes
now share `GroupButton` + `GroupedRuns`.

**Cut: the week's one-line goal.** A text box asking for a summary of decisions the
whole screen already shows, at the moment you'd finished making them. The sprint's
existing goal rides through `commit()` untouched, so nothing is lost — it just isn't
asked for. The ceremony moved to where there's actually a moment: the arrival, whose
domain bands now grow into place.

→ **Bug found and fixed on the way (pre-existing, user-visible):** the draft seeded
`kept` **once**, latching on the first non-empty pull. `useVertical` streams, so a
slow load seeded from a *partial* pull (two loose ends), latched, and never took in
the twelve pieces of project work that arrived a render later — you'd open Plan the
week to a slate with nothing kept and an empty week. Seeding is now **additive** over
an `offered` set, which is immune to arrival order; a piece you dropped is in
`offered` and never comes back on its own.
*Status: standing — typechecked, `npm test` green, driven in a real account: the
three-step walk verified end to end (33% → 67% → 100%, button `Leftovers →` →
`Inbox →` → `Commit the week →`), reveal accumulating 5 → 9 blocks, a project slot's
5 subtasks opening on click while drag still moves the block, and 375px clean.*

**D-037 · 2026-07-26 · Plan the week has one column that owns the walk, and it
starts from the empty week.** *(Extends D-035/D-036, same day, after driving them.)*

Three separate pieces of chrome were all trying to orient you at once: a step
switcher top-left, a capacity meter across the top at full width, and a walk bar
along the bottom with its own progress line. The operator's read of it was exact —
**the step row looked like tabs** (parallel, equal-weight, always-available: "pick
a view", not "you are on a journey"), **the button was diagonally opposite the
thing that said where you were**, and **the capacity bar, being the biggest element
on screen, read as the primary cue** when it is a reference.

The hierarchy was inverted. What the operator needs here, in order: *what am I
deciding* → *what is it doing to my week* → *where am I and how do I move on* →
*can I carry it* (a glance). So:

- **The rail owns the walk, top to bottom:** stepper → question → pool → the one
  primary button, in a single column. The act now sits directly under the pool it
  acts on.
- **The tab row became a connected stepper** — numbered stations joined by a rule,
  past ones checked. Every station is still one click away (a walk, not a wizard),
  but jumping now reads as the exception rather than the invitation.
- **The capacity meter moved below the grid it measures**, in a `compact` variant.
  It is a footnote to the week, not a headline over it.
- **The bottom bar is gone.** One primary control, one place.
- **The button names the act, not the destination:** *Add your projects · Add
  what's left over · Add the inbox · Commit the week*. "Projects →" said where
  you'd land and nothing about what pressing it does; each press pours one more
  source into the week, and the grid animating is that sentence finishing.

**Step 1 is now the week as it already stands** (`open`) — the immovable calendar
and the room between it, drawn as `--slot` bands with their hours. The plan used to
open with project blocks already scattered across the grid: new information
arriving before you had any frame to read it against. Now you see the empty week
first and every later step is a visible *change* to a picture you already
understand. It also does the thing that actually changes the answer: **a meeting
you aren't going to attend isn't capacity**, so you can set one aside in place. That
writes the existing `hidden_events` setting every availability path in the app
already reads — one rule, not a plan-only fiction.

**Grouping is automatic.** Pressing a button to get a proposal was busywork; the
pull, the standing-slot routing and the compose already run on open. Once it *has*
grouped, the call-to-action demotes to a quiet "↻ group again" — a filled button
offering to "Group 10 into blocks" above six blocks it just made is the screen
arguing with itself. Principle 3 is untouched: these are proposals in a quiet pool,
and nothing reaches the calendar until Commit.

→ Also: **the step lives in nav history** (`flowStep`), so browser/mouse
back-forward walks the plan instead of dropping out of it; the sitting popover
closes on any press outside it; and calendars hidden in Settings no longer appear
in the reclaim list (a 39-event week was listing 89 rows).

→ **Then the list went too.** Step 1 briefly listed all 46 of the week's
commitments in the rail so you could set one aside — the calendar restated as a
table: the same information, worse, and overwhelming enough to bury the one number
that matters. The grid already shows every meeting in its own shape and place, so
the act moved *there*: click a meeting on the week and its time turns into open
time under your cursor. A set-aside commitment stays on the grid as a faint
struck-through ghost inside the span it just opened — which is both the undo and
the explanation of why that span is free. The rail keeps two sentences: the hours
open, and how to change them.
→ **Left open — a real divergence:** the phone has no `open` step. Five stations
don't fit a 375px stepper, and its "The week" step is its own after-view. The
phone's meter and button voice now match; the before-state doesn't. Worth closing
when the phone's step rail is next touched.
*Status: standing — typechecked, `npm test` green, built, and driven in a real
account: the four-step walk verified end to end with the stepper checking off
behind you, back/forward walking steps 4→3→2→3, blur-dismiss on the sitting
popover, and 375px clean.*

**D-038 · 2026-07-27 · "No room this week" was two different problems under one
false heading — and the proven-pace ceiling is a report, not a rule.**

Driven with a real week: the plan said **8 things couldn't fit** while Thursday
morning sat visibly, completely open. Both statements were true and the screen was
still lying, because `composeWeek` has two entirely different reasons to leave work
unplaced and was reporting them under one heading:

| cause | what it means | when it fires |
|---|---|---|
| **pace** | the week fits your calendar fine; it's past what your history says you finish | *before* a slot is even looked for |
| **full** | there is genuinely nowhere to put it | after every day is tried |

Nearly everything in that list was `pace`. So `ComposeResult.unplaced` now carries
a **`kind`**, and the report is split: *"Held back to protect your pace"* (with the
plain sentence — the week has open time, this is past what you've been finishing)
and *"No open time left"*. Only the second one is `--signal`.

**And the ceiling lifted.** Nuvo reports; you decide (Principle 4). Silently
refusing to plan a week the operator can see is possible is the app overruling the
human, which is exactly what the doctrine forbids — so the pace group carries
**"there's room — place them anyway →"**, which recomposes with no budget. The cost
stays on screen the whole time: the meter keeps drawing how far past pace the week
runs, in `--signal`. (Verified: 9 scheduled · 8 held back → 17 scheduled, 5.4h past
pace, still shown.) *Calibration still owns the default — this is an override you
take deliberately, not a setting that quietly stays off.*

**Blocks say what kind of thing they are.** A "▸" and a "· 3 tasks" asked you to
learn a glyph before you could tell a project's sitting from a grouped run or an
ordinary task. Each placed container now wears its kind as an eyebrow in its own
domain colour — **PROJECT · 3 TASKS**, **GROUPED · 2 CAPTURES** — and a single task
under a project still gets the project's name, which is the useful thing there.
Blocks under ~34px stay quiet rather than truncating a label.

→ Also fixed: "X h of that you took back" summed whole set-aside events, so it
could exceed the total open hours it claimed to be a share of. A 6am meeting you
set aside gives back nothing you were ever going to plan into — it now counts only
the overlap with your working window, the same way open time does.
*Status: standing — typechecked, `npm test` green, built, and driven in a real
account.*

**D-039 · 2026-07-27 · A project that doesn't fit the week gets a remedy, not a
footnote — and it spans, it doesn't fork.**

Projects and initiatives are the things that move the needle, so *"Stampede v3 —
the week is full"* sitting in a list under the grid is the app leaving you stuck
on the one item that mattered most. Closes **W3** ("what should I drop, and what
breaks if I do?" — previously ○). Two remedies, offered **on the Projects step
while you're still choosing**, on the row itself:

- **Give it another week** — when some of it fits. The project's On Deck span
  widens by one week: this week takes what fits, the rest continues next week.
- **Move it to next week** — when none of it fits. The whole span shifts out,
  keeping how long it runs. Not dropped, not half-done: deliberately later.

**Rejected: minting a "Part 2" project.** It was the proposal on the table and
it's the wrong object. A second project with a near-identical name is an
overlapping name (Principle 11) with no outcome of its own, and it splits the
thing that makes projects worth having — one pace number, one ship, one line in
the Review — across two rows forever. **On Deck already models a project running
across weeks**; the honest answer is to use the span, and let the *sittings*
carry the part numbers (`PROJECT · PART 1 OF 2`) since a sitting is exactly the
thing there are two of.

Both remedies are **kernel patches** — `spanAnotherWeekPatch` /
`pushToNextWeekPatch` in `planningRules.ts` — so they're the same act as dragging
the project's card on On Deck, and the deck and the plan cannot disagree about
where a project lives. They're proposals with an explicit press (Principle 3);
nothing moves on its own.

→ The report under the grid no longer just names the problem: when project work
is in "No open time left" it points at the step that can resolve it.

→ **Extended 2026-07-30 (D-060): the remedies are no longer Sunday-only.** They sit on each
row of the Week's Plan mid-week too, where a week actually stops being true, sharing one
`RemedyPanel` so the wording can't drift. **W3 re-scored ✅** in the ledger, which this entry
claimed but never carried through.

*Status: standing — typechecked, 29 tests green (4 new for the span math, which is
verified in isolation rather than by mutating a real account's project dates),
built, and driven in a real account: "Only 1 of 5 pieces fit this week" with both
acts on the row.*

**D-040 · 2026-07-27 · The calendar is the constraint. The proven pace is
commentary, and a project's work is decided in one place.** *(Removes the ceiling
D-038 made lift-able; reverses the lane precedence in D-034.)*

**The pace ceiling is gone as a gate.** `composeWeek` was given
`provenPace − alreadyBlocked` as a hard budget, so it refused work once the week
passed a number the operator had **never set, never seen derived, and could not
find on any surface** — it appeared only as *"past the ~12h/wk you've actually
been finishing"* beside a visibly empty Thursday. Asked where the figure came
from, the honest answer was "a 4-week average of your completed tasks, times 1.15,
minus what's already scheduled", and the honest follow-up was: *the calendar
should be the indicator of how much time I have.* That's right. A silent refusal
is the app deciding (Principle 4), and it was deciding with a hidden model against
plain visible evidence. → Work is placed into the open time that actually exists.
**Calibration keeps its real job:** `CapacityMeter` says *"25.9h · 5.6h past your
usual 20.3h"* in `--signal` while you decide — A4 ("am I lying to myself about
this week?") answered, in words, without enforcement. The number now carries a
tooltip saying where it comes from and that nothing is refused for exceeding it.
→ Consequence: "No open time left" is now true whenever it appears; on the account
this was driven in, unplaced work went **9 → 1**, and the inbox finally found time.

**Project attachment now beats carried.** D-034 put a slipped task in Leftovers
even when it belonged to a project, reasoning it's "a leftover to re-time, not a
fresh push". Driving it showed the cost: `clusterWeek` groups a project's sittings
by `project_id` *regardless of lane*, so carried project work was already **placed
on the calendar under its project** while still being listed under Leftovers as an
undecided leftover — the same task asked about twice, the second time after it had
visibly been settled. It also made the Projects step undercount (a project showing
"3/3" that really had five pieces in the week). → `laneOf` is now inbox → project →
loose. Carry-forward doesn't go quiet: the piece keeps its `↻N` badge and wears it
under the project it belongs to, which is the altitude the decision is made at.
`themeCarried` now skips project work, or grouping would pull it back out of the
sitting it belongs to.

**A block says what it is at every size.** The kind eyebrow was suppressed under
34px, so every 45-minute sitting — most of them — lost its designation. A block
now sheds the *least recoverable thing last*: the designation survives longest,
the title next, and the time goes first, because the grid axis already says when.
Under 30px the designation moves inline before the title. (A floating label
outside the block was considered and rejected: it collides with whatever sits
above it in a dense column, and breaks under drag.)
*Status: standing — typechecked, 29 tests green, built, and driven in a real
account.*

**D-041 · 2026-07-27 · Show it; don't narrate it. Plan the week prefers a picture,
a glyph, and one name per thing.**

Held against a real week, the flow was still asking to be *read*. Four cuts, one
rule: **if the answer is visual, draw it.**

- **Step 1's rail is a picture.** Two sentences of prose plus a three-line
  instruction, to answer a question that is entirely visual — *here's your free
  time, does that look right?* Replaced with five bars, one per working day,
  committed against open, plus the hours and a single glyph line for the gesture.
- **Meetings are solid; open time is empty.** They sat at 5–9% ink with a 9%
  `--slot` wash beside them — the same weight, so the week was unreadable *before
  anything of yours was on it*. A meeting is a fact you arrived with, so it's drawn
  like one (16% ink, a real edge). Open time is the **absence** of one, so it has
  **no fill at all** — one `--slot` bracket and its size. Any fill makes absence
  compete with presence.
- **The week is named once.** "Week of Jul 27" appeared in the header, the rail's
  eyebrow *and* the rail's hero — three labels for one date. The hero keeps it.
- **Glyphs over instructions.** Boundaries said "click to adjust"; it now shows a
  `▾`. The grid's legend row ("✦ placed for you · immovable · drag to move · hover
  to drop") is gone entirely — every block now names its own kind, so the key was
  restating what the blocks already say.

**And one name per thing:** "Grouped" was a fourth vocabulary for a **Slot** (the
glossary's word for a container of time on the grid that holds child tasks).
Renamed throughout; loose work says `TASK`, so `PROJECT · 3 TASKS`, `SLOT · 2
CAPTURES` and `TASK` read as one language.
→ Fixed on the way: two eyebrow renderers had drifted apart, so blocks between 30
and 34px showed neither the eyebrow nor the inline label — the designation
vanished at exactly the size most 45-minute sittings land on.
*Status: standing — typechecked, 29 tests green, built, driven in a real account.*

**D-042 · 2026-07-27 · Lanes are arithmetic; steps are the walk. Leftovers and
Inbox become one step, "Carried", and are slotted as one pool.**
*(Supersedes the four-step shape in D-034/D-037 and the name "Leftovers".)*

The two steps were one decision wearing two hats. **A carried task *was* an inbox
capture once** — the difference is provenance, not kind — and at slotting time
they're identical: small loose things that need a home. Because each step themed
its *own* pool, a "Frontier" leftover and a "Frontier" capture came back as **two
different slots**: the AI never saw them together and had no way to know they
belonged in one sitting.

→ One step (**The rest** — *"What else is the week carrying?"*), one pool, **one**
slotting pass (`slotLooseWork`). Provenance still shows, as sections *inside* the
decision — *Carried over · Due, or going quiet · New captures* — rather than as
two stops on the walk. The plan is now three steps: **Open time · Projects · The
rest.**

**Named by exclusion, after two failures.** "Leftovers" and then "Carried" were
both tried and both rejected for the same reason: each describes *one* of the four
things in the bucket and is plainly false of the others — a capture that arrived
this morning is neither left over nor carried. **A category named for its members
will always be wrong about most of them**, so this one is named for what it isn't.

**The lane/step split is the load-bearing idea.** They used to be the same list,
which is what forced the false separation. The capacity meter keeps three lanes
(projects · carried · new) because *where the week's weight came from* is worth
seeing; the walk has one step for two of them. `STEP_LANES` maps between them.

**"Leftovers" is retired** (operator's call — it was only ever true of the first
of the four things in the bucket). "Carrying" is honest for all four: you carry
what slipped, what's due, what's gone quiet, *and* what came in.
→ **Fixed alongside: the flow could not be closed.** `closeFlow` assumed
`flowStep` counted the history entries a flow had pushed — true for a gated wizard
you walk one step at a time, false the moment a flow lets you *jump* between steps
(clicking step 3 from step 1 is one push but sets `flowStep` to 2, so closing
tried to unwind three entries, sailed past the app, and left the flow open with no
way out). It now remembers the stack index the flow opened at; the step index
isn't a count of anything.
*Status: standing — typechecked, 32 tests green, built, and driven in a real
account: 9 slots from one pass, Clearstream no longer split across two, and Esc
verified to close from a jumped-to last step.*

**D-043 · 2026-07-27 · The calendar leads on step 1 and recedes after — and a
button completes the step you're on, not the next one.**

**Emphasis follows the subject.** Meetings were drawn at one weight on every
step, which is wrong at both ends: on step 1 the calendar *is* the subject — the
whole act is saying which of these you're actually going to — and everywhere
after, your work is the subject and the calendar is context. So step 1 draws them
at full strength (24% ink, a real edge, ink text, a lift on hover, `.ev-toggle`)
and every later step fades them to 7%. **And the toggle state is a mark, not an
inference:** `✓` counts against your week, a dashed empty box + *open* means set
aside. A strikethrough was asking you to read the *absence* of something.

**The CTA completes the current step.** It said *"Add your projects"* on the
open-time step — naming what the *next screen* does. Standing on step 1 you
aren't adding projects; you're agreeing this is the room the week really has, and
a button that narrates somewhere else gives you nothing to decide against. Now:
*"That's my open time" · "That's what I'm moving" · "Commit the week"*, with the
destination as a quiet line beneath (`next · Projects`) — a **name**, not a step
number, because the stepper already owns the counting.
*Status: standing — typechecked, 32 tests green, built, driven in a real account.*

**D-044 · 2026-07-28 · The mobile Calendar gets a Day lens — proportional time
beside the list, never instead of it.** *(The D-031 rejection stands and is
narrower than it reads: what was rejected was the seven-column **week** grid,
which can't be tapped at 375px. One column of one day is exactly what a phone
holds — and it was the one projection the phone lacked: the desktop Schedule
renders time as space; the phone had flattened it to text.)*

The operator's ask, verbatim: the list is good, *but blocks of time show how
long each event is instantly.* Duration-as-area is read preattentively;
duration-as-text is arithmetic. The two lenses answer differently — **List**
answers *"what's coming, and when am I free"* across two weeks; **Day** answers
*"what is this day's shape"* — so neither replaces the other:

- **They coexist behind the calendar view-pill** (List | Day) in the drill-in
  header; the month grid stays home, and a month tap opens whichever lens you
  used last. A lens, not a place — the bottom bar is untouched (Principle 10).
- **One computation, two projections.** Both render `buildDayPlan` (now
  `dayPlan.ts`), so the Day lens's `--slot` brackets are the *same* gaps the
  list prints as Free chips, sized (`readDay`), and the header readout is one
  shared `dayReadout` — the lenses cannot disagree about a day.
- **Traversal is the planner grammar** (design-language, planner rule 6 — the
  horizontal axis pages through time): swipe left/right walks a day, the date
  strip jumps anywhere (and holds still within a week), a pinned **Today**
  chip returns. Vertical scroll is deliberately *kept* across swipes so days
  compare at the same hour. Switching List → Day hands over the day you were
  scrolled to, not the anchor.
- **Open time is drawn, not narrated** (D-041): no fill, one `--slot` bracket
  and its size. Now is the `--signal` line. Blocks speak the list's vocabulary
  at scale — accent = yours, neutral = events, `▸` + edge = project-backed,
  struck = done. 30 min = 44px, so an ordinary block IS a tap target.

→ Rejected: *replacing the list* (it answers a question the grid can't at a
glance, and the two-lens pairing is the proven shape everywhere else); *a
third navigation destination* (Principle 10 — it's a lens, not a place); and
*mounting FullCalendar on mobile* (the desktop dependency stays desktop-only;
the lens is a few hundred lines of absolute positioning over the shared plan).
→ Strains **Principle 8** (one surface, now three lenses): named and accepted —
the surface's question is unchanged (*what is my day, and where is it open*),
the lenses are projections of one answer, and the pill is the one control.
D3's *read* strengthens (a 40-minute window is now visibly 40 minutes) but its
score stays ◐ — gap→task matching is still manual.
*Status: standing — typechecked, 51 tests green, built, and driven in the
`?daycal` fixture harness at 375px, light + dark: proportionality (30m = 44px,
90m = 132px), overlap columns, gap brackets agreeing with the list's Free
chips, tap→sheet wiring, chip traversal with the strip holding still. **Not
yet driven in a real account** (no credentials in this build environment).*

**D-045 · 2026-07-28 · "Week starts on" is a display preference, honored
everywhere, and it defaults to Sunday.** The operator opened the phone's month
grid and read Monday in the first column. The bug underneath was not the day
order: `MobileCalendar` hardcoded `weekStartsOn: 1` while a **Week starts on**
setting already existed and already described itself as *"the first column of
the week and month views."* The desktop calendar honored it; the phone silently
didn't. A setting that one shell obeys and the other ignores is worse than no
setting — it teaches the operator their preference doesn't hold.

- **One reader, one fallback.** `firstDayOfWeek(settings)` in `useSettings.ts`
  is the only place `week_start` is turned into a `weekStartsOn`. The four call
  sites (mobile month grid, the Day lens's date strip, `CalendarPane`'s
  `firstDay`, `useCapacity`'s week columns) had each invented their own
  loading-state fallback — `?? 0`, `?? 1`, `=== 0 ? 0 : 1` — so a grid could
  paint one order and flip to the other when settings landed.
- **The default is now Sunday (0).** Sunday-first is the convention where this
  is being used; Monday-first is ISO-8601. It is a regional split with no
  correct answer, which is why it stays a setting — but the default should be
  the one the operator expects to see, not the one that happens to match the
  planner's internals. Only the column default moves (migration `…047`);
  existing rows keep what they hold, so no one's chosen order shifts under them.
- **Display only — the planning week stays Monday.** Sprints run Mon–Fri and
  `planningRules.spansWeek` deliberately tests weekdays only, precisely so a
  Sunday-start grid can't leak a project into the neighbouring sprint week. The
  kernel already anticipated this reader; the default flip just makes the
  anticipated case the common one.

→ Rejected: *mass-updating existing `week_start` rows to 0* — that would
overwrite a deliberate Monday choice to satisfy one operator's preference
(Principle 16). Anyone who wants Sunday flips one toggle.
→ Strains **Principle 8** lightly (a second thing the calendar's first column
can be): named and accepted — it's one setting read through one function, and
the surface's question is unchanged.
*Status: standing — typechecked, 51 tests green, built, and driven at 375px in
a fixture harness in both orders (weekday header, date alignment, the 5-vs-6
row case, no horizontal overflow). **Not yet driven in a real account** (no
credentials in this build environment).*

**D-046 · 2026-07-28 · Inviting a guest is outbound mail, so the app asks first
— and "contacts" means a real address book, not whoever turned up in a meeting.**

**Nothing emails a human without saying so.** Creating an event with guests sent
Google `sendUpdates=all` behind a button labelled *"Create"* — the chip UI read
like tagging and the action was mail to real people. The last step now names the
recipients and offers *Add without emailing*; adding a guest later offers *Email
invite* or *Add quietly*. The mirror bug was worse and silent: **delete** passed
`sendUpdates=none`, so cancelling a meeting you host removed it from every
guest's calendar with no explanation. Cancelling now defaults to notifying when
you are the organizer and there are guests, and says which it will do. The
notification is a caller decision (`notifyGuests`) end to end — never a constant
buried in an edge function.

**Contacts come from address books.** The picker searched only attendees of
synced events, so anyone emailed-but-never-met was invisible. We took Google's
`contacts.readonly` **and** `contacts.other.readonly` — the second is where
auto-recorded correspondents live, and without it the common case stays broken —
plus Apple contacts over CardDAV, which needs no new credential because the
app-specific password already in Vault reaches `contacts.icloud.com`. Both are
*sensitive* scopes: one consent-screen resubmission, and connected accounts must
re-consent. Taken now deliberately, while verification is still in Testing and
the blast radius is one account. M365 was declined — not used here.

**Sources are labelled, not blended.** A merged list that won't say where a
name came from asks you to trust it blindly, so each row names its origin
(*Google · Apple · Met before*) and a person in two books collapses to one row
carrying both.
→ **The bug underneath it all:** fuzzy matching scored the whole address, and
`word_similarity` matches the best *substring* — so `@gmail.com` alone cleared
the old 0.15 floor and every gmail contact matched every gmail address typed,
ranked by how often you met them. Typing a stranger's address suggested your most
frequent correspondent. Verified live: one address returned **20 unrelated gmail
contacts**. Matching is now local-part to local-part, and a complete address the
user typed always leads the list and is the default selection.
*Status: standing — typechecked, 64 tests green (13 new vCard/CardDAV parse
tests), edge functions parse, built, and driven in a real account: the exact
address commits instead of the fuzzy stranger, and the confirm step was reached
without sending. **Not yet deployed** — migration 47, four edge functions, and
the Google consent screen are pending.*

**D-047 · 2026-07-28 · A hidden calendar is never offered and never chosen —
only named. Unnamed always means the default, and the agent never infers a
calendar from what an event is about.**

Asked to add *"Call with Tiffany Souers"*, the agent put it on a **Women's**
calendar hidden from the board months earlier. Three gaps made that a legal
answer, none of which a typecheck could see:

- **The write list didn't respect hiding.** `agent/context.ts` filtered the
  *events* feed by `hidden_calendar_ids` and left the **write-target** list
  unfiltered ten lines later — so all twelve hidden Frontier calendars (Women's,
  Men's, Youth, Sozo, Sunday Service) sat in the model's context as equal peers.
- **There was no default.** `default_calendar_account_id` existed, was honored by
  `google-events` only when no account was passed, and was never read by the
  agent at all. The fallback was `writable.find(provider === "google")` — first
  row in arbitrary DB order.
- **Nothing forbade topical inference.** The prompt required *naming* the
  calendar in the confirmation but never said how to *choose* one. Given topical
  names and a person's name, the model matched on subject.

**The rule: hidden means never offered, still nameable.** Hiding a calendar is a
stated intent, so nothing unprompted may land there — but *"put it on Women's"*
still resolves, because naming it is the user deciding (Principle 3: Nuvo
proposes, you promote). One shared module (`agent/calendars.ts`) now answers
"where may this go" for both the context builder and the tools, so the two can't
drift; the offerable list excludes hidden calendars and marks exactly one
`isDefault`, and the tools' resolver keeps the full list so an explicit name
still lands. **A named destination outranks the stored default** — the recovery
turn failed the same way, resolving *"my phil@frontierchurch account"* against
the setting instead of the words, so account emails now resolve too.

**The calendar is a control on the record card, not a caption.** It's the fact
most likely to be wrong, so reading it and fixing it are the same gesture: the
chip on the agent's event card opens the account/calendar picker and moves the
event. It offers only calendars still on the board — the same rule the agent
follows — so the fix can't put the event back out of sight.
→ This is a **Principle 16** failure as much as a bug: in the builder's account
the first Google row is benign, so nothing looked wrong until the row order
happened to put a topical calendar first.
*Status: standing — typechecked, 74 tests green (10 new, pinning the rule that
would have caught it), built, and the card's picker driven in the real dev app at
desktop and 375px: the twelve hidden calendars are absent, the event's own hidden
calendar is retained with a ✓ so the card still tells the truth. **Deployed
2026-07-28** and verified live against the deployed agent, read-only: asked what
it can write to, it named exactly the four calendars still on the board —
`phil@frontierchurch.us`, ROSE VILLA EVENTS, `phillipchan1@gmail.com` (default),
Family — out of 21 writable rows, with the other seventeen hidden and absent.*

**D-056 · 2026-07-30 · A meeting Nuvo books gets a Google Meet link the same way
one booked in Google does — as a real conference, never a URL pasted into the
notes.**

**The bug: nobody was asking.** Google's *"automatically add Google Meet video
conferences to events I create"* is a property of **their web UI**, not of the
account or the calendar. It is never applied to an event created through the
API, and `google-events` never sent `conferenceData` — so *every* event Nuvo
ever created, by drag or by chat, went out with no way to meet digitally. It
didn't look broken from inside Nuvo, because the read path renders whatever
Google returns and Google was returning nothing to render. Two details make the
request work and both fail silently when missed: `conferenceDataVersion=1` on
the URL (without it the whole field is ignored, no error), and a fresh
`requestId` per attempt (Google dedupes by it and hands back the previous
conference).

**Where the link lives is the interesting half — and the answer is not the
description.** The tempting fix is to paste `meet.google.com/…` into the event
body. We rejected it: a description is free text, so a pasted link is invisible
to every client's Join button, to the calendar chip on a phone's lock screen, and
to Meet's own knock-to-enter; it doesn't move when the meeting is rescheduled,
survives as a stale link if the conference is removed, and can't be told apart
from a link someone typed. `conferenceData` is the structured field every client
already reads. **Google puts the link on the invite email and the event card for
free — the description stays for what a human wrote.** So Nuvo asks Google to
mint the conference and never writes the URL anywhere itself.

**The default is guests-only, and it is one rule in one file.** A solo block
doesn't need a room; a meeting with someone does. `auto_add_meet` (`guests` ·
`always` · `never`, default `guests`) is the account's standing answer, and
`_shared/conferencing.ts` holds the rule both runtimes call — the composer's
toggle starts from it, and the edge function falls back to it when the caller
says nothing, so booking by drag and booking by chat can't disagree
(root `CLAUDE.md`: one rule, two runtimes). The toggle turns itself on the moment
a guest is added and stops following the rule the instant it's tapped: Nuvo
proposes, you promote (Principle 3). Because the link goes out on an invite,
the guest-confirmation step now says so — *"Email these 2 guests an invite with a
Google Meet link?"* — extending D-046 rather than working around it.

**Meetings that already exist get the same repair.** `action: "add_meet"` adds a
conference to an event booked before any of this, idempotently (an event that
already has one returns its link instead of minting a second), notifying guests
by default because a meeting moving online is news. And the join link is now
read through one function that checks `conferenceData` **and** the legacy
`hangoutLink`, so older events — and events other clients made — stop looking
link-less. The phone got the button it never had: Join is the top action on the
mobile event sheet, which is where a video meeting actually gets joined.
→ **No Question Ledger row.** This isn't a new act; it's an existing act
(*book the meeting*) that was quietly producing a broken artifact. Nearest
neighbour is D2 — *what's already decided so I don't have to re-decide it* — and
a meeting you have to re-open in Google to make joinable was not, in fact,
decided.
*Status: standing — typechecked, 82 tests green (8 new, pinning the default rule
and the `hangoutLink` fallback), edge functions parse, `npm run build` green, and
the composer driven in the dev app via a `?meet` harness at desktop and 375px:
off with no guests, on the moment a guest is added, an explicit tap sticks
through further edits, and the emitted draft carries `addMeet`. **Not verified
against Google** — this container has no Supabase credentials, so the
round-trip (link actually minted, `conferenceDataVersion` honored, the async
mint settling within the poll) is unproven until migration 49 and `google-events`
+ `agent` are deployed. **Not yet deployed.***

---

**D-058 · 2026-07-30 · A week is named by distance, not by a number — and "sprint" is
retired from every user-facing surface.**

**The word.** *Sprint* was agile jargon in a product that is **single-player by design**
(Principle 12) — it imports a team apparatus (backlog, sprint planning, velocity, a locked
scope) that doesn't exist here. Worse, in plain English it means *going fast*, which is the
opposite of the promise to P1: Sunday takes 20 minutes and ends with a week you believe.
[`personas.md`](./personas.md) already used the word as a thing that gets in the way — *"a
calendar that doesn't care about your sprint."* This was also **not a new decision**: D-007
accepted `sprints` as *code* drift with **Week** as the user-facing name, and D-049 logged
the resulting P11 violation (the pool read "Needs a week" while the columns said "Sprint
31"). This finishes it.

**The number, which is the half that nearly got missed.** The obvious fix — rename *Sprint
33* to *Week 33* — was **rejected**. The number is ISO week-of-year, a convention that is
normal in Germany and Scandinavia and effectively unused in the US: Google Calendar ships
week numbers off by default and its **mobile apps don't offer them at all**; Apple Calendar
ships them off, month-view only. The two conventions also disagree (ISO starts Monday, week
1 holds the first Thursday; the US convention starts Sunday, week 1 holds Jan 1) — and
Nuvo's grid is **Sunday**-start while `weekNumber` snaps to Thursday for an **ISO** number,
so a renamed "Week 33" would look authoritative while disagreeing with the user's own
calendar around New Year. `sprint.ts` claimed the number was *"self-locating"*; it isn't,
for the same reason [domain coverage](../../CLAUDE.md) can't answer by color alone — nobody
memorizes the mapping.

**The evidence that settled it was already in the app.** Every surface that printed the
number printed a date line under it — `Sprint 33` over `This week · Aug 10` in the On Deck
columns and the phone deck, `33` over `Aug 10` in the record's placement band. The fallback
existed because the number wasn't enough. So the win was **deleting the headline, not
translating it.**

→ **What shipped.** `src/lib/sprint.ts` → **`src/lib/week.ts`**, and the label API is now
distance-first:

| Function | Reads | Where |
|---|---|---|
| `weekName` | *This week · Next week · Last week · In 3 weeks · Week of Aug 24* | every headline |
| `weekSpan` | *Aug 10–16* (*Aug 31–Sep 6* across a month) | the date line under it |
| `weekTick` | *Now · Next · +2 · −1*, date once off the horizon | tiny scales — the record band, the phone's pager chips |
| `weekNumber` / `weekYear` / `weeksBetween` | the ISO number, still derived | spans, runway, cross-year identity — **never a label** |

Applied across ~20 user-facing sites: On Deck columns, the phone deck, the record's
placement band (`SprintBand` → **`WeekBand`**, section label *Sprint* → **Week**), the
Schedule masthead eyebrow, the terminal skin's status bar, Plan the week (desktop + phone),
the pool label (*Needs a sprint* → **Needs a week**), runway prose (*"14 sprints left"* →
*"14 weeks left"*), and the orientation art. Verified in the running dev app on both shells
(desktop planner + record; phone deck at 375px, no overflow).

→ **Consequence.** The glossary loses the sentence that existed only to defend a second name
(*"sprint is the cycle's ADD-ON identity that rides alongside week"*). One name per thing
(P11). **`sprints` / `sprint_id` / `sprintSpanFor` stay in code and in the kernel** — that
drift is blessed by D-007 and renaming the table would ripple into the edge functions for no
user-visible gain.

→ **Rejected:** *Week 33* as a straight swap (above); inventing a second noun to separate
the commitment cycle from the calendar's Day·Week·Month zoom — the zoom is a view control
and the commitment is a noun phrase we already have (*the week's plan*), so the collision is
cosmetic, and P11 cuts against minting a word users don't perceive a need for.

---

**D-059 · 2026-07-30 · Orientation forks instead of choosing: "Show me around" or "Walk me
through it." A coach-mark tour over a cold account was tried on paper and rejected.**

**The problem.** Nuvo's concepts are the hard part of Nuvo, and the tour taught them with
rebuilt art — honest, but it leaves the reader one translation short of the actual screen.
Real stranger feedback (2026-07-29) was that the concepts read as confusing.

**Why the obvious fix doesn't work, and this is the load-bearing part.** Replacing the art
with coach marks on the live app **fails on a cold account.** `AppShell` gates the shell on
`domains.length === 0`, so `FirstRun` runs first: orientation opens with **1–5 domains the
user just named and nothing else.** Four of the five ladder steps would spotlight empty
surfaces. An orb on an empty Inbox teaches *less* than a drawing of a full one — Principle 7
("useful on day one, with an empty backlog") straining at exactly the moment it matters
most. Logged as **N-13** so it stops coming back.

**So it forks.** The welcome step asks the one question it's actually qualified to ask —
*how do you want to learn this?* — and offers two doors. **Show me around** is the existing
8-step visual tour, untouched. **Walk me through it** docks a panel beside a fully live app,
names one act per step, lights the real element, and ticks from real data. Phil's framing:
*"power users like me want to just be shown, but I know my wife would want a thorough
walkthrough."* Two audiences, one question, no guessing.

**The live path teaches by making the thing exist** — which is what resolves the cold-start
problem without touching **D-026** (signup still seeds nothing; every row is created by the
user, in their words). Its five acts are deliberately the five `GettingStarted` milestones,
in order, read through the *same* derivations — the walkthrough **is** that tracker,
performed live — so finishing it retires the tracker and clears the floors' empty states.

→ **Three rules that keep it honest.** The Initiative step **stays a drawing** and says
*"you won't need this today"* — an initiative is several projects and a day-one account has
one, so staging a fake would be the dishonest version. A step whose whole teach is
*arriving* (the domain wall) gets **navigation, no orb** — an orb around a whole wall is a
rectangle with its edges off-screen, which reads as no spotlight at all; same reason the
Nuvo step lights the **✦ badge**, not the full-height agent rail. And auto-advance fires
**only on a real not-done → done transition**, so a milestone already satisfied shows its
tick and waits instead of flying past.

→ **Nothing gates.** Next is always live, Skip is on every step, Esc leaves, and Back from
the first slide of either path reopens the fork. A user who hates walkthroughs is one key
from an empty app they can drive.

→ **Consequence.** Closes **O1** and gives Nuvo its first real answer to **O6** (the
five-minute win). Partly answers **Q-10**: the picker and the tour compose deliberately now
— *collect what you carry → choose how you learn → learn.* Spec:
[`orientation.md`](../orientation.md). `ORIENTATION_VERSION` 3 → 4.

→ **Rejected:** the straight swap to a full coach-mark tour (**N-13**); reusing Marquee's
session to drive the tour — it's a single held spotlight that ends the moment you
self-navigate, the opposite of what a multi-step walkthrough needs (the orb CSS and the
wait-for-target idea *are* reused).

→ **Revised the same day, after the first real walk-through.** Three things the build got
wrong, all in the same direction — *not visual enough for someone who has never seen the
app*: four of nine steps highlighted nothing, the Initiatives step never travelled to the
Initiatives floor, and the Nuvo step described the chat without opening it. The corrections
are now design rules in [`orientation.md`](../orientation.md): **every step highlights
something**, behind a real spotlight (a dim layer with a cut-out at `rgba(0,0,0,.7)`, above
the modal layer, click-through) rather than a glow alone; **light the thing you can click**,
never the container (one domain card, not the wall; the composer, not the rail); and a step
**opens what it is about to talk about**. The honesty rule that produced the art-only
Initiatives step was over-applied — *don't stage a fake initiative* is right, *don't show
them where initiatives live* was not, so that step now travels and simply asks for nothing.
The opening step also became an act rather than a definition (**"Let's add your first
task"**, then a step that shows the Inbox with their own words already in it), which is
Phil's own framing of what a beginner needs first.

---

**D-060 · 2026-07-30 · The Week's Plan shows the week's *projects*, at depth — and D-004
narrows: a priority IS a project.** *(Closes the open thread D-031 named and
[`priorities-and-projects.md`](../priorities-and-projects.md) has carried as a status note
since 2026-07-26.)*

**The defect, which was structural, not cosmetic.** The full-screen Week's Plan built its
priority list from `vertical.bigRocks` — the `sprints.big_rocks` jsonb — while every other
week surface (the rail crown, Sunday, the phone's Plan the week, the agent's `weekSlate`)
derives the slate from each project's On Deck span via `weekPushes`. Since D-031 the jsonb
holds **only the per-week verdict**, so the floor was blind to the week's actual projects:
it printed *"The week is open — nothing named yet"* over a week holding four, and the only
way to put anything on it was a free-text box that minted project-less rocks nothing else
could render. The floor was the last surface reading `big_rocks` as a list.

**So D-004 narrows in practice.** A priority is a project you brought into the week.
Bringing it in / taking it off IS the week's plan. **The cost, stated rather than buried:**
a "pure intention" priority — one with no project behind it — is no longer expressible on
any surface. The data model still permits the row; nothing renders it. The crystallization
line of D-004 survives only at its right-hand end.

**What the surface became.** One question at two points on the arc, which is why forming and
sealed can share it without straining P8: *forming* asks **"is the week I committed to still
true?"** and *sealed* asks **"did anything move?"** The rail crown already answers "what am I
on this week?" in a glance, so the floor earns its full screen by going deeper — each project
with its outcome line, its open work, and **the honest arithmetic: how much of what's left
actually has a time this week, and how much is loose.** A project with 4h remaining and
nothing on the grid is not "in progress"; it's a promise the week hasn't made room for.
(Work parked inside a *slot* counts as placed — slot children carry no `start_time` of their
own, so without threading slots into `composeWeek` an hour sitting on Tuesday morning would
have read as loose. That's the difference between a number and a true number.)

→ **Extends D-039 to mid-week.** Its two remedies were offered on the Projects step *while
you're still choosing*; nothing offered them on a Wednesday, which is exactly when a week
stops being true. Both now sit on the row itself (plus *Take it off this week*), via the same
kernel patches, through a shared `RemedyPanel` — one copy of the wording, and its acts are
now always visible and ≥44px, because the Sunday original was hover-revealed and this panel
renders inside the phone's Week's Plan sheet (P13).

→ **Three latent bugs surfaced and fixed with it.** (a) *Carry to next week* appended a rock
to next week's `big_rocks` — a week whose slate is derived from spans — so the toast said
"Carried…" and nothing happened; it's now `pushToNextWeekPatch`. (b) The ✓ wrote `done_at`
directly, which reads as "complete" while finalizing nothing; it now opens
`ProjectShipAssess` like every other ship path. (c) The Review **sealed on first open** — so
opening the plan on Monday made Monday's slate that week's permanent Review. A live week now
re-snapshots on every open; a past week is sealed once and never rewritten. *(Already-sealed
weeks keep their old snapshot — history isn't retroactively corrected.)*

→ **Cut:** both free-text capture boxes (this week's priorities, next week — the second wrote
where Sunday never reads), the standalone **Highlights** list (its receipts already expand
under each domain in the weave; it was the living relative of the throughput count
`weekly-review.md` cut years-equivalent ago), and drag-to-reorder (it persisted a `big_rocks`
array order the rail doesn't honor — kept, it would have snapped back).

*Status: standing — typecheck + build green, 96 tests (12 new for the placement math,
verified in isolation rather than by mutating a real account). Driven in the running app at
1440×900 and 375px: the floor's list, the rail crown and the On Deck board show the same four
projects; the ship ✓ opens the assessment and cancels clean; the sealed week is read-only
with the full weave. Not driven: pressing a span remedy on live data — the acts are the same
kernel patches D-039 already covers with tests, and widening a real project's dates to prove
it isn't worth the mutation.*

---

**D-061 · 2026-07-30 · The conscience note speaks while the week can still change, and goes
quiet once it's sealed.** *(Closes open decision #2 in
[`weekly-review.md`](../weekly-review.md) — the grace-vs-audit dial.)*

Resolved on the **forward-folding rule**, not on tone. Mid-week a quiet domain is
*actionable*, so naming it hands something forward — which is the entire justification for
looking at it. Once the week is sealed nothing can be done, so a sentence there is pure
audit and the faint ember carries it alone (P4 — never present undone things as debt; and
never shame a quiet domain, since sometimes weighting elsewhere was right).

So the hours section forks: **forming** → one sentence in the opportunity register, paired
with the open hours so it reads as room; the full weave sits one tap away behind a
disclosure. **Sealed** → the weave, expanded, receipts and all, with no sentence added. The
grace dial made structural.

Honesty guards, because this must be true in a stranger's account on their first Tuesday
(P7/P16): if **no** domain has hours yet, say *"Nothing has landed against a domain yet this
week"* and name no one; name at most **two** quiet domains, and past that say *"most of your
domains are quiet so far — X has the hours."* Naming five quiet domains to a new account is
the app inventing a failure.

*Status: standing — driven in the running app.*

---

**D-062 · 2026-07-30 · No forward-fold write ships without its reader.**

The forming conscience read wants a *"flag it for next week"* button and **doesn't get one**,
because there is nowhere honest to write it — and this repo already has the receipt.
`week_reviews.note_to_monday` has been written by the Find since migration 33 and is **read
by nothing**; `useWeekReview.ts` says so in a comment. A write with no reader is worse than
no button: the user believes something will happen next Sunday, and it won't.

**The rule:** a control whose only job is to carry something forward ships with the surface
that picks it up, in the same change, or it doesn't ship. If we want the quiet-domain flag,
it arrives as both halves at once — a column *and* a reader in Sunday's opening beat.

→ Leaves `note_to_monday` itself as an open thread (§3), not fixed here: deciding where
Monday's reader lives is a surface decision, not a wiring task.

*Status: standing — Principle 6, and the general form of the bug D-060 fixed three times
over.*

---

**D-063 · 2026-07-30 · A rail row can be dragged to a new place in its own list — but only
where the new place will actually hold. The return-to-inbox banner is retired; the Inbox
tab is the target.**

**The defect, reported from a real Thursday.** Four failures in one gesture. (1) There was
**no reorder at all** — every row drag was FullCalendar's "drop this onto the grid," so the
day's list could not be hand-ordered. (2) No insertion line, so even a working drag would
have been aimed blind. (3) The *"Release to return to inbox"* banner unfurled over the top
of the list the instant a drag began — it overlaid rather than reflowed, but it covered the
first row, which reads as the list lurching away from the cursor. (4) The dragged row kept
its lifted `glass-lift-row` state after the drop, because selection resolves on `mousedown`
(deliberately — see D-054a) and nothing cleared it.

**The rule that decides where a line may appear.** A drop offer is a promise. Order in the
rail is only *ours to set* in three places: the inbox queue, the day's **anytime** run, and
the children of one slot. A row with a real clock time is ordered by its clock — dropping it
two rows up would snap straight back on the next read, so it gets **no line**, and it moves
on the calendar instead, where its position means something. Offering the line everywhere
would have been the friendlier lie.

**The banner is retired because the tab was already there.** The Inbox tab sits above the
list, is permanently in the layout, and already carries the word *Inbox*. Arming it costs
zero reflow and covers zero rows. Two drags, two marks: a calendar item over the rail wash
the **whole rail** (the whole rail is the zone); a row already *in* the rail arms **only the
tab** (the tab is the only new destination — tinting the rail said "drop anywhere here,"
which was never true).

→ **Mechanism.** `useListReorder` (`src/hooks/useListReorder.ts`) — pointer events, since
Tauri swallows HTML5 DnD. Deliberately *passive*: it never calls `preventDefault` or
`stopPropagation`, so it rides alongside FullCalendar's `Draggable` on the same rows rather
than replacing it. FC keeps the cursor ghost and owns drops onto the grid; the hook owns the
line and drops inside the list; they resolve by geometry, and the line goes quiet the moment
the pointer leaves the rail. A commit **re-deals the band's own `sort_order` values** instead
of renumbering `0..n` — `sort_order` is a global column that a project's steps and a slot's
children also read, so a reorder here must not renumber rows it can't see.

→ **Consequence.** Sharpens **D2** (*"what do I do next?"*) — the day's order is now a thing
you can state, not just a thing that happens to you. Costs one honest limitation, stated
above. `GroomWall` and the slot popover still carry their own hand-rolled copies of this
gesture; they should adopt the hook, and until they do this is the reference.

→ **Rejected:** a drag handle/grip to disambiguate reorder from calendar-drop (hover-only
chrome on a row deliberately kept to one line — and the axis already disambiguates); a
banner pinned to the *bottom* of the list instead of the top (same covering, lower down).

→ **Not taken here, worth its own decision:** a **cross-band** drop as a real act — dragging
a slot child up into the anytime run meaning *take it out of the slot*, and the reverse
meaning *put it in*. That's a genuine planning move, not a reorder, and it deserves to be
designed rather than inherited from a gesture.

*Status: standing — verified against the running app 2026-07-30 (both bands reordered and
restored, persistence confirmed across a reload).*

**D-063a · same day · a drop target names its destination, or it loses the row.** Held
against a real Thursday within the hour: dropping *Build company DNA/heartbeat* on the
Inbox tab **made it disappear.** Not a regression — `backToInbox` has always routed a
**parented** task to `status: "backlog"`, its project's, and only a loose one to the triage
`inbox`. But the rail renders neither backlog, so the row left the day, never arrived in the
Inbox, and the tab's own count didn't move. The control said *Inbox* and meant *Stampede v3
backlog*. Confirmed in the row itself before writing a line of the fix.

**The routing is right; the label was the lie.** The inbox is the triage queue for *unfiled*
captures — flooding it with parented project work would break the funnel (**P10**, near
enough). So the destination gets **named** instead:

→ **Before the drop**, a cursor chip states the act and where it lands — *"↩ Back to
Stampede v3 backlog"* vs *"↩ Back to Inbox"*, read from the row's own project. It's the
calendar's slot-chip idiom in `--accent` (intent) rather than `--slot` (open/unclaimed).

→ **After the drop**, a toast names it again and carries **Undo**, which restores the exact
four fields either act moves (`status` · `do_date` · `start_time` · `slot_id`). Verified
round-trip on live data.

→ **And the strip is symmetric now.** During a drag the two tabs stop being *places* and
become the two acts available to the row in hand: the **Inbox** tab takes it off the day,
the **Today** tab puts it on. Three states each, because *"you could drop here"* and *"you
are about to"* are different promises — resting · armed (dashed ring) · ready (filled +
lift). Rail-origin drags now have exactly **one** owner: `LeftRail`. `CalendarPane` and
`WeekBoard` each kept a copy of the tab hit-test; both are gone, and `CalendarPane` keeps
only what it alone knows — a *calendar* item over the rail.

→ **Found in passing.** `CalendarPane`'s drag tracker only reset on `pointerup`, so Escape
(which the rail's reorder honours) left `body.cal-dragging` behind — every day cell still
glowing for a drag that had ended. It now aborts on Escape and `pointercancel` too. Same
family as the stuck row-highlight in D-063: **when the gesture ends, it ends.**

*Status: standing — the general rule is in `design-language.md`'s drag contract: a target
that can route somewhere the surface doesn't render must say so before the release, and
carry an Undo after it.*

---

**D-064 · 2026-07-30 · The funnel is stated as a law and defended with friction, not
refusal. "Every task needs a time" is not one of the rules.**

**What prompted it.** The walkthrough taught the four altitudes and never taught the thing
that makes them a *funnel* — that work earns the floor below it by being groomed. Phil's
framing: *"what's key in this entire thing is the groomed funnel… we are an enforced funnel
machine."*

**The check, and the correction.** We are **not** an enforced funnel machine today, and it
matters before writing any copy that says we are. `bringIntoWeekPatch`
([`planningRules.ts`](../../supabase/functions/_shared/planningRules.ts)) refuses exactly
one thing — a project already spanning that week. The Sunday ritual's `bringIn` calls that
same patch; its span/push-out remediations are about **capacity**, not readiness.
`ripenessOfProject` returns a *stage* (RAW → SHAPED → SCAFFOLDED → ACTIVE), never a gate. So
an outcome-less, taskless project can take a week right now, and a walkthrough claiming
otherwise would be disproved by the user in about ten seconds.

**So: friction, not refusal.** Placing an unready project still works, and then the app says
what it costs — *"the week can only size work it can see; without steps this won't get real
time on your calendar"* — with a one-tap **Add steps**. The incentive goes to the operator
with the consequence named, which is Principle 4 (*reports, doesn't command*) rather than a
wall. `src/lib/readyNotice.ts`, fired from the Sunday bring-in and the On Deck drop.

→ **A hard gate was rejected**, and not only on P4: it's the version that **only works with
clean data** (Principle 7). An account mid-import, or an operator who genuinely holds a
project in their head, would be blocked from recording something true. Logged as **N-14**.

→ **The kernel stays ungated on purpose.** `bringIntoWeekPatch` is the shared *act* — the
browser and the agent both apply it — so a refusal there would make the two runtimes
disagree about what a week can hold. This is a UI-layer nudge over an unchanged act.

→ **The law, as the walkthrough's closing card** (rules *after* the doing — stated up front
they're terms of service; stated after they consolidate a pattern the reader has felt):

> **A task earns a day** by getting a time · **A project earns a week** by having tasks ·
> **An initiative earns a quarter** by having projects.

→ **"Every task needs a time" was cut from that triad**, though it was in the original
framing. It contradicts the Backlog, which is *"processed and **deliberately** undated"*
([glossary](./glossary.md)) and never rolled, and contradicts loose weeks' `for_week: null`
Someday state. **"Earns" rather than "requires"** makes all three lines true, gives them one
grammar, and makes the card say the same sentence as `ripenessOfProject` and
[`readiness-model.md`](../readiness-model.md) §3 ("ready for the floor below").

→ **Consequence.** The walkthrough closes on the funnel instead of a generic sign-off, and
**W1** ("can I actually carry this week?") finally gets named during onboarding.

→ **Follow-up, same day: Plan the week is now the walkthrough's last step — after the law,
not before it.** It had been deferred on the assumption that the ritual would be an empty
ceremony on a day-one account; **that was wrong.** By that point the walkthrough has created
a project, sitting in *needs a week* with its chip ready to click, plus an inbox capture, so
all three of the ritual's lanes hold exactly one real thing.

**Order matters here and it changed once.** Placed *before* the law it reads as one more
surface; placed *after* it, it becomes the answer to the constraint the law just set — the
rules say things must earn their place, and this is the twenty minutes a week that makes
that easy. It also means the walkthrough **ends inside the act**, with the user's own
project one click from taking a week, instead of signing off on an empty Schedule.
Calendars sits two steps back because the ritual opens by asking what room the week has.
**W1** now has a demonstration, not just a sentence.

---

**D-065 · 2026-07-30 · One door. The visual tour is retired and first-run opens on a
promise, not a menu.**

D-059 gave the welcome two doors — *Show me around* (a card tour of rebuilt art) and *Walk
me through it* (live, over the real app) — on the reasoning that being shown and being
walked through are different people. Watching both, the pair didn't hold up:

- **The tour is the weaker half by our own argument.** This whole line of work started from
  the observation that a diagram makes the reader map a picture onto a screen they've never
  seen. The live path removes that translation; keeping a door to the thing we'd just
  diagnosed was preserving the problem out of politeness.
- **The power-user case is already served.** Skip sits on every step and Esc leaves from
  anywhere, so "show me and get out of my way" costs one key — it never needed a fork.
- **The concepts survive.** D-064's closing rules card carries the abstraction the tour
  existed to deliver, and it lands *after* the doing, where it actually sticks.

→ **The welcome becomes one screen with one promise.** Not a dialog-shaped card with a
feature diagram: full warm paper, a Fraunces line, one button.

> **Your whole life, actually moving.**
> The complexity is ours. The decisions stay yours.

**The subhead says what the diagram says.** The art is loose motes gathering into one line
— *you bring the tangle, Nuvo makes it coherent* — and the copy should make the same claim
rather than a different one. **The second sentence is load-bearing, not balance:** "Nuvo
handles the complexity" on its own promises Motion-style autopilot, which is **N-01**
(*"removes the judgment the product exists to build"*), so the deciding has to be handed
back in the same breath. It doubles as the sharpest line against both neighbours — a board
organizes but never moves it; an auto-scheduler moves it but takes the call.

**Two subheads were rejected on the way.** *"Work, family, faith, health"* — persona zero's
own list, and [`personas.md`](./personas.md) §1 names that exact move as the Principle 16
violation behind the retired four-domain seed (*"these are kinds, so the app never assumes
names"*). `FirstRun` had already been de-biased for the same reason, so enumerating here
would have reintroduced the bias one screen earlier. Then *"especially the parts nobody's
chasing you about"* — true, and it names the silent-starving failure the doc calls the
expensive one, but it describes a *symptom* where the visual is describing the *service*.

**The verb is the decision.** The first draft said *organized*, and *organized is what the
tools this replaces already do* — [`personas.md`](./personas.md) on the boards P1 left:
*"work goes in and never comes out onto a Tuesday; the board is a graveyard with good UI."*
Tidiness is the failure mode, not the promise, so the word had to be **execution**. A
week-scale promise ("a week you can believe", straight from the same doc's success
criterion) was also tried and rejected as too small for a cold open — the scope a stranger
recognises is their whole life; *the week* is the mechanism they meet a minute later.

⚠️ The headline uses **"life"** deliberately, which is the one place D-057's *lives outside,
domains inside* line bends: this screen is the boundary between the marketing promise and
the app's vocabulary, and it's the last surface before any altitude noun appears. No app
surface past it says it.

→ The hero art is the funnel as a feeling: loose motes on the left gathering into one calm
line. No labels, no altitude vocabulary — the feeling arrives before any of it, which is the
only thing a welcome screen can honestly do, and it rhymes with the rules card at the end.

→ **Consequence.** `ORIENTATION_STEPS` and the card path are deleted; `OrientationMode`
drops `"show"`. `WelcomeVisual` / `OnDeckVisual` / `FlowVisual` stay — the floor
empty-state teachers use them. `TimeblockVisual`, `NuvoVisual`, `CaptureVisual`,
`AppearanceVisual` and `ReadyVisual` are now unreferenced; left in place as the orientation
art library rather than swept, since the teachers draw from the same family.

→ **What we gave up, honestly:** someone who wants the concepts *without* touching their own
data no longer has a path. The rules card covers most of it; if that turns out to matter,
the answer is a help surface, not a second door on first run.

**D-066 · 2026-07-31 · The chat gets a conformance battery, and slots become something it
can say.**

Asked for *"9am slot today where I'll update documentation get day spring deployed get
stampede subdomains working"*, Nuvo created **three consecutive one-hour tasks** — 9–10,
10–11, 11–12 — and reported it as done. Nobody asked for an order, a duration, or three
blocks. The morning that was supposed to be one held block came back tiled.

→ **Why it was legal.** `slots` has been a table since migration 8 — a block of time that
owns N tasks, mirrored to Google as one busy block, droppable into on the Schedule. The
agent could not see one (`agent/context.ts` never read the table) and could not make one
(no slot tool existed). Worse, its prompt already used the word: `todayFreeSlots` meant
*computed free window*. So "9am slot" had exactly one reading available to the model, and
it took it. **Principle 11, inside the prompt** — one name, two meanings, and the model
picked the wrong one every time.

→ **The fix, in three parts.** Slots are in context (`todaySlots`, with what's inside) and
they now count as **busy** — the agent was offering hours the user had already claimed.
The computed gaps are renamed `todayOpenWindows` everywhere, so "slot" means one thing.
And the chat has `create_slot` / `add_to_slot` / `reschedule_slot` / `delete_slot`, with
the naming rule stated as the job: *the user gave you the contents, not a title — write the
through-line in 2–4 words.* Card, undo and the "released, work kept" wording included.

→ **The real decision is the second half.** Every other part of Nuvo fails loudly — a
component throws, a type fails `tsc`, a drifting week rule fails the kernel suite. The chat
fails **fluently**. Four times in six days it shipped something confidently wrong that no
gate could have caught: the empty-week claim over a full deck (D-031), the Saturday week
drift (D-032), the hidden-calendar booking (D-047), and this. So the chat now has what the
kernel has:

- The agent's pure half is **importable outside Deno** — prompt, tool definitions, snapshot
  shape, message assembly, turn loop. The battery drives *those*, not copies of them.
- **`npm test`** pins what needs no model: every tool has a handler, every tool the prompt
  names exists, every context field the prompt reads is actually sent, the loop's failure
  paths (a tool that throws is fed back, not fatal), and one name one meaning. It found a
  live bug in its first minute — the prompt was telling the model to call a tool that
  doesn't exist.
- **`npm run eval`** runs behavioral scenarios against a live model, asserting on tools and
  arguments rather than prose. **The bar is 100% — every scenario, every run.** It started
  as 100/80 across two tiers and was raised the same day: the chat is a first-class surface,
  and a planner you have to double-check is not doing its job. A partial pass is reported as
  **flaky** and is a bug — the chat drifts there, or the assertion is loose enough to fail a
  right answer. The only way past the bar is an explicit dated `quarantined:` line, capped
  at 10% of the suite, so the escape hatch can't quietly become the old 80%.
- The map of what the chat can do — including what it **can't** — is
  [`docs/agent-conformance.md`](../agent-conformance.md), and `npm test` fails when the map
  and the suite disagree.

→ **What we gave up, honestly:** the battery asserts what the agent *decided*, not what the
handler then wrote — that needs a database and is named as the top gap rather than papered
over. Recorded runs protect the plumbing but can't catch a judgment regression; only the
live run can, and it costs tokens. Ledger: **D3** ("I have 40 minutes — what fits?") is the
row this opens a path to; the slot half strains **P10** (a slot is not a fifth pool — it is
a container for time, and it already existed) and closes nothing on its own until the chat
proves it in real use.

---

**D-067 · 2026-07-31 · Long-cadence repeating tasks get a Schedule catalog, not a new pool.**

Upkeep chores (key rotation, HVAC filter) need a place between due dates and a path through
Nuvo chat. A fifth Tasks tab would violate P10; Settings buries something operational.
→ **Schedule ⋯ → Recurring upkeep**: series grouped by cadence (Weekly · Every N months · …),
next-due read computed beyond `HORIZON_DAYS`. Agent + capture use `create_recurring_task` /
`parseRecurrencePhrase`; engine lives in `_shared/recurrence.ts`. *Status: standing.*

---

**D-068 · 2026-08-01 · A name that matches two things is a question the tool layer has to
make answerable.**

A conversation about a Dayspring support project ran four turns of "I need the exact one"
at a user who had already said which one, and ended by writing the same description over
two different projects. Read as a model failure it looks like stubbornness; it wasn't. The
chat had been told `Multiple projects match (2)` and nothing else — no ids, no names, no
parent — so it could not offer a choice it had not been told the contents of, and the only
exit the error suggested was `delete_all_matching`.

→ **Three rules, in the handlers rather than the prompt** (a rule with one right answer
belongs in code — D-066):

- **A create checks for the name first.** There is no unique constraint on `projects.name`,
  so a blind insert is how one project becomes two — and in that transcript the twin was
  made one turn before it became unanswerable. A create that finds the name returns the
  existing row with `existing: true`; `allow_duplicate` is how you mean it.
- **An ambiguous lookup returns the candidates**, each with the initiative and life area
  that tell them apart. The model's job is to show a choice, not to guess.
- **One target per write.** Only the delete path may mention `delete_all_matching`; an
  update says "do not act on more than one unless the user names each". Plus
  `in_initiative_name`, deliberately not `initiative_name`, which on `update_project` is
  the field that *re-parents* a project — one name for both would make "the one under X"
  silently move it to X.

→ **What this cost, honestly:** a create is now two round-trips against the database in the
common case, and a user who genuinely wants two same-named projects has to say so. Both are
cheaper than an account that quietly accumulates twins. Ledger: no new row — this is **O2**
("can I trust what it says it did?") being repaid, not extended. It strains nothing; the
duplicate guard is the kind of thing P7 asks for, since ambiguity is exactly what a
not-clean account produces. *Status: standing.*

---

## 2 · Things we decided **not** to do

| # | The idea | Why not | Would change if… |
|---|---|---|---|
| **N-01** | Auto-schedule the day (Motion-style) | Removes the judgment the product exists to build; when it's wrong you have no model of why | Never — this is identity, not a feature gap |
| **N-02** | Multi-**player**: shared funnels, assignees, someone else's dashboard | Consensus objects blunt every altitude (D-003). ⚠️ **Not** an argument against multi-tenancy — that's D-024, and it's a yes | A separate product, not this one |
| **N-03** | A separate "event" entity for scheduled tasks | Doubles every sync path (D-001) | Never |
| **N-04** | Streaks, scores, karma, debt ledgers | Serves *optimizer*; we serve *steward* | Never |
| **N-05** | Notion-style databases / custom fields | A blank canvas is a product you have to finish | Never |
| **N-06** | A fifth pool | The funnel's power is its small vocabulary (Principle 10) | Two independent instances prove the need |
| **N-07** | Push notifications for planning nudges | The app reports, you decide (Principle 4) | Time-critical *now* signals only, opt-in |
| **N-08** | A native watchOS app for capture | Shortcuts → the `agent` endpoint already works on every watch, today, with dictation ([`APPLE_WATCH.md`](../APPLE_WATCH.md)) | We want a complication or an offline queue |
| **N-09** | Extracting `packages/design` fully now | Stub is enough while there are two consumers | A third consumer appears |
| **N-10** | Folding marketing into the SPA | D-018 | Never |
| **N-11** | Rebuilding the UI wholesale on Untitled UI React | Tried for real — a full overnight rebuild on branch `untitled-ui-rebuild` (2026-07-28: React 19, UUI tokens bridged under every surface, one RecordCard, focus-trapped dialogs; all gates green). Phil's feel test rejected the look, and a feel test has exactly one judge. Branch destroyed same day (tip `832ae43`, unreferenced). Transferable learnings noted before deletion: the React 19 upgrade is ~3 type fixes; workbox precaches nothing over 2 MiB; react-aria adds ~200KB to the bundle | A concrete new reason beyond cohesion — e.g. hand-rolled component debt starts blocking features — and even then, propose per-primitive adoption, not a wholesale reskin |
| **N-14** | Hard-gating the week on readiness — refusing a project that has no tasks | It's the version that only works with clean data (P7): an account mid-import, or an operator who really is holding a project in their head, gets blocked from recording something true. It also contradicts P4 and `readiness-model.md` §1 ("never commands, never shames, never auto-acts"), and a refusal in `bringIntoWeekPatch` would make the browser and the agent disagree about what a week can hold. D-064 uses friction with the cost named instead | Evidence that the notice is ignored often enough to matter — and even then, gate at the *ritual*, not in the shared kernel act |
| **N-13** | Replacing the orientation's rebuilt art with coach marks on the live app | A cold account has nothing to point at. `FirstRun` gates the shell on zero domains, so orientation opens with the domains they just named and **nothing else** — four of five ladder steps would spotlight empty surfaces, and an orb on an empty Inbox teaches less than a drawing of a full one (P7). D-059 forks instead, and the live door teaches by *making the thing exist* | Never as a straight swap. The live door already covers the real want; if it needs more reach, extend it — don't point at emptiness |
| **N-15** | Queuing recurring-series materialisation offline | Tried and reverted the same day. `materializeSeries` **reads server state** to work out which occurrences are missing, and `clearFuture` deletes by predicate — queued, you get a series row with no occurrences behind it: a recurring commitment that displays but does not exist. That is worse than an honest "needs connection", so the `field_ts` column and the `apply_patch` allowlist entry were backed out rather than shipped half-working (D-091) | Materialisation moves to a pure client-side computation over the already-cached occurrence set, so it needs no read to decide what to write |
| **N-12** | Pasting the video-call link into the event description | It's the *unstructured* copy of a structured fact (D-056): invisible to every client's Join button, doesn't move when the meeting does, outlives a removed conference, and can't be told apart from a link a human typed. `conferenceData` is the field they all already read | A provider Nuvo writes to has no conference field at all — and even then, say plainly that the link is pasted |

---

**D-069 · 2026-08-01 · Nuvo chat can invite people — by resolving who, never by
sending. The tap that mails a human stays in the user's hand.**

Chat could already create an event with `attendees`, and that was the problem:
`create_calendar_event` forwarded the list to `google-events`, which defaults
`notifyGuests` to true, so a model that guessed at a name could put mail in a
stranger's inbox with no confirmation anywhere in the path. D-046's consent step
lived in `DraftComposer` — the only door that existed when it was written. A
second door had quietly opened beside it.

**The split that makes this safe is structural, not a prompt.** The agent
**resolves and stages**; the client **sends**. `propose_invite` returns an
`InviteDraft` and writes nothing — no event, no mail — and `create_calendar_event`
routes any guest list into the same staging path rather than refusing (a refusal
the model can retry around is not a guard). There is deliberately **no agent tool
that puts an invite on the wire**, and `tests/invites.test.ts` asserts it: no file
under `supabase/functions/agent/` may name the `invite` action, forward
`attendees` to a create call, or mention `notifyGuests`. The send runs through the
composer's own mutations, so booking by chat and booking by drag produce the same
event — one act, two doors (root `CLAUDE.md`).

**The card is the confirmation, and it names people, not a count.** Recipients
render two lines (name over address — at rail width a single line truncates the
address, which is the half that decides who actually gets mailed), each labelled
with where we know them from (*Google · Apple · Met before*), each removable. The
question and the quiet option are `inviteConsentPrompt()` / `QUIET_HINT` in
`_shared/invites.ts`, imported by **both** the card and the composer, so the two
doors cannot word the ask differently. **Send invite** and **Add without
emailing** stay separate buttons; afterwards the card becomes a receipt that says
which one happened.

**Ambiguity is answered, never guessed.** `pickRecipient()` resolves a name only
when exactly one contact answers to it — every word of the query has to land, so
"Matt Hansen" separates the two Matts that "Matt" cannot. Two matches come back
as a question with candidates; no match comes back as *"I don't have an address"*.
Never the closest-looking row: that is D-046's fuzzy-match bug wearing a new coat,
and mail is not undoable. A complete address the user typed is always taken, and
flagged *not in contacts* when we've never seen it.

**Lookup reuses the picker's ranking instead of copying it.** `contacts(search)`
is security definer over `auth.uid()` and returns nothing to the service role, so
migration 50 moves the body to `contacts_for(uid, search)` and leaves
`contacts(search)` a one-line wrapper — one definition of "who do I mean by Matt",
two callers. `contacts_for` is granted to `service_role` only; a definer function
taking a user id as an argument is otherwise a cross-account read.

**What it still won't do:** send an iMessage. The screenshot that started this is
a group thread, and Nuvo has no business posting there — it reads the thread,
proposes the time, drafts the reply, and books the calendar half. And guests stay
**Google-only**: an Apple target now fails loudly with an offer to move it, where
before the guest list was silently dropped and the event created anyway.
*Status: standing — typecheck clean, 119 tests green (18 new), edge functions
parse, `npm run build` green, and every card state driven at 375px and desktop in
the running dev app via the `?invite` harness (recipient removal, the consent
sentence re-counting, the failure path). **Not yet deployed** — migration 50 and
the agent function are pending, and no invite has been staged from a live chat
turn in a real account. Re-verify there before calling the ledger row ✅.*

**D-070 · 2026-08-01 · The Review archive gets a gallery — inside the existing door, not
beside it.** Revises the navigation half of the 70/30 doctrine
([`weekly-review.md`](../weekly-review.md), decided 2026-06-19).

Phil's objection: every sealed week is already stored forever (*"the archive is the
product"*), so it isn't temporary — but reaching an old one meant walking `‹` one week at a
time, which makes a permanent archive practically unbrowsable. That's a real gap (**W7** —
"is this carrying a pattern?" needs looking at more than one week at once; it's also a
plausible Drift-detector, per brandscript §2). It is not a reason to reopen the part of 70/30
that's actually load-bearing: no third Spine section, no dashboard destination.

→ **`WeekArchiveGallery`** (`src/components/floors/WeekArchiveGallery.tsx`): a grid of past
weeks' emblems (`WeekEmblem`, already a pure renderer), newest first, named by distance
(`weekName`) with `weekSpan` beneath. Tap one, jump straight to that sealed week. Opened from
a small icon button beside the ‹ › walker **inside** the Week's Plan / Review floor on both
shells (`WeekPlanFloor.tsx` desktop, `WeekPlanCard.tsx`'s sheet on mobile) — not a new nav
item, not reachable any other way. `useWeekReviewList` (`hooks/useWeekReview.ts`) queries
every sealed `week_reviews` row, filtered to ones carrying a full report (skips the empty
placeholder rows `ensureRow` leaves behind). Degrades honestly on a fresh account: zero
sealed weeks renders one sentence, not an empty grid (Principle 7).

**Consequence, named rather than hidden:** this does nudge the 30% up slightly — a
jump-anywhere grid invites more looking-back than a forced one-at-a-time walk. The mitigation
is that the gallery only *reaches* Reviews; nothing about what a Review does once you're
inside one changed, so the forward-folding doctrine (every backward element hands something
forward) still governs the destination, just not the door to it.
*Status: standing — typechecked, driven in the dev app on desktop and at 375px, opened from
both the plan/review floor and the mobile sheet, past-week jump verified.*

**D-067 · 2026-07-31 · App-wide undo is two channels — toast for stakes, silent stack for
drags.** Fat-finger complete (and trash / ambiguous routing) need a discoverable Undo;
calendar drags must not spam toasts. One stack (`UndoProvider` / `useUndoStack`), two tiers
in `undoTiers.ts`:

→ **Tier A (toast + stack):** complete / reopen, trash, keyboard triage (`e`/`t`/`n`/`i`),
rail tab drops (D-063a destination labels), file-to-project. Coalesce ~1.5s into one toast
("3 tasks marked done"). Mobile's only recovery path.

→ **Tier B (silent stack):** calendar drag-drop / resize, slot & event moves, rail reorder.
Desktop recovers with ⌘Z; mobile drags back. No toast.

→ **⌘Z** at the root; stands down in inputs / contenteditable. No redo in v1. Agent card
undo stays on the transcript for now.

Closes the D7 failure mode (mistaken "finish") without violating P4 (neutral copy, never a
debt count). Extends D-063a; does not replace the rail-tab chip law.
*Status: standing.*

**D-068 · 2026-08-01 · The Find leaves the Review surface.** Phil: not valuable in
practice. The Review already answers W6 via landed projects + the completed-task
breakdown (by day / by domain). Find cards, story scenes, and the mobile teaser that
hinged on a Find are gone from the UI. `composeWeekFinds` / `week_reviews` Find fields
remain in the data path for now (sealed snapshots, optional narration) so we don't break
history — they just have no reader. Supersedes the "surface The Find" half of D-021's
product promise; the "at most one, hide when nothing notable" rule is moot while there's
no surface. *Status: standing.*

**D-069 · 2026-08-02 · The phone's record is the desktop record, and status is not the
headline.** Phil, on the mobile project/initiative record: "status is not important and
there's no way for me to add tasks which is problematic… I also don't see comments? This
should hopefully be a replica of what's on desktop." So the phone's detail sheet now
leads with the work and files the bookkeeping at the foot: **Week/Quarter → Tasks →
Comments → Momentum → Status**, where it used to be Status → Week → a read-only task
list and no thread at all. Tasks are editable on the phone (add via one free-text line
through `parseCapture`, toggle, delete-with-undo) — "scaffold it on the desktop" is not
an answer for a surface you carry. Comments are the *same* `RecordLog` the desktop
record mounts, not a phone copy. Status drops from five always-on chips to one native
`<select>` row; shipping still routes through `ProjectShipAssess`. *Status: standing.*

**D-070 · 2026-08-02 · The phone plans six weeks out, and the strip scrolls.** Phil:
four weeks is not enough runway — "not this month" had nowhere to land. The phone's
projects deck now reaches **six** weeks (`PHONE_WEEK_HORIZON`), which is more columns
than a 375px strip can show legibly, so the strip scrolls horizontally and the coverage
rows scroll in lockstep with it (one grid, two scrollers). The pool cell and the domain
icons are a pinned label gutter outside both scrollers, so "shelve it" stays reachable
from any column. The record's week picker takes the same horizon — a week you can drag
onto has to be a week you can tap onto. **Desktop is unchanged**: `OnDeckPlanner` and
the record rail's quiet band both keep the shared `HORIZON = 4` default, which is now a
prop rather than a constant. *Status: standing.*

**D-071 · 2026-08-02 · One hero per phone screen — the week you're standing in.** Phil,
on the mobile deck: "functionality is great but I find myself a little confused." The
deck stacked four full-weight bands (crown eyebrow · crown bar · the shaping line ·
strip · coverage) above a column head set in the same semibold sans as the section
labels, so the page's actual subject was the least prominent thing on it. The crown
collapses to one quiet line, and the column title becomes the hero in Fraunces
(`text-lead masthead`) like every other floor / day hero. The column head no longer
reprints `load/cap` — the strip cell directly above already carries that number — except
when over cap, where the warning is the point. *Status: standing.*

**D-072 · 2026-08-02 · Icon-only tap targets get a 44px hit box, not a 44px circle.**
Phil: "the close buttons for these things need to be larger overall on mobile, hard to
press." `.tap` only ever set `min-height`, so every ✕ / ‹ / ⋯ drawn at 32px stayed a
32px-wide thumb target. `.tap-icon` grows the *hit area* to 44×44 from the centre with a
transparent `::after` and leaves the drawn control exactly its old size — bigger target,
zero layout shift, nothing to re-tune per surface. Scoped inside the ≤767px block, so
desktop hit boxes are untouched. Applied to the bottom `Sheet` (which every mobile sheet
goes through), the detail sheet's back arrow, the chat close, search clear, the three
top-bar buttons, the trial banner's dismiss, task check/delete and the comment ⋯ menu.
*Status: standing.*

**D-073 · 2026-08-02 · The phone record's head is the desktop `Head`, and the sheet's
title row earns its keep.** Phil: "why are we showing the project card, we have title
there twice… top is a lot of misappropriated space." The name was printed in the sheet's
title row *and* again inside a bordered card below it, with the outcome and a progress
bar — three bands before the first section. Now there is **one hero**, named once (D-041):
the record body opens with the name in Fraunces (`text-display masthead`, editable) and
the outcome as the lead line under it, no frame — the sheet is already the card. The
title row, which has to exist anyway for Back / ✕ / the drag handle, carries the crumb
row at rest and cross-fades to the name once the hero scrolls past (iOS's large-title
collapse). Progress moved onto the section rules, where the desktop's `Sec` already draws
it. **The domain is now changeable on the phone** — the same `DomainPicker` the desktop
record wears, with the same cross-domain detach for projects and the same
takes-its-projects-with-it cascade for initiatives. The record no longer links *to* a
domain screen (desktop doesn't either); domain records stay reachable from global search.
Head height above the hero fell from ~135px to 81px. *Status: standing.*

**D-074 · 2026-08-02 · A bet is measurable from the phone.** Auditing D-073 across both
altitudes: the project record could be worked (tasks add / toggle / delete) but the
initiative record's **key results were read-only, and the section vanished when there
were none** — so a bet could never be made measurable from a phone, and "Measured" was a
readiness axis only a desktop could satisfy. The KR section is now always present with a
composer, and each result edits in place: name, current, target, unit, delete. Attainment
rides the section rule, matching the desktop record's `Sec`. Every section on all three
mobile records now uses one grammar — label · optional meter · the rule that doubles as
progress — instead of counts baked into the label text. *Status: standing.*

**D-075 · 2026-08-01 · Manifest `orientation: "portrait"` stays — and it is not the
landscape fix.** The mobile a11y pass flagged the PWA manifest's `orientation` field:
only an *installed Android* app honours it; iOS PWAs, mobile browsers and desktop ignore
it entirely, so it never addressed the real landscape bug (a sideways iPhone at 844×390
rendering the three-pane desktop shell). Kept deliberately — installed Android is the
one surface that can enforce it and the phone shell is a portrait design — while the
actual landscape fix lives in `useIsMobile`: a `(max-height: 500px) and (orientation:
landscape) and (pointer: coarse)` media clause that routes short touch viewports to
MobileShell on every surface. Don't mistake the manifest field for behaviour again.
*Status: standing.*

**D-076 · 2026-08-02 · In Aurora the app is three planes, and the chat is the one the app
rests on.** Phil brought a reference chat design and named the reason precisely: *"that
subtle border that wraps the whole app conveys that this chat fully understands everything
in the app."*

**First attempt was wrong and is worth recording.** I built *two* planes — a ground, and
one frame holding spine · work · chat side by side with a hairline between them. Phil
caught it against the reference: *"the right chat takes that layer while the rest of the
app is in a higher layer."* Re-reading the screenshot he was right — the backdrop photo is
visible **through** the chat, and the document pane is an opaque card floating above it.
Two planes flattens the whole idea; the chat has to be the substrate, not a neighbour.

So: `.app-ground` (deep paper) → `.app-shell` (frosted; **the chat is printed here**) →
`.app-canvas` (the app, raised, translucent, sliding left to *uncover* the chat). No
divider between sheet and chat — a divider says "two panes, one plane." `.atmosphere` sits
on the sheet with a new `--atmosphere-base` so it can go translucent without touching the
two lights, which is where the airiness comes from. D-019 holds: still painted once, still
continuous.

**Aurora only.** The other four materials kill `backdrop-filter` wholesale and E-ink zeroes
every shadow, so layered glass there becomes three flat rectangles pretending — worse than
the honest edge-to-edge they had. Scoped `html:not([data-skin])`; Flat/Terminal/Blueprint/
E-ink are untouched.

**Rejected:** (a) chat as a floating glass card in its existing rail slot — contained, but
no wrapping border, which was the entire point; (b) a true overlay slideout — covers the
work you're asking about, wrong trade for a planner. **Learned:** deriving `--ground` by
darkening `--bg` fails on already-dark materials — terminal's `--bg` is `rgb(11,14,10)` and
30% black gave 0.7/255 of separation. Dark grounds step toward `--line`. *Status: standing.*

**D-077 · 2026-08-02 · Only the user's line gets a bubble.** Nuvo's half of the
conversation runs free on the paper (`.agent-turn`) — no box, no fill, generous leading.
A reply boxed in `--surface-2` reads as a quotation from somewhere else and nests a frame
around the record cards inside it; unboxing is just "dissolve, don't frame" (D-019's
sibling) applied to the transcript, and it is where most of the reference design's space
and balance actually came from. What *you* typed keeps its bubble, because a quotation is
the one thing in the transcript that genuinely came from elsewhere. Per-turn actions
(copy · try again) rest at `opacity: 0`, come up on hover, and stay visible on touch.
`retry()` rewinds to just before the newest user turn so the retried answer *replaces*
the rejected one instead of piling a duplicate question onto the transcript. One
component, three surfaces (rail · phone `ChatPane` · ⌘K spotlight). *Status: standing.*

**D-078 · 2026-08-02 · When Nuvo has the candidates, the candidates go in the sentence.**
Any time a tool result or tool error hands the chat an enumeration of what the user might
have meant — `Candidates:` from an ambiguous project lookup, `unresolved` from
`propose_invite`, or simply two rows in context the words fit equally — the reply must
**name the options in prose**, by whatever tells them apart (the initiative a project sits
under, a person's full name), and *then* repeat them as taps. A bare "Which one?" or
"Which Matt?" is a **failed turn**: the user is being asked a question Nuvo was already
holding the answer to. This is what actually shipped when the rule was softer — terra put
both initiatives in the suggestion buttons and left the message body saying only "Which
**Build Dayspring Support Infrastructure** project should I update?". Correct buttons, and
still the 2026-08-01 bug from the user's side. So: the `<suggestions>` block is a shortcut
for the thumb, **never where the information lives** — it doesn't survive being read back,
read aloud, or rendered on a surface that doesn't draw buttons. The mirror half of the rule:
when the user answers ("the one tied to Get Dayspring into the Public"), that is a
disambiguator, not a new topic — call the tool again with the narrowing, and never end that
turn without it. *Status: standing.* Pinned by `structure-ambiguity-shows-the-options`,
`structure-spends-the-answer`, `invite-asks-when-a-name-is-two-people`.

**D-079 · 2026-08-02 · A tool result's instruction is a shipped constant, not prose the
battery retypes.** `supabase/functions/agent/toolNotes.ts` (pure, zero imports) owns the
`note` strings a tool result carries; `tools.ts` sends them and `tests/agent/scenarios.ts`
imports the same constants for its scripted results. The invite-disambiguation scenario had
been scripting a bare `{unresolved: […]}` while the deployed tool sent a `note` telling the
model what to do with it — so the battery was grading the chat against a *weaker*
instruction than production, and the pin failed for a reason production didn't have. Same
law as the planning kernel and `prompt.ts`, one layer down: **never put a rule where the
battery can't reach it, and never let the battery test a copy.** *Status: standing.*

**D-080 · 2026-08-02 · Who an event is with never picks a calendar — and never picks the
tool either.** The 2026-07-28 incident (a call with Tiffany Souers landing on a long-hidden
"Women's" calendar) is pinned as an invariant over *whichever* tool writes the event, not as
`create_calendar_event`. An event with another human routes through `propose_invite`
(D-069/D-046), so a pin that demanded `create_calendar_event` for "add a call with Tiffany
Souers Thursday at 3pm" was failing turns that obeyed the invite doctrine perfectly — two
correct rules, one scenario asserting their collision. The rule that belongs to the incident
is narrower and holds either way: **the subject of an event, and who it is with, never
select a calendar.** A pin should assert the invariant it was born from, not the code path
that happened to carry it that week. Applies equally to `cal-named-calendar-wins` — a
calendar the user *named* outranks their stored default, whichever tool carries it.
*Status: standing.*

**D-081 · 2026-08-02 · A conformance expectation that a correct chat cannot satisfy is a
bug in the battery, and it can hide the bug it was written to catch.** Four of the six
scenarios in this pass were not chat failures at all. `avail-from-windows-only` demanded
`pm` immediately after the hour, so every correct "1:00–2:30 PM" failed while the chat read
`todayOpenWindows` exactly as prompted. Three more asserted `calledTimes(<tool>, 1)` for a
call made in a **seeded `{assistant}` turn** — the harness only runs the model on the last
user message, so that call cannot happen. On `slot-add-to-existing` that mistake was
actively harmful: the count of 1 was satisfied *by the duplicate slot*, so the wrong number
concealed the exact bug the scenario is named for, and it read green. The rule: when a
scenario goes red, **establish whether the chat or the assertion is wrong before touching
the prompt** — a prose fix aimed at a broken assertion makes the prompt worse and the score
no better. For a "don't do it twice" pin after a seeded turn, the number is 0.
*Status: standing.*

**D-082 · 2026-08-02 · A suggestion's `message` is a tool argument, not prose — it carries
whatever actually resolves.** Live, the same day D-078 shipped: *"9am friday Stampede
Meeting with ryan weeks"*. That contact is a **Met before** row — harvested from calendar
attendance, so it has no display name, only `ryancweeks@gmail.com`. `pickRecipient` matches
words against handles (the name's words + the address's local part), so with no name the
only handle is `ryancweeks`: `ryan` prefixes it, `weeks` does not, and it fell through to
the fuzzy branch — which is deliberately never auto-taken, so a typo can't invite a
stranger. Result: `ambiguous` **with a single candidate**. Nuvo asked. Phil tapped *"Use Ryan
Weeks"*. The agent re-called with that same name, ran the identical failing match, and asked
again. **The question was unanswerable in the terms it was asked** — only pasting the
address ever worked. Two rules follow. (1) The human sentence stays human, but the tappable
`message` must contain the exact resolving token (the address), because words that just
failed to resolve will fail again — and D-078's "no email addresses in the prose" was being
read as covering the button too, which is what produced a dead-end tap. (2) **One candidate
is a confirmation, not a choice**: say who you have and that it's the only match, rather
than staging a "which one?" over a list of one. Pinned by
`invite-one-candidate-is-a-confirmation` and the new `suggestionsResolve` assertion — a
check that reads suggestion *messages*, because counting suggestions and reading prose both
saw this turn as perfect. *Status: standing.*

**D-083 · 2026-08-02 · The people the user works with are in scope.** Chasing the above,
`invite-lookup-is-read-only` was flaky at 8/10 — *"what's Matt's email?"* was sometimes met
with "I'm a focused planning partner — ask me about your schedule, tasks, or goals." The
Scope block listed planning, scheduling, structure and review, and **never mentioned
people**, so a contact question read as off-topic against the prompt's own definition —
while `find_contact` sat in the tool list built to answer exactly it. A shipped tool the
prompt gives no permission to use is a coin flip. Meetings are made of people: "who was on
that call?", "have I met her before?" are planning questions. Look them up; never turn one
away, and never answer one from memory. *Status: standing.*

**D-084 · 2026-08-05 · Work that has no time gets an act that gives it one — not only
three ways to give up on it.**

A project on this week's slate grew a task on a Wednesday, which is what projects do. It
landed in dead space: on a project the week claims to be moving, while itself off the week,
off the calendar, and outside the project's own sitting. The origin ⓞ: *"it actually
technically goes dead space… it just lives in the shadows within this new project."*

**The cause was an altitude mismatch, not a missing screen.** Bringing a *project* into a
week has been manual for a long time — On Deck's drag, the ritual's Projects step, the
phone — all writing `bringIntoWeekPatch`. One altitude down, `suggestPull` is the only
function that knows a week's on-deck projects' open work IS the point of the week, and it
had **exactly one caller in the repo**: the plan draft. So the act of giving project work a
time existed *only inside the automation*. **We had built the automated version of a flow
with no manual version** — the inversion of our own rule that AI automates a proven flow.

The app already saw it. `weekPlacement().looseMins` counted the orphan, and the Week's Plan
row said *"1.5h of what's left has no time this week"* mid-week (D-060). But every act
offered was a deferral — another week, next week, off the week. D-039 built the remedies
for *"it doesn't fit."* Nothing answered *"it fits — find it time."* So:

- **"Find it time this week"** now sits **first** on that row's panel, above the three
  deferrals. It composes with `composeWeek` (`lib/compose`) over the week's real remaining
  open time — the same composer the ritual uses, so the manual act and the automated one
  place work identically. It proposes and waits for a press (P3), and states what still
  won't fit rather than dropping it (P6). Reaches the phone for free: the panel already
  renders in the mobile Week's Plan sheet.
- **The Schedule's week crown opens.** Each project row in `WeekPanel` discloses its loose
  pieces, stamped `data-task-drag` — the attribute CalendarPane's FullCalendar `Draggable`
  already watches across the whole rail. No new drag machinery, and the manual gesture now
  exists at the altitude that was missing it.

**Rejected: a third rail tab (Projects, beside Inbox and Today).** It was the proposal on
the table. It is a fourth pool on the rail, and P10's bar — a new abstraction needs a second
instance — isn't met by a pool whose contents were *already on the rail*, read-only, in the
crown. Giving the existing pool depth costs no new noun and no new destination. Kept the
word already on screen, **loose**, so nothing entered the glossary.

**Two silent defects surfaced with it, both fixed.** (a) `applySlots` never wrote
`slots.project_id`, so nothing could ask whether a project already had a sitting this week —
which is *why* a top-up was impossible. (b) Consequently, re-planning mid-week INSERTed a
**second slot with the same project title** beside the first (`keptTasks` drops already-placed
siblings, and `commit()` only ever inserted). A sitting is now topped up in place: it keeps
the day and time it already holds, and only grows to cover what's being added.

**The gate held.** `block()` and `assignToSlot()` don't stamp `sprint_id`, so a naive drop
would have written a `do_date` with no week behind it (P2). Crown rows carry
`data-task-week`, and the drop commits them to the sprint in the same gesture; the composer
path ensures the week via `ensureWeek()` before writing. Placing project work is a
deliberate act, not the same-day reactive capture P2 exempts.

**Out of scope by decision:** whether Plan the Week's *placement* step is redundant with the
Schedule. It is a real question — the ritual decides *which projects* and *which loose work*,
and then places in a second grid — but Phil's call was to leave the ritual alone. Not logged
as an open question; recorded here only so the omission is deliberate.

→ **Extended 2026-08-05 · the other half: what HAS a time.** Shipping the loose half alone
left a lopsided app — you could see by name everything homeless and still nothing that was
placed. Asked directly ("does this show which tasks have a time block?") the answer was
*no, it shows the inverse*, and the gap ran deeper than the crown: **the project Record was
silent about time entirely.** `floors/TaskList.tsx` rendered checkbox · title · duration ·
KR chip · delete, and a grep of `src/components/record/**` for
`start_time|do_date|slot_id|scheduled` returned **zero matches** — while the row's own
`VTask` prop already carried `doDate`, `slotId` and a derived `status: "scheduled"`. The
data was in the props, unread. So "which piece of this project has a Thursday block" was
answerable only by opening every task's SlideOver in turn.

- **The crown discloses both halves** — *has a time* (day + start, not draggable: they're
  on the grid, and a second place to drag one thing is a second answer to one question, P8)
  and *loose* (unchanged, still draggable). The pill states the split (`3 of 5 placed`), and
  goes grey rather than amber once nothing is homeless (P9).
- **One pass, not two filters.** `splitFor` partitions in a single loop over
  `isPlacedInWeek`. Two independently-written predicates showing lists side by side is
  exactly how a task ends up in both or neither; a test now asserts the partition.
- **Both records say when.** `whenText` distinguishes three genuinely different
  commitments — a block (`Thu 9:00am`), a sitting (`Thu · in a sitting`, since the slot
  holds the clock), and a day with no block (`Thu`) — and is shared by the desktop record
  and the phone's, so one shell can't answer what the other can't. `VTask` gained a
  `startTime` pass-through it had always dropped.
- **Silent when there's no time.** Backlog work is *deliberately* undated, so stamping "no
  time" on every row would dress a decision up as a debt (P4, P9).
- **`TaskRow` untouched.** Its no-clock rule — *"the calendar sits inches away rendering the
  very same block"* — is correct **for the rail**. A record has no grid on screen to
  restate.

→ **A comment in `LeftRail` was simply false.** It justified merging the planned and
scheduled sections with *"a blocked task already shows its time."* `TaskRow` never shows
it, and in fact **suppresses** the date label once `start_time` is set — a scheduled row
renders strictly *less* than an unscheduled one. So the desktop Today list lost the
scheduled/unscheduled distinction in both the grouping and the row, on the strength of an
affordance that does not exist. The comment is corrected. **Whether the split should return
is left open on purpose** — that's a product call, not something to settle inside a fix.
(Mobile still keeps its "On the clock" header, where no grid sits beside the list.)

→ **Correction 2026-08-05 · the crown's drag never worked. Three blockers, all shipped.**
The rows carried `data-task-drag` and the ghost followed the pointer, so it *looked* built —
but nothing could land. Recorded rather than quietly patched, because each one is a trap the
next draggable surface will walk into:

1. **The drop couldn't find the task.** `CalendarPane`'s `tasks` prop is the **render set**
   (inbox · today · sprint · scheduled · anytime · slot children). A project's loose work is
   deliberately in none of them — no `do_date`, no `start_time`, no `sprint_id` — so
   `findTask` missed and `onReceive` called `info.revert()`. Fixed with `resolveDropTask`,
   kept **separate** from `tasks` on purpose: that set also feeds `fcEvents`, so widening it
   to fix a lookup would start drawing untimed work on the grid.
2. **`WeekBoard` had the identical gap** in the Spread view (`taskById` over the same five
   pools, bailing at `if (!task) return`). Same resolver threaded through. Its sprint stamp
   was already correct.
3. **On macOS the drag moved the WINDOW.** The crown lives inside the rail's
   `data-tauri-drag-region="deep"` zone, so a row drag was a window drag. `TaskRow` and the
   rail's task list already carry `data-tauri-drag-region="false"` for exactly this; the
   crown had never needed it because it had never offered anything to drag.

**The lesson worth keeping:** a drag affordance is four things — the source attribute, the
drop resolving the id, the write, and the platform not stealing the gesture — and a
typecheck proves none of them. This is precisely the class of defect the "verify in the
running app" rule exists to catch, and it shipped because that step was skipped.

*Status: standing — typecheck clean, 376 tests green (3 new: the shared placed/loose
predicate and its partition), web + desktop builds green. **Not driven in a running app:**
this remote container has no Supabase credentials (`.env.local` is gitignored), so the dev
server serves the login wall — confirmed, not assumed. Everything below the UI is covered
by tests; what needs eyes is the crown's two groups and its drag, the proposal panel, the
per-row time in both records, and a mid-week re-plan producing one sitting rather than two.*

**D-085 · 2026-08-06 · The Domain wall shows the week's *shape*, not its share — and
"hidden" means hidden from the ledger too.**

Origin ⓞ: *"most of my time is definitely spent at SCE. why or how is that not
reconciled?"* The wall read **SCE 4.3h · 23%** for a week that actually held **27.9h** of
SCE meetings. Three causes, compounding — the first two are bugs, the third is this
decision.

1. **The calendar contributed exactly zero.** `useExternalEvents` ran an unbounded
   `.select()`. PostgREST caps that at **1000 rows and returns them in physical order**, so
   the domain ledger's 13-week window (1,363 rows) came back as the *oldest* 1000 — **not one
   event from the current week**. Every hour on the wall was a completed task; every meeting
   was invisible. This is the **third** incident from the same cap (see the routing loop, and
   `useEventRouter`'s own paged key set) — the pattern is now: *any list query whose result
   set is a **set** rather than a page must page.*
2. **`event_domain_routing` was truncated the same way** (1,342 rows, 1,000 read), so the AI
   router's cached verdicts silently reverted to "unattributed."
3. **Hidden calendars were still in the ledger** — and that is the interesting one, because
   fixing (1) would have made it *worse*. Phil's SCE work calendar is mirrored into his
   personal Google account, and his iCloud family calendar into a second one; **24 of this
   week's 35 SCE events exist twice**. Counting both would have shown ~50h of SCE. So:
   **what the user takes out of the busy math comes out of the hours ledger too.** One rule
   (`ActualsFilter` in `eventActuals.ts`), applied by `buildVertical`, `buildWeekEvidence`,
   and the AI router — which now also stops spending completions on time it would never
   count. **A mapping does not override a hide**: if you want hidden time counted, unhide the
   calendar. Phil, asked directly about the ~8.5h/wk of church calendars that are hidden *and*
   unmapped: **leave them out.**

**The visualization.** The read was a 100%-stacked share bar. A share cannot tell a 40-hour
week from a 4-hour one, and it flattens *when* into a percentage. Replaced with **seven day
columns** on an absolute scale (floor: an 8h day), stacked by domain in one stable order,
today in `--signal`, days still ahead as open `--slot` track. Offered against two
alternatives (hours-vs-vow bars, both-with-a-toggle); Phil picked the day shape — *"which
days got eaten"* is the question he was actually asking.

**Known and deliberately not fixed here:** a day column sums attributed minutes, so
concurrent time double-counts — Monday reads 16.5h against ~8.8h of union calendar time plus
task estimates. The share bar hid this; the day view exposes it, which is an argument for the
day view. Making a day the *union* of busy minutes (splitting a contested minute between
domains) is a real change to what `investedThisWeek` means and belongs in its own decision.

*Status: standing — typecheck clean, 423 tests green (7 new in `tests/event-actuals.test.ts`,
1 pre-existing agent-prompt baseline failure untouched), web + desktop builds green, driven
in the running dev app against real data: SCE 4.3h/23% → **27.9h/51%**, and the week's shape
renders at 768px with no overflow.*

**D-086 · 2026-08-07 · The Domain comes to the phone at full parity — as the fifth tab,
over one shared voice.**

Origin ⓞ: *"mobile view of domains. Full desktop feature parity. There's now room on
bottom bar."* The anchor altitude was the only one you couldn't reach on a phone: the bar
carried Calendar · Tasks · Projects · Initiatives, and a domain was reachable only by
accident — a global-search jump into a thin sheet with a pulse, a target field and a task
list. Q7 (*"am I being faithful in what I've been given?"*) was answerable **only at a
desk**, which is the wrong place for it: the question shows up on a Tuesday night, not
during a planning session.

**What shipped.** Domains is a fifth bottom-bar destination (all five labels fit at 375px,
57px tall — measured, not assumed). It opens the **wall**: the week's shape strip, then
one card per domain carrying the living sigil, the state word, the vow, the Gain numbers
and the "routes clean" mark. Tapping one opens the **open domain** in the shared detail
Sheet, now carrying everything the desktop plate does — the sigil hero and faithfulness
voice, the 13-week pulse against your intent, the Gain (quarter · week/target · streak ·
blocks) with the deep-work/meeting split, what you've built, the portfolio with each bet's
outcome-vs-build bars and at-risk chips, Nuvo's read, the grooming workbench, ＋project /
＋initiative, and delete. The two things the phone does its own way: the sigil form and the
domain's light are a disclosure under the hero rather than hover-revealed corner chrome
(there is no hover), and "Parked here" is an editable list with a composer rather than the
desktop's count, because capture on a phone is the point.

**The decision that matters is not the tab — it's that neither shell owns the domain's
voice.** "Quiet for 9 days", "needs grooming", the four sentences of Nuvo's read, the
week's shape and the shipped list now live in `lib/domainRead.ts`, and the marks that draw
them in `components/domain/DomainParts.tsx`. Both shells import both. The desktop floor
lost ~490 lines and gained nothing; the phone got parity for free. This is the same rule
as the planning kernel (D-032, `planningRules.ts`) applied one altitude up: **a domain that
reads "quiet for 9 days" at a desk says exactly that in your hand, because there is only
one place that sentence is written.**

**Verification.** No account credentials exist in a fresh container, so the surfaces were
driven against fixtures instead of guessed at: `?domains` (`mobile/DomainHarness.tsx`)
mounts the wall, the open domain (tended · quiet · never-touched) **and the desktop floor**
over one fabricated store, so a divergence between the shells is a difference you can see.
Interactions driven, not assumed: tapping a wall card opens that domain, the composer parks
a real task, the form/colour disclosure writes through, the routing workbench opens. Ten
colour swatches can't be 44px in a 375px row, so the drawn circle stays 32px and
`.tap-bloom` grows the hit area — every control in the open domain now clears 44×44 at
375px, audited in the browser with the mobile media query actually applied.

*Status: standing — typecheck clean, builds green (web + desktop), 382 tests green (the one
pre-existing agent-prompt baseline failure untouched), no horizontal overflow at 375px in
either theme.*

**D-087 · 2026-08-07 · A tapped suggestion says the label, not the message — the button
does the talking.**

Origin ⓞ: *"I press a button and it literally will send the underlying message in the
message. That feels awkward, like putting words in my mouth."* The transcript rendered the
suggestion's `message` as the user's own line, which was already impossible to write well,
because D-082 had settled that **the `message` is a tool argument, not prose** — it has to
carry the thing that actually resolves. So the two rules collided in the worst possible
place: tapping *"Ryan Weeks"* made the transcript claim the user had typed
*"Use ryancweeks@gmail.com"*. Same failure with a seeded turn — the event sheet's *"Ask
Nuvo to help prepare"* wrote a whole constructed paragraph (title, time, location) into the
user's mouth, and *"Plan with Nuvo"* said *"Help me plan this week."* Nobody talks like
that, and a transcript that misquotes you is a transcript you stop trusting as a record.

**The split.** `AgentMessage` gains `display` — what the user *did*, kept apart from what
Nuvo *hears*. `sendMessage(text, files, { display })` sends `content` on the wire, exactly
as before, and renders `display` in the transcript. The label never reaches the model, so
it can't be mistaken for an instruction; the resolving token never reaches the page, so it
can't be mistaken for something the user said. `AgentSuggestionChips` now hands its caller
the whole suggestion rather than the message alone — a caller given only the message
*cannot* tell the transcript what was pressed, which is how this shipped in the first
place. All three chat surfaces (rail · phone `ChatPane` · ⌘K spotlight) and both seeded
turns route through it, and `retry()` carries the label so a retried tap is still a tap.

**A pick is not a bubble.** D-077 gave the user's line a bubble because a quotation is the
one thing in the transcript that came from elsewhere — but a tap is not a quotation, it's a
point. So it renders as `.agent-bubble-pick`: a quiet pill with a ✓, lighter than the user
bubble on purpose, because **pointing is a smaller act than speaking**. The wire text stays
reachable as the pill's `title` and nowhere else. The rejected alternative was sending the
turn *silently* — nothing in the transcript at all, which is what the ask literally
described. It loses the record: scroll back an hour and there's an answer to a question you
can no longer see yourself having answered. A concierge doesn't repeat your order back
verbatim and inflated, and doesn't stay silent either — they confirm the choice in one
short line. That's the pill.

**What this asks of the prompt (unchanged, now load-bearing).** The `label` was already
specified as the human sentence and the `message` as the resolving token; that split is now
what the user reads as their own voice, so a label written as instruction-to-Nuvo rather
than in the user's voice is now a visible defect rather than a cosmetic one. No prompt edit
shipped with this — the existing labels read correctly as speech — and changing the prompt
gates on `npm run eval`, which needs a live model this container has no key for.

**Verification.** No account credentials exist in a fresh container, so the transcript was
driven against fixtures at `?chat` (`AgentPickHarness.tsx`, precedent `?invite` / `?meet`):
desktop rail and phone column side by side, seeded with the two shapes that fail loudest —
the D-082 address and the event sheet's paragraph — plus a live chip row, so tapping was
exercised, not assumed. Confirmed the pill renders the label and never the wire text, in
both themes, with the ✓ sitting on the first line of a wrapping label.

*Status: standing — typecheck clean, 386 tests green (the one pre-existing agent-prompt
baseline failure untouched, as in D-086), no horizontal overflow at 375px in either theme.*

---

**D-087 · 2026-08-07 · A ship is a touch. Quiet after finishing is not quiet before
finishing, and the domain speaks in weeks because it is measured in quarters.**

Origin ⓞ: *"I go to domain, it says this has been quiet for 7 days for Stampede when in
fact I finished a major project this week. So that's not only untrue, the signal is really
quite the opposite."*

**The input was incomplete — the same failure shape as D-085.** `Domain.lastTouchedDays`
was derived from exactly two sources: completed **tasks** and attended **calendar events**.
Shipping a project stamps `projects.shipped_at` and nothing else, and the ledger never read
it. So a finish line reached the domain only by the accident of a task that happened to be
checked off — and three ordinary ways of finishing produced silence instead:

1. ship a project carrying no tasks;
2. ship with the **drop** verdict — `ShipAssess` trashes the leftovers, and trashed rows are
   filtered before the ledger, so **finishing deletes its own evidence**;
3. ship a project whose last task closed the week before (the reported case).

The failure was therefore *correlated with finishing well*: the more decisively you closed
something out, the more neglected its domain looked. **The wall punished completion.**

**But the missing input was only half of it.** Days-since-last-task measures **liveness**,
not faithfulness — and the domain exists to answer Q7, *am I being faithful in what I've
been given?* `overview.md` opens by stating the product's purpose — *"so a week of being
busy is never mistaken for a week of being faithful"* — and this signal did the inverse: it
mistook a week of not-being-busy for a week of not-being-faithful. It also alarmed at **3
days** and rendered `warn` → `var(--signal)`, which is red-alert styling for a non-urgent
state — P4's own *violated when* — while `overview.md` sets the domain horizon at **a
quarter**. That is day-altitude urgency on a quarterly instrument, and it is how "quiet for
7 days" turned into an accusation. **D-061 had already ruled the tone** (*"never shame a
quiet domain, since sometimes weighting elsewhere was right"*); it was simply never wired to
this surface.

**What shipped.**

- **Finish lines fold into the ledger** (`buildVertical`), contributing a **touch, not
  hours** — never into `investedThisWeek`, the 13-week pulse or the day columns, because an
  hour is a thing you can point at and a ship is not a duration (P6). Fixing the *input*
  rather than the readers means the sigil glows, the weekly **Pull** stops proposing a "get
  back to it" task because that domain is starving, and Standback stops nominating it as the
  quietest — all without touching a single surface.
- **Drift and delivery are told apart.** `DomainState` gains a `because`
  (`kept · shipped · resting · drifting · unstarted`) rather than a third `tone`: `tone` is
  consumed as `=== "lit"` at four sites driving ~14 style ternaries, and an unhandled third
  value would silently fall into the *quiet* visual branch — painting a just-shipped domain
  as neglected, with no compiler error anywhere.
- **The voice is restrained on purpose.** A freshly shipped domain names the ship in the
  hero and says **nothing** in Nuvo's read — no affirmation, no forward-fold. Saying it
  twice would make it a trophy, and P9 rules out the badge register. Once the glow passes:
  *"You shipped X here 30 days ago. It's been quiet since — that's what finishing looks
  like."* Rest after delivery is the shape of completion, not a lapse.
- **Quiet re-scaled to domain altitude.** Nothing is said below **two weeks** — the pulse
  above already draws it. Past that it speaks in weeks and carries the kept-count as
  evidence (*"3 of the last 13 weeks kept"*), which makes a gap read as a trough in a
  rhythm; when the count is zero there is no rhythm to point at, so it states the gap once
  and stops. Every `warn` in the rhythm read became `info` / `good`, and the quiet chip gave
  up `--signal`, which P9 reserves for **now**.
- **The 99 sentinel is gone** — `lastTouchedDays` is `number | null`. `99` was silently
  plausible: it read as a number everywhere and made a domain last touched 120 days ago
  claim *"no time has been kept here yet"*, which was false. `null` made the compiler
  enumerate all 13 readers, which is the D-085 lesson turned into a mechanical check.
- **Shipped work is filed by when it shipped**, not by when it was due — `shipped.ts` groups
  on `shippedAt` with `targetDate` as the fallback for initiatives. The rail's own comment
  had justified `targetDate` as "durable and reconstructable"; that argument is right about
  counting **wins**, but `shipped_at` is equally stored and was **backfilled** to
  `target_date` by migration 35, so it is never thinner and usually truer — the same call
  the kernel already made (*"`shippedAt` is the only honest answer — `targetDate` is when it
  was DUE"*). This also un-hides completed projects with no finish line set, which were
  invisible on the Gain rail forever. **Historical Gain counts move on deploy** — expected,
  not a new bug.
- **Two P11 collisions closed.** `stateOf` said "Groomed" for time kept while `clarityOf`
  said "needs grooming" for routing — three lines apart on the same mobile hero. Faithfulness
  takes **Kept** (already its verb); routing keeps **grooming**. Both are now in the glossary,
  along with **Shipped**, which had no entry at all.

**Known gap, deliberately not closed here:** initiatives have no completion stamp — there is
no `initiatives.shipped_at` — so only projects fold into the ledger, and initiative grouping
still falls back to `targetDate`. A schema change shouldn't ride a bug fix; logged as Q-12.

*Status: standing — typecheck clean, builds green (web + desktop), 415 tests green including
15 new ones over the real `buildVertical` (the one pre-existing agent-prompt baseline failure
untouched, verified identical on the base commit). Driven at `?domains` at 375px and 1440px:
the reported card now reads **SHIPPED** with a glowing sigil, no horizontal overflow, and
both shells agree — which is the divergence check D-086 built that harness for.*

**D-088 · 2026-08-07 · A parented task belongs to its parent's domain. The stored
`tasks.domain_id` is a cache, and the cache was outvoting the truth.**

Origin ⓞ: *"confused. i shipped something this week which is great but showing 0 hours/this
week."*

The open domain read **Shipped Get Stampede Ready for ATC Review yesterday** in the hero and
**0h / 0h this week · 0wk current streak** in the row beneath it. Both were true statements
from the same ledger, which is what made it hard to see.

`tasks.domain_id` is a *denormalized copy* of the parent's domain, stamped at the moment the
task is filed (`setProject` writes `domain_id: p?.domainId ?? task.domain_id`). It goes stale
the instant the project is re-homed — and nothing re-stamps it. Every reader in the app then
asked the copy **first**: `t.domain_id ?? project?.domainId ?? initiative?.domainId`. The
fallback chain existed, but it only ran when the copy was *missing*, never when it was
*wrong*. Live data:

| Stampede project | done tasks | `domain_id` they carried |
|---|---|---|
| Get Stampede Ready for ATC Review | 9 (7.75h **this week**) | Frontier |
| Stampede v3 | 5 | Trading |
| Stampede marketing website | 7 | Trading |
| Meridian Phase 2 | 7 | **null** → resolved correctly |

The only project whose hours reached Stampede was the one whose tasks had *no* stored domain
— the case where the fallback was allowed to run. Frontier and Trading were quietly inflated
by exactly what Stampede was missing, so no total looked wrong anywhere; only the attribution
was.

**The rule, in one place:** `resolveDomainId` (`src/lib/vertical.ts`) — if a task has a
project, the project's domain wins; if it has an initiative, the initiative's does; the
task's own id is authoritative only for a **loose** task, which has no parent to ask, and
remains the fallback when a parent has no domain of its own. `buildVertical`'s ledger derive,
`taskDomainColor`, `taskDomainId`, the rail, the task list, the task sheet and the SlideOver
all read it. The stored copies stay in the database and are simply no longer consulted for
parented rows — no backfill, because a derive that ignores the cache can't go stale again.

**The general lesson (third time — D-085, D-087, now this):** the domain ledger has been
wrong three times and never once by miscalculating. It was wrong about its *inputs* — a
truncated query, a missing source, and now a trusted stale copy. A number that is arithmetically
correct over the wrong rows is the failure mode this subsystem actually has, and `??` chains
are where it hides: the operator that means "when this is missing" reads as if it means
"when this is wrong".

*Status: standing — typecheck clean, 20 tests over the real `buildVertical` including three
pinning the precedence (parent wins · loose task keeps its own · fallback when the parent has
none). Verified in the running dev app: Stampede's week went 0h → **7.8h**, Frontier 10.6h →
5.3h.*

---

**D-089 · 2026-08-07 · *Vow* and *faithfulness* are retired. A domain's line is a
**mandate**; the axis is **showing up**.**

Origin ⓞ: *"can we remove faith language from these domains. 'vow' 'kept faith' — makes no
sense to me and wont make sense to others."*

[`brandscript.md`](./brandscript.md) §10 explicitly blessed both words: D-027's register table
listed **vow · faithful** under "tangential — in", the column for words that carry moral
weight and are *fully usable by anyone*. The test was: would a reader who shares none of these
convictions still find this the most precise word, or would they feel addressed as an
outsider? On the running screen, the answer came back from the person who wrote the
convictions — it read as a register, not as precision.

Retired from copy **and from code**, because a surviving identifier is how a dead word gets
back into a string (the D-053 lesson, applied harder this time): `faithfulness()` →
`showingUp()`, `FaithPulse` → `PresencePulse`, `WinKind.kept_faith` → `kept`, `faithWins()` →
`keptWins()`, `hoursVow()` → `hoursNote()`, and the comment layer that taught the vocabulary.
`domains.intention` keeps its column name.

Copy that moved: *State the standing vow…* → *…standing mandate…* · *Kept faith N of the last
13 weeks* → *Showed up N of the last 13 weeks* · *Measured by faithfulness over a long arc* →
*Measured over a long arc by whether you keep showing up* · *You're keeping faith — a 5-week
streak. This one's tended* → *You've shown up 5 weeks running. This one's steady* (which also
retired a stray *tended*, D-006) · Summit's **The Vows** → **The Mandates** · the Gain's
subtitle *what this domain has cost you* → *what you've actually put in*, which had been
contradicting its own heading. **Faith** also stopped being an example domain in the
first-run copy and the Settings blurb — a religious *default domain* is "explicit — out" under
D-027 and always was.

**What the register table is, after this:** a hypothesis about how a word lands, not a
finding. The app is where it gets tested, and a tangential word that survives review but not a
real screen is out.

*Status: standing — typecheck clean, full suite green.*

---

**D-090 · 2026-08-07 · A ship books the work its tasks never ledgered — and nothing more.**

Chasing D-088, the ledger's other half was re-opened: D-087 had ruled that a ship contributes
a **touch, not hours** (P6 — an hour is a thing you can point at). That left a shipped week
visually indistinguishable from a dead one, so the rule was reversed: a ship now books
`max(0, planned − ledgered)` at its ship date, where *planned* is the project's non-trashed
task effort and *ledgered* is what already reached the ledger as a checked-off block.

**It is deliberately near-inert, and that is the honest outcome.** A project only reaches
`complete` when every task is closed (or dropped, and dropped rows are trashed before the
ledger sees them), so `planned − ledgered` is zero for essentially every real ship. The gap it
genuinely closes is the task marked `done` with a null `completed_at` — real in older rows,
and invisible to a ledger that keys every hour off that timestamp.

Worth stating plainly because it was almost built as something bigger: the reported symptom
looked like "shipping should count as hours", and the fix for it was D-088's attribution rule.
Had the ship simply been credited with its project's effort, it would have double-counted
every hour those tasks already contributed and papered over the real bug at the same time. The
subtraction is what keeps it honest, and the fact that it usually evaluates to zero is the
proof that the hours were already there.

*Status: standing — pinned by three tests (`A2` the null-`completed_at` gap, `A3` no double
count, `B` dropped work contributes nothing).*

---

**D-091 · 2026-08-07 · A write is durable before it is sent. Nuvo has an offline
outbox, and per-field last-write-wins is the conflict rule.**

Nuvo was a server-authoritative thin client: every one of 123 write sites called Supabase
directly, the query cache lived in memory only, and a write made offline was **actively
destroyed** — it retried three times, then `onError` rolled the optimistic patch back. The
user watched a capture appear, sit for ten seconds, and vanish. On the phone, where offline is
the normal case, opening the app with no network showed an empty planner.

The fix is an IndexedDB outbox (`src/lib/sync/`, spec [`offline-sync.md`](../offline-sync.md)).
`queueWrite` resolves when the op is **durable**, not when Postgres acknowledges it; nothing is
ever rolled back. Three things make replay safe: **client-generated row ids** (a server-side
uuid cannot be replayed — a lost response means a duplicate row), **per-field timestamps** so
two devices editing different fields both keep their work, and a **monotonic `seq`** so a child
insert never overtakes its parent.

Conflict resolution is per-field LWW in `apply_patch` (migrations 53–54), `SECURITY INVOKER` so
RLS still decides what a caller may touch. Because the outcome depends only on the timestamps
and never on arrival order, out-of-order delivery *converges* rather than merely not crashing.

Two consequences worth naming. **Invalidation is now conditional** — an unconditional refetch
while writes are queued returns rows that predate them and wipes the user's offline work, so
mutations call `invalidateWhenSafe`. And **the persisted read cache is cleared on sign-out**:
Nuvo is multi-tenant and that cache is on disk, so leaving it would rehydrate one account's
tasks for the next person to sign in on the device.

Known limit, deliberately accepted: `field_ts` is client wall-clock, so a wrong clock can win or
lose an exchange. The RPC clamps future stamps to `now()`, which bounds a fast clock; a slow one
still loses. A hybrid logical clock would close it.

*Status: standing — tasks, the vertical record CRUD, slots and record comments are converted;
50 writes remain online-only, inventoried in the spec. 96 tests in `tests/sync/`.*

---

**D-092 · 2026-08-09 · A shipped project/initiative gets a heavier, tinted mark — a
deliberate, scoped strain of Principle 9.**

The On Deck card, the Shipped wall's card, and both records used to mark "finished" the same
way everything else settles — a faded card or a single small check. Read back against a real
screenshot, a shipped card was indistinguishable from a healthy in-progress one at a glance,
the opposite of what the state needs to say. The fix (`ShipSeal` in `floors/parts.tsx`,
shared by `DeckCard.tsx`, `ShippedWall.tsx`, and both record headers) gives shipped work a
tinted card background, a bigger badge, and a bolder label — and scales that weight by
altitude, since a finished initiative is a bigger deal than a finished project (the same
"scope reads as mass" rule D-048 established for the live card).

This leans on Principle 9 ("quiet by default… violated when something animates, colors, or
notifies for engagement rather than information") and on D-087's explicit ban on a "badge
register" for a freshly-finished thing. Decided deliberately, not silently: the treatment is
**static only** — no pop, glow, or one-time celebration. The app already has that primitive
(`useRefinedCelebration` + `.seal-draw`, built for the "all groomed" seal) and it was
considered and declined here, specifically to keep this on the "information" side of P9's
own test rather than the "engagement" side. If this starts reading as a trophy in practice,
that's the signal to revisit.

*Status: standing.*

---
---
## 3 · Open questions (decide these deliberately)

| # | Question | Why it matters | Blocked on |
|---|---|---|---|
| **Q-01** | ~~Does mobile get the vertical?~~ **Partly answered by D-030 and D-031** — the phone gets the *planning* surfaces (the decks, editable), the light records, and now the weekly ritual (Plan the week). Still open: does it get **grooming** — shaping one project to ready (the Groom deck / `ItemRun`) — or does shaping stay a desktop act? | Decides whether the phone can answer W5/Q1, or stays an execution surface | A real read on where grooming actually happens |
| **Q-02** | Is *refusal* a first-class act at Summit — an explicit "not this quarter" object? | Q6 in the Question Ledger is ◐ because there's nowhere to put a no | Wanting a "refused bets" surface at all |
| **Q-03** | Does non-calendar work become visible via activity sources beyond GitHub? | W8 ("where did my time go") is ◐ while shipped-but-unblocked work is invisible | The GitHub instance proving the pattern |
| **Q-04** | Should `TendingFlow` be retired now the Refine run has proven out? | Two grooming paths is a Principle 11 violation waiting to happen | Refine run confidence on real data |
| **Q-05** | What is the transitional CTA on the marketing site? | Currently direct CTA only — the biggest funnel gap (brandscript §5) | Picking one and writing it |
| **Q-10** | ~~Do the two first-run surfaces compose?~~ **Mostly answered by D-059** — the sequence is now deliberate and each surface asks one question: the picker collects *what you carry*, the fork asks *how you want to learn*, the path teaches. Still open: nobody has watched a stranger take the pair back to back, and the live door's auto-advance transition is unverified (every milestone is pre-satisfied in the builder's account) | Principle 8, and whether the fork reads as a choice or as a wall | One genuinely fresh account, watched |
| **Q-07** | Where do timezone and working hours come from for a new account? | Rollover is LA-anchored and hours default to 480/990. Both are silent wrongness for anyone else — and capacity math depends on them | Reading how the rollover cron and `user_settings` actually resolve per user |
| **Q-11** | Where does Monday's reader for `note_to_monday` live? | The Find has written this column since migration 33 and **nothing reads it** — the surface that did went with the Today rung. It's a letter from Friday-you to Monday-you that never arrives, and it's the precedent D-062 was written against. Either give it a reader or cut the field; leaving it is the one thing that shouldn't continue | Deciding which surface Monday actually opens on |
| **Q-12** | Does an initiative get a completion stamp (`initiatives.shipped_at`)? | D-087 gave projects an honest ship date and folded them into the domain ledger. Initiatives have no stamp at all — `status === "complete"` and nothing else — so a finished bet neither keeps its domain warm nor files under the quarter it actually landed in; it files under the quarter it was *due*. The fallback is honest about being a fallback, which is why this is a question and not a bug | Whether a migration is worth it, or whether the bet's finish line is close enough at quarter grain |
