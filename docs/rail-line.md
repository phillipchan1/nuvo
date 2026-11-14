# One crown, one line — where Nuvo speaks, on every planner page

**Status: built 2026-11-13 (D-207), with the deviations below.** The kit `Crown` (+ `CrownLine`)
heads the Schedule (`WeekPanel`), both decks (`PlannerRail`) and the phone's open crown; the line is
`scheduleLine` / `deckLine` over the same compose as the stack (`useReady`, `lib/deckReady`); the
decks have their own Get ready stacks; the kernel owns `isMissed`; the decks' page bar is drawn over
the grid (`floors/floorBar`); the domain wall (both shells) carries a Read line (`wallLine`).
**Deviations:** (1) "Leave it where it is" is still per device: per-account needs a column and a
migration, not shipped blind. (2) No native iOS haptic: the phone's acts call `haptic("success")`,
which works on Android; iOS needs a Tauri plugin that couldn't be compiled here. (3) Deck cards open
the record or Draft the path / Draft the projects; *Set as outcome* (a ✦ outcome draft) and *Move to
Nov 23* aren't built. (4) Domains got the lighter §8.1 alternative: a line in the wall's head, no
rail. (5) The phone's SHUT strip keeps its pips (D-123); the line shows when the crown is open.
(6) The Spine's cue words (§8.3) are untouched. **Not driven on a signed-in account** (no dev login
in this checkout): verified at `?kit`, `?weekcrown`, `?domains` and the new `?decks`; `npm run perf`
not run. Anchor pass run the same day (Ledger
A2 · D4 · W2 · W3 · Q3 · Q4; strains P9 and P8; four no's clear except a Domains rail, which is
left open). Prototype (private, example data):
[Nuvo Rail Line](https://claude.ai/artifact/XKuFVzAVHiAjc1QDkC14nN). It shows Schedule, Projects
and Domains on the desktop, and the Schedule on the phone. It was drawn before this reconciliation,
so its line opens Repair, Plan or Groom directly, not the Get ready stack. The initiative deck uses
the same `PlannerRail` as Projects and gets the same crown (§3); it isn't drawn.

Builds on: [`rail-modes.md`](./rail-modes.md) (D-204: Rest · Plan · Repair, acts named by
destination, the repair line) · D-206 (the week track, the **Get ready** stack, `readyCards`) ·
D-205 (offers on the rows, the balance budget) · [`intelligence-home.md`](./intelligence-home.md)
(D-202: the Reach) · [`outcome-readings.md`](./outcome-readings.md) (D-203) ·
[`design-language.md`](./design-language.md) planner law 2 (the crown: one hero, one gap line) ·
[`readiness-model.md`](./readiness-model.md).

---

## 1 · Thesis

Nuvo already notices when the week breaks, when the deck is raw, and when a domain goes quiet.
D-206 built the remedy: **Get ready**, a stack of up to five cards, worst first. But you reach it
through a button that says nothing ("Get ready ›"), and the fact that should make you press it lives
somewhere else. The repair line only appears when something broke. The decks have their own gap
line ("3 need shaping · mid-groom"). The sidebar's cues say a third thing. The operator's report is
the evidence: a block scheduled that morning didn't happen, and they couldn't tell where Nuvo would
say so.

**So the door becomes a sentence.** Every planner page opens its rail with the same crown, and its
last row is **the line**: the first card of that page's Get ready stack, said in words, with where
it goes ("◌ 2 blocks today didn't happen · Get ready ›"). Press it, and the rail becomes the stack.
Act on a card, and the thing lands, a mark travels to the reading it moved, and the reading swaps in
place. When the stack is empty the line is quiet, and there is nothing to press.

## 2 · What Nuvo offers: the kinds, and where each goes

**Repair and Plan the week are different acts.** One puts back what reality knocked over; the other
composes what's next. The Get ready stack *orders* them, worst first, and each card can open its full
mode. They never merge into one walk.

| Kind | Question | Looks | Starts from | `readyCards` kinds | Full mode the card opens | Lands on | Tone |
|---|---|---|---|---|---|---|---|
| **Repair** | Something didn't happen. Where does it go now? (A2 · D4) | back | a fact: a block ended undone, or a meeting landed on it (`useWeekRepair`) | `repair`, `repairAll` | Repair (`RepairRail`) | the week track: no time → placed | `--warn` |
| **Plan the week** | Where do this week's hours go? (W2 · W3) | forward | **your choice**; the line only invites when work has no time | `hold`, `loose`, `plan` | Plan (`PlanRail`) | the week track: no time → placed | `--accent` |
| **Groom** | Is the work ahead ready? (Q3 · Q4) | further: the next weeks or quarters | a fact on the deck: no outcome, a thin path, no OKRs | `path` (today) plus outcome and OKR cards (new) | the record, or Draft the path | the deck's track: raw → ready | `--accent` |
| **Row offer** | This one thing has an obvious home | one row | a confident answer (D-205) | `file`, `hold` (as chips) | none: one chip on the row | the crown row it serves | `--accent` wash |
| **Read** | Which part of my life is quiet? (W5 · Q7) | across months | a fact: no hours in a domain for 3 weeks | none: it reports | none | nothing | `--muted` |

*Memory* (`memory` card) stays an input to Plan, inside the stack, as D-206 built it. **Read** is
the Domain floor's existing *Nuvo's read* (`lib/domainRead.ts`) moved to the line, not a new voice.
It never offers a task from a quiet domain (N-20) and never suggests parking one (D-197).

## 3 · The crown: one part, every planner page

The Schedule's crown (`WeekPanel`) and the decks' crown (`PlannerRail`'s `crown`) become one kit
part, `RailCrown`. It enforces planner law 2 and takes D-206's week track as its track.

```
THIS WEEK · NOV 9–15                    ← eyebrow: what this page measures
13/17 done                              ← one number (D-206)
━━━━━━━━━━━━▪▪◌◌                        ← the track (D-206's states)
◌ 2 blocks today didn't happen · Get ready ›   ← THE LINE
```

| Page | Eyebrow | Number | Track | Line draws from |
|---|---|---|---|---|
| Schedule | This week · {span} | N/M done | D-206 week track | the Schedule's Get ready stack (`readyCards`) |
| Project deck | Next 4 weeks | N of M ready | one piece per project: shipped · ready · raw | the deck's stack: no outcome, thin path, a crowded week (Q2) |
| Initiative deck | Next N quarters | N of M on track | one piece per bet: shipped · on track · at risk · needs shaping | the bet deck's stack: at risk (`--warn`) first, then no OKRs / needs shaping |
| Domains *(open, §8.1)* | This month · N domains | N of M with hours | one piece per domain: kept · quiet | Read only |

- **The header button goes.** No "Get ready ›" chip beside the eyebrow; the line is the door. The
  crown's eyebrow names the week it measures; it isn't a hero date.
- **The crown is pinned in every mode** (D-204). The stack and the modes render under it, so the
  reading advances while you work.
- **The project rows stay under the crown** on the Schedule (the Reach's targets, D-202).

## 4 · The line

### 4.1 · What it says

**The line is the first card of the stack, in words.** One ranking, `readyCards`, decides both
what the line says and what the stack shows first, so they can never disagree.

| First card | Line |
|---|---|
| `repair` (one) | "◌ {title} didn't happen (2pm) · Get ready ›" or "↯ {title}: a meeting landed (Thu 10am) · Get ready ›" |
| `repairAll` | "◌ 3 blocks this week didn't happen · Get ready ›" |
| `hold` / `loose` / `plan` | "4 with no time · Get ready ›" |
| deck: outcome / path | "{project} has no outcome · Get ready ›" or "3 on deck need shaping · Get ready ›" |
| bets: at risk | "{bet} is at risk · Get ready ›" |
| Domains: Read | "{domain}: no hours in 3 weeks · Open {domain} ›" (opens the domain; there is no stack) |
| none | the line reads "Ready" in `--faint` for one beat after the last card, then nothing |

A second card of a *different kind* may sit under the line as one faint "then:" clause ("then: 4 with
no time"). Never a third, and never a count of the stack.

### 4.2 · Rules

| Rule | Why |
|---|---|
| **One line, the stack's first card.** Never a list | P8; P4 (the stack is capped at 5 and never counted, D-206) |
| **Only while true.** An empty account shows no line | P7 |
| **A fact and where it goes**, never an imperative: "didn't happen (2pm)", never "You missed a task" | P4 |
| **Never counts up, never moves on its own**; a number in it swaps | P9, D-187 |
| **`--warn` when the first card is a break or an at-risk bet, `--accent` otherwise, `--muted` for a Read.** `--signal` stays *now* | P14, D-204 |
| **Nothing opens the stack but your press.** No badge, no push, no modal | P3, N-07 |
| **"Leave it where it is" is remembered per account,** never asked again for the same block at the same time | today it is `localStorage`, per device |

### 4.3 · When a block counts as "didn't happen"

The code holds two clocks for one fact. `useWeekRepair` calls a block missed the minute it ends
undone; the rail's *Overdue* (`taskQuery.ts`, `OVERDUE_GRACE_MS` = 1h) waits an hour after the end.
**One rule, in the kernel** (`isMissed` in `planningRules.ts`): a block is missed when it ended
undone, and the line shows it **15 minutes after its end, or at the start of your next block,
whichever is first**. *A proposal: feel-test it before it is a number.* After working hours, today's
misses fold into one `repairAll` line. Still excluded, on purpose: recurring blocks (Memory's
business, D-194) and tasks inside a slot.

## 5 · The stack, per page

The Schedule's stack is D-206's, unchanged except that the line opens it. The decks get their own
stack through the same `GetReadyRail` and kit `OfferCard`:

| Page | Cards, worst first | Acts (named by destination) |
|---|---|---|
| Schedule | as D-206: repair · hold · loose · file · path · memory · plan | Move to… · Hold… · → {place} · Draft the path · Keep: … · Plan the week |
| Project deck | no outcome (✦ draft) · thin path · a week holding more than fits | **Set as outcome** · **Draft the path** · **Move to Nov 23** |
| Initiative deck | at risk · no OKRs · needs shaping | **Bring {project} on deck** · **Move to Q2** · **Set these OKRs** · **Leave it where it is** |

Every card writes nothing until pressed (P3), says what it is built from (P6), lands and Reaches
(D-202), and leaves. When a card opens a full mode (Repair, Plan), Esc returns to the stack, not to
rest.

## 6 · The landing: what improved, shown where it went

D-202's Reach on every card, every page:

1. **Land.** A moved block slides from its old place to its new one (FLIP, `--ease-land`); a new one
   lands from 0.88 scale; a groomed card's ring fills.
2. **Reach.** One 8px mark in the domain's hue travels to the reading it moved: the project's crown
   row on the Schedule, the deck crown's track on the decks.
3. **Advance.** On arrival, that piece of the track changes state with a short pop, and the labels
   it changed swap ("13/17" stays, "2 of 3 placed" → "3 of 3"; "5 of 8 ready" → "6 of 8").
4. **The line re-ranks** after the advance, never before. When the stack empties it reads "Ready"
   once.
5. **Phone:** the same onto the crown strip's pip, plus `haptic("success")`. **This needs an iOS
   path.** `lib/haptics` is `navigator.vibrate`, a silent no-op on iOS (its own comment says so), so
   the iPhone, the shell this matters most on, feels nothing. The Tauri iOS build needs a native
   haptics plugin; the PWA gets none.

D-202's limits hold: only on your own act; never on load, refetch, realtime echo or an agent write;
Undo snaps back; one mark per project for a batch; reduced motion swaps at once; no tally (N-04).

## 7 · The frame: the rail owns its corner

On the Schedule the rail runs to the top of the panel and the page bar starts at the grid. On the
decks the page bar (`Projects · On Deck Groom Table Shipped`) spans over the rail, so the crown starts
lower and the faces' tabs sit in the rail's territory. **Every planner page does what the Schedule
does:** the rail runs to the top; `PageBar` begins at the grid's left edge (`FloorPane`'s workspace
faces). The crown's eyebrow is the rail's only header.

## 8 · Open questions

1. **Does Domains get a rail?** The wall is a Board, not a Planner, and has no pool. A rail just to
   hold a line is a new place (P10). The lighter alternative is the line alone in the wall's own
   head, under *This week's shape*. The prototype shows the rail; the feel test decides.
2. **The grace (§4.3).** 15 minutes, or the next block's start, is a guess until it's lived with.
3. **Do the Spine's cues go?** `readSpine` puts words on every rung ("2 drifting", "3 to place").
   With the line on every page, that's a second place for the same fact (P8). Proposed: the rung
   keeps a dot (amber when its page's first card is a break or at-risk, accent otherwise) and loses
   its words.
4. **Which deck cards ship first.** The project deck's outcome draft needs the scaffold endpoint to
   draft one outcome; *Move to Nov 23* needs `sprintSpanFor`'s fit. The initiative deck's *at risk*
   facts exist today (`InitiativeDeck.tsx`, the crown's `gap`); its acts don't.

## 9 · What it retires

- The **Get ready ›** button in the crown's header (D-206), and the Plan the week door it replaced.
- `RepairLine` as a separate line: a break is the stack's first card, so the line already says it.
- The decks' own gap line ("3 need shaping · mid-groom ›") and its jump to Groom.
- Three crown implementations, replaced by `RailCrown`, shown at `?kit`.
- If §8.3 lands: the Spine's cue words.

## 10 · Build order

1. **`RailCrown` in the kit**, mounted by `WeekPanel` and `PlannerRail`, with the line drawn from
   `readyCards[0]` on the Schedule. The header button goes; `RepairLine` folds in. Phone: the crown
   strip's line opens `MobileGetReady`.
2. **`isMissed` in the kernel**, used by `useWeekRepair` and `taskQuery`'s overdue. Conformance test.
3. **The frame fix** on the decks (§7).
4. **Deck stacks**: the project deck's cards (outcome, path, crowded week), then the initiative
   deck's (at risk, OKRs). Each card kind needs a fixture at `?rail=ready`.
5. **The landing on deck cards** (`reachMark` onto the deck crown), then **iOS haptics**.
6. Docs the same day: this header, `design-language.md` (planner law 2 names `RailCrown` and the
   line), glossary, ledger notes for A2 · D4 · Q3.

## 11 · Verification

- `tests/rail-crown.test.tsx`: one crown component on all three planner pages; the line equals the
  stack's first card on every fixture; at most one "then:"; no line on an empty account (P7).
- Kernel conformance: `isMissed` agrees between the SPA and the agent; Overdue and Repair flag the
  same tasks at the same minute.
- Momentum: Reach keyframes are transform/opacity only; nothing animates on a refetch.
- Driven on the dev app at desktop and 375px, including the decks' frame change; `npm run perf`
  (the crown, the rail and the Schedule are shared surfaces).
- On a real iPhone: the success haptic fires on a card's act, and never on load.
