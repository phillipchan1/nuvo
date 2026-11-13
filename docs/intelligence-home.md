# One home for Nuvo's suggestions — and the landing that reaches the outcome

**Status: §5 (the Reach) built as D-202 on `worktree-intelligence-readings`; see D-202 for where it fires.
§1–§4 (where offers live) are an open question, Q-16: the same day, D-198 put offers in the
right-hand Nuvo panel and shipped it, and D-201 removed the chat but kept that panel. §2's
"asked" column and §4 are history either way. The readings the Reach moves are specced in
[`outcome-readings.md`](./outcome-readings.md) (D-203).** Anchor pass run the same day
(Ledger W2 · W3 · Q1 · W6; strains P9; four no's clear). Prototype (private, example data):
[Nuvo Reach](https://claude.ai/artifact/Y7ZB6hQWShuuaZ35eBXJFP): the desktop Schedule
(today's two homes vs one, docked vs floating chat, the refused counter for comparison) and the
phone's Calendar.

Builds on: [`plan-the-week-v2.md`](./plan-the-week-v2.md) (the draft on the real Schedule, the
walk) · [`memory.md`](./memory.md) (observations that reach Plan the week) ·
[`design-language.md`](./design-language.md) — *Momentum* (Land · Advance, the pace tick) and the
six layouts · D-193 *Draft the path* (the ghost row) · `useWeekCrown` (placed vs loose) ·
[`agent-conformance.md`](./agent-conformance.md) (the chat's battery).

---

## 1 · Thesis

Nuvo now suggests things in two places. **Plan the week**, What I noticed and Draft the path sit
on the left, beside the work. The Nuvo panel on the right is a chat with suggestion starters
per page ("Which projects are rawest and need shaping?"), and it is becoming a second place to be
told what to do. Two surfaces claiming one question is P8's failure. P3 already says where
suggestions belong: in a quiet pool, and **the pool is on the left** of every planner surface.

So: **what Nuvo offers unasked lives on the left, as a ghost in the pool, beside the work it
would change. What you ask Nuvo for happens in the chat, which you call up and dismiss.** The
chat stays a permanent first-class *action*, as it already is on the phone (the ✦ launcher).
It stops being a second *place*.

The second half is what accepting feels like. A placed block already *lands* (D-187). But the
thing it serves, the project's line in the week crown, stays where it is and changes without
anyone seeing it. **The Reach** connects the two: in the same beat as the landing, one mark
travels from the block to its project's row, and that row's track advances one piece. You hit
something and the goal bar moves. That is the part of a game worth taking. The part not worth
taking (points, streaks, a running tally) stays refused (N-04).

## 2 · Asked vs offered

*Since D-201 there is no "asked" column: the chat is removed. The "offered" column is the rule.*

The line that decided where anything went:

| | **Offered** — Nuvo, unasked | **Asked** — you, in words |
|---|---|---|
| Lives | on the **left**: the pool of the page you're on, or inline in the list it changes | in the **chat** |
| Shape | a **ghost**: the real row or block, not yet yours (D-193's accent wash + dashed check) | a reply, and when it wrote something, the record card with **Undo** (as today) |
| Writes | **nothing** until you Keep | what you asked for, reported with Undo (unchanged; the battery holds it) |
| Says | why it's there and what it's built from (P6): "slipped 3 weeks", "you usually do this Tue mornings" | the answer |
| Lands / Reaches | **yes**: Keep is your tap | **no**: a write the assistant made is never celebrated (Momentum law 2) |
| Examples today | Plan the week's draft and walk · What I noticed · Draft the path · span remedies (W3) | "move my 3pm to tomorrow" · invites (D-069) |

**Consequence for the chat:** a starter that duplicates an act the left already offers is removed
from `agentHints`. "Which projects are rawest and need shaping?" is the Groom deck's question;
"What should I defer to backlog?" belongs to the inbox. The starters that stay are questions
only a conversation answers ("Summarize what's in flight across domains"). The chat may *point
at* an offer ("Plan the week has a draft for Tuesday") but never re-renders it as a card.

## 3 · Where the left is, per layout

Every page is one of six layouts (D-190). The offer goes where that layout keeps its pool:

| Page | Layout | Where offers sit |
|---|---|---|
| Schedule | Planner | the rail (`LeftRail` / `PlanRail`), with the draft drawn on the grid (D-180) |
| Project deck · Initiative deck | Planner | the `PlannerRail` pool |
| A project or initiative | Document | inline in the list it changes (Draft the path is the model) |
| Groom · Inbox | Board · List | inline, at the top of the column or list it changes |
| Domains | — | **open (§8.1)** |
| Phone, every tab | — | inline in the tab's list or the Calendar's crown; the chat is the ✦ launcher, as today |

No page gains a new panel, and no offer floats over the work as a toast.

## 4 · The chat, summoned — *superseded by D-201: the chat is removed*

Kept for the record of what was weighed. With no chat, steering Nuvo in words happens on the
object (Draft the path's **/** steer) or through capture.

Desktop today: `AgentSidebar` is a 380px column, its open state persisted (`nuvo-agent-open`),
toggled by ⌘J, and forced shut on a narrow window (`AppShell`'s width budget).

Proposed:

- **⌘J or the ✦ opens it; Esc or ⌘J closes it.** Opening is not remembered across launches.
  The app opens on your work, not on a conversation.
- **The column stays a column while open** (the conversation and the work it acts on should be
  visible together), but it is a summoned surface, not part of the frame. Whether it docks or
  floats as the Inspector popover is a prototype question (§8.2).
- Memory's dot keeps its place on the sidebar row (D-194). It does not move to the chat.

## 5 · The Reach

### 5.1 · The act

You keep an offer that places loose work: Plan the week's **Looks good ↵**, the task sheet's
**Put in a slot** (D-172), or a drag of a loose piece onto the grid. Then:

1. **Land.** The block lands on the grid (`landBlock`, unchanged).
2. **Reach.** As the land settles, one mark (a 6px dot in the domain's hue) travels from the
   block to its project's row in the week crown (`WeekPanel` on desktop, the sticky crown strip
   on the phone). Transform and opacity only, one element, `--d-advance` on `--ease-momentum`.
3. **Advance.** The piece in the row's `PaceTrack` that stands for the placed task goes from
   *loose* to *placed* with D-187's Advance, and the `placedLabel` changes in place, "2 of 5
   placed" → "3 of 5 placed". The number swaps; it never counts up.

   **This amends `PaceTrack`.** D-187's track draws only *done* (pieces filled in the domain's
   hue) against the rest. Placing a task doesn't do it, so with today's track nothing on the bar
   could move. The track gains a third state: **done** solid hue · **placed** tinted hue ·
   **loose** `--line`. The pace tick still compares only *done* to the clock (placing isn't
   progress on pace, P6). Needs a feel test: if a tinted piece reads as done, it's wrong.
4. **All placed.** When the last loose piece is placed, the label reads "all placed" and the
   project's pip fills with `landMark`, once. Nothing bigger.

### 5.2 · Rules

| Rule | Why |
|---|---|
| Only on your own tap, drag or key, once, at the moment of the act | Momentum law 2, P9 |
| Never on load, a refetch, a realtime echo, or a chat-made write | P9: data arriving is not progress |
| Undo snaps the row back: no reverse flight | Momentum law 3 |
| A task with no project reaches nothing: it lands, and that's all | P7: nothing to point at, no invented goal |
| Several placements at once (Keep all, a multi-select drop) send **one** mark per project, not per task | perf rule 2: one element per act |
| The crown row is off-screen or shut: the mark goes to the shut strip's pip; if no crown is mounted, no Reach | never scroll or open something to stage an animation |
| Reduced motion and `motionOff()`: no flight; the label and track change at once | Momentum law 4 |

### 5.3 · What doesn't change

No counter, no tally of acts ("12 groomed today"), no score, no level, no sound, no confetti,
no streak (N-04, D-202). Everything that moves is a fact the crown already shows; the Reach only
shows **where it came from**.

### 5.4 · The other altitudes: later, one anchor each

The same pattern fits elsewhere: keeping a drafted step could reach the project's readiness on
the Groom deck, and shipping a project could reach its initiative. Each is a separate decision
with its own ledger row. They are not part of this spec.

## 6 · What it retires

- The right panel as a standing column that is open by default and remembered.
- `agentHints` starters that duplicate a left-side act (§2).
- Any planning suggestion rendered as a card inside the chat. The record cards the chat shows
  today (`AgentRecordCards`) report writes it already made, with Undo; they are answers, not
  offers, and stay. This rule stops an offer card from starting.

## 7 · Anchor, for the record

| | Consolidation (Q-16) | The Reach (D-202) |
|---|---|---|
| Ledger | mends P8 for **W2 · W3** (one home, not two) | **Q1** (on pace?) and **W6** (did anything move?), at the moment of the act |
| Altitude | every page; structural | Week (crown) ← Day (grid) |
| Story step | commit | land |
| Strains | none named; costs one thing: every chat-born planning offer needs a ghost form on the left | **P9**, held the D-093 / D-187 way (§5.2) |
| Replaces | the standing right column; duplicate starters | nothing to remove; ties two existing motions together |
| Four no's | clear | clear: no pool, no new user-facing name, degrades on an empty week (no crown, no Reach), nothing about one account |

## 8 · Open questions

1. **Domains.** The Domain wall has no pool on its left today. Its offers (a quiet domain,
   N-20's boundary) need a home before any are built. Until then it has none.
2. **Docked or floating chat.** Prototype both; the feel test decides.
3. **Does Memory's observation card on Plan the week reach anything?** Keeping a habit writes a
   standing slot (D-194), not project work. Proposed: no Reach (nothing on the crown moved).

## 9 · Build order

1. The Reach on the Schedule, desktop: Plan the week's Looks good and a loose-piece drag. One
   WAAPI helper in `lib/motion.ts` (`reachMark(from, to)`), called by the act's handler, never
   by an effect that watches data.
2. The phone: Put in a slot → the crown strip's pip.
3. The chat: unpersist the open state, trim duplicate starters, update `tests/agent/` if a
   starter is named there.
4. Docs the same day: this status header, `design-language.md` (add **Reach** to the motion
   table, forbidden: on data, on chat writes, per task), ledger notes for Q1 / W6.

## 10 · Verification

- `tests/momentum.test.tsx`: Reach keyframes are transform/opacity only; no Reach on a refetch
  (render the crown twice with new data and assert no `animate` call).
- A test that a chat-made write lands nothing (the law already exists; this pins it for Reach).
- Driven on the dev app at desktop and 375px; `npm run perf` (the crown and the Schedule are
  shared surfaces).
