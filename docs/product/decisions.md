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
here.* **(b)** The desktop had a
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
| **N-12** | Pasting the video-call link into the event description | It's the *unstructured* copy of a structured fact (D-056): invisible to every client's Join button, doesn't move when the meeting does, outlives a removed conference, and can't be told apart from a link a human typed. `conferenceData` is the field they all already read | A provider Nuvo writes to has no conference field at all — and even then, say plainly that the link is pasted |

---

## 3 · Open questions (decide these deliberately)

| # | Question | Why it matters | Blocked on |
|---|---|---|---|
| **Q-01** | ~~Does mobile get the vertical?~~ **Partly answered by D-030 and D-031** — the phone gets the *planning* surfaces (the decks, editable), the light records, and now the weekly ritual (Plan the week). Still open: does it get **grooming** — shaping one project to ready (the Groom deck / `ItemRun`) — or does shaping stay a desktop act? | Decides whether the phone can answer W5/Q1, or stays an execution surface | A real read on where grooming actually happens |
| **Q-02** | Is *refusal* a first-class act at Summit — an explicit "not this quarter" object? | Q6 in the Question Ledger is ◐ because there's nowhere to put a no | Wanting a "refused bets" surface at all |
| **Q-03** | Does non-calendar work become visible via activity sources beyond GitHub? | W8 ("where did my time go") is ◐ while shipped-but-unblocked work is invisible | The GitHub instance proving the pattern |
| **Q-04** | Should `TendingFlow` be retired now the Refine run has proven out? | Two grooming paths is a Principle 11 violation waiting to happen | Refine run confidence on real data |
| **Q-05** | What is the transitional CTA on the marketing site? | Currently direct CTA only — the biggest funnel gap (brandscript §5) | Picking one and writing it |
| **Q-10** | Two first-run surfaces now exist — the **Orientation** tour (8 steps, teaches the app) and the **domain picker** (collects what you carry). Do they compose, merge, or does one go? | Principle 8 (one surface, one question) and Principle 11. They're currently sequenced picker → tour, which is defensible — *collect, then teach* — but nobody has watched a stranger go through both back to back | Driving the pair in a fresh account |
| **Q-07** | Where do timezone and working hours come from for a new account? | Rollover is LA-anchored and hours default to 480/990. Both are silent wrongness for anyone else — and capacity math depends on them | Reading how the rollover cron and `user_settings` actually resolve per user |
