# Glossary — the naming canon

**Status:** canonical · living document. **Rule (Principle 11): every user-facing name has
an entry here.** If you introduce a name and don't add it, you've created drift.

Code identifiers below are quoted from the repo where verified; ones marked *(per
migrations)* should be confirmed against `supabase/migrations/` before being relied on.

---

## The altitudes & objects

| User-facing | In code | What it is |
|---|---|---|
| **Domain** | `domains` *(per migrations)*, `domain_id` | An area of lasting responsibility — one you've committed to keep showing up in and producing from. **Not a folder or a tag.** Carries a color used as identity across calendar and rails. Signup seeds **none**; the account names its own via the first-run picker over the five domain *kinds* in [`personas.md`](./personas.md) §1 (D-026). |
| **Initiative** | `initiatives` *(per migrations)* | A big outcome under a domain, usually a quarter's worth. Has vows / key results. |
| **Project** | `projects` *(per migrations)*, `project_id` | A finite thing that gets *finished*. Has size (remaining effort) and a finish line — the two inputs to pace. |
| **Task** | `tasks` | The atom. One row carries pool membership, planning, *and* scheduling. |
| **Priority** | **`big_rocks`**, `tasks.big_rock_id` | ⚠️ **The main naming drift.** The week's priorities. A real node that can own tasks — it slides along a crystallization line from pure intention → proto-object → bound to a project. See [`priorities-and-projects.md`](../priorities-and-projects.md). |
| **Week** | **`sprints`**, `tasks.sprint_id` | ⚠️ Drift. The commitment gate. One row per week; tasks point at it. |
| **Block** | *no separate entity* | A `tasks` row with `do_date` **and** `start_time`. **A scheduled task IS a time block.** |
| **Slot** | `slots` | A container of time on the grid. Can hold child tasks. Title auto-derives when unnamed. **Plan the week uses this word for the blocks it groups leftovers and captures into** — it briefly said "grouped into blocks", a fourth vocabulary for a thing that already had a name (D-041). Calendar blocks wear their kind as an eyebrow: `PROJECT · 3 TASKS`, `SLOT · 2 CAPTURES`, `TASK`. |
| **Standing slot** | `slots` + affinity (`project_id` / `domain_id`) | Protected *recurring* time with an affinity that acts as a magnet during Sunday compose. [`standing-slots.md`](../standing-slots.md) |
| **Project slot** | *(spec)* | A block typed as protected project time, so capacity is measured in real project hours. [`project-slots.md`](../project-slots.md) |
| **Record** | `src/components/record/` | The full detail screen for a project/initiative/task. Desktop-only. |

## Tenancy & people

Use these precisely — the first two get conflated constantly, and the conflation has already
been used to argue against things it doesn't forbid.

| Term | Means | Our position |
|---|---|---|
| **Single-player** | One person inside a funnel. No assignees, no shared objects, no state someone else updates. | **Yes** — the product refusal (Principle 12, D-003) |
| **Multi-tenant** | Many independent accounts on one deployment, isolated by RLS on `user_id`. | **Yes** — a deployment fact, not a product opinion (D-024) |
| **Multi-player** | Several people sharing one funnel. | **No** (N-02) |
| **Account** | One operator's entire funnel — the tenancy boundary. There is no workspace, team, or org object above it. | — |
| **Operator** | What we call the person using Nuvo, in docs and copy. Preferred over "user". | — |
| **Persona zero** | The builder, as a *verified instance* of P1. Evidence, cited **ⓞ**, never the definition. | [`personas.md`](./personas.md) |
| **ⓞ** | Marks a claim sourced from persona zero — **unvalidated beyond N=1.** | — |
| **The stranger test** | *Would this be true and usable in a fresh account belonging to someone you've never met?* | Principle 16 · [`audit.md`](./audit.md) Pass 6 |

## The pools

| User-facing | Meaning |
|---|---|
| **Inbox** | Raw captures. Never planned from directly. |
| **Backlog** | Processed and **deliberately undated**. Project/initiative work lives here. Never on Today, never rolled. |
| **The Week** | The gate. Committed work for this week (`sprint_id`). |
| **The week's projects** | The projects committed to *this* week — the week's Priorities, derived from each project's On Deck span (`weekPushes`), never a stored list. Bringing a project in / taking it off IS the week's plan. Called *the slate* in code and specs (`weekSlate`); the UI says **Projects** (D-034). |
| **The rest** | Step 3 of Plan the week — the week's work that isn't a project: work that **carried over** (`roll_count > 0`), work **due** inside the week, one small task from each **quiet** domain, and **new captures**. Was two steps ("Leftovers" then "Inbox") until D-042, and named for its members twice ("Leftovers", then "Carried") before being named by exclusion — a carried task *was* a capture once, and slotting them separately produced two slots for one theme. A step, not a pool; lanes stay three for the meter's arithmetic (`laneOf`, `STEP_LANES` in `src/lib/intake.ts`). |
| **Today / the Day** | `do_date` set; optionally blocked. |

## The ceremonies (flows)

| Name | Cadence | Output |
|---|---|---|
| **Sunday** | weekly, forward | A composed, accepted week. Both shells run the same three sources — **Projects · Leftovers · Inbox** (D-034) — over one composer (`useWeekDraft`). On the desktop it is **one screen**: the sources take turns in the planner rail while the week grid holds the right half permanently, so a keep or a drop re-shapes the week beside your cursor (D-035). The phone keeps a fourth step for the day-by-day read and carries the same live consequence in `CapacityMeter`. A switch, not gates: every source is one click away and the week is pre-composed on open. ⚠️ **The UI calls this flow "Plan the week" on both shells; "Sunday" now survives only in these docs and in code (`SundayRitual`, `openFlow("sunday")`).** Renaming the ceremony is a canon call nobody has made — flagged, not taken. |
| **the Review** | weekly, backward | The closing valve. Evidence receipts, one scored **Find**, Keep, Note to Monday, a sealed `week_reviews` snapshot. [`weekly-review.md`](../weekly-review.md) |
| **Sunrise** | daily, morning | The day's plan; pulls from the Week pool, surfaces prepared tasks. |
| **Sundown** | daily, evening | Leads with the day's gain; "back to week" for leftovers. |
| **Summit** | quarterly | Quarter's Gain → Vows → Portfolio → Months. |
| **Blueprint** | on demand | State a bet → proposed KRs + projects + ordered tasks → accept creates the subtree. |
| **On Deck** | continuous | The project timeline you open *first* — coarse calls about which weeks hold what. [`on-deck.md`](../on-deck.md) |
| **the Refine run** | on demand, phone-first | Grooming as a winnable game — a short card run that moves readiness. [`refine-run.md`](../refine-run.md) |
| **Grooming lenses** | *(spec)* | Four views: **When** (On Deck, built) · **What** · **How** · **In the way**. [`grooming-lenses.md`](../grooming-lenses.md) |

> **Say "flow" or the ceremony's own name in the UI.** "Ritual" survives in code
> (`src/components/rituals/`, `Rituals.tsx`) but is discouraged in copy.

## The measures

| Term | Definition |
|---|---|
| **The intake** | The three sources a week's load comes from — Projects · Leftovers · Inbox — and the capacity they pour into. Switched by `SourceSwitch` (in the rail), measured by `CapacityMeter` (over the week grid), computed by `readIntake` (`src/lib/intake.ts`). **Load** = the immovable calendar + every kept piece, measured against Calibration's proven pace — **the flow's only capacity arithmetic** (D-035). |
| **Gain** | What moved — framed forward from where you were, not against an ideal. (Gap-and-Gain lineage.) The Review and Sundown both lead with it. |
| **Readiness** | The ambient, always-on gauge of where the funnel needs you. A *thermometer* — reports, never commands. [`readiness-model.md`](../readiness-model.md) |
| **Demand** | Σ required weekly pace across in-flight projects. |
| **Capacity** | Real available hours this week, calendar-derived. |
| **Commitment** | `Demand ÷ Capacity`. `<0.7` under · `0.7–1.0` healthy · `>1.0` over. |
| **Pace** | `remaining effort ÷ weeks until target` — the portfolio→week conversion. `src/lib/pace.ts` |
| **Calibration** | Proven weekly pace from the last 4 weeks of completed blocks, capping the composer (+15% room to grow). No history → it says so. `src/lib/calibration.ts` |
| **The Find** | At most **one** evidence-backed discovery per Review. Hidden when nothing is notable — never manufactured. |
| **Actuals** | What actually happened (completed blocks, attended events, activity sources) vs. tasks (what was planned). |
| **Activity source** | Any external feed of *completed* work attributable to the hierarchy. The calendar was the first; GitHub is the second. [`activity-sources.md`](../activity-sources.md) |

## The assistant & surfaces

| Term | Meaning |
|---|---|
| **Nuvo** (the assistant) | ⌘J. Say **"ask Nuvo"** for the assistant, **"in Nuvo"** for the app. Endpoints on the `agent` edge function: `scaffold` · `blueprint` · `prepare` · `narrate`. |
| **Prepare** | Pre-work written onto a task (approach, drafts, pitfalls). Carries the **✦** badge; surfaced at Sunrise, boosted in Now. |
| **Marquee** | Nuvo *shows* an answer alongside telling it — brings a surface forward and holds a warm **limelight** orb on the thing it means. A held session, not a flash; a **return pill** makes it reversible. Vocabulary lives in `src/lib/marqueeRegistry.ts`. [`marquee.md`](../marquee.md) |
| **Spine** | The vertical navigator of altitudes. ◉ marks a flow. |
| **Floor** | An altitude's screen (Domain / Initiative / Project floors). |
| **Wall · Chapel** | The Domain floor's two halves — the reference screens for Warm Paper alongside the Schedule. |
| **the Vertical** | Spine + floors: *what matters and why.* |
| **the Planner** | Day · Week · Schedule: *what am I doing.* |

## Mechanics

| Term | Meaning |
|---|---|
| **Rollover** | 00:05 America/Los_Angeles via pg_cron. Rolled tasks: `do_date = today`, `start_time` cleared, duration kept, `roll_count + 1`, mirror event deleted, ↻ badge. Recurring occurrences **never** roll. |
| **Overdue** | 1 hour past a block's end (start + duration + 60 min grace). Signal orange, pinned to the top of Today. |
| **Mirror calendar** | A Google calendar named **"Nuvo"**, found-or-created on first connect. Every scheduled task is reconciled to it. One-directional — the app always wins. |
| **Materialized occurrence** | A repeat is a `recurrences` row (rule + template); occurrences are stamped as *ordinary* `tasks`/`slots` rows to a 35-day `HORIZON_DAYS`, so drag/resize need no special-casing. |
| **`needs_reconnect`** | Flag on a calendar account after token/credential failure → surfaces the orange reconnect banner. Sync never fails silently; everything writes to `sync_log`. |
| **Day contexts** | Per-day markers on the sprint (`day_contexts`): normal · ◐ light · ✈ travel · — off. They bound the composer. |
| **Working hours** | `user_settings.work_start_minutes` / `work_end_minutes` (default 480/990). |

## Design language

| Term | Meaning |
|---|---|
| **Warm Paper** | The design language: one continuous sheet, editorial hand, glass that lifts. [`design-language.md`](../design-language.md) |
| **`.atmosphere`** | The canvas gradient. **Never paint an opaque `bg-*` over it** — that's the "frost seam." |
| **glass-card / glass-lift** | Floating things rest as translucent glass; the focal element *lifts* with `--shadow-lift` and a small rise — **no flat ring.** |
| **Masthead** | Fraunces display type for heroes (floors, records, days). Never `font-semibold`. |
| **`--signal`** | The token reserved for **now** (and overdue). Not for emphasis. |
| **`--slot`** | Open / unclaimed time. |

---

## Names we retired

| Retired | Use instead | Why |
|---|---|---|
| *Harvest* | **the Review** | Farming metaphor. D-006. |
| *Tend / Tending* | **the Refine run** / grooming | Same. (`TendingFlow` survives in code pending retirement.) |
| *Ritual* (in copy) | **flow**, or the ceremony's name | Reads culty. Code keeps the folder name. |
| *Big rock* (in copy) | **Priority** | Cliché; the code name stays. |
| *Slate · Pull · Shape* | **Projects · Leftovers · Inbox · The week** | Invented verbs used nowhere else in the product; they named the act after our mechanics instead of after what the operator is deciding. D-034. Code keeps `suggestPull` / `PullSuggestion` / `weekSlate`. |
| *Slot the projects · Slot the work* | same as above | The desktop's own pair of verbs, a third vocabulary for one act. D-034. |
| *Clear the inbox* (the flow's step) | **Inbox** | The step is the pool it works on; naming it with a verb made it read like a chore. |
