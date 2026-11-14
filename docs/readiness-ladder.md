# The readiness ladder — from the day to the season

**Status: shipped 2026-11-14 (D-209), with the deviations in §7.** Prototype
(private, example data): [Nuvo Readiness](https://claude.ai/artifact/VrHP29PAmat3gQCrrPbs11). It has
Schedule, Rail, Projects, Initiatives, Phone, Celebrate and Grammar tabs, with a Quiet/Played switch
that shows D-203's restraint beside this.

Builds on and amends: [`outcome-readings.md`](./outcome-readings.md) (D-203: Ready → Placed → Done →
Significant) · D-206 (the week track, the Get ready stack) · [`rail-line.md`](./rail-line.md) (D-207:
the crown's line) · D-202 (the Reach) · [`design-language.md`](./design-language.md) *Momentum* ·
[`readiness-model.md`](./readiness-model.md) (Readiness, the thermometer).

---

## 1 · Thesis

Nuvo is for ambitious people, and ambitious people like gamesmanship. The operator, 2026-11-14:
*"I want this to feel like we have daily rewards… daily completion, weekly completion, seasonal
completion… a person to go, 'Man, I finished at 3:00 p.m. and I feel freaking great.'"*

So readiness becomes a ladder you climb every day, with rewards that grow with what each rung
means. The one rule still in force: **juice yes, economy no.** There are hits, bars that close and
moments, but no points, streaks, levels or tallies (N-04 stands, re-worded in D-209).

## 2 · One grammar at every altitude

Each planner altitude reads through **three marks**, always in the same order:

1. **Shaped**
2. **Given time**
3. **The run**

Each mark is a bar of **pieces**, one per real thing (a project, a task, a bet). Your act fills a
piece. When the first two marks close, the altitude's title earns the **ember stop** (the mark's
full stop, D-191), so "This week." means the week is ready. The run fills all period and never
holds the stop back.

| Altitude | Shaped | Given time | The run | Lives on |
|---|---|---|---|---|
| **Week** | **Ready**: slate projects with an outcome, a finish date and open steps | **Placed**: tasks with a time | **Done**: in hue when toward a *moving* initiative, grey otherwise | the Schedule rail's crown; the phone's crown (three hairlines shut, the marks open) |
| **Projects** | **Ready** | **Fits**: this week's project hours inside 70–100% of capacity | **Shipped** | the On Deck rail |
| **Initiatives** | **Ready**: an outcome, a finish date and a number | **On a week**: one of its projects is on this week | **Moving**: its number moved this quarter | the initiative deck's rail |

**The day sits above them all.** "Today" is the Schedule rail's hero (and the phone's top bar on
the Calendar's Today): one bar of today's own tasks. It **closes the moment the last one is done**,
at whatever hour. The reward is the hour: **"Done at 3:04pm. 1h 56m of your day back."**, and the
rest of the working day is drawn on the grid as a band marked **Yours**.

Every label carries its definition (`MARK_DEFS`): on hover through the app's styled tooltip, on
keyboard focus, and inline on a tap where there is no hover.

## 3 · The Schedule rail, deck first

The rail answers three questions, most-asked first:

1. **Am I winning today, and this week?** The crown: Today, then This week's three marks.
2. **What's my next winning move?** **The deck at rest** (`RestDeck`): the Get ready stack's top
   card, shown under the crown in place of the line that used to open it. Its siblings are drawn as
   edges beneath it, never as a count (P4). **Not now** sends a card to the back, and only the last
   card's Not now snoozes. **All ›** opens the full Get ready mode.
3. **Which of my projects is moving?** One line per project: ring · name · its track · what's left.

**Today and Inbox fold into a tray** above Capture. The tab strip is the handle; a tab (or 1/2/3)
opens it into the rail's lower part, and the chevron folds it. The day's blocks are already on the
grid beside the rail, so the list no longer takes a third of the rail's height.

The decks wear the same shape: a title that earns its stop, three marks, and the deck at rest.

## 4 · The celebration ladder

| Rung | When | What you see | Haptic |
|---|---|---|---|
| **Ready** | a Ready mark closes | the piece pops in; the label takes a check. No sweep: shaping is upkeep | light |
| **Placed / Fits / On a week** | a "given time" mark closes | one sweep across the bar | medium |
| **Day** | the last of today's tasks is done | the bar sweeps and rings, the ember stop drops onto "Today" with eight sparks, the hour you got back rises in, and the grid draws **Yours** | success |
| **Week** | the week's Ready and Placed both close | "This week." earns its stop | — |
| **Shipped** | a project ships | **the Seal**: a "Shipped" stamp slams onto its crown row (or the deck's Shipped mark). Toward a *moving* bet the target also jolts and an ember ring opens; toward none, the stamp alone | success |

Laws kept:

- A motion plays only on a transition the part watched happen, never on mount, so a page opening
  is still.
- Transform and opacity only.
- Everything is off under reduced motion or a still material.
- No sound.
- Nothing red, nothing "behind".

`lib/celebrate.ts` holds every motion; the kit parts call it.

## 5 · Significance, properly measured

**Significant = done toward an initiative whose number moved this quarter.**

- The kernel decides which bets are moving (`movingInitiativeIds`).
- Work on a stalled bet stays grey until you record progress, so busywork can't pump it.
- In the crown, the Done mark colours those pieces, and its line says "4 toward a moving initiative
  · 2 other".
- The week track (`useWeekCrown`) uses the same set, so the phone and every other track agree.
- An account with no initiatives sees no significance line at all (P7, P16).

## 6 · One rule, two runtimes

Both the app and the agent read the day, moving bets and fits from the planning kernel
(`planningRules.ts`):

- `dayReadiness`
- `movingInitiativeIds` / `krMovedSince` / `quarterStartISO`
- `fitsCapacity`

The agent's context carries `readiness: { day, movingInitiativeIds }`, and its prompt says what a
closed day and a moving bet mean. So the cards it drafts (Draft the path, Set as outcome, the OKR
drafts) arrive through the same stack and climb with the same ✦ Reach as everything else.

## 7 · Deviations and open questions

1. **"Moving" is a stand-in.** A key result keeps only its current value, so moved = the number
   differs from its baseline AND the row was written this quarter. A title edit after a real move
   still counts; a number that moved and moved back doesn't. The fix is a `value_changed_at` stamp
   on `key_results`. That's a Neon migration applied by hand, and is not built. **Checked on production Neon 2026-11-14:** `key_results.updated_at` exists, and the Worker
   stamps it on every write (`rest.ts`), so Moving lights on real data. (The agent selects `key_results(*)`, so a missing column can't break its context.)
2. **No native iOS haptics.** D-207 dropped them, so the day's and the Seal's haptics fire on
   Android only.
3. **The phone keeps its Get ready door as a sheet.** The deck at rest is desktop-only for now. The
   phone gets the day's stop and hour in the top bar, and three hairlines on the crown.
4. **Fits uses this week's remaining open hours** (the Commitment meter's denominator), so late in
   the week it can read over. Feel-test.
5. **The phone's day reads the day list without slot children.** A task inside a slot doesn't hold
   the phone's day open. The desktop reads them.
6. **Perf:** at parity with master on blocked time and dropped frames. Renders are 5–15% higher,
   and completing a block reads layout more for the celebration (D-209's status has the numbers).

## 8 · Verification

- `tests/readiness-ladder.test.tsx` covers:
  - the kernel rules over unlike fixtures (an empty day, a 114-day recurring pile-up, a carried
    one-off, a stalled bet, an over-full week);
  - the hour back;
  - the deck marks;
  - nothing celebrating on mount but a transition doing so;
  - every label's definition;
  - Not now going to the back;
  - the agent reading the same rules.
- Updated tests: `rail-offers` (the crown draws three marks) and the agent's prompt baseline.
- Harnesses:
  - `?kit` → Readings: press *Finish one* to watch the ladder;
  - `?rail=deck`: the rail with the deck at rest;
  - `?weekcrown`: both shells;
  - `?decks`: both decks.
