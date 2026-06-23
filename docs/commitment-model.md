# Commitment — knowing your week is aligned with your bets

The hardest thing Nuvo is trying to solve: **every week, know exactly what to work
on, with confidence the major projects and initiatives are on pace.** Tools pick a
side — Akiflow/Sunsama nail *the week* (capacity in hours), Asana/Notion nail *the
portfolio* (projects with deadlines). Nobody connects them because the two altitudes
speak different units: the week is measured in **hours**, the portfolio in
**deadlines**. With no shared currency, "am I over-committed?" has no honest answer.

## The bridge: turn every project into a weekly *rate*

A project with a **size** (remaining effort) and a **finish line** (target date)
implies a required weekly rate. That single conversion is the Rosetta Stone — it puts
the portfolio and the week in the same unit (hours/week).

```
required pace = remaining effort ÷ weeks until target
```

- **Demand** = Σ required pace across all in-flight projects
- **Capacity** = real available hours this week (calendar-derived — see below)
- **Commitment = Demand ÷ Capacity**
  - `< ~0.7` under-committed (slack — pull another bet)
  - `~0.7–1.0` healthy
  - `> 1.0` over-committed (cut scope, move a deadline, drop a bet, or add capacity)

"Are we behind?" is a separate number — **Drift**:

```
projected finish = remaining effort ÷ recent actual pace
drift = projected finish − target date
```

A project is behind when, at the rate it has *actually* been moving (trailing
completed blocks), it lands after its target. The whole mushy "committed / on-track /
behind" question collapses to **two numbers**: a ratio (Demand÷Capacity) and a delta
(Drift). Everything else on screen is decoration around those two.

## Size comes from the funnel — refinement is the gate

A project only enters the meter once it's **sized + dated**, and that maps exactly onto
the existing ripeness ladder (`src/lib/tending.ts`):

| Ripeness    | Has              | Size source                        | In the meter?              |
| ----------- | ---------------- | ---------------------------------- | -------------------------- |
| raw         | name only        | —                                  | No — latent, "refine to commit" |
| shaped      | outcome          | top-down (T-shirt → hrs)           | Rough demand               |
| scaffolded  | task path        | **bottom-up: Σ open task minutes** | Real demand, no finish yet |
| active      | path + target    | bottom-up                          | Full pace                  |

`durationMins` defaults to 30, so any scaffolded project is sized for free. As a project
ripens its estimate sharpens (top-down guess → sum of real task estimates). The meter is
only as trustworthy as your refinement — **and it flags what to refine next.** An
unsized project isn't scored as zero-demand-and-fine (the "comfortable lie" warned about
in `src/lib/standing.ts`); it shows as a refinement liability.

## Reconciles with `standing.ts`, doesn't replace it

`standing.ts` deliberately chose **WIP-first** capacity (no hours math). We keep that as
the *qualitative* guardrail and split the Capacity axis into the two things it conflated:

- **WIP / liabilities** (count in-flight, overdue, rotting) — governs **unsized** work.
- **Pace / Demand÷Capacity** — *quantitative* feasibility for **sized + dated** work.

These slot into the existing three honest axes: **Defined** is the ripeness gate that
lets a project into the pace math, **Capacity** becomes real hours-demand for ripe work
+ WIP for raw work, **Motion** powers Drift.

## Capacity = calendar-derived (decided)

The divisor is **real available hours** = working window (`work_start/end_minutes`)
− external meetings (`toBusyBlocks`) − already-scheduled blocks. Not the aspirational
Σ domain `weekly_target_hours` (which measures intent, not what the calendar can hold).
`refineFeasibility.ts` already walks the calendar this way per project — the portfolio
ribbon is its aggregate.

Making it *honest* (post-dogfood) took three corrections, because a naïve "window minus
booked" over 13 weeks reads wildly optimistic:
- **Weekdays only.** Weekends aren't work capacity, so the 8:00–4:30 window applies
  Mon–Fri (`capacity.ts` skips Sat/Sun).
- **Near-term anchor.** "Typical week" capacity = the average of the **next 4 full
  weeks**, not weeks 2–13. The far future looks empty only because one-offs aren't booked
  yet; recurring meetings are already on the calendar this close in, so near-term is real.
- **Cap the far weeks.** In the forecast ribbon each future week's free time is capped at
  that near-term typical, so a sparsely-booked week 9 doesn't pretend to be wide open.
  Recurring meetings keep actual ≤ cap anyway, so this never double-counts them.

## The gauge it replaces

The projects Standing used to show a WIP-first **"Capacity"** gauge (Comfortable / Tight /
Overcommitted by *count* of in-flight bets). That competed with the hours-based meter, so
the Commitment meter now **owns the capacity story** and the WIP read folds in as a
concurrency sub-line ("N in flight; M carry no plan yet" + the Triage handoff). The
Standing keeps **Defined** and **Motion**; `FloorStanding` drops the Capacity gauge via
`showCapacity={false}` for projects (initiatives still show all three).

## Where it lives in the spine

- **Summit (quarterly):** balance the portfolio against the quarter. Over-commitment is
  decided here, at altitude ("16 project-weeks of demand into a 13-week quarter — drop a
  bet or move a finish line").
- **Sunday → Pull:** feed the pull the right target — this week's required pace per
  in-flight project — so it proposes a capacity-gated, faithfulness-balanced pull
  instead of an arbitrary `sprintLoadMins` vs `weeklyCapacityHours`.
- **Refine / Reality-Check card:** the per-project version of the portfolio ribbon
  (already built — `refineFeasibility.ts`).
- **Timeline:** real date-spanned bars (not the current list-order fake Gantt), with a
  per-week capacity ribbon — weeks where the bars pile up past your hours glow `--signal`.
  Concurrency becomes literally visible.

## Phased build

**Layer 0 — manual, no AI ("stupidly clear"):**
1. Project **size** = Σ open task minutes (bottom-up). ✅ `src/lib/pace.ts`
2. **Required pace** + **Drift** per project. ✅ `projectPace()`; surfaced on `ProjectFloor`.
3. **Portfolio meter** (Demand÷Capacity, calendar-derived) on the projects Standing. ✅ `CommitmentMeter`.
4. **Capacity ribbon.** ✅ a per-week **load forecast** lives in `CommitmentMeter` (`demandByWeek` × `capacityByWeek`, with a capacity-ceiling line). ⏳ *Remaining:* the same ribbon **overlaid on the portfolio Timeline bars** so concurrency and over-capacity weeks line up pixel-for-pixel — deliberately deferred (the Timeline is an intricate pointer-drag component reached through the generic `Collection`; an aligned overlay there shouldn't ship without watching it render).
5. **Latent** unsized/undated projects — surfaced as the "not yet counted — refine to commit" handoff in the meter (the Timeline already has an undated tray). ✅

**Then stack intelligence:** auto-size raw projects from task titles; learn *real*
delivered velocity per domain so capacity stops being aspirational; auto-propose the
Sunday pull to exactly fill pace; early-drift alerts; ranked rebalance suggestions when
over-committed.

## Current state

**Project altitude** — `src/lib/pace.ts` `projectPace(data, project, now)` returns
remaining effort, required pace, recent actual pace, projected finish, and a `PaceRead`
(`clear | undated | overdue | stalled | behind | on_track | ahead`). Surfaced as a
hairline "Pace" row on the Project floor (`ProjectFloor.tsx`).

**Portfolio altitude** — `pace.ts` `portfolioDemand()` rolls in-flight projects into one
weekly demand and partitions counted / latent / pressing; `demandByWeek()` spreads that
across upcoming weeks. `src/lib/capacity.ts` + `src/hooks/useCapacity.ts` supply
calendar-derived capacity (this-week / typical-week / by-week). `CommitmentMeter`
(`src/components/floors/CommitmentMeter.tsx`, on the projects Standing) shows the
Demand÷Capacity band, a Fraunces synthesis, the per-week load forecast, and the refine
handoff for latent projects.

Layer 0 is complete except the in-Gantt aligned ribbon (step 4, deferred — see above).
The whole of it is calendar-/AI-free; the intelligence layers build on these primitives.

### Not yet verified in a running app
The remote build session had no preview/browser tooling, so these were proven by
typecheck, web build, and unit-level math checks — **not** yet driven on screen.
Worth a look on desktop + 375px before calling it done: the Project-floor Pace row, and
the `CommitmentMeter` (band, forecast ribbon, empty/over states) on the projects Standing.
