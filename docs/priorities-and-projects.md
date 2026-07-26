# Priorities ↔ Projects — the binding model

> **Status note · 2026-07-26 (D-031).** *What the app does today is narrower than this spec.*
> Every built week surface — the Priorities editor (`BigRocks`), the phone's Plan the week
> slate, the week's plan card, `readiness.ts` — renders **`weekPushes`**: the projects whose
> On Deck span covers this week, derived, never stored. The sprint's `big_rocks` jsonb carries
> only the per-week *verdict*. So a priority with no project (the "pure intention" end of the
> line below) is real in the data model but **invisible on every planning surface**. The agent
> now says so rather than writing one silently. Whether the crystallization line gets a surface
> or D-004 narrows to "a priority is a project" is **open** — decide it deliberately.

> The week's **Priorities** (code: `big_rocks`) and the vertical's **Projects** are not two
> competing lists. They are the *same work at two time-horizons*, joined by one idea:
> **a priority is a proto-object that tries to bind to standing work, and stays loose when it can't.**

This is the canonical spec. Read [design-language.md](./design-language.md) for the visual grammar
and `src/lib/priorities.ts` / `supabase/functions/agent/priorities.ts` for the implementation.

## The core frame: one node on a crystallization line

A priority is always a **real node** (a `big_rock` that can own its own tasks via `tasks.big_rock_id`).
It is never "just a sentence" in the data model — but it can *behave* like one. The same node slides
along a crystallization line, and may move along it over time:

```
"protect my mornings"   "ship the deck"        "Phase 2 Meridian"
   pure intention    →    proto-object      →    bound to a project
   (0 tasks, a lens)      (owns its tasks)       (lens on standing work)
   loosest ───────────────────────────────────────► most crystallized
```

- **Pure intention** — a theme/posture with no tasks. A complete, healthy end-state. Never nagged,
  never forced to grow up.
- **Proto-object** — owns whatever tasks you attach. Lives the week. Also a complete end-state.
- **Bound** — `project_id` / `initiative_id` / `domain_id` points at an existing altitude object.
  The priority becomes a **lens**: it *borrows* that object's tasks and **inherits its progress for
  free** (see `priorityWork()` — already aggregates direct + project-spotlight + initiative-umbrella).

### Binding strength is a dial, default = whatever you typed

```
pure intention  →  domain  →  initiative  →  project
   (a theme)      (faith)     (a bet)      (Meridian P2)
   lightest ───────────────────────────────────────► strongest
```

The **source of truth is always the human's sentence.** Binding only ever *decorates* it.

## Two feeds, mirror images, one node

### 1. Top-down — "my named" (recognize, never classify)

You type a priority in free text. The parser (`supabase/functions/agent/priorities.ts`) **tries to map**
it to an existing project / initiative / domain.

> **Rule: only link to what the human already named. Recognize — never classify.**
> "Phase 2 Meridian" unmistakably names a thing → bind. "Protect my mornings" names nothing → leave it
> a loose proto-object. When in doubt, stay loose. A wrong link is worse than none.

- If it binds → priority is a lens on that object, inherits its progress.
- If nothing matches → it stays a **proto-object**. That's a finished state, not a waiting room.
- **No "make this a project?" prompt on week 1.** Promotion is *earned* (see below), never offered up front.

### 2. Bottom-up — "bring in what's slipping" (proposal beside the blank line)

Your timeline already knows which projects are pressing — `portfolioDemand()` (`src/lib/pace.ts`) computes
behind-pace / overdue / stalled / starting-this-week, and today **throws the answer away**. We surface it
as a **"Projects asking for you"** proposal rail in the Sunday *intent* step:

> *Meridian Phase 2 — starts this week · untouched 28d → make it a priority*

One tap → a `big_rock` **born already bound** to that project (`project_id` set, project outcome → the `win`).

**Constraint: only fully-groomed projects may surface here.** A project is eligible only if it is *tended /
sound* (positive `verification` verdict, sized + dated) — i.e. its tasks carry **real durations**. Raw,
unshaped, or unsized projects must never be proposed, because their time estimates are fiction (see
"Duration accuracy" below). Grooming is the gate.

This stays **human-drives**: it is a *proposal rail beside the blank line*, never a pre-filled list.

## Promotion: proto-object → real Project (earned, cheap)

A proto-object crystallizes into a real Project only when **your own behavior proves it's ongoing** —
it rolls forward ~3 weeks (`roll_count`) or accumulates enough tasks. Only then does Nuvo offer
*"give this a home?"*. Promotion is cheap because the tasks are already attached via `big_rock_id`:
create the Project, reassign those tasks' `project_id`, set `big_rock.project_id`. No work is lost.

## Duration accuracy is a grooming property

The shaping calendar today can estimate "30 min" for real project work — fiction. The fix is upstream:
a **properly groomed task carries a real, defended duration**, and only groomed projects feed planning.
The Shape grid should trust groomed durations and never invent a default minute count for ungroomed work.

## Editable shaping calendar

Nuvo's slot suggestions are a *starting point, not a verdict.* The Shape grid (`SundayRitual.tsx` →
`WeekGrid`) must let the human **edit off the suggestion** — move, resize, and retitle proposed time
blocks directly on the grid (pointer events, per the Tauri DnD rule). Suggestions seed; the human shapes.

## Build order

1. **Top-down binding** — parser sees projects + domains as candidates; sets `project_id` / `domain_id`;
   loose stays a proto-object. (edge fn — NEEDS DEPLOY)
2. **"Projects asking for you" rail** — `portfolioDemand().pressing` filtered to groomed projects, as a
   one-tap proposal rail in the intent step. (client)
3. **Editable shaping calendar** — drag/resize/retitle proposed blocks on the Shape grid. (client)
4. **Groomed durations** — Shape trusts groomed task durations; no fictional defaults. (client + grooming)

Every slice ships mobile-ready and is verified in the running dev app (see CLAUDE.md).
