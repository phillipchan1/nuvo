# The Refine run — grooming as a winnable game

Status: **built — phone-first v1** (2026-06-19). The spec we converged on in the session
that reframed "Tend" as a card game, now implemented. Code: `src/lib/refine.ts` (gap
decomposition), `src/lib/refineFeasibility.ts` (the Reality-check calendar math),
`src/components/refine/RefineRun.tsx` (the run: board + cards + swipe) and
`RefinePortfolio.tsx` (the overworld map + cascade); launched from the Now screen in
`MobileShell.tsx`. Builds on the existing readiness/tending machinery below. The desktop
`TendingFlow` ritual is left intact for now (§7); retiring it is a follow-up once this
proves out. Not yet exercised on real data: the cascade (needs a completed run) and the
Reality card (needs an active project with a tight deadline) — both coded + typecheck-clean.

This sits **on top of** [`readiness-model.md`](./readiness-model.md). That doc defines the
**ambient signal** — the always-on, calm gauge on the spine that *reports* where the
funnel needs you. This doc defines the **active loop** — what you actually *do* when you
decide to answer that demand. Readiness is the thermometer; the Refine run is the
thirty seconds of play that moves it.

It also leans on [`design-language.md`](./design-language.md) (Warm Paper — the run must
stay quiet, not arcade) and pairs with [`weekly-review.md`](./weekly-review.md) (the
portfolio meter is a natural opening shot of the Review).

---

## 1 · The thesis

Grooming a project toward "ready" is open-ended dread — *is this project… fine?* The
Refine run turns it into a **closed, winnable loop**: a single legible number you drive
to 100%, where **the app — not you — decides what counts as ready** and does the heavy
lifting of proposing every fix. You just adjudicate.

Three commitments make it work, and all three are non-negotiable:

1. **The app must be accurate and high-value in what it asks.** The manual views already
   let you do all of this by hand. The run earns its place *only* by surfacing
   **low-effort, high-impact** fixes — the low-hanging fruit — and being right about them.
   A run that asks low-value or wrong questions burns the trust the whole feature needs.
2. **Lowest possible data entry.** Every card is Nuvo's *proposed answer*; the default
   action is one tap to accept. This is the [low-data-entry principle](../CLAUDE.md)
   made into a game — forms are the fallback, never the front door.
3. **Quiet reward, not arcade.** The dopamine is the readiness ring closing and the gain
   rippling up the ladder — never bolted-on points that fight the design language.

## 2 · The card loop — a verdict, not a form

> **The board never leaves. Only the card changes.**

A run grooms **one project at a time**. The project's header, spec sheet, and readiness
ring stay fixed on screen for the entire run; a **stack of cards** falls through, each
fixing one gap. This is the Tetris insight: the board is one persistent context so your
attention never reloads — only the falling piece changes. (Contrast: shuffling
project-*and*-field every card is cognitive whiplash. Don't.)

The load-bearing rule for each card:

> **Every card is a verdict you confirm, not a form you fill.**

Nuvo does the work first — proposes the title, guesses the due date, drafts the missing
task, flags the infeasible date — and the card leads with **why it's blocking**. Your job
is one of three taps:

- **Accept** — take Nuvo's proposal as-is. One tap. The default.
- **Tweak** — edit Nuvo's guess inline, then confirm (iOS dictation works — plain input).
- **Skip** — leave it for now. **First-class and painless** — trust comes from "not now"
  costing nothing. The manual views are always there for the deep stuff.

A blank "enter a title" field is a chore no matter how it's skinned. A card that says
*"Calling this 'Q3 board deck' — right?"* with a ✓ is a game. That difference is the
entire feature.

As cards clear, the project's **readiness ring fills in real time**. Clear the stack →
the project **seals** (reuse the Weekly Review seal idiom) → the next project slides in.

## 3 · The card taxonomy — the gaps Nuvo can find

A card exists for each way a project is "not ready." Ordered by how much each moves the
score, cheapest-and-highest-impact first. These map onto the structural `ripeness` pips
and the AI `soundness` verdict already in [`tending.ts`](../src/lib/tending.ts).

**Structural cards** (cheap, deterministic — the app *knows* these are missing):

| Card | Blocks because | Nuvo proposes |
|---|---|---|
| **Title** | captured as vague free text ("board stuff") | a clear name, from the capture + context |
| **Definition of done** | no outcome → app can't tell when it's finished | a one-line finish condition |
| **Due date** | no date, but the calendar implies one | a date with buffer, from linked events |
| **Missing step** | the outcome needs a step no task covers | a task to add ("Review draft with Sarah") |

**Intelligence cards** (the ones only this app can ask — the proof of the pitch). These
need the agent + `effectiveScore` soundness, not just structure:

| Card | Blocks because | Nuvo proposes |
|---|---|---|
| **Reality check** | task load vs open calendar time doesn't fit | "≈9h of work, 2 open afternoons before due — tight but doable?" (reuse `readDay`/`toBusyBlocks`) |
| **Stuck, not ready** | stalled at ~90% for weeks (the `silent` signal) | "this has been 90% for 3 weeks — it's stuck. Re-scope or park?" |
| **Outcome mismatch** | sealed child tasks/projects don't add up to the stated outcome | "these 3 things don't deliver the outcome — there's a gap here" |
| **Duplicate** | two projects doing the same thing | "this overlaps with X — merge?" |

The **Reality check** card is the keystone demo: only Nuvo can do that math, because only
it holds both the task estimate and the live calendar. That card *is* the product in one
gesture — the app did the work, you just made the call.

## 4 · Climbing the ladder — altitude graduation

You refine **projects one at a time**, but a run climbs the funnel
(Domain → Initiative → Project → Week → Day):

- An **initiative's readiness is mostly a function of its children.** Sealing a project
  ticks its initiative's ring up automatically (the cascade, §5).
- When *all* of an initiative's projects are sealed, the run **graduates** to
  **initiative-level cards** — the higher-altitude verdicts: *"these sealed projects don't
  add up to the initiative's outcome,"* *"no project owns the launch."* Same loop, higher
  floor.

So grooming is **bottom-up**: ready the projects, and the initiative readies as a
consequence — then close the gap that only shows at the initiative altitude. This is the
funnel made tactile.

## 5 · The portfolio map — the overworld

The meta-surface: **how much of your whole portfolio is groomed**, as a single number you
watch climb. It doubles as the *"where do I start"* screen — projects sorted by readiness,
so "Refine next" just deals the lowest one.

- **One honest color axis.** Gray = untended, amber = in progress, teal = sealed. No
  rainbow — it must read at a glance. (Reuse `RIPE_AMBER` / status tokens, never a new
  hue.)
- **The cascade is the reward.** Seal a project → its bar fills → its initiative ring
  climbs → the portfolio meter counts up and a `+N%` floats off. One tap, three altitudes
  of visible gain. *That* is the video-game beat — not points, but watching the gain
  ripple up the ladder you actually care about.
- **The number is the app's claim, not yours.** *"57% of your portfolio is ready to
  work"* is a sentence only this app can compute, because only it knows what "ready" means
  at each altitude. Rolls up from `readinessOf{Project,Initiative}` in the planned
  `src/lib/readiness.ts`.

This pairs with the **Weekly Review**: the meter is a natural opening shot of Sunday
("your portfolio is 67% groomed, up from 41% last week"), and a wall-of-weeks turns
grooming into a *season*, not a chore.

## 6 · The reward — quiet by design

Per Warm Paper, the game stays **restrained**: a quietly filling ring, a seal at 100%, a
gain rippling up the map. We deliberately **do not** bolt on streak counters, score
popcorn, or sound as the primary reward — overt arcade points fight the design language's
ceremony. The closing ring *is* the dopamine.

Where we *do* spend ceremony: **crossing-into-ready and all-at-rest** (peak-end rule, per
`readiness-model.md` §6). Sealing an **initiative** earns a genuine level-up beat — the
crest lights, a domain pulse, "floor unlocked" — because climbing the ladder should feel
earned. The day-to-day stays calm; the celebration concentrates at the landmarks.

## 7 · Naming

**Retire "Tend"** — too soft/pastoral, the same reason Phil rejected farming metaphors in
the Weekly Review. The loop wants agile-plain, ticking-clock energy.

- Working name for the loop: a **Refine run** (a deck you clear in one sitting).
- The verb is still open — **"Refine"** is the strongest alternative (elevation-agnostic;
  implies already-good-getting-sharper, not neglected-getting-rescued). Decide against the
  running app.

## 8 · Surface & mobile — phone-first

The swipeable card stack is **more native to the phone than the desktop** — a thumb-swipe
deck is the purest expression of the loop. So unlike the other Build floors (desktop-only),
the Refine run should be **mobile-first**:

- **Mobile:** a full-bleed swipe deck — accept (swipe right / ✓), skip (swipe left),
  tweak (tap). The portfolio map is its own scrollable screen, reachable from the **Plan**
  tab cue that `readiness-model.md` §5 already routes there. Respect `pb-safe`, ≥44px taps,
  clears the bottom bar + FAB.
- **Desktop:** the same loop as a focused "sit down and refine" surface; the portfolio
  map can be the richer overworld. Hangs off the spine rung's cue ("Refine these 3 →")
  from the readiness gauge.

Both must obey the cardinal rule: **transparent over `.atmosphere`**, hairline-separated,
the card is the one thing that *lifts* (`.glass-lift`).

## 9 · Build on what exists — don't duplicate

- **Readiness math:** the planned `src/lib/readiness.ts` (`readiness-model.md` §7) supplies
  the per-floor + portfolio rollup the map renders. The run *writes* to the inputs that
  doc *reads*.
- **What's "ready":** `ripeness` (cheap structural pips) + `effectiveScore` soundness from
  [`tending.ts`](../src/lib/tending.ts) — already the structural-vs-sound split the cards
  need. The `silent` signal already finds "stuck" projects.
- **Card proposals:** the agent + [`parseCapture`](../src/lib/nlp.ts) generate the
  title/date/task guesses (same path attribution already uses).
- **Reality check:** `readDay` / `toBusyBlocks` (`src/lib/now.ts`) for the load-vs-calendar
  math — the one busy-rule, reused.
- **Seal / reward idiom:** the Weekly Review seal + crest language.
- **Tauri:** the card swipe is **pointer events**, never HTML5 drag (`CLAUDE.md` Tauri rule).

## 10 · Open knobs (tune against the running app)

- **Card supply & ranking** — how Nuvo orders a project's gaps by impact, and the
  confidence bar below which a card is *not* shown (accuracy gate from §1).
- **Run length** — cards per project, projects per run before it offers to stop.
- **Graduation threshold** — do all children need 100% to unlock initiative cards, or
  ≥ `CALM`?
- **Reward volume** — exactly how much ceremony the initiative level-up gets before it
  tips into arcade.
- **Portfolio rollup** — mean of projects vs mean of initiatives (weighting altitudes).
