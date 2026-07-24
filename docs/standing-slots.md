# Standing slots — recurring time you dedicate, that the planner fills for you

> "I dedicate 6–8a every day to trading. Sometimes I'm watching charts passively —
> and I want my trading captures to land there. When I plan the week, look up my
> trading items and slot them into that block."

A **standing slot** is protected recurring time with an **affinity** (a domain or a
project). It holds your time whether or not anything is scheduled into it — and during
the weekly plan it acts as a **magnet**: matching in-play work is routed *into* it
before the composer places anything else.

You know your own rhythm better than any scheduler can infer it. Standing slots are how
you tell it.

---

## The model — one slot, two axes (not three types)

We resisted "default / project slot / domain slot" as three kinds. It's cleaner as **one
slot** with two independent properties, both already on the `slots` row:

- **Affinity** — *what work it attracts*:
  - **open** — a manual container (today's default; no `project_id`, no `domain_id`)
  - **project** — `project_id` set → attracts that project's tasks
  - **domain** — `domain_id` set → attracts that domain's work
- **Cadence** — *how often it appears*:
  - **one-off** — a single `slots` row
  - **recurring** — a `recurrences` row (`kind='slot'`) that materializes an occurrence
    per day/week

A **standing slot** is the cell **recurring × affinity**. The trading case = recurring
(daily) × domain (Trading). "Frontier Tuesdays 2–5" = recurring (weekly) × domain
(Frontier). The affinity is the "this is domain work" property the user asked for — it's
`slots.domain_id`, which has existed since migration 8.

Nothing new in the data model. Both `project_id` and `domain_id` already live on `slots`
and are already copied into the recurrence template + every materialized occurrence.

---

## What already existed (before this feature)

- `public.slots` carries `project_id` **and** `domain_id` (migration 8).
- Full recurrence engine (`src/lib/recurrence.ts`, `src/hooks/useRecurrence.ts`) with
  `kind in ('task','slot')`; `materializeSeries` stamps recurring **slot** occurrences 35
  days out, copying `domain_id`/`project_id`/`color` from the recurrence template.
- The slot editor could set a **project** (which inherited the project's domain) and set
  **Repeat** — but there was **no standalone domain picker**, so a domain-only dedication
  was unreachable from the UI.
- The weekly planner (`clusterWeek` → `composeWeek` → `planWeek`) **never read existing
  slots as targets** — it only ever *created* fresh batch slots, and it explicitly
  *excluded* any task already in a slot from the plan pool (`!t.slot_id`). So even a
  hand-built trading block was ignored by planning.

## What this feature adds

1. **A domain chip on the slot editor** (`SlideOver`) — tag a slot to a domain directly,
   independent of any project. Domain + Repeat = a standing domain slot, created in one
   place. (Desktop; slot editing is a desktop surface, like the Sunday ritual and On Deck.)
2. **A routing pass — "layer 0" — in the weekly plan.** Before clustering/placement, fill
   standing slots from matching in-play work, then hand the *remainder* to the composer.

---

## The routing pass (layer 0)

Runs inside the Sunday plan draft, before `clusterWeek`/`composeWeek`:

```
for each standing-slot occurrence in the planning week (recurring + has an affinity),
  ordered project-affinity first, then by start_time (earliest occurrence first):
    remaining = slot.duration − minutes already inside it
    pull matching, un-routed, in-play tasks (by deadline, then priority)
      a task matches a project slot if task.project_id === slot.project_id
      a task matches a domain slot if resolveDomainId(task) === slot.domain_id
    assign until `remaining` is exhausted (cap — never cram)
    routed tasks drop out of the pool handed to the composer
```

**Match** reuses `resolveDomainId` (task → project → initiative domain, from `batch.ts`),
so "trading items" means anything whose resolved domain is Trading — a loose capture, a
task under a Trading project, or one directly tagged Trading.

**Why it composes for free:** assigning `slot_id` makes those tasks fall out of the plan
pool automatically (the same `!t.slot_id` filter that used to *hurt* now *helps*), and
standing slots are already mirrored as busy blocks, so the composer places everything else
*around* them without any collision logic.

**Overflow ("spill") is free too:** a daily trading slot has 7 occurrences in the week.
Greedy fill tops up today's block to its cap, then tomorrow's, and so on across
occurrences. Only once every occurrence is full does the remainder fall through to normal
placement. That's exactly "look for domain slots first, then spill."

---

## Decisions (locked for v1)

1. **Cap, don't cram — then spill.** Fill each occurrence only to its duration; overflow
   goes to the next occurrence, and finally to general placement. A passive dedication
   should never be stuffed past the time you set aside. *(This was the user's "look for
   domain slots first" instinct.)*

2. **Arrange-only, not auto-commit inbox — v1.** The routing pass only arranges work that
   is already **in play** for the week (kept candidates + the committed pool). It does
   **not** silently sweep un-committed trading captures out of the inbox into the week.
   Instead the plan **surfaces** them ("3 trading items waiting — pull in?") and the
   *commit* is the trigger the user already presses. Auto-pull from inbox is a v2 toggle.
   Rationale: no work should appear pre-scheduled on Sunday that the user didn't choose.

3. **Leave it pure.** If a standing slot has spare time and no matching work, it stays
   part-empty — protected passive time. Non-affinity work never backfills a dedication;
   the whole point is that you reserved it.

4. **Magnet = recurring + affinity.** Only *recurring* slots (`recurrence_id` set) with a
   `domain_id` or `project_id` magnetize. A one-off affinity slot is just a labeled
   container — no surprise pulls into ad-hoc or last-week's batch slots. (Extending the
   magnet to deliberate one-offs is a later option.)

---

## Data touchpoints (no migration)

- `slots.domain_id` / `slots.project_id` — the affinity (already present).
- `recurrences` (`kind='slot'`, template carries `domain_id`/`project_id`) — the cadence.
- Routed tasks: `slot_id` set, `do_date` = the slot's day, `start_time` = null,
  `status='planned'`, `sprint_id` stamped — the same child-of-slot shape the batcher
  already produces.

## Code touchpoints

- `src/components/DraftComposer.tsx` — **Domain picker on the Slot create dialog** (the
  drag-to-create card), so the affinity is set at creation, not as a second step. Threaded
  through `CalendarPane` (`domains` prop → `handleCreate` → `createSlot`/`createSeries`
  template) and fed `vertical.domains` from `Planner`.
- `src/components/SlideOver.tsx` — domain chip (`setDomain`) on the slot editor popover
  (for editing an existing slot's affinity).
- `src/lib/standingSlots.ts` — `routeToStanding()` pure routing function (this doc's
  algorithm). *(Named `standingSlots` to avoid colliding with `lib/standing.ts`, the
  unrelated Project "Standing" assessment.)*
- `src/lib/batch.ts` — `resolveDomainId` exported for reuse.
- `src/components/rituals/SundayRitual.tsx` — run layer 0, reduce the compose pool, surface
  the routed count, commit assignments.
- `src/hooks/useVertical.tsx` — `assignToStanding()` writes routed tasks into their slots.

## Not in v1 (deferred)

- Auto-pulling matching **inbox** captures into the week (decision 2's v2 toggle).
- One-off (non-recurring) affinity slots as magnets (decision 4).
- Energy/time-of-day fit inside a standing slot (the user's fixed time overrides the
  scheduler's guess by design — that's the point).
- A mobile creation affordance for standing slots (setup is desktop-first, like rituals).
