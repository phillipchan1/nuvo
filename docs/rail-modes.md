# The rail — three modes, and acts that say where things go

**Status: built (2026-11-13, D-204) on `worktree-intelligence-readings`, except §3's inline chips, which wait on Q-16. Deviations are listed in D-204. Amended by D-207 ([`rail-line.md`](./rail-line.md)): the
repair line folds into the crown's one line, which opens Get ready.** Prototype (private, example data):
[Nuvo Rail Modes](https://claude.ai/artifact/WVnQT5WqK6JzfxzxSxG71B): Rest, Plan and Repair on
the desktop Schedule, with a switch to compare today's labels.

Builds on: [`intelligence-home.md`](./intelligence-home.md) (Q-16: offers live on the left; D-201:
no chat) · [`outcome-readings.md`](./outcome-readings.md) (D-203: the crown's readings, the Reach)
· [`plan-the-week-v2.md`](./plan-the-week-v2.md) §4 the walk (D-183) and §7 repair and the dial ·
D-194 (every answer says what it changes) · D-150 (taking work off the week says what comes off the
calendar) · `LeftRail`, `PlanRail`, `RepairBar`, `WeekPanel`.

---

## 1 · Thesis

Once the chat is gone, the left rail holds everything Nuvo knows how to do for you: the week's
projects, today's work, the inbox, and every offer. Stacked as sections, that's four panels
fighting for 340px. **So the rail has modes, not sections: Rest, Plan and Repair, one at a
time.** At rest it's your day, with the crown pinned above it and Nuvo's offers riding the rows
they would change. Planning and repair *take the rail over* as a walk, one thing at a time, and
hand it back when you're done.

And every act names its destination. "Looks good", "Later" and "Leave it" are opinions and
deferrals; they don't say what happens. **An act's label is where the thing goes: a time, a
named place, or a state.** You know where it will land before you press, and the Reach (D-202)
shows it arriving.

## 2 · The three modes

| Mode | When | What the rail is | Enter | Leave |
|---|---|---|---|---|
| **Rest** | always, by default | the crown (shut, one line) · Today / Inbox · offers inline on rows | — | — |
| **Plan** | you choose to plan the week, any day (D-180) | `PlanRail`'s walk over the draft on the grid (D-183) | the crown's line, or Plan the week in the page bar | Esc, or the last block decided |
| **Repair** | only when the week **broke**: a meeting landed on a block, or a block was missed (§7 of plan-the-week-v2) | the same walk, one broken block at a time, its target ghosted on the grid | the crown's line | Esc, or the last repair decided |

Rules:

- **One mode at a time.** Planning hides repair; when you finish planning, repairs that still
  apply come back as the crown's line.
- **The crown is pinned in every mode.** It's what the week is carrying, so it stays on screen
  while you change it; the readings advance under your hand (D-203).
- **Repair moves into the rail.** Today `RepairBar` floats over the Schedule; it becomes a rail
  mode with the walk's grammar, so planning and repairing are the same act at different times.
  The calendar ghost stays (that's where you see the target). The dial (Ask · Suggest · Handle)
  lives in **Settings → Schedule** only (settled by Phil, 2026-11-13), not in the walk; Q-14 stays
  open.
- **Nothing takes the rail over by itself.** A mode starts only from your press (P4, P9).

## 3 · Rest — what is passive and what is shown

The answer to "passive or actively shown" is: **always present, never pushed.**

| Thing | Shown at rest as | Never |
|---|---|---|
| The week's readings | the crown, shut to one line of pips; open it for the rows (D-203) | animating on load |
| Work with no time | the crown's line: **"4 with no time · Plan the week ›"** | a count badge on the nav, a notification |
| A broken week | the crown's line, replacing the above: **"Tue 10am broke: a meeting landed · Repair ›"** in `--warn` | `--signal` (that's *now*), a modal, a push (N-07) |
| An offer for one row | a chip on that row, naming its destination: **"Hold 2–2:30pm"** on a today task with no time; **"File in Garage studio"** on an inbox item the router has a guess for | a section of offers, a card above the list, more than one chip per row |
| Nothing to offer | nothing | an empty state about offers |

### Get ready (D-206)

The crown's one door. The rail becomes a stack of at most 5 cards that take this screen to ready,
worst first; each card names its destination, lands and Reaches when pressed, and leaves. Empty,
it says "Ready." and hands the rail back. It replaces the crown's "N with no time · Plan the week"
line; Plan and Repair are cards in it as well as modes. Mechanism: `lib/readyCards.ts`,
`GetReadyRail`, phone `MobileGetReady`.

### The balance budget (D-205, the operator: "it has to be elegant and balance all that is going on in the left")

The rail at rest carries the crown (its one line, Significant), Today or Inbox, and offers. It
stays calm by rule, not by taste:

| Rule | Why |
|---|---|
| **No row grows.** A chip sits in the row's trailing slot and *replaces* its meta while it shows | a list whose rows change height reads as noise and moves under the hand (D-123) |
| **Quiet chips**: text in accent ink, 12px, no fill, no border; 44px tap target by an invisible hit area on the phone | an offer is a suggestion, not a button wall |
| **At most 3 chips in the rail at once** (2 per phone screen), ranked crown row → Today (earliest first) → Inbox (top first), decided once in `budgetOffers`; nothing past the cap, never "+2 more" | a count of waiting offers is debt (P4); one place decides so both shells agree |
| **Draft the path shows only on an open crown**; the shut crown and the pinned pips carry no chips | the anchor stays one line drawn |
| **No rest chips while Plan or Repair owns the rail** | one mode at a time |
| **Not now is not a second button**: it lives in the row's context menu / long-press, and ⌫ on the focused chip | one mark per row |

An inline chip is the same engine as the walk (`composeWeek` / `slotPicksFor` for times, the router
for filing), so the rail at rest and the walk never disagree about where something goes.

## 4 · Acts that say where things go

**The rule:** an act's label is its destination, a time ("Hold Tue 10–11am"), a named place
("Back to Launch pricing page", "File in Garage studio") or a state ("Let it move"). Never an
opinion ("Looks good"), and never a deferral without a place ("Later"). The keycap stays beside
the label. Long names truncate the name, never the verb.

| Today | Becomes | Where it applies | What it does (unchanged) |
|---|---|---|---|
| Looks good ↵ / Keep · next | **Hold Tue 10–11am** ↵ | the walk | holds the block; a reflow won't move it (D-183) |
| Release H | **Let it move** H | a held block in the walk | releases the hold |
| Split S | **Split: 30m Tue · 30m Wed** S (or **Split in two** before the halves are known) | the walk | splits to fit |
| Off this week X | **Back to Launch pricing page** X, and under it what comes off the calendar (D-150) | the walk, repair | takes it off the week, back to its project |
| Later J | **Look at it last** J | the walk | moves on; this block waits at the end of the line |
| Take it ✓ | **Move to Wed 9–10am** ↵ | repair | moves the block to the composer's fit |
| Leave it ✕ | **Leave it where it is** | repair | leaves the block in place |
| Skip this week | **Back to <project>** | the walk's no-fit prompt | as above |
| (inbox) | **File in <guess>** · **Into this week** · **File…** | inbox rows, at rest | the router's guess; the week, no time yet; pick |

A deferral that should come back at a time ("ask me Thursday") would be a **new mechanism** (a
resurfacing date), and something resurfacing on its own is close to a nudge (N-07). Not in this
spec; see §8.

## 5 · The phone

The phone already has the same shape: the shut crown strip on the Calendar, the Plan the week
card on the Week segment, the repair card on the Calendar. This spec changes it in two ways only:
the labels (§4, same words), and the crown strip's line (§3: "4 with no time" / "Tue 10am broke",
a tap that opens the walk). Inline chips are taps, 44px.

## 6 · Anchor

- **Ledger:** W2 (placed) and W3 (what to drop, and what breaks) get acts that say what they do;
  A2 (what's about to blow up) gets repair announced in the rail instead of floating over it.
- **Story step:** commit (Plan), land (Repair).
- **Strains P9** at the crown's line: always present. Held by: it appears only when it's true,
  states a fact, never counts up, never moves.
- **Strains P8?** Repair and Plan share one rail. Held: they're two times of one act, and only
  one shows at a time.
- **Four no's:** no pool; no new place (repair moves *into* the rail, the floating bar goes);
  no new names beyond the acts' own words; degrades (no slate → no crown line, no offers); not
  one account's.

## 7 · Build order

1. Labels (§4) in `PlanRail` and `RepairBar` — pure copy plus the computed halves for Split; tests
   that assert labels on `?planweek` fixtures.
2. The crown's line at rest (desktop `WeekPanel`, phone crown strip).
3. Inline chips at rest: today tasks with no time, inbox items with a router guess.
4. Repair as a rail mode; retire the floating bar.

## 8 · Open questions

1. **"Ask me Thursday."** A resurfacing date is a new mechanism and leans on N-07. Worth its own
   anchor pass if "Look at it last" and "Back to <project>" don't cover the need.
2. **A deck walk for projects** (one project at a time to Ready, the same grammar). It adds a
   ritual (P10's tax); Summit already walks initiatives quarterly. Its own anchor pass.
3. ~~Repair's dial.~~ *Settled 2026-11-13:* Settings → Schedule only.
