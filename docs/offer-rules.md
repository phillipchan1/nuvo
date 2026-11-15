# Offers — the rules a suggestion keeps, and Plan projects

**Status: built 2026-11-14 on branch `claude/offer-rules` (D-216; amends D-209's "deck first" and
D-213's card labels, §5). All four phases. Driven in the local dev app (local Worker + Postgres,
test account): the Schedule's chip, hover preview, Other times (alternatives, your own pick, the
hold write), and the project deck's rest state and Plan projects walk (outcome, a typed task, the
weeks with the overlap named). Not driven: Plan initiatives on a signed-in deck (harness only), any
AI draft or steer on a live model (the local Worker has no model key), the phone's Other times sheet,
and `npm run perf`.**
Prototype (private, example data): [Nuvo Offer Rules](https://claude.ai/artifact/7oumBYorD2Zk7bAbxZgetX):
fifteen scenarios on the desktop Schedule, the project deck and the phone.

Builds on: [`intelligence-home.md`](./intelligence-home.md) (D-198: offers live on the left; D-200:
no chat; D-199: the Reach) · [`rail-modes.md`](./rail-modes.md) (D-202: Rest · Plan · Repair, acts
named by destination) · [`outcome-readings.md`](./outcome-readings.md) (D-201: Ready · Placed) ·
D-193 (Draft the path) · D-194 (Memory) · `useFindTime`, `composeWeek`, `slotPicksFor`.

---

## 1 · Thesis

An offer that's wrong costs more trust than a missing one earns. So Nuvo offers **only what's
hard to work out yourself**, and every offer carries everything you need to judge it before you
press: **where it lands (with the day), why, and what it costs.** Pointing at it shows the spot on
the grid and dims the rest of the week. When the first answer isn't right, there's always a
second: **Other times** opens up to two alternatives that differ for a reason they name, and you
can place it yourself by clicking the grid. Nothing is written until you press.

The left rail at rest is your work. An offer is a **chip on the row it would change**, never a
card above the list. The Get ready card at rest (D-209's "deck first": a `NUVO` label, a filled *Schedule 4:15–5pm*
button, no day, above the Projects list) breaks four of these rules. At rest it gives way to
the chips; the stack stays one press away behind the crown's line (D-207).

## 2 · The thirteen rules

| # | Rule | Violated when |
|---|---|---|
| R1 | **Only what's hard to do yourself.** Fitting several pieces into a fragmented week, finding the only gap, splitting, sizing from history, drafting tasks, naming what breaks. | One drag into an obvious gap would do it. |
| R2 | **Says where, with the day.** The label is the destination: *Today 4:15–5pm*, *Thu 10:30–11am*, *File in Garage studio*. | A time without a day; an opinion (*Looks good*) or a placeless deferral (*Later*). |
| R3 | **Shows where.** Hover or keyboard focus ghosts it on the grid and dims everything else to ~20%; the target day's column and header take the accent. The phone's first tap opens a sheet that draws the day. | You have to press to find out where it went. |
| R4 | **Says what it's built from**, in one muted line. With no history it says so and names the default ("30m is a guess"). | A number with no source, or a default dressed as a read of you (P6). |
| R5 | **Says what it costs**: what it fills, pushes or collides with, in `--warn`. | A cost the user discovers after pressing. |
| R6 | **Rides the row it changes.** One chip per row, quiet outline at rest, filled only under hover/focus. | A card or section of offers; an offer louder than the Today hero. |
| R7 | **Writes nothing until you press**, then offers Undo. | A ghost becomes data without a press. |
| R8 | **Learns from no.** ✕ asks why in one tap (Not now · Wrong time · Don't offer this); Memory keeps the answer (D-194). | The same refused offer returns unchanged. |
| R9 | **Modes start from your press.** The crown line is a fact, present only while true. | A badge, a push (N-07), an auto-opened mode. |
| R10 | **Lands and reaches.** Keeping lands the block and advances the project's bar in one beat (D-199). | A keep with no visible consequence; a score (N-04). |
| R11 | **Silence is an answer.** Nothing worth offering shows nothing. | An empty state about offers. |
| R12 | **Never rewrites what you touched.** A steer redrafts only Nuvo's lines; anything you edited, sized or typed stays. | A redraft undoes your edit. |
| R13 | **Always a second answer.** *Other times* is always shown beside the chip (not revealed on hover). It opens up to two alternatives, each different for a reason it names (*Sooner*, *Keeps today light*, *Two longer blocks*) and each with its own cost; or click any open time on the grid and Nuvo checks it ("Overlaps CAB Meeting", "That time has passed", "Open"). | Alternatives fifteen minutes apart; more than two; alternatives shown before you ask; no way to say "somewhere else". |

## 3 · Anatomy of an offer at rest

```
◯ Stand up security team at Frontier ━━━━━──  3/5
   ✦ Today 4:15–5pm ↵   Other times   ✕
   45m · sized from your last 3 finished on this project · Ends right before Kid date night   ← on hover/focus
```

- **Hover/focus the chip:** only the suggestion ghosts on the grid; the rest dims. Alternatives
  do **not** appear on hover (settled by Phil, 2026-11-14).
- **Other times:** the chip becomes a small chooser in the rail: the suggestion and up to two
  alternatives as numbered rows (1 · 2 · 3), all drawn on the grid at once, numbered; the one
  you point at is solid, the others faint. Click a faint block on the grid to pick it, or click
  open time to place it yourself (snapped to 15 minutes, the task's length). The button names the
  choice: **Hold Wed 1–1:45pm ↵**. Cancel or Esc leaves everything as it was.
- **Multi-piece offers** (*Place 3h: Tue · Wed · Fri*) offer a different *shape* as the
  alternative (*Two longer blocks*); place-it-yourself is off, since one click can't place three.
- **Phone:** the chip opens the task's sheet with the day strip, the ghost, time chips for the
  alternatives, and "or tap the day". 44px targets. Same words.

## 4 · Plan projects (and Plan initiatives)

The rail's Plan mode on every planner surface: **Plan the week** (Schedule), **Plan projects**
(project deck), **Plan initiatives** (initiative deck). Same grammar, three clock speeds. This
closes rail-modes §8's open question 2.

Plan projects walks the deck's not-Ready projects, rawest first, in two phases each:

1. **Tasks.** Nuvo drafts the missing tasks (the Draft the path engine, D-193), sized from shipped
   projects in the same domain. Inline: rename, resize, remove (Undo), add your own. A plain-language
   line, *Tell Nuvo what to change*, steers the draft (*fewer*, *smaller pieces*, *start with a call
   to Ana*) and obeys R12. Commit names the destination: **Add 4 tasks to Rebuild / Restart
   Fundraising**. Drafted lines use the existing **Drafted step** look (faint wash, dashed edge).
2. **Weeks.** The kept hours become a span at your usual weekly pace in that domain (a named
   default when there's none), offered as two spans with costs (*Overlaps Cloudflare migration the
   week of Nov 23* vs *clear weeks, later*), plus **Park it**. Hover ghosts the span on the deck.

The counter is **Ready n of m**, a state of the deck (D-201), never a tally of acts (N-04).
**No history:** drafts from the project's outcome with every size at a 30m default, and says so.
No outcome either: no draft, just the add line.

**Built (2026-11-14, `claude/plan-projects`):** `ondeck/PlanProjectsRail` + `PlanInitiativesRail`
over shared parts (`ondeck/PlanWalk`) and one pure half (`lib/planProjects`: walk order, R12's
`mergeSteer`, `domainPace`, `spanOffers` / `quarterOffers` with costs). The tasks phase asks
Draft the path's own request (`lib/scaffoldAsk`, which `usePathDraft` now calls too) and sizes with
its `toSteps` against finished work in the same domain; a line you rename, resize or type is
pinned (solid check, no wash) and a steer redrafts only the rest. Commit is one press through
`useTaskMutations().create` (backlog rows, one Undo toast); a project with no outcome gets an
outcome line in the same phase, since it can't be Ready without one. The weeks phase sizes the
span at the median of the domain's worked weeks, else its weekly target, else 1.5h a week (said);
pointing at a span slides the bar there and dims the rest; pressing writes through the deck's own
`moveProject` + `sprintSpanFor` (the kernel's `weekSpanFor`). Park it = `waiting`. Keys: J looks at
it last, 1 · 2 pick a span, Esc leaves. **Entry:** the crown's line reads *N not Ready · Plan
projects ›* when shaping leads; when something is overdue or crowded the line stays *Get ready*
(with *then: N not Ready*) and the walk is the stack's last card. Not in the page bar.
**Plan initiatives** is the same shell: *Shape* (an outcome and a first key result when missing,
plus the deck's own ✦ Suggest projects) then *Quarter* (up to two, a same-domain bet finishing
there or a quarter over the cap named). Left out: an Undo for the added key result
(`addKeyResult` doesn't return the row's id); a span past the 4-week horizon previews clamped to
the last column, cut square.

*Copy note:* the UI says **tasks**, not steps. In the glossary a **Step** is a line on a task's
checklist (D-103); "Add 4 steps" would name the wrong object (P11).

## 5 · Anchor

- **Ledger:** W2 (where do the hours go), W3 (what breaks), Q1 (on pace), Q2 (collisions), Q4
  (the actual steps), A4 (honest about the week, via costs).
- **Strains P9** (an offer is always present on its row), held by R6 + R11: quiet outline, one per
  row, nothing when there's nothing hard to offer. **Strains P10** with Plan projects (another
  walk), held by it being the existing Plan mode on another surface, not a new ritual.
- **Four no's:** no pool (offers ride existing rows); new names *Other times*, *Plan projects*,
  *Plan initiatives* (glossary); degrades on empty data (R4, R11; scenario *A brand-new account*);
  nothing about one account.

## 6 · Build order

1. **Phase 1 — the chip at rest (desktop):** ✅ built. `OfferChip`'s `preview` prop →
   `lib/offerPreview` → `Planner`'s `previewOverlay` (the plan overlay with `dimCalendar`);
   `WeekPanel`'s `TimeOfferLine` carries a project's first loose card; `whenLabel` / `holdWhen` say
   *Today*. The cost rides the offer line (R5). **Decks ✅ built:** neither deck mounts `RestDeck` at rest. A card whose
   act names a destination (*Move to Nov 23*, *Suggest tasks*, *Suggest projects*) rides that
   project's or bet's own card on the grid as an `OfferChip` (`rowOffers`: one per card, at most
   three, never an *Open*; pointing at *Move to* lights its week). Placed projects have no row in
   the pool rail, so the card on the grid is their row. Everything else stays behind the line (R11).
2. **Phase 2 — Other times:** ✅ built. `nuvo/OtherTimes` beside every time chip (a ⋯ on a task
   row): `alternativesFor` asked again through `useWeekComposer`, cut to two by `nameAlternatives`
   (a named reason and cost each, `lib/offerChoices`), all options numbered on the grid
   (`setOfferChoice` → Planner's overlay), "Pick a time yourself…" via `PlanOverlay.onPickTime`,
   checked by `checkPick`. Choosing writes through the card's `placeAt` / the chip's own block. Saying
   no from the same menu: *Not now · two weeks* and *No time offers for <project> · two weeks*
   (`readyKey.times`) — R8's "Memory keeps the answer" is **not** built; these are snoozes. Phone: a
   `PickSheet` of the same options (no tap-the-day strip yet).
3. **Phase 3 — Plan projects:** ✅ built (§4). The deck walk (tasks, then weeks) on the Draft the path engine.
4. **Phase 4 — Plan initiatives** ✅ built (§4) on the same walk: shape, then quarter.

### Tuned against a live model (2026-11-14, local Worker + OpenAI)

| Found | Fix |
|---|---|
| A steer restated your edited lines (they aren't saved yet, so the drafter couldn't see them) | the walk sends kept lines as `draftTitles` |
| "Fewer, smaller" was ignored by the small drafter model | `steerLimits` sends `maxCount` / `maxMinutes` to the prompt **and** the walk enforces them; fewer keeps the foundational and finishing steps |
| First drafts ran 7 tasks, 9–11h, 1–2h each | the scaffold asks for 3–5 sittings, 15–90 min, most 30–45 |
| Draft the path re-proposed an existing step in new words ("Implement the pricing toggle…" beside "Wire the pricing toggle") | `restates()` in the proposer drops them, for every caller |
| No outcome → the walk had nothing to offer for it | Nuvo's `draftOutcome` proposes one under the empty field ("Use …"), and the prompt now asks for what's true in the world, not that a document exists |

Initiative drafts (`draftProjects`) were tried and left as they are.

## 7 · Open

1. Does choosing an alternative teach Memory silently (e.g. "never straight after a meeting")?
   Leans yes, under D-194's "says where it learned it". Not in phase 1–2.
2. ~~Named alternatives from the fitter.~~ Settled: `alternativesFor` returns candidates; the
   names and costs are added in `lib/offerChoices`.
3. R8 into Memory: a *Don't offer this* that Memory keeps (D-194), instead of a two-week snooze.
4. The phone's sheet draws the day with the ghost and takes a tap on it (prototype scenario 15).
5. Plan projects from the page bar, not only the crown's line.
