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
- **Commitment** — see the evolution below. The first cut was `Demand ÷ Capacity`
  (project pace vs free time); dogfooding showed that's tone-deaf when your week is
  wall-to-wall *meetings*, so Commitment now measures **total load**.

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

## Commitment = total load (the model that survived dogfooding)

A packed *meeting* calendar is commitment, even if zero project work is on it. So the
meter measures the whole week, not just project pace. Over a weekday work window
(`work_start/end_minutes`, Mon–Fri):

```
load = meetings/obligations  +  project pace        (vs the window)
focus budget = usable free  −  buffer               (what's actually left for bets)
over  ⇔  project pace > focus budget                (your bets don't fit the gaps)
```

- **% committed** = (meetings + project pace) ÷ window — the headline that finally
  reads high when your week is slammed.
- **Band** is driven by *fit*: `over` when project pace exceeds the focus budget;
  `committed` when little slack remains; `room` otherwise.
- The bar is **stacked**: meetings · project · buffer · free.

### Capacity = calendar-derived, and honest (`capacity.ts` + `useCapacity.ts`)

The divisor is **real** time, not the aspirational Σ domain `weekly_target_hours`.
Four corrections, because a naïve "window minus booked over 13 weeks" reads wildly
optimistic (it told a 13%-committed lie against a wall-to-wall calendar):
- **Weekdays only.** Weekends aren't work capacity.
- **Trailing-actual meeting load.** "Typical week" busy is learned from the **last 4
  weeks** (fully booked in hindsight) and carried forward — the future looks empty only
  because one-offs aren't booked yet.
- **Buffer reserve.** `BUFFER_FRAC` (~15%) of the window is held back for
  admin/email/transitions and never counted as project-capable.
- **Usable gaps only.** Free stretches under `MIN_FOCUS_GAP` (30m) are the cracks
  between meetings, not focus time, so they don't count toward the budget.

*(Known gap: all-day banners — "PTO", "X in Town" — are excluded by `toBusyBlocks`, so
they don't shrink capacity. Usually right; revisit if it bites.)*

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
