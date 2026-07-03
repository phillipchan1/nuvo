# On Deck — grooming that starts at the timeline

Status: **spec** (2026-07-01). The surface that fixes the thing grooming is missing: a
higher-level *start*. Today grooming drops you straight into a per-project card deck
(`RefineRun` → `ItemRun`) with no view of what's coming, sorted by *how unready* a project
is rather than *when it's needed*. On Deck is the timeline you open **first** — see the
next few weeks, see what's about to collide, make the coarse calls — and only then drop
into the deck to shape the survivors.

Sits on [`refine-run.md`](./refine-run.md) (the card deck — kept as-is), the
[`commitment-model.md`](./commitment-model.md) engine (Demand ÷ Capacity, already built),
and [`readiness-model.md`](./readiness-model.md) (the ambient gauge). It is almost entirely
an **assembly of existing pure functions**; the one genuinely new thing is the
project-attributed timeline view itself.

---

## 1 · Thesis — two altitudes, one flow

Grooming is two different acts we've been calling one thing:

- **Portfolio grooming (the timeline).** Look across the on-deck projects, see what's
  *going to happen* to the near weeks, and make the coarse calls — this one's in, that one
  waits, next week is impossible so something moves. Judgment about the **set**.
- **Project grooming (the deck).** Once a project is in play and needed, shape it to
  schedulable — one at a time. This is `ItemRun`, unchanged.

The load-bearing claim: **for a time-limited operator the highest-leverage grooming is
subtraction at the timeline, not shaping at the card.** Deciding what *waits* next week
saves more than sharpening a task ever will. So grooming must **open on the timeline** and
treat the deck as the second act, reached only for the handful that survive the cut.

> **The timeline decides. The deck does.**

## 2 · The flow — the six doors collapse into one

```
On Deck  ──"Shape the N that need it"──▶  Groom deck (ItemRun)  ──seal──▶  back to On Deck
(survey the set,                          (shape one at a time,            (a week fills,
 make coarse calls)                        dealt by demand)                 coverage climbs)
```

On Deck **replaces `RefinePortfolio` as the home screen of the existing grooming flow**
(`flow === "refine"` in `AppShell.tsx:287`). The Scaffold, the `ItemRun` deck, the cards,
the seal — all kept. This also **absorbs two orphaned/siloed flows**: `CapacityRun`'s
Keep/Park/Cut becomes the coarse-move layer *on* the timeline (§6), and `TendingFlow`
(mounted, no entry point — dead) is retired.

Entry points that today open the grooming flow all now land on On Deck: the command
palette "Groom" (`Planner.tsx:401`), the floor readiness "Groom" button
(`FloorReadiness.tsx:29`), the mobile "Groom your projects" button (`MobileShell.tsx:278`).
A tapped to-groom *row* (`nav.flowFocus`) still jumps straight into that item's deck —
that path is unchanged.

## 3 · What already exists (this is why it's cheap)

| Need | Already built | File |
|---|---|---|
| Per-week **capacity** (open work-mins) | `capacityByWeek` → `useCapacity().byWeek` (`WeekCapacity{weekStart, availMins}`) | `lib/capacity.ts`, `hooks/useCapacity.ts` |
| Per-week **demand** forecast | `demandByWeek(d, now, weekStarts)` → `{weekStart, demandMins}[]` | `lib/pace.ts` |
| Per-project **pace / due / remaining** | `projectPace` → `{remainingHours, daysLeft, read}`; `portfolioDemand` → `counted / latent / pressing` | `lib/pace.ts` |
| The **pinch** math (demand ÷ capacity per week, `over` flag) | `CommitmentMeter.forecast` (needs lifting into the lib) | `components/floors/CommitmentMeter.tsx` |
| Coarse **moves** (Park / Cut / Reschedule) | `CapacityRun` verdicts → `updateProject({status, targetDate})` | `components/capacity/CapacityRun.tsx` |
| **Readiness** per project (bar color, needs-shaping) | `tendedScore`, `refineProjectCards`, `CALM` | `lib/tending.ts`, `lib/refine.ts` |
| The **deck** (shape one project) | `ItemRun` + `refineCards` | `components/refine/RefineRun.tsx` |
| Demand-ranked **run queue** | `curateRefine` (reorder by demand — §7) | `lib/refine.ts` |

The only new code is `lib/onDeck.ts` (pure assembly) and `components/ondeck/OnDeckTimeline.tsx`
(the view), plus a small pace.ts addition and a lib-lift refactor.

## 4 · The data model — `src/lib/onDeck.ts` (pure)

One pure function over `VerticalData` + the capacity read, mirroring `readiness.ts` /
`standing.ts`. **No new scoring** — it only arranges what the engines above already return.

```ts
const HORIZON_WEEKS = 3;        // near-term the timeline shows (knob §10)
const BLOCK_MINS = 90;          // display unit — a "focus block"; math stays in minutes

type LaneState = "ready" | "needs_shaping" | "stalled" | "idea" | "parked";

interface OnDeckLane {
  project: Project;
  pace: ProjectPace;            // projectPace()
  readiness: number;            // Math.round(tendedScore*100)
  needsShaping: boolean;        // refineProjectCards(...).length > 0
  state: LaneState;             // from pace.read + readiness + status
  startWeekIdx: number;         // first horizon week it's in play (0 = this week)
  dueWeekIdx: number | null;    // week containing targetDate, clamped; null = undated → idea
}

interface WeekColumn {
  weekStart: Date; idx: number;
  availMins: number;            // useCapacity().byWeek[i].availMins
  demandMins: number;          // demandByWeek[i].demandMins
  over: boolean;                // demandMins > availMins
  blocks: number;               // round(availMins / BLOCK_MINS) — for display
}

interface Pinch {               // the one projection sentence, deterministic (no AI)
  weekIdx: number;
  overByMins: number;
  culprits: Project[];          // counted projects whose span covers the over week, worst pace first
  line: string;                 // "Next week wants ~4 blocks and you have 2 — Q3 pricing slips unless you start it this week or push API out."
}

interface OnDeckBoard {
  weeks: WeekColumn[];
  lanes: OnDeckLane[];          // demand-ranked (portfolioDemand.counted order, then latent)
  pinch: Pinch | null;          // first over week, or null when the horizon fits
  coverageWeeks: number;        // readyRemainingMins / weeklyAvgMins — "2.1 weeks stocked"
}

export function readOnDeck(d, cap: CapacityRead, now): OnDeckBoard
```

- **`coverageWeeks`** is the reframed headline (replaces the portfolio's "% ready"):
  `Σ remainingMins of ready projects (readiness ≥ CALM) ÷ weeklyAvgMins`. This is the "how
  many weeks am I stocked" number the whole thing trends toward.
- **Lane span:** a project is in play from `startWeekIdx` (this week, or `pace.read`-derived
  start) to `dueWeekIdx`. Undated → `idea` lane, floated to the far week. `overdue` → its bar
  starts in week 0 (owed now), matching `demandByWeek`.
- **State → color** (reuse tokens, no new hue): `ready` teal (`READY`), `needs_shaping` /
  `stalled` caution amber (`PROJECT_STATUS_COLORS.waiting`), `idea` dashed `--line-strong`,
  `parked` faint.

### The one pace.ts addition — per-project attribution

`demandByWeek` returns *aggregate* mins per week; the bars and the pinch culprits need
project identity. Add a sibling that keeps it, and let `demandByWeek` delegate:

```ts
export function demandByWeekDetailed(d, now, weekStarts):
  { weekStart: Date; demandMins: number; contributors: { project: Project; mins: number }[] }[]
```

Same spread logic already in `demandByWeek` (lines 146–163) — just don't discard the
`project` while summing. `pinch.culprits` = the over week's `contributors`, sorted by
`pace.driftDays`.

## 5 · The projection — lift the forecast, keep it deterministic

`CommitmentMeter.forecast` (`CommitmentMeter.tsx:38–52`) already computes per-week
`{freeMins, demandMins, ratio, over}` with the far-future cap trick (`Math.min(availMins,
weeklyAvgMins)`). **Lift it verbatim into `lib/capacity.ts` as `weekForecast(byWeek,
demandByWeek, weeklyAvgMins)`** so `onDeck.ts` and `CommitmentMeter` share one source and
can never diverge. `CommitmentMeter` then renders the lifted result; `onDeck.ts` reads the
same to set `WeekColumn.over` and find the pinch.

The pinch **`line` is generated deterministically** from the numbers + culprit names — the
steward voice ("the app reports"), never an AI sentence. Template:
`{Week} wants ~{demandBlocks} blocks and you have {availBlocks} — {topCulprit} slips unless
you {start it this week | push {laterCulprit} out}.`

## 6 · The surface — `OnDeckTimeline.tsx`

A horizontal 3-week timeline: project lanes as bars, a capacity row, the pinch banner, and
inline coarse moves. Mounted where `RefinePortfolio` was, inside `RefineRun`'s `!inRun`
branch.

**Layout** (reference the sketch in this conversation):
- **Header:** "On deck · next 3 weeks" + `coverageWeeks` ("2.1 weeks stocked"), trending
  hint when a far week thins.
- **Pinch banner** (only when `pinch != null`): the amber `Pinch.line`. Calm/hidden when
  the horizon fits — cue doctrine.
- **The grid:** week columns (each showing `blocks` capacity, amber when `over`), one row
  per lane, bar positioned by `startWeekIdx → dueWeekIdx` with a due pin, colored by state.
- **Footer:** "Shape the N that need it →" (the handoff, §7) + the move affordance.

**Coarse moves — reuse `CapacityRun`'s mutations, no new backend:**
- **Push out** — drag a bar right / a "Push a week" action → `updateProject({targetDate})`
  (the Reschedule verdict). Pointer events only (Tauri rule).
- **Park** — swipe a bar away / "Park" → `updateProject({status:"waiting"})`.
- **Cut** — `updateProject({status:"cancelled"})`.
- The pinch banner **re-reads live** as load sheds (same pattern as `CapacityRun`'s live
  `readLoad`), so the amber eases the moment you park or push — the reward beat.

**Mobile** (this flow is already phone-first): the 3 weeks stack or scroll horizontally;
tapping a bar opens a bottom `Sheet` with Shape · Push · Park · Cut (never a cursor
popover). ≥44px taps, `pb-safe`, clears the bar + FAB.

**Warm Paper:** transparent over `.atmosphere`, hairline-separated grid, bars are the
lifted element (`.glass-lift` on the focal/dragged bar). Masthead header (Fraunces). No
opaque `bg-*`. Semantic color only (READY / caution amber / domain color / `--line`).

## 7 · The handoff — demand-ordered deck + the "why now" band

**Queue by demand, not readiness.** On Deck's "Shape the N" builds a queue from the
`needs_shaping` lanes ordered by `pace` urgency (pressing → soonest `daysLeft`), and calls
the existing `startRun(refs)`. Independently, **reorder `curateRefine`** (`refine.ts:198`,
`refine.ts:248`) so its clusters rank by `portfolioDemand` pressing/pace instead of raw
`tending` priority — so every entry into the deck is demand-first.

**Make the intelligence visible in the deck.** Add a `demandContext(d, cap, ref, now)`
helper (in `onDeck.ts`) returning the one sentence + due + week-capacity for a ref, and
render it as a **"Why now" band** at the top of `ItemRun`'s `Board`
(`RefineRun.tsx:225`): *"Due next week and it needs ~2 blocks. Next week has 2 open —
groom it now so Sunday can place it."* Plus reframe the position line from "project 1 of 3"
to "blocks next week · 1 of 2," and the seal payoff from "portfolio 60→64%" to "next week
reads 4 of 5 blocks covered."

## 8 · Build order (each slice ships mobile-ready + verified in the dev app)

1. **Lift `weekForecast` to `lib/capacity.ts`; add `demandByWeekDetailed` to `pace.ts`.**
   Pure refactor, no UX change, `CommitmentMeter` switches to the lifted fn. Keeps build
   green. *(foundation)*
2. **`lib/onDeck.ts` + read-only `OnDeckTimeline`**, mounted as the grooming home in place
   of `RefinePortfolio`. You can now **see** the timeline, capacity, and pinch. No mutations
   yet. *(the surface — the big visible win)*
3. **Handoff + "Why now" band.** "Shape the N" → `startRun` with a demand-ordered queue;
   `demandContext` band in `ItemRun`; reorder `curateRefine`. *(the two altitudes connect)*
4. **Coarse moves on the timeline** (Push / Park / Cut, live-easing pinch). Fold
   `CapacityRun` into this; retire it as a separate flow. *(subtraction becomes one gesture)*
5. **Sunday handoff + cleanup.** On Deck as the front half of the Sunday ritual (feeds the
   Shape grid); retire `TendingFlow` and `RefinePortfolio`. *(close the loop to the calendar)*

## 9 · Reuse / retire ledger

- **Reuse unchanged:** `capacityByWeek`, `useCapacity`, `demandByWeek`, `projectPace`,
  `portfolioDemand`, `tendedScore`, `refineCards`, `ItemRun`, `curateRefine` (reordered),
  `CapacityRun`'s mutation calls, `toBusyBlocks`.
- **New:** `lib/onDeck.ts`, `components/ondeck/OnDeckTimeline.tsx`, `weekForecast`
  (lifted), `demandByWeekDetailed`, `demandContext`.
- **Retire:** `TendingFlow` (orphaned), `RefinePortfolio` (subsumed by On Deck),
  `CapacityRun` as a standalone flow (folded into the timeline's moves).

## 10 · Open knobs (tune against the running app)

- `HORIZON_WEEKS` (3?) — how far the timeline looks before it's just noise.
- `BLOCK_MINS` (90?) — the display block size; align with Sunday's `batchWeek` focus blocks
  so "2 blocks here" means "2 blocks there."
- `coverageWeeks` "ready" threshold — is a project ready at `CALM` (0.85) or only at 100%?
- Pinch sensitivity — `over` at `ratio > 1`, or leave a small buffer before it flags.
- Lane start rule — do bars start this week, or only in the week work realistically begins?
</content>
</invoke>
