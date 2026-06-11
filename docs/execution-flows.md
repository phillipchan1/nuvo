# Nuvo — Flows: how the vertical meets the week

*Design proposal · June 2026*

---

## 1 · The diagnosis

Nuvo already has two excellent halves that don't yet touch:

- **The vertical** (Spine → Domain / Initiative / Project floors) answers *"what matters
  and why."* Faithfulness lamps, momentum, key results framed as Gain — it's the
  conscience layer, and it's good.
- **The Planner** (Day · Week) answers *"what am I doing right now."* Inbox, drag-to-block,
  rollover, mirror calendar — it's the execution layer, and it works.

The gap between them is the actual product. Three symptoms:

1. **Two disconnected task worlds.** The Planner runs on Supabase `tasks`; the floors run
   on a localStorage `VTask` prototype. "Send to Day" and "scaffold with AI" are stubs.
   Until one row of truth flows from initiative to calendar block, the verticality is a
   diorama, not a system.
2. **The Spine is spatial, but the need is temporal.** The five rungs answer *where am I
   looking* (altitude). But the flows you described — Sunday planning, quarterly initiative
   review, morning triage — are *verbs with a cadence*, not places. Today they're either
   missing or hidden (the sprint funnel is a sub-tab of the Project rung; nobody's Sunday
   starts at ⌘3 → "This Week").
3. **The GTD tension is unresolved in the data model.** Scaffolding a project creates
   tasks you are *not ready to work on*. Right now there's no state that means
   "planned, deliberately dormant." Anything real either pollutes the inbox or
   pollutes Today.

## 2 · The organizing idea: two axes

Don't replace the Spine with "modes." Keep it, and add a second, perpendicular axis:

> **Floors are for looking. Rituals are for deciding.**

- **Floors** (the existing Spine): free browsing at any altitude, any time. Unchanged.
- **Rituals**: guided, full-screen, *finishable* sessions on a cadence. Each one is a short
  sequence of steps that reuses the floors' components but with a deciding lens applied —
  one question per screen, a clear end state, and a "done" moment.

This is your "flow modes" instinct, but with two corrections: they're **cadences, not
modes** (you enter them at a rhythm, finish them, and leave — the app never *stays* in
one), and the app already speaks this language (`Rituals.tsx` has Morning Plan and
Evening Shutdown). We extend the family and give it a name system:

| Ritual | Cadence | Question it answers | Exists today? |
|---|---|---|---|
| **Sunrise** | daily, morning | "What is today?" | ✅ Morning Plan (extend) |
| **Sundown** | daily, evening | "What happened today?" | ✅ Evening Shutdown (extend) |
| **Sunday** | weekly | "What is this week, and why does it matter?" | ◐ SprintFloor is the raw material |
| **Summit** | monthly/quarterly | "What are the bets?" | ✗ new |

Sunrise · Sundown · Sunday · Summit. One family, four altitudes of time. Rituals are
launched from a single **Begin** button at the top of the Spine (and ⌘⏎ / command bar),
and the app *suggests* the right one contextually — Sunday evening or Monday's first
open prompts the Sunday ritual the way Morning Plan auto-prompts today. Each ritual is
skippable and resumable; it's a liturgy, not a lock.

## 3 · The state model that resolves GTD vs. scaffolding

One rule fixes the whole tension:

> **Inbox is for *captures*. Backlog is for *plans*. The Week is the only gate between
> the vertical and your days.**

Four pools, one direction of flow:

```
  CAPTURE                    SCAFFOLD
     │                          │
     ▼                          ▼
 ┌────────┐   Sunday/sweep  ┌─────────┐
 │ INBOX  │ ───────────────▶│ BACKLOG │   quiet by design — never in inbox,
 │ (raw)  │                 │ (under a │   never on Today, never rolls over
 └────────┘                 │ project/ │
     │                      │initiative)
     │ "this week"          └─────────┘
     │                          │ pulled in the Sunday ritual
     ▼                          ▼
            ┌──────────────────────┐
            │       WEEK            │  the sprint: committed, capacity-checked,
            │  (sprint commitment)  │  visible in the Planner's new Week rail
            └──────────────────────┘
                        │ Sunrise / drag
                        ▼
            ┌──────────────────────┐
            │        DAY            │  do_date set → Today list
            │  (planned/scheduled)  │  + start_time → calendar block
            └──────────────────────┘
```

Mechanics:

- **Tasks created under a project or initiative default to `backlog`**, not `inbox`.
  Scaffolding (manual or AI) can produce 30 tasks and your inbox and Today stay
  untouched. Backlog tasks have no `do_date`, so rollover never sees them.
- **Inbox stays pure GTD**: only loose captures (⌘K, agent, eventually email/Siri).
  Processing an inbox item means routing it: to a project's backlog, to the current
  week, to today, or to trash. (The Sunday ritual's "sweep" step and Sunrise both do
  this; the inbox finally has somewhere to *put* things other than a date.)
- **The Week is a real entity, not a flag.** A `sprints` row per week with a goal and
  focus initiatives; tasks point at it. Committing is a deliberate act with a capacity
  meter watching. Anything not finished by week's end gets *re-decided* next Sunday —
  it does not silently roll (rollover keeps operating on days, inside the week).
- **Day works exactly as today.** do_date = on the list; + start_time = block. Nothing
  about the Akiflow layer changes; it just gains a better upstream.

### Schema (migration sketch)

```sql
-- 00000000000004_flows.sql
create table public.sprints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,                  -- Monday, per user_settings.week_start
  goal text not null default '',
  focus_initiative_ids uuid[] not null default '{}',
  reviewed_at timestamptz,                   -- set when Sunday ritual completes
  unique (user_id, week_start)
);

alter type public.task_status add value 'backlog';   -- inbox|backlog|planned|done|trashed

alter table public.tasks
  add column sprint_id uuid references public.sprints(id) on delete set null,
  add column initiative_id uuid references public.initiatives(id) on delete set null,
  add column assignee text not null default 'me'      -- 'me' | 'agent'
    check (assignee in ('me','agent'));
```

Derived, no extra state: a task's pool is `status='inbox'` → Inbox; `status='backlog'`
→ Backlog; `sprint_id` set (current week) and no `do_date` → Week; `do_date` set → Day.

### Kill the prototype seam

`useVertical.tsx` was built to be swapped (the comment says so). Do it now: move
domains/initiatives/projects/key-results to live Supabase hooks, and make `VTask`
*be* `Task`. One task type, one store, every floor reading the same rows the calendar
writes. This is the single highest-leverage engineering task in this document —
everything below assumes it.

(Carry over from the prototype into real columns: `initiative_id` on tasks — above.
Drop `tl` timeline positions; the project Gantt should derive from `do_date`/`deadline`
once tasks are real. Domain `invested_this_week` / `last_touched_days` become *computed*
from completed blocks — see §7 — not hand-entered numbers.)

## 4 · The rituals

### 4.1 Sunday — the centerpiece

Full-screen, five steps, ~15 minutes, ends with a committed week. Steps reuse existing
components (SprintFloor, Collection, CalendarPane) under a stepper shell.

```
●──●──○──○──○   Sunday · Jun 14                                    esc to leave, resumes

  1 THE GAIN      2 THE SWEEP      3 THE BETS      4 THE PULL      5 THE ANCHOR
```

**Step 1 · The Gain** (gap-and-gain, structurally enforced: the week *always* opens
looking backward at measured progress, never forward at the mountain)

```
┌──────────────────────────────────────────────────────────────────┐
│  Last week                                                       │
│                                                                  │
│  23 tasks done · 19h invested            ▲ Get finances clean    │
│                                            58% → 64%             │
│  ❤ Family    ████████░░  9/12h          ▲ Q3 board deck          │
│  ✝ Frontier  ██████████  8/8h  ✓          32% → 40%              │
│  ◈ SCE       ██████████  24/22h         ● KR: months reconciled  │
│  △ Trading   ██░░░░░░░░  1/5h  quiet      3 → 4 of 6             │
│                                                                  │
│  "Measured from where you started: finances are 64% of the way   │
│   from January's mess to a 2-day close."                         │
└──────────────────────────────────────────────────────────────────┘
```

**Step 2 · The Sweep** — inbox to zero, one capture at a time (the Morning Plan
pattern, but routing into the vertical, not just onto dates):

> *"Reply to Sarah"* → **[ This week ] [ → project… ] [ → initiative… ] [ Someday/domain ] [ Trash ]**

Every choice is one keystroke. "→ project…" files it into a backlog (quiet); "This
week" stages it for step 4. Inbox ends at zero with nothing forced onto a date.

**Step 3 · The Bets** — the initiative scan. Every active initiative as one row:
momentum arrow, progress delta, days-to-target, *and a verdict chip*:

```
  ▲ Q3 board deck         40%  ↑   29d left    [ lead ★ ]  [ tend ]  [ rest ]
  ▼ Backtest system v2    15%  ↓   stalled 3w  ── commit something or pause it ──
```

Pick **up to three "lead" initiatives** for the week (stored on the sprint). Stalled
ones demand an explicit choice: commit one task, pause, or drop — no zombie bets. This
is the 5-minute version of initiative mode that keeps the quarter honest week-to-week.

**Step 4 · The Pull** — the existing SprintFloor, elevated: sources on the left
(Inbox-staged · Backlogs · Projects), commitment on the right, capacity meter and
domain-balance strip on top. Two upgrades:

- Backlog sources are **sorted with lead initiatives first**, each project showing its
  *next up* task (first not-done by `sort_order`) so you pull the right next step, not
  a random middle.
- An intelligence strip proposes a starting pull: *"Suggested: 14h across 5 domains —
  Trading has been quiet 12 days, included 1 task."* One click to accept, then prune.

**Step 5 · The Anchor** — the week calendar (existing CalendarPane, week view) beside
the committed list. Drag the 3–5 biggest rocks (deep-energy tasks) into real blocks
now; leave the rest in the Week pool for daily pulling. Then the close:

```
        Your week is set.
   "Close Q3 books · ship deck v3"
   17h committed · 5 domains · ★ 3 lead bets
            [ Begin the week ]
```

### 4.2 Summit — monthly/quarterly

Same shell, four steps at initiative altitude. Quarterly by default, with a lighter
monthly variant (steps 1 and 3 only).

1. **The Quarter's Gain** — quarter hours per domain, shipped initiatives, KR baselines
   → currents. The trophy shelf: shipped initiatives rendered as a permanent gallery
   (also visible any time on the Initiatives floor — gains must have a *place*).
2. **Faithfulness review** — each domain's intention re-read (edit or re-affirm), weekly
   target hours adjusted. Domains are vows; this is where vows get renewed.
3. **Portfolio decisions** — the Initiatives collection in Board mode with verdict
   actions: ship · keep · pause · drop · **new bet**. Starting a new initiative here
   opens AI scaffolding (§6) inline: outcome → key results → first project → first tasks.
4. **Rough-cut the months** — the existing Timeline component: drag initiative/project
   date ranges across the quarter so target dates are staggered on purpose, not wishes.

### 4.3 Sunrise & Sundown — small extensions, big payoff

- **Sunrise** triages from the **Week pool first** ("7 committed this week, 2 anchored
  today — pull more?"), then the inbox. The day is assembled *from the week*, which is
  what makes the sprint real. Then: drag to block, as today.
- **Sundown** leads with the gain before the triage: *"Today: 5 done, 3h deep on SCE.
  Q3 deck 40% → 46%."* Then the existing leftovers list. One added action per leftover:
  **"back to week"** (clear do_date, keep sprint) so an over-planned day degrades into
  the week pool instead of guilt-rolling to tomorrow.

## 5 · The Planner gains a Week rail (and importance threading)

The left rail's two tabs become three: **Inbox · Week · Today**.

```
┌ Inbox 2 · Week 11 · Today 6 ──────────┐
│  GOAL  Close Q3 books · ship deck v3  │   ← sprint goal, always visible
│  ████████░░░░░░  9/17h · on pace      │   ← week progress ring (gain, live)
│                                        │
│  ★ LEAD · Q3 board deck               │
│   ◆ Draft narrative arc        90m  ▸ │   ← drag onto calendar, or ▸ = "today"
│   ▲ Review metrics w/ Dana     45m  ▸ │
│  ★ LEAD · Get finances clean          │
│   ▲ Reconcile checking         45m  ▸ │
│  ─ also this week ─                   │
│   • Send receipts to Dext      15m  ▸ │
└────────────────────────────────────────┘
```

Importance threading — *why this matters*, visible at the moment of execution:

- **Task chips carry their lineage.** Every Today row and calendar block is tinted by
  **domain color** (replacing the single generic accent), and shows a faint breadcrumb
  on the row / in the slide-over: `◈ SCE › Q3 board deck › Build deck v3`. Click any
  segment to jump to that floor — the vertical is one click away from any block.
- **Lead-initiative tasks get the ★.** On the calendar, on Today, in the Week rail.
  When you look at Wednesday 10am you can see it's a bet, not an errand.
- The week progress ring in the rail header is the persistent anti-gap device: it only
  ever fills, it resets Sunday, and it measures against *what you committed*, not
  against infinity.

## 6 · Where the intelligence plugs in

One principle for all AI in Nuvo: **the agent proposes into quiet pools; only you
promote work toward the calendar.** AI output lands in backlog or as a draft — never in
the inbox, never on Today. That makes every AI feature safe to use aggressively.

| Surface | Feature | Mechanic |
|---|---|---|
| Project floor | **Scaffold with AI** (wire the existing stub) | Agent gets `scaffold_project` tool: reads project outcome + initiative context, proposes an *ordered* task list (a→b→c via `sort_order`, with energy + duration + rough sequence). Renders as a **draft diff** — editable checklist, accept all / per-task. Accepted tasks land in `backlog`. |
| Summit | **New-bet scaffolding** | Same tool chained upward: outcome → suggested key results (with baselines) → first project → its first tasks. |
| Sunday step 4 | **Suggested pull** | Heuristic first (it's `rankNow` generalized to a week: faithfulness gaps, deadlines inside the week, lead-initiative next-ups, capacity fit), agent later. Always shown as a proposal to prune. |
| Now floor | **Today's recommendation** | Already built. Feed it real data: the live calendar gap (next external event / block) replaces the stubbed `gapMins`, and candidates come from the Week pool first. |
| Any task | **Delegate to the agent** | The `delegate` energy bucket becomes actionable: `assignee='agent'` + a `prepare_task` tool. The agent does *pre-work* — research, drafting an email, outlining the doc — and writes it into the task's notes, then flags it `prework ready ✦`. Sunrise surfaces these: "2 tasks came back prepared overnight." Execution stays yours; later, whole task types graduate to full agent execution. |
| Sundown / Sunday | **The narrator** | Small LLM pass that turns the week's raw deltas into the one-sentence gain framing ("Measured from January, you're 64% of the way…"). Cheap, and it's the voice of the gain. |

## 7 · Make the gain real (stop hand-entering it)

The prototype's `investedThisWeek` / `lastTouchedDays` / `quarterHours` are typed-in
numbers. With one task model they become *facts*:

- **Invested hours** = sum of `duration_minutes` of completed blocks, by domain, by
  week/quarter. (Completed scheduled tasks are the time ledger — this is the hidden
  dividend of "a task IS a block.")
- **Last touched** = most recent `completed_at` of any task under the domain.
- **KR currents** stay manual (they're judgments) but get a nudge: completing the last
  task of a project under an initiative prompts "move any key result?"

Then the gain surfaces are honest: faithfulness lamps, the Sunday Gain screen, the week
ring, the quarter trophy shelf — all derived, none performative.

## 8 · Build plan

| Phase | What ships | Touches |
|---|---|---|
| **1 · One world** | Vertical store → Supabase (kill localStorage seam); `tasks.initiative_id`; `backlog` status; project/initiative tasks default to backlog | `useVertical` → new hooks, migration 04, `TaskList`, agent context |
| **2 · The Week** | `sprints` table; Week rail tab w/ goal + ring; sprint pull/commit against real tasks; Sunrise pulls from Week; Sundown "back to week"; domain-colored blocks + lineage breadcrumbs | migration 04, `LeftRail`, `SprintFloor`, `Rituals`, `CalendarPane`, `TaskRow`, `SlideOver` |
| **3 · Sunday** | The five-step ritual (Gain · Sweep · Bets · Pull · Anchor); Begin button on Spine; contextual prompt; lead-initiative ★ | new `rituals/` shell + steps (compose existing floors), `Spine`, `Planner` |
| **4 · Intelligence I** | `scaffold_project` tool + draft-diff UI; live gap feeding Now; suggested pull (heuristic) | `agent/tools.ts`, `ProjectFloor`, `now.ts`, Sunday step 4 |
| **5 · Summit** | Quarterly ritual; trophy shelf; derived invested-hours/faithfulness | `rituals/`, `InitiativesFloor`, `DomainFloor`, queries |
| **6 · Intelligence II** | `prepare_task` delegation + prework badges; the narrator | `agent/`, `Rituals`, task rows |

Phases 1–2 are the foundation everything else stands on; 3 is the Sunday experience;
each later phase is independently shippable.

---

### The shape of it, in one paragraph

Keep the Spine — it's the *map*. Add the rituals — they're the *walk*: Sunrise, Sundown,
Sunday, Summit, four finishable liturgies that always open on the gain and always end
with a decision. Between them sits one gate: the Week. Scaffolding fills quiet backlogs
below it, GTD captures queue ahead of it, and only deliberate Sunday commitment lets
work through to your days — where every block carries its domain color and its thread
back up the vertical, so that on a random Wednesday at 10am, the thing on your calendar
visibly belongs to a bet you chose, in a life area you're being faithful to.
