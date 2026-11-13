# Readings — ready, placed, done, significant

**Status: Significant built (2026-11-13, D-203) on `worktree-intelligence-readings`; the project, initiative and domain slices are not. Meetings count as *other* until an event can point at a project.** Follows
[`intelligence-home.md`](./intelligence-home.md) (Q-16 one home, D-202 the Reach) and D-201 (the
chat is removed). Prototype (private, example data):
[Nuvo Readings](https://claude.ai/artifact/LWc6UfcDghwmW19HLLG7R7): every altitude, and a
playable gallery of each motion beside the refused ones.

Builds on: [`readiness-model.md`](./readiness-model.md) (Ready, the thermometer) ·
[`commitment-model.md`](./commitment-model.md) (calibration: planned vs proven) ·
[`design-language.md`](./design-language.md) *Momentum* (Land · Advance, `PaceTrack`, the pace
tick) · `useWeekCrown` (placed vs loose) · `lib/vertical.ts` (`taskDomainId`, the ledger) ·
D-087 (a ship is a touch) · D-142 (an event's *Counts toward*).

---

## 1 · Thesis

An ambitious person wants to know whether the week is going to come true, and afterwards whether
it was the work that mattered. Nuvo already measures most of that, in pieces, on different
surfaces. **Four readings, in order, are the chain from intention to outcome: Ready → Placed →
Done → Significant.** Each one is a fact about the *work* (a ratio of things Nuvo already
measures), never a grade of the *person*. Each is always visible where its question is asked,
and each moves only when you do something.

This is what makes Nuvo feel like a game without becoming a scoreboard. The bars are persistent
and honest. The motion happens at the moment of your act, and the Reach (D-202) shows the act
climbing one altitude to the bar it moved.

## 2 · The four readings

| Reading | The question | Measured as | Ledger | Already exists as |
|---|---|---|---|---|
| **Ready** | Is this shaped enough to act on? | the Ready checklist per altitude: a project has an **Outcome** and **Steps**; a bet has an **Objective** and **a number moving** | Q3 · Q4 | Ready / Readiness (`lib/lenses.ts`) |
| **Placed** | Of what I committed to, how much has a time? A time is the only guarantee | open tasks with a `do_date` + `start_time`, or in a slot, ÷ open tasks on the slate | W2 | `placedLabel` (`useWeekCrown`) |
| **Done** | Of what I placed, how much got done? | completed ÷ placed, by pieces; calibration by minutes | W1 · W6 | `PaceTrack` pieces · calibration |
| **Significant** | Did my finished hours go to what I said mattered? | finished minutes on work whose project **belongs to an initiative** ÷ all finished minutes | **W6** ("or was I just busy?") | **new** |

**Significant, defined once (settled by Phil, 2026-11-13).** A minute is significant when the
work belongs to a **project attached to an initiative**. That's the discipline the reading
exists to reward: work that ladders up to a bet you made, not merely work you scheduled.
Minutes count when a task is completed (its estimate, or its block's length when it was placed)
or when an event with *Counts toward* (D-142) a project is attended; the parent rule applies (a
parented task belongs to its parent, `taskDomainId`). Everything else is *other*: loose tasks,
upkeep, projects with no initiative, meetings that count toward nothing. Shown in hours, never a
percentage: **"6.5h of 9h toward an initiative"**. A percentage reads as a grade; hours read as
where the time went.

**The same rule at every altitude**, so it's one name (P11): the week, the domain, and the
quarter all ask "how much of what I finished went toward an initiative". **An account with no
initiatives shows no Significant at all** (P7, P16): a stranger isn't scored against a ladder
they haven't built, and the reading doesn't nag them into building one.

## 3 · Per altitude — what is persistent where

The readings are not a page (P10). Each altitude shows the ones that mean something there, on the
surfaces it already has:

| Altitude | Ready | Placed | Done | Significant | Lives on |
|---|---|---|---|---|---|
| **Week** | slated projects that are Ready, "3 of 4 ready" | "11 of 14 placed" | "6 of 11 done" + pace ticks per row | "6.5h of 9h toward an initiative" | the week crown's header (desktop rail · phone crown, open) |
| **Project** | the checklist: Outcome ✓ Steps ✓ | open steps with a time | `PaceTrack`: **done · placed · loose** (D-202) + pace tick | n/a: everything on a project is the project | the On Deck card · the record head (both shells) |
| **Initiative** | projects Ready, "2 of 3 ready" | projects on a week now | projects shipped, + the bet's **number moving** | n/a | the initiative card · its record |
| **Domain** | n/a | n/a | ships this quarter (a touch each, D-087) | of the hours **kept** here this quarter, how many went toward an initiative: "31h of 44h toward an initiative" | the wall tile, beside the Kept pulse · the open domain |

Rules for every cell:

- **No cell exists without its data** (P7). An empty week has no crown; a project with no span
  has no tick; a domain with no kept hours says nothing. Never a zero standing in for "unknown".
- **Read, not ranked.** No reading is compared with another account, a target or a previous
  week on the surface. History lives in the Review (W6), which already owns "did anything move".
- **No red, no "behind"** (P4). Short of the pace tick is drawn, never said. *Other* hours are
  `--muted`, never `--warn`.
- **One drawing per reading.** Ready is a check pair; Placed and Done share the project's
  three-state track; Significant is one two-segment bar (initiative hue · `--line`).

## 4 · The motions — one per act, and where each one goes

Every row is the synchronous consequence of the user's own act, played once, transform and
opacity only, forward only (an Undo snaps), off under reduced motion (Momentum laws 1–4). The
Reach always climbs **one altitude**, never more, so it's one element per act.

| Your act | What lands where you are | Reach climbs to | What advances there | Motion |
|---|---|---|---|---|
| Write the outcome, or add the first step, so the checklist completes | the second check stamps | the deck card | the card's outline goes from drafted (dashed) to solid; "Ready" swaps in | Land · Reach |
| Keep an offer that places work (Plan the week, Put in a slot, a drag) | the block lands on the grid | the project's crown row | a loose piece goes tinted (placed); "11 of 14" swaps | Land · Reach · Advance (D-202) |
| Tick a task | the box stamps, the strike draws, the row lets go | the project's crown row | its tinted piece goes solid; the week's significance bar grows by the task's minutes, in the initiative segment or *other* | Land · Let go · Reach · Advance |
| Ship a project | the ship stamp (D-093) | its initiative's card | one project piece fills; "1 of 3 shipped" swaps | Land · Reach · Advance |
| Ship a project, on the Domain wall | — | its domain's tile | the ship touch (D-087) | Advance only, no Reach on a surface that wasn't where you acted |
| Commit the week | `WeekSetMoment` (D-187) | — | — | Commit |

Motion that is **not** in this table does not exist: no count-up, no confetti, no glow or halo,
no sound, no badge, no "level", nothing on load, a refetch, a realtime echo, or a write Nuvo
made. A chain that completes (a project Ready and all placed) gets nothing extra: the last
piece advancing *is* the moment.

## 5 · Anchor

- **Ledger:** W6 gains its first live answer outside the Review (Significant). W2, W1 and Q3/Q4
  get one shared drawing instead of three.
- **Altitude:** spans all five, which usually means several ideas in a coat. It's one grammar
  applied per altitude. Build it as four slices (§7), each its own decision if it diverges.
- **Story step:** commit → land.
- **Strains P9** (held as above) and **P4** (Significant can read as a verdict on how you spent
  your week; mitigated by hours not percent, *other* in `--muted`, no target line).
- **Strains P6** at Significant: estimates stand in for minutes on a task finished without a
  block. Said where it's shown ("from estimates" when most of it is).
- **Four no's:** no pool; **one new user-facing name**, *Significant* (glossary, proposed); P7
  clear (§3 rule 1); P16: a stranger with no slate has no Significant, and the reading must not
  nag them into making one.
- **Already decided:** N-04 forbids scores, streaks and tallies; these are ratios of this week's
  facts, shown in place, with no history on the surface. If any reading grows a history chart,
  a streak or a combined number, it has crossed N-04.

## 6 · Open questions

1. **Significant and calendar work (Q-03).** Work that never touches the calendar is invisible,
   so the slate segment reads low for anyone who doesn't block time. Proposed: don't show
   Significant until the week has at least two hours finished.
2. **Meetings.** An attended event with *Counts toward* a project under an initiative counts.
   One with no attribution counts as *other*. Is that fair to someone whose work *is* meetings?
3. ~~Domain significance's name.~~ *Settled 2026-11-13:* the rule is the same at every altitude
   (toward an initiative), so it's one name.

## 7 · Build order

1. **`PaceTrack`'s third state** (placed) and the Reach on placement. This is D-202; it unblocks
   the rest.
2. **The week crown header**: the four readings in one line, desktop and phone. Significant needs
   a pure function beside `useWeekCrown` (`weekSignificance`), and if the agent ever reads it,
   it goes in the planning kernel (one rule, two runtimes).
3. **Project**: the deck card and record head wear the three-state track; Ready's Land + Reach.
4. **Initiative and Domain** slices, each re-anchored when built.

## 8 · Verification

- Pure tests for `weekSignificance` over fixture accounts unlike persona zero's: an empty week,
  a week with no slate, a week of only meetings, a week of only loose upkeep.
- `tests/momentum.test.tsx`: every new keyframe transform/opacity only; no animation on a
  re-render with new data.
- Driven at desktop and 375px; `npm run perf` (the crown, the deck and the wall are shared).
