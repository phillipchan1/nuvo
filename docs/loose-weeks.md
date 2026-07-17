# Loose weeks — giving a task an answer to "when?"

Status: spec, in build. Companion to `docs/on-deck.md`.

## The problem

Two complaints, one root.

1. **Capture punishes you.** Add anything to the inbox on Wednesday and the week
   goes incomplete. `weekReadiness` counts `inboxTasks(d)` — a *global* list with
   no week filter — so a thought you had on Wednesday is scored against a plan you
   made on Sunday.
2. **A loose task can't say "not now, then."** Every other object in Nuvo can. A
   project gets a week from the On Deck timeline, and `pull.ts` treats that as
   authoritative: *"On Deck decides WHEN a project happens, so it also decides when
   its work happens."* A project-parented task on an August project is already
   correctly invisible this week. The loose, project-less capture is the only thing
   in the system with no way to answer the question.

Today the only way to defer a loose task is to give it a `do_date` — to invent a
specific day you don't believe in, just to buy silence.

## The model

Every piece of work answers **one** question: *which week?*

| `for_week` | meaning | where it lives |
| --- | --- | --- |
| `<= thisWeek` | **in play** — this week's inbox | this week's column |
| `> thisWeek` | **deferred** — you decided, later | that week's column |
| `null` | **Someday** — you decided *not to* | the rail |

`thisWeek` is always `planningWeekStartISO()`, never a raw clock read. It shifts to
next Monday on Sat/Sun, which is correct here: a Saturday capture is for the week
that's about to start, and the same helper is what Sunday plans against.

### Why `<=` and not `==`

Carry-over falls out of the comparison. A task stamped `Jul 13` that never got done
still satisfies `<= thisWeek` on Jul 20 — it is *simply still in play*. Nothing
rolls, nothing gets rewritten, no `roll_count` bump, no nightly job.

And because `for_week` stays put, `thisWeek - for_week` is a free age signal. A
carried item renders with its age, so the thing that's been in play four weeks does
not look identical to Monday's capture. The app doesn't nag. It just refuses to hide
the number.

This is the one place we deliberately reject a literal carry-over. Sliding week N's
leftovers into week N+1's inbox would make the roll invisible, and an item on its
fourth roll would look exactly like its first. That is how backlogs rot without
anyone noticing.

### Capture defaults to this week

A fresh capture stamps `for_week = thisWeek`. It does **not** ask.

Capture is the highest-frequency action in the app and the front door is organic
free text — making it ask "which week?" turns the front door into a form, which the
low-data-entry principle exists to prevent. Most captures really are for now. The
*exception* is what costs a gesture.

The punishment was never the default. It was `weekReadiness` scoring the inbox.
Those are separable, and only the second one is a bug.

## Intent vs. commitment

`for_week` and `sprint_id` are different things and must stay different things.

- **`for_week` = intent.** "I want this in the week of Aug 3." Written by the defer
  menu and by dragging a chip in On Deck. Needs no sprint row to exist.
- **`sprint_id` = commitment.** "This is the live week's committed pool." Keeps its
  exact current meaning, and its sweep.

**Sunday is the transition between them.** `planWeek` seeds `kept` with anything
whose `for_week` has arrived, commits it (`sprint_id` set), and the intent is spent.
That is Groom → Slot expressed structurally: `for_week` is the coarse slot, `do_date`
is the fine one, and the ritual is where one becomes the other. It is also why
`reviewed_at` matters — before Sunday a week is intentions, after it it's commitments.

### Do not reuse `sprint_id` for this

`ensureSprint()` (`useVertical.tsx:398`) nulls every `sprint_id` that isn't the
current week's:

```
.update({ sprint_id: null }).not("sprint_id","is",null).neq("sprint_id", row.id)
```

Its intent is right — *"the gate re-decides — nothing strands on a stale sprint_id."*
But `neq(current)` is a **proxy for "past"**, and it was only ever safe because
assigning a future week was impossible. The moment it's possible the proxy breaks and
a deferred task evaporates on the next sprint touch. `for_week` sidesteps this
entirely: `ensureSprint` never sees it, and `t.sprint` stays a clean current-week
boolean (so `vertical.ts:317`, `LeftRail.tsx:610` and `SlideOver.tsx:119` don't move).

## Sunday: a week-slot is a pre-accepted pull

`suggestPull` is a proposal engine, not a source of truth — Sunday seeds `kept` from
it and you prune. So there are already two ways into a week, and a deferral is just
the second one:

- **Nuvo proposes it** — deadlines, slipped work, on-deck projects, faithfulness. You
  accept or prune, guiltlessly; it was never your idea.
- **You already decided it** — the week-slot. It arrives **pre-kept**.

This is the priorities model one altitude down: you name one, or it proposes itself.
Loose tasks currently only have the second feed.

Shape renders them as two groups — **"You already decided · 3"** above **"Nuvo
suggests · 7"**. Keep them apart: pruning a suggestion is nothing, pruning your own
past decision is a re-defer or an admission, and it should feel like it.

Sunday still pulls from the inbox, unchanged. The inbox is now *truer* — it holds
what's in play, so the pull proposes from a clean pile instead of one polluted with
work you already know you don't want yet.

**"Brought in" means pre-kept in the draft, not auto-committed.** `planWeek` stays the
only writer of `sprint_id`; the gate still decides. Skip Sunday entirely and the task
just sits in the week's inbox while readiness says "3 to place" — which is honest.

## `elsewhere()` — the one real bug this creates

`pull.ts:42`:

```ts
const elsewhere = (task: VTask) =>
  onDeck != null && task.projectId != null && !onDeck.has(task.projectId);
```

`task.projectId != null` means **loose work is never "elsewhere,"** so the deadline
and faithfulness sources would cheerfully re-propose something you deliberately
pushed to August. Widen it to also honour the task's own `for_week` when set.

Pleasingly, one predicate handles both directions: on Aug 3,
`for_week === planningWeek` → not elsewhere → pre-kept.

⚠️ This function is load-bearing for on-deck **project** work. The project branch must
keep behaving exactly as it does today; `for_week` is an *additional* gate, never a
replacement.

## The horizon

Slotting is bounded by `PLANNER_HORIZON = 8` (`OnDeckPlanner.tsx:35`). Past the
runway there is no week — only Someday.

Without this, "week of Nov 2" quietly becomes a backlog with extra steps. Reaching
for week 14 isn't scheduling, it's avoiding, and Someday is the honest word for that.

## Surfaces

**The fast path — a row-level menu.** "Not this week →" · Next week / In 2 weeks /
Pick a week / Someday. Each option shows the target week's existing load, which is
what stops you silently pre-burying August. Mobile: the same menu in a `Sheet`. This
is the only piece of the feature that works on a phone, deliberately — On Deck is
desktop, like the rituals.

**The survey — On Deck.** Not a new view. It already has the 8-week runway, week
columns with load counts, drag-to-assign and drag-to-rail-to-uncommit. We add a chip
layer:

- Projects ride as **bars** — they're intervals (`start_date`/`target_date`).
- Tasks dock as **chips** — they're points (`for_week`).
- Drag a chip between columns → re-slot. Drag a chip to the rail → **Someday**.
- Chips collapse past ~3 to "+N loose"; this week's column will be busy, honestly so.
- Chips count toward the week's load gauge.

The rail is the null-week bucket: projects that need a week, and Someday tasks.

## Build order

1. **Scope the readiness inbox line to `reviewed_at`.** No schema. Ships alone and
   unblocks capture immediately. (Needs `createdAt` mapped onto `VTask` — the row has
   it, `toVTask` just drops it.)
2. `tasks.for_week date` + backfill from `created_at`'s week (truthful ages from day
   one).
3. Stamp `for_week` at every insert site.
4. `forWeek` on `VTask`; `inboxTasks` → in-play; widen `elsewhere`.
5. The defer menu.
6. On Deck chips.
7. Sunday's "You already decided" group.

## Open

- **Does "Inbox processed" survive?** Once `for_week` lands, the honest line may be
  *stale* in the inbox (`for_week < thisWeek`) rather than inbox-zero — an unsorted
  capture from Tuesday isn't a failure of the week; one sitting since June is. Inbox
  zero is GTD dogma, not obviously this week's business. Revisit after step 4.
- **Backfill ages.** Stamping from `created_at` will surface some genuinely ancient
  work on day one. That's the truth, but it'll look alarming. Worth seeing before
  deciding whether to keep it.
- `for_week` is a placeholder name. `slot_week` collides with the existing `slot_id`
  (timed containers, unrelated).
