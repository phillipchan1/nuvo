# Glossary — the naming canon

**Status:** canonical · living document. **Rule (Principle 11): every user-facing name has
an entry here.** If you introduce a name and don't add it, you've created drift.

Code identifiers below are quoted from the repo where verified; ones marked *(per
migrations)* should be confirmed against `supabase/migrations/` before being relied on.

---

## The altitudes & objects

| User-facing | In code | What it is |
|---|---|---|
| **Step** | `tasks.parent_task_id` | A line on a task's checklist — the small ordered list *inside* one task. Deliberately **not** a task and not a fifth pool: a step has a title, a done state and an order, and the schema forbids it every field that would make it schedulable (D-103). One level deep; never on the calendar, in the inbox, or in any rollup. |
| **Trash** | `tasks.status = 'trashed'`, `tasks.trashed_at` | Where a deleted task rests until a human empties it. A face on the rail's tab strip and on the phone's Tasks control, shown only when it holds something — not a destination. **Restore** returns a task to where the funnel says it belongs; **Delete forever** is the one act with no undo (D-104). |
| **Reminder** | `user_settings.reminder_prefs` (defaults), `reminders` (overrides) | The one time Nuvo speaks first, and only about a commitment minutes away: a meeting starting, a block you scheduled starting, a deadline arriving. Never a planning nudge. Off until asked (D-102). |
| **Lead** | `reminders.lead_minutes` | How long before a commitment a reminder speaks — "10 minutes before". `null` silences that one item, which is a different thing from having no preference. |
| **Domain** | `domains` *(per migrations)*, `domain_id` | An area of lasting responsibility — one you've committed to keep showing up in and producing from. **Not a folder or a tag.** Carries a color used as identity across calendar and rails. Signup seeds **none**; the account names its own via the first-run picker over the five domain *kinds* in [`personas.md`](./personas.md) §1 (D-026). |
| **Mandate** | `domains.intention` | A domain's standing one-liner — what this area of your life asks of you, in the operator's own words. Edited in the domain hero and re-read each quarter in **Summit → The Mandates**. Replaces *vow*, which read as a register the user was being addressed in rather than the most precise word (D-088). |
| **Life** *(marketing only)* | — *(no code name — the app says **domain**)* | The **outward-facing** word for a domain on [nuvo.day](https://nuvo.day): *"You live more than one life."* A cold reader has no word for themselves and doesn't know what a "domain" is, but recognizes the plural life instantly. Two names for one concept is the deliberate ceiling — *lives* outside, *domains* inside (D-057). **One app surface says it: the first-run welcome** (*"Your whole life, actually moving"*), which is the boundary between the marketing promise and the app's vocabulary and sits before any altitude noun appears (D-065). Nothing past it does. |
| **Initiative** | `initiatives` *(per migrations)* | A big outcome under a domain, usually a quarter's worth. Has key results. |
| **Project** | `projects` *(per migrations)*, `project_id` | A finite thing that gets *finished*. Has size (remaining effort) and a finish line — the two inputs to pace. |
| **Task** | `tasks` | The atom. One row carries pool membership, planning, *and* scheduling. |
| **Priority** | **`big_rocks`**, `tasks.big_rock_id` | ⚠️ **The main naming drift.** The week's priorities. A real node that can own tasks — it slides along a crystallization line from pure intention → proto-object → bound to a project. See [`priorities-and-projects.md`](../priorities-and-projects.md). |
| **Week** | **`sprints`**, `tasks.sprint_id` | ⚠️ Drift, and now the *only* place the word survives. The commitment gate. One row per week; tasks point at it. A week **names itself by distance** — "This week", "Next week", "In 3 weeks", then "Week of Aug 24" — never by an ISO number (D-058). `src/lib/week.ts` owns every label. |
| **Block** | *no separate entity* | A `tasks` row with `do_date` **and** `start_time`. **A scheduled task IS a time block.** |
| **Slot** | `slots` | A container of time on the grid. Can hold child tasks. Title auto-derives when unnamed. **Plan the week uses this word for the blocks it groups leftovers and captures into** — it briefly said "grouped into blocks", a fourth vocabulary for a thing that already had a name (D-041). Calendar blocks wear their kind as an eyebrow: `PROJECT · 3 TASKS`, `SLOT · 2 CAPTURES`, `TASK`. **The chat can hold one too** (`create_slot`), and names it itself — one window plus several pieces of work is one block with a written through-line, not one block per item (D-066). |
| **Open window** | *(computed)* | A genuine gap in the day — ≥30 min, future-only, between real busy blocks (events, scheduled tasks **and** slots). Computed server-side and handed to the chat as `todayOpenWindows`, because a model counting gaps itself gets it wrong. Deliberately **not** called a slot: a Slot is a block you hold, and the two senses sharing one word is what made "9am slot" unanswerable (D-066). |
| **Standing slot** | `slots` + affinity (`project_id` / `domain_id`) | Protected *recurring* time with an affinity that acts as a magnet during Sunday compose. [`standing-slots.md`](../standing-slots.md) |
| **Project slot** | *(spec)* | A block typed as protected project time, so capacity is measured in real project hours. [`project-slots.md`](../project-slots.md) |
| **Record** | `src/components/record/` | The single-record surface for a project/initiative/task — identity, the work, the Log, and a rail of standing (D-050). The *modal* is desktop; the phone reaches the same record through a bottom Sheet (`mobile/detail/`), and both write placement through one band (D-030). |
| **Placement** | `start_date` / `target_date`, shown as weeks & quarters | *When this lands.* A project **spans** weeks (resizable); a bet **belongs to** a quarter. Dates remain the storage unit but are no longer the front door — the record edits a scale, not two date fields (D-030, D-050). |
| **Ready** | derived, `lib/lenses.ts` | The record's readiness checklist, named per altitude: a project needs an **Outcome** and **Steps**; a bet needs an **Objective** and **a number moving**. The finish line is deliberately not a tick — the placement band above it already says whether one is set. |
| **Assess** | `record/AssessLayer.tsx` | Nuvo's review pass over one record: it reads the record and lays margin notes beside the things it would sharpen, each accept-or-dismiss. Proposes, never writes (Principle 3). |
| **Log** | `record_comments` | The running "what's going on" journal at the foot of a record — newest first, one line at a time. It replaced the static Brief document, which no surface ever wrote. |
| **Belongs here** | derived, `lib/belonging.ts` | Loose or inbox work that looks like it wants this record as its home, offered as a fold-in. A suggestion pool, never a mutation. |

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
| **Guest** | Someone invited to one calendar event — an address on a Google event, nothing more. Not an assignee, not a collaborator, and they cannot see or change anything in the account. The word appears in the composer's guest picker and on the chat's invite card, which use one vocabulary for where an address came from: *Google · Apple · Met before* (D-046, D-069). | **Yes** — a guest is a fact about an event, not a shared object, so it doesn't touch Principle 12 |
| **ⓞ** | Marks a claim sourced from persona zero — **unvalidated beyond N=1.** | — |
| **The stranger test** | *Would this be true and usable in a fresh account belonging to someone you've never met?* | Principle 16 · [`audit.md`](./audit.md) Pass 6 |

## The pools

| User-facing | Meaning |
|---|---|
| **Inbox** | Raw captures. Never planned from directly. |
| **Backlog** | Processed and **deliberately undated**. Project/initiative work lives here. Never on Today, never rolled. |
| **The Week** | The gate. Committed work for this week (`sprint_id`). |
| **The week's projects** | The projects committed to *this* week — the week's Priorities, derived from each project's On Deck span (`weekPushes`), never a stored list. Bringing a project in / taking it off IS the week's plan. Called *the slate* in code and specs (`weekSlate`); the UI says **Projects** (D-034). Since D-060 this is also literally what the Week's Plan floor renders — it was the last surface reading `sprints.big_rocks` as a list. |
| **Loose work** | Work on a week's project that has **no time on the calendar this week** — no block of its own and not inside a slot that starts this week. Its opposite is *has a time*. The Week's Plan states both per project (*"2h has a time · 4h loose"*) because that split, not the task count, is what says whether the week is still true. Work timed into a *different* week counts as loose here: it isn't happening in this one. |
| **The rest** | Step 3 of Plan the week — the week's work that isn't a project: work that **carried over** (`roll_count > 0`), work **due** inside the week, one small task from each **quiet** domain, and **new captures**. Was two steps ("Leftovers" then "Inbox") until D-042, and named for its members twice ("Leftovers", then "Carried") before being named by exclusion — a carried task *was* a capture once, and slotting them separately produced two slots for one theme. A step, not a pool; lanes stay three for the meter's arithmetic (`laneOf`, `STEP_LANES` in `src/lib/intake.ts`). |
| **Today / the Day** | `do_date` set; optionally blocked. |

## The ceremonies (flows)

| Name | Cadence | Output |
|---|---|---|
| **Sunday** | weekly, forward | A composed, accepted week. Both shells run the same three sources — **Projects · Leftovers · Inbox** (D-034) — over one composer (`useWeekDraft`). On the desktop it is **one screen**: the sources take turns in the planner rail while the week grid holds the right half permanently, so a keep or a drop re-shapes the week beside your cursor (D-035). The phone keeps a fourth step for the day-by-day read and carries the same live consequence in `CapacityMeter`. A switch, not gates: every source is one click away and the week is pre-composed on open. ⚠️ **The UI calls this flow "Plan the week" on both shells; "Sunday" now survives only in these docs and in code (`SundayRitual`, `openFlow("sunday")`).** Renaming the ceremony is a canon call nobody has made — flagged, not taken. |
| **the Review** | weekly, backward | The closing valve. Evidence receipts, one scored **Find**, Keep, Note to Monday, a sealed `week_reviews` snapshot. **Your Reviews** is the archive of every sealed one — stored forever, browsed via a gallery of past emblems opened from inside the same floor (D-070) — never a nav destination of its own. [`weekly-review.md`](../weekly-review.md) |
| **Sunrise** | daily, morning | The day's plan; pulls from the Week pool, surfaces prepared tasks. |
| **Sundown** | daily, evening | Leads with the day's gain; "back to week" for leftovers. |
| **Summit** | quarterly | Quarter's Gain → Mandates → Portfolio → Months. |
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
| **Shipped** | A project or initiative that crossed its finish line. Dated by **when it actually shipped** (`projects.shipped_at`, stamped at the one write choke point), not by when it was due — a thing shipped today against a June deadline belongs to this month's record. The **Shipped wall** collects them (projects by month, bets by quarter); the open domain shows its own as *what you've built*. A ship also counts as a **touch** on its domain — see *Kept*. D-087. |
| **Kept** | Time actually kept in a domain — the *presence* axis. A domain reads *kept* when hours landed in it recently, *shipped* when a finish line crossed there inside the week, *resting* when the last thing that happened was a finish, *quiet* when neither has happened for weeks, and *unstarted* when nothing ever has. Measured over a **quarter**, so it speaks in weeks, never days. Not to be confused with **grooming**, which is the *routing* axis (can Nuvo file captures here?) — one word per axis. D-087. |
| **Activity source** | Any external feed of *completed* work attributable to the hierarchy. The calendar was the first; GitHub is the second. [`activity-sources.md`](../activity-sources.md) |

## The assistant & surfaces

| Term | Meaning |
|---|---|
| **Nuvo** (the assistant) | ⌘J. Say **"ask Nuvo"** for the assistant, **"in Nuvo"** for the app. Endpoints on the `agent` edge function: `scaffold` · `blueprint` · `prepare` · `narrate`. |
| **Prepare** | Pre-work written onto a task (approach, drafts, pitfalls). Carries the **✦** badge; surfaced at Sunrise, boosted in Now. |
| **Marquee** | Nuvo *shows* an answer alongside telling it — brings a surface forward and holds a warm **limelight** orb on the thing it means. A held session, not a flash; a **return pill** makes it reversible. Vocabulary lives in `src/lib/marqueeRegistry.ts`. [`marquee.md`](../marquee.md) |
| **Walk me through it** | The first-run walkthrough, and the only door on the welcome (D-065 retired the visual-tour alternative). A panel docks beside the **real** app, names one act per step, lights the real element, and ticks from real data — nothing is simulated, every row it creates is the user's own. Skippable at every step; Esc leaves. It closes on **the law** (D-064): *a task earns a day · a project earns a week · an initiative earns a quarter.* [`orientation.md`](../orientation.md). |
| **Capture · Ask Nuvo** (iOS widgets) | The lock-screen (and Home Screen) faces of the phone's two floating actions — **Capture** opens the quick-task sheet, **Ask Nuvo** opens the chat, and a rectangular face carries both. Launchers only: they show nothing about your day, because a widget can only render what the app last wrote (P7). Both fire `nuvo://` links that parse through the same `shortcuts.ts` vocabulary as the PWA's icon shortcuts. D-100. |
| **Apps & devices** (Settings) | Where you mint a **token** so something you own — a shortcut, a widget, a watch — can add to your inbox over HTTP via the `capture` function. Deliberately **not** called a "connection" in the UI even though the table is `connections`: Settings already uses that word for calendar accounts, and one word must not mean two things (P11). A token is shown exactly once (only `sha256(token)` and its last four are stored) and is revoked by timestamp, never deleted, so a revoked token still explains where a task came from. |
| **Spine** | The vertical navigator of altitudes. ◉ marks a flow. |
| **List · Day** (mobile Calendar lenses) | The phone Calendar's two drill-in lenses, switched by the header pill (`nuvo-mobile-cal-mode`; the month grid stays home). **List** (`ScheduleView`) = the 14-day agenda with Free chips; **Day** (`MobileDayView`) = one day as a proportional time grid — blocks to scale, open windows as `--slot` brackets, now as the `--signal` line. Both render one `buildDayPlan` (`dayPlan.ts`), so they can't disagree about a day. Swipe or tap the date strip to traverse days. D-044. |
| **Floor** | An altitude's screen (Domain / Initiative / Project floors). |
| **Wall · Open domain** | The Domain floor's two halves — the wall of all domains, and one domain entered — the reference screens for Warm Paper alongside the Schedule. |
| **This week's shape** | The strip at the head of the domain **wall**: seven day columns, each a stack of the domains that got those hours, on an absolute scale (an 8h day is the floor) — so a light week reads light and *when* is visible, not just the split. Today is `--signal`; days still ahead are open `--slot` track. Replaced the 100%-stacked share bar, which could not tell a 40-hour week from a 4-hour one (D-085). |
| **the Vertical** | Spine + floors: *what matters and why.* |
| **the Planner** | Day · Week · Schedule: *what am I doing.* |

## Mechanics

| Term | Meaning |
|---|---|
| **Rollover** | 00:05 America/Los_Angeles via pg_cron. Rolled tasks: `do_date = today`, `start_time` cleared, duration kept, `roll_count + 1`, mirror event deleted, ↻ badge. Recurring occurrences **never** roll. |
| **Overdue** | 1 hour past a block's end (start + duration + 60 min grace). Pinned to the top of Today under an **`Overdue`** label — the only group in the rail that earns one. Signal orange appears **once** per row, on the *time* it was for; the title keeps its ink and the word "overdue" is never repeated on the row itself. D-054. |
| **Mirror calendar** | A Google calendar named **"Nuvo"**, found-or-created on first connect. Every scheduled task is reconciled to it. One-directional — the app always wins. |
| **Materialized occurrence** | A repeat is a `recurrences` row (rule + template); occurrences are stamped as *ordinary* `tasks`/`slots` rows to a 35-day `HORIZON_DAYS`, so drag/resize need no special-casing. |
| **Recurring upkeep** | Long-cadence repeating *tasks* (HVAC filter, key rotation) — a `recurrences` row with `kind='task'`. Catalog lives on Schedule → **⋯ → Recurring upkeep**, grouped by cadence (Weekly · Every N months · …). Agent: `create_recurring_task`. |
| **`needs_reconnect`** | Flag on a calendar account after token/credential failure → surfaces the orange reconnect banner. Sync never fails silently; everything writes to `sync_log`. |
| **Day contexts** | Per-day markers on the week (`day_contexts`): normal · ◐ light · ✈ travel · — off. They bound the composer. |
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
| *Worlds* | **lives** (marketing) · **domains** (in app) | A *third* name for one concept: the site said "worlds", the app says "domains", and the hero now says "lives". P11 — an overlapping name. Swept from `marketing/src` including the component and CSS classes (`LivesVisual`, `.lives-*`), because a stale identifier is how the retired word gets back into copy. D-057. |
| *Sprint* / *Sprint 33* / *Spr 33* | **This week · Next week · In 3 weeks · Week of Aug 24** | Agile jargon for a **single-player** app (P12) that also means *hurry* — the opposite of what we sell. And the number it carried was ISO week-of-year, a convention US readers don't use (Google and Apple both ship week numbers off by default). Every surface that printed "Sprint 33" already printed "This week · Aug 10" underneath, so the number was decoration. D-058. **`sprints` / `sprint_id` survive in code only** (D-007). |
| *Harvest* | **the Review** | Farming metaphor. D-006. |
| *Tend / Tending* | **the Refine run** / grooming | Same. (`TendingFlow` survives in code pending retirement.) |
| *Ritual* (in copy) | **flow**, or the ceremony's name | Reads culty. Code keeps the folder name. |
| *Vow / Vows* | **mandate** / **The Mandates** | Devotional register. It asked the reader to share a conviction to parse the word — the test in [`brandscript.md`](./brandscript.md) §10 that *vow* used to pass. D-088. |
| *Faithfulness · kept faith · keeping faith* | **showing up** / **presence** | Same. The axis is still real and still measured over a quarter; the word for it is now plain. Code renamed too (`faithfulness()` → `showingUp()`, `FaithPulse` → `PresencePulse`) so it can't leak back into copy. D-088. |
| *Big rock* (in copy) | **Priority** | Cliché; the code name stays. |
| *Slate · Pull · Shape* | **Projects · Leftovers · Inbox · The week** | Invented verbs used nowhere else in the product; they named the act after our mechanics instead of after what the operator is deciding. D-034. Code keeps `suggestPull` / `PullSuggestion` / `weekSlate`. |
| *Slot the projects · Slot the work* | same as above | The desktop's own pair of verbs, a third vocabulary for one act. D-034. |
| *Clear the inbox* (the flow's step) | **Inbox** | The step is the pool it works on; naming it with a verb made it read like a chore. |
