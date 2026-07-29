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
