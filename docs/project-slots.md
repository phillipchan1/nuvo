# Project-slot blocks — protected project time

**Status:** spec / not built. Design-only, for review before any code.
**Origin:** Phil — "not all blocks are created equal… a special block type to work on
projects so we can always find time for them."

## The problem

On Deck's capacity math (`readOnDeck` → `weekForecast`, the `9 of 9 blocks` / `over by 2`
header, `weeks stocked`) counts **generic available time** — any gap in the work window
that isn't already busy. But a random 40-minute slot between two meetings is *not* usable
project time. So today's "blocks available" is optimistic: it implies project capacity that
reactive work, admin, and context-switching will quietly eat. The planner can tell you a
week is "fine" when in practice you have zero protected time to move a project forward.

## The idea

A **project slot** = a calendar block *typed* as protected project time. You reserve it
deliberately ("Deep work — projects, Tue/Thu 9–11"). On Deck then measures capacity in
**project slots**, not generic free time — so the numbers reflect time you've actually
committed to project work.

The loop closes:

1. **Reserve** project slots on the Schedule (like you already block focus time).
2. **On Deck reads them** → `blocks available` per week = project-slot time that week.
   `weeks stocked` / `over by N` / the pinch become honest.
3. **Claim** — dragging a project onto a week can fill/reserve that week's project slots
   (future step; the placement already exists, this just gives it real blocks to land in).

## Reuse, don't invent — the slot primitive already exists

Nuvo already has **slots**: open-time containers on the Schedule you drop tasks into
(`tasks.slot_id`, `useSlots`, `slotMutations.assignToSlot / removeFromSlot`, the `evt-slot`
render, "Drop into {slot title}"). A project slot is a slot with a **kind**. We are adding a
type discriminator, not a new entity.

## The three parts

### 1. Schema — a `kind` on slots
Add `kind` to the slots table: `'general' | 'project'` (default `'general'`, so existing
slots are unchanged). Optionally a nullable `project_id` if a slot is reserved for a
*specific* project vs. project work in general. Recommend starting **general project time**
(no per-project binding) — simpler, and matches "always find time for projects."

- Migration: `alter table slots add column kind text not null default 'general'`.
- `useSlots` returns `kind`; `slotMutations` gains `setSlotKind(slotId, kind)`.

### 2. Schedule UI — mark a slot as project time
On the Schedule, a slot's context menu / editor gets a **"Project time"** toggle. A
project-kind slot renders with a distinct treatment (e.g. the `--accent` intent color / a
"◆ project" tag) so protected project time is visible at a glance on the calendar.
Creating one is the same gesture as making any slot, plus the toggle. (Later: a recurring
"project time" template so you set it once.)

### 3. On Deck — capacity reads project slots
`capacity.ts` / `weekForecast` currently derive `availMins` from the work window minus busy
time. Add a mode where **per-week available project time = Σ project-slot minutes that
week**. `readOnDeck`'s `WeekColumn.blocks` (and the `over` / pinch / `coverageWeeks` math)
then read that. This is the one change that makes the headline numbers honest.

Guardrail — **don't silently break the current read**: if a user has *no* project slots
yet, fall back to the generic availability (today's behavior) and surface a gentle nudge
("Reserve project time so On Deck can pace against it"), rather than showing `0 blocks`
everywhere and making every week look overloaded.

## Open decisions (resolve before building)

1. **General vs per-project slots.** Start general (recommended) or bind a slot to one
   project from day one?
2. **Capacity source switch.** Once project slots exist, does On Deck read *only* project
   slots, or `max(project-slots, some floor)`? (Avoid a cliff where deleting one slot
   swings the whole board into the red.)
3. **Claiming.** Does dragging a project onto a week *reserve* that week's project slots for
   it, or is capacity purely a read for now (placement stays independent)? Recommend
   read-only first; add claiming once the capacity read proves useful.
4. **Fallback.** Confirm the no-slots-yet fallback above so the feature is additive, not a
   regression for anyone who never sets project slots.

## Why it's worth it

It turns On Deck from "here's roughly how full your weeks look" into "here's how much time
you've *actually protected* for projects, and whether it's enough" — which is the whole
point of a planning surface, and the honest version of `weeks stocked`. Builds on
[[on-deck.md]] and the planner in `components/ondeck/OnDeckPlanner.tsx`.
