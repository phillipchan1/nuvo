# Plan the week, v2 — a planner that stays with the week

**Status: proposed (2026-11-06; revised same day — overlay on the real Schedule, any day,
and a rail you decide in rather than read).** *2026-11-06: built for a trial, uncommitted (D-180, D-181): the overlay, the To-settle rail,
alternatives on keys, hold, split, local moves, Keep clear (drag empty time), day acts (Lighten ·
Clear afternoon · Day off), runs by kind of action, This/Next week, memory (proposals + Keep/Forget
+ the kept list), the mid-week repair with the dial on the desktop (a bar over the Schedule) and the
phone (a card on the Calendar). Trial deviations from this spec: memory and the dial live in this
device's localStorage, not `plan_signals`; Keep clear is a planning rule, not a calendar event;
kept rules sit in the rail's "Nuvo keeps" list, not Settings; the phone has no draft mode (only
repairs). Handle is built on trial — Q-14 is still open.* *2026-11-09: the draft is now walked **one block at a time** over a faded calendar. Each group lists its tasks; ↵ accepts (holds) it and moves on; dragging it or picking a numbered alternative re-places it (D-183).* Prototype:
[Plan the week v2](https://claude.ai/artifact/Xtnmyo9RFic7r2xeZB8TwN) (private; Sunday ·
Wednesday · Phone scenes, example data, a toy scorer, not `compose.ts`). Three
calls are still open and marked **[open]** below; the biggest is Q-14 (how far the dial
goes). Supersedes, once accepted, the three-step walk of D-035–D-042 and extends D-163.

Builds on: [`plan-the-week-ux-review-2026-10-25.md`](./plan-the-week-ux-review-2026-10-25.md)
(the placement defaults, D-163) · [`standing-slots.md`](./standing-slots.md) (declared time)
· [`commitment-model.md`](./commitment-model.md) (can I carry it) ·
[`planning-kernel.md`](./planning-kernel.md) (one rule, two runtimes) ·
`useWeekDraft` / `lib/compose.ts` / `lib/batch.ts` (the engine we keep).

---

## 1 · Thesis

Plan the week runs once, on Sunday, as a stranger. It doesn't know when you're actually
free, it groups loose work by **who it's for** instead of **what you'll be doing**, every
correction you make is thrown away, and by Wednesday it's gone. So you can't trust it, and
you can't get faster at it, because it never gets better at you.

v2 is three changes to the same engine:

1. **Correct at the speed of thought.** The draft is an **overlay on the real Schedule**,
   not a second calendar. Every block carries the other places it fits; one key moves it
   there; anything it displaces re-places itself. The composer asks you only about what it
   wasn't sure of — as marks you accept or reject, not sentences you read.
2. **Remember the corrections.** What you move, split, paint out and leave undone is
   evidence. Each plan opens with at most three things Nuvo noticed, each a *Keep* or a
   *Forget*, and each *Keep* becomes an object that already exists.
3. **Stay with the week.** When the week breaks — a meeting lands on a block, a block
   passes undone — the same composer stages the **smallest** repair on the Schedule, and
   you take it with ↵. How much it does on its own is a dial.

**The load-bearing idea: correct, don't configure.** The operator will not spend an hour
describing their life to a scheduler. They will spend a minute fixing a draft. If every fix
is kept, the draft is better next week, and the minute shrinks.

---

## 2 · Anchor

| Check | Answer |
|---|---|
| **Ledger** | **W2** (◐ → the week's best hours go to the week's intent, and stay there when Wednesday breaks) · **D2** (what's decided stays decided, *mid-week*, not only on Sunday) · **A4** (a plan that heals is one you don't quietly abandon) · **W1** (capacity uses real free time, not 9-to-5) |
| **Strains** | **P3/P4 and N-01** — a planner that acts mid-week is the nearest Nuvo has come to Motion. Held by: every change is staged, reasoned and one key; held blocks never move; the dial's top setting is **[open] Q-14**. **P9** — a stager that speaks every hour is a nag; it speaks only when the week *broke*, never to optimise. **P10** — memory must not become a place: it lives inside Plan the week and as one list in Settings → Schedule. **P16** — learning needs history; a new account runs on D-163's defaults, unchanged |
| **Already decided** | D-035–D-042 (the walk) — superseded by draft-first. D-163 (defaults) — kept whole; v2 is the layer above. N-20 / D-169 (the app never picks work) — kept: the inbox enters runs only by your one press, never by the app choosing a task. N-01 — see Q-14 |
| **Four no's** | Pool: no. Name: three new user-facing words — **Held**, **Needs you**, **What I noticed** — and one setting, **How much Nuvo moves**; glossary on build. Clean data: no — grouping reads titles, learning degrades to defaults. Builder-only: the drive at 8am is ⓞ; "time the calendar can't see" is the archetype |

---

## 3 · What's hard about planning a week — the order we design against

| # | Hard part | Today | v2 |
|---|---|---|---|
| 1 | **Knowing the real free time** — the calendar is wrong both ways (the drive isn't on it; optional meetings are) | One working-hours span; step 1 sets meetings aside | Paint *Keep clear* on the grid; learned clear hours proposed; per-day end times learned |
| 2 | **Groups that make sense** | Loose work batched by domain; AI runs by energy | Runs cut by **kind of action** (§5) |
| 3 | **The right hour for the kind of work** | D-163: projects take the morning | Kept; plus learned sitting length and project hour |
| 4 | **Fixing the draft fast** | Drag only; nothing reflows | Alternatives on keys, reflow, day acts (§4) |
| 5 | **After Sunday** | Nothing | Staged least-change repair (§7) |
| 6 | **Deciding what's in** | A step of lists | A pre-filled slate in the rail; untick reflows |

---

## 4 · The surface — an overlay on the Schedule (desktop first)

Plan the week stops being its own screen. **It is a draft laid over the Schedule you
already use** — `CalendarPane`, the real one — with the rail in draft mode beside it.

**Why an overlay, not a second grid (ⓟ, 2026-11-06).** `SundayRitual` draws its own week
grid, and you can feel it: small inconsistencies, and it doesn't perform like the
Schedule. It has already drifted once in a way that broke the act (the drag-scale bug,
`HOUR_PX` vs `hourPx`, D-163). A second calendar is the same failure as a second task row
(D-111): two implementations of one thing diverge. So:

- Draft blocks are **one more event source** on `CalendarPane`, painted through the same
  `eventContent` with a `draft` class. The pane already draws a draft preview
  (`DRAFT_PREVIEW_ID`) and drop ghosts that read exactly like the block you'll get (D-109);
  the plan's draft and its alternatives ride that, never a parallel renderer.
- They go in through **one `batchRendering` call** (perf rule 3) and carry **no
  `backdrop-filter`** (`tests/perf-budget.test.ts`). The draft is ~15 events; alternatives
  and ghosts are ≤6 more, only while a block is selected.
- Drag, resize, the gather rules (D-170) and the keyboard (`blockKeys.ts`) are the
  Schedule's own. The plan adds keys; it never re-implements a move.
- `SundayRitual`'s grid is deleted when this lands (and `FlowShell`'s walk with it).

**Not a Sunday event — an act you can do any day.** Planning is *take what needs a place
and find it one*, which is as true on a Tuesday as on a Sunday. Opening Plan drafts **the
rest of the planning week** from now (which week is `planningWeekStartISO` — the kernel
decides, so Saturday plans next week; never re-derived here). Sunday is the **recommended
rhythm**, carried by the existing week-reveal reminder, not a gate.

**Grid:** draft blocks rest in their domain's hue with a dashed edge; committed blocks are
solid. Calendar events are immovable. Keep-clear time is hatched `--line`.

### The rail — decide, don't read

The first prototype's rail was a stack of sentences: correct, and too much reading
(ⓟ: *"there has to be a way to triage using a lot less reading"*). The law:

| Rule | Instead of | Do |
|---|---|---|
| **One row, one decision, ≤4 words** | "8–9am stayed clear 3 of the last 4 weeks. Keep it clear every weekday?" | `Keep 8–9 clear` · `weekdays` · ✓ ✕ |
| **The grid explains, the rail doesn't** | a sentence describing the effect | the **focused** row previews its consequence on the grid: ghosts where blocks would go, hatch where time would close, trails from where they'd leave |
| **Evidence is a mark** | "3 of the last 4 weeks" | four pips, three filled `●●●○` |
| **Cause is a glyph** | "didn't fit" / "has no next step" / "landed on" | one glyph per kind, constant everywhere (legend once, in the rail's foot) |
| **Lists the grid already shows don't repeat** | a projects list and a runs list | the slate is a row of **pips** (a project per pip, its domain's hue; tap toggles it off the week); runs live on the grid |
| **Sentences on demand** | always-on explanation | `?` or a click on the row expands the one line of why |
| **Keys for the stack** | reading, then hunting a button | `Tab` walks the stack, `Y`/`↵` accept, `N`/`⌫` reject — the stack empties like an inbox |

**Rail, top to bottom:** the verdict (one meter, `29h / 38h`) and the slate pips · **the
stack** — noticed and needs-you in one list, glyph-led, ≤6 rows · the selected block (name,
span, one line of why, its alternatives as chips) · **Commit** at the foot.

### The walk — one block at a time (D-183)

Showing the whole draft at once over a full week was unreadable (ⓟ, 2026-11-09). So the plan
opens **on the earliest block**. The calendar scrolls to it and it lifts. The rest of the draft
goes quiet, and **everything already on the calendar fades**, so only the net-new reads. The rail
shows what the block holds (each task and its minutes), why it's there, and its other open times
(numbered on the grid). **Looks good ↵** holds it and moves to the next; **Later J** moves on;
dragging it holds it where it lands. A pip per block, in time order, shows what's accepted.

### Three zoom levels, no page changes

| Level | You see | Question it answers |
|---|---|---|
| **Forest** — the week | Seven columns of colored mass, a load bar per day, the verdict | Does it fit? Is it balanced? Is a domain dark (W5)? |
| **Branch** — a day or a domain | Click a day header: its acts. Hover a domain in the rail: its blocks light up across the week | Is Thursday sane? Where does Church live this week? |
| **Tree** — one block | Select a block: it lifts, its **alternatives appear as numbered outlines**, the rail shows what's inside it and *why here* | Is this the right place? Where else could it go? |
| **Preview** — one decision | Focus a row in the stack: the grid shows what *Keep* would do before you press it | What happens if I say yes? |

### The keymap — the whole point

| Key | Act |
|---|---|
| `J` / `K` (or click) | Next / previous block |
| `Tab` · `Y`/`↵` · `N`/`⌫` | Walk the stack (its focus previews on the grid) · accept · reject |
| `←` / `→` | Previous / next **alternative** (the composer's ranked fits, top 5) |
| `1`–`5` | Jump to that alternative |
| `↑` / `↓` | Same time, previous / next day (nearest fit if taken) |
| `H` | **Hold** — Nuvo never moves it. Any block you move by hand is held automatically |
| `S` | Split in two (sittings for a project; halves for a run) |
| `X` | Off this week (back to the rail) |
| `⌘Z` | Undo — every act, including a reflow, is one undo |
| `⌘↵` | Commit the week |
| Drag on empty grid | **Keep clear** — Once / Every week |
| Click a day header | Lighten · Clear the afternoon · Day off |

**Reflow is local and visible.** When a move lands on an unheld block, *that* block takes
its own best alternative and leaves a ghost trail from where it was. Nothing else moves.
Held blocks and events refuse the move (the block shakes; the rail says what's in the way).

### Needs you — exceptions, not a review

The composer lists only what it could not settle: a block that didn't fit (*Split into 2 ×
1h* · *Next week*), a project with no next step (*Add a step*), a block sitting on an
event you've marked optional. Everything else is presumed right. **An empty Needs you is
the 60-second week.**

### The reward

At commit: one line — *23 things → 11 blocks · 52s · 4 changes by you*. Not a stat board
(the quantified-self collector is an anti-persona); the last number is the one that should
fall week over week, and it's the evidence the memory works.

---

## 5 · Runs are cut by what you'll be doing

A run is time spent in one **mode**, so it is grouped by **kind of action**, not domain:

| Kind | Read from | Example |
|---|---|---|
| Calls | *call, ring, phone, catch up with* | "call David re lease" |
| Replies | *email, reply, respond, send, follow up* | "reply to Grace about Sunday" |
| Out of the house | *buy, pick up, drop off, return, post office* | "pick up dry cleaning" |
| Writing | *write, draft, outline* | "draft the sermon intro" |
| Admin | everything ≤15m that isn't above | "renew car registration" |

The AI pass (`clusterInboxRuns`) keeps its job, with the axis changed from energy to kind;
the deterministic fallback (`batchLooseWork`) uses the verb table above and only falls
back to domain when the kind is unknown. Domain still colors the task row inside a run.
Runs cap at 60m by default (learned, §6). **[open]** — confirm the kinds against a real
week's inbox (Phil's question 2 is unanswered).

**The inbox enters the week by one press.** The rail's *Inbox (14)* row carries **Put into
runs**; nothing is pulled without it (N-20, D-169).

---

## 6 · What I noticed — memory

### What's recorded

A `plan_signals` row for every gap between what the composer proposed and what happened:

| Signal | Recorded when |
|---|---|
| `moved` | a draft or committed block is moved (from, to, by key or drag) |
| `split` / `merged` | a block or run is split or merged |
| `cleared` | Keep clear is painted |
| `removed` | X, or unticked |
| `missed` | a committed block's end passes undone and not moved |
| `repair` | a staged repair accepted, cycled or dismissed |

Pure derivation reads them into **proposals**. Each needs evidence from at least three of
the last four weeks, and says so.

| Proposal | Evidence | On *Keep* it becomes |
|---|---|---|
| "8–9am stayed clear 3 of the last 4 weeks. Keep it clear?" | `cleared` / `moved` out of a range | a private recurring **event** on your calendar (busy, so `toBusyBlocks` already counts it) |
| "Friday after 2pm went unused 4 of 4 weeks. End Fridays at 2?" | `missed` / `moved` out | a per-day working-hours end (bet 2 of the Oct 25 review) |
| "You split the Admin run twice. Cap runs at 45m?" | `split` on runs | the run cap setting |
| "Project sittings you kept ran 90m. Make that the default?" | completed project block lengths | the sitting length setting |

**Every Keep becomes something that already exists** — an event, working hours, a setting.
There is no "memory" object to manage; the list in Settings → Schedule is just those
things, each with where it came from. *Forget* suppresses the proposal for 8 weeks.

**Never shown:** a proposal from one week's data; anything about a domain's *worth*
(that's the Domain floor's voice, not the planner's); more than three at once.

---

## 7 · Staying with the week — repair and the dial

### Triggers (only when the week *broke*)

- a calendar event now overlaps a committed block;
- a committed block ended undone and unmoved (`missed`);
- a dated capture lands in this week;
- first open of the day, if any of the above happened overnight.

Never on a timer, never to "optimise" a week that isn't broken (P9).

### Least-change repair

The repair is the composer run over **the rest of the week only**, with everything done,
held, or in the past fixed, and a **churn budget**: it may move the displaced block and at
most two others. A repair that reshuffles the week is worse than no repair — it's the
moment trust breaks. *Re-plan the rest of the week* (a button, always there) lifts the
budget, and still says how many moves it made before you take them.

### On the Schedule

The repair stages as a ghost at its target, with one line in the rail:
*"Call with Dana landed on Proposal draft. Thu 9am?"* — `↵` take it · `←/→` other times ·
`Esc` leave it. On the phone it is a card on the Calendar tab with the same three acts.

### The dial — *How much Nuvo moves* (Settings → Schedule, and in the rail)

| Setting | Behaviour |
|---|---|
| **Ask** | Nothing stages. *Re-plan the rest of the week* is there when you want it |
| **Suggest** *(default)* | Repairs stage as above; nothing moves without ↵ |
| **Handle** **[open] Q-14** | Repairs apply to unheld blocks, and the rail says what moved with an Undo on each. This overturns part of N-01 — it ships only with a logged decision |

---

## 8 · The phone

Same draft, same repair, taps not keys. Plan the week on the phone is the Week lens in
draft mode (one list per day). A tap on a block opens the `sheetKit` sheet: the name as the
mast, *why here* as the muted line, **Other times** as a `PickSheet` of the alternatives,
then *Hold* and *Off this week*. Repairs are a card above the crown. Keep-clear painting is
desktop only; the phone reaches it through the event composer (P5 holds — it's an event).

---

## 9 · Engine changes

| Piece | Change |
|---|---|
| `compose.ts` | Expose `alternativesFor(block, week)` (ranked fits, top 5, deduped within an hour); add `repairWeek(week, from, churnBudget)`. Same scorer as `composeWeek` — never a second placement rule |
| `batch.ts` | Kind-of-action axis; verb table; run cap from settings |
| `useWeekDraft` | Draft lives on the Schedule; commit unchanged. Holds on blocks |
| new `lib/planSignals.ts` | Record signals; pure `noticed(signals)` → proposals |
| `tasks` | a `held` boolean (or reuse an existing pin, if one exists — check first) |
| Migration | `plan_signals` (user_id, kind, task_id, from/to, at) with RLS |
| Kernel | If the agent gets *re-plan my week*, `repairWeek` must live where both runtimes import it (`planning-kernel.md`) and the act joins the registry |
| Perf | Ghost and alternative outlines are plain borders — **no `backdrop-filter` per block** (`tests/perf-budget.test.ts`). Reflow animates via one batched render |

---

## 10 · Build order

1. **Fast correction** — the draft as a `CalendarPane` event source, the decide-don't-read
   rail, alternatives on keys, hold, reflow, Keep clear, day acts, runs by kind; delete
   `SundayRitual`'s grid. *Done when:* a real week commits with Needs
   you empty after ≤5 keystrokes of correction, driven at 1440 and 375.
2. **Memory** — `plan_signals`, proposals, Keep/Forget, the Settings list. *Done when:*
   three weeks of real use produce a proposal you'd keep.
3. **Stays with the week** — triggers, least-change repair, the dial at Ask/Suggest.
   Handle only after Q-14.

Each order is forced: memory needs corrections to learn from, and a planner that acts
mid-week needs the trust the first two earn.

---

## 11 · Open

| # | Question | Default until answered |
|---|---|---|
| Q-14 | May *Handle* move unheld blocks without asking (with undo)? | No — Suggest is the ceiling |
| — | Do the five run kinds match a real inbox? | The table in §5 |
| — | Keep clear as a calendar event: on Google, or Nuvo-only? | Your primary calendar, private |
