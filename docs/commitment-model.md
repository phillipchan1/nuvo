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
Domain target-hours become the per-domain *budget split* of that real capacity.
`refineFeasibility.ts` already walks the calendar this way per project — the portfolio
ribbon is its aggregate.

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
1. Project **size** = Σ open task minutes (bottom-up). ✅ in `src/lib/pace.ts`
2. **Required pace** + **Drift** per project. ✅ `projectPace()`; surfaced on `ProjectFloor`.
3. **Portfolio meter** (Demand÷Capacity, calendar-derived) on the projects dashboard + Sunday.
4. **Real-date timeline + capacity ribbon.**
5. **Latent tray** for unsized/undated projects with a refine nudge.

**Then stack intelligence:** auto-size raw projects from task titles; learn *real*
delivered velocity per domain so capacity stops being aspirational; auto-propose the
Sunday pull to exactly fill pace; early-drift alerts; ranked rebalance suggestions when
over-committed.

## Current state

`src/lib/pace.ts` — `projectPace(data, project, now)` returns remaining effort, required
pace, recent actual pace, projected finish, and a `PaceRead`
(`clear | undated | overdue | stalled | behind | on_track | ahead`). Surfaced as a
hairline "Pace" row on the Project floor (`src/components/floors/ProjectFloor.tsx`).
This is Layer 0, steps 1–2 — the atom before the portfolio molecule.
