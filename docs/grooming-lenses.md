# Grooming Lenses — one hub, four views, each solving one aspect

Status: **spec** (2026-07-05). The umbrella that **replaces the RefineRun card deck**
(`ItemRun`) with four dedicated grooming views. Builds on
[`on-deck.md`](./on-deck.md) — **On Deck is the first lens (When) and the hub, already
BUILT** — and inherits its doctrine ([`readiness-model.md`](./readiness-model.md),
[`design-language.md`](./design-language.md), the "human drives, Nuvo enriches" policy).

This doc is written to be **handed to a fresh build chat.** §12 says exactly what's ready
and what needs one decision first.

---

## 1 · Thesis — grooming is four decisions, not one

Grooming a project is not one activity. It's four distinct decisions, each with a different
*cognitive shape*:

| Decision | Question | Cognitive shape |
|---|---|---|
| **When** | which projects land in which weeks, what slips | a **line** (time) |
| **What** | what "done" means, what's in / out of scope | a **document** |
| **How** | the steps to get there, sized and ordered | an **outline** |
| **In the way** | what's stuck, waiting, or depends on something | a **list of links** |

The old card deck (`ItemRun`) flattened all four into one stack of cards, so each was
mediocre. On Deck proved the fix: give **one** aspect (When) the UI whose shape matches it
(a timeline) and it clicks. The governing principle:

> **Match the UI's spatial shape to the aspect's cognitive shape.** You don't edit a spec
> on a Gantt bar or sequence a timeline in a task list. One view per decision, each solving
> that decision *extremely* well, with AI doing the first draft.

## 2 · The model — a hub with gap-driven lenses (NOT a wizard)

Two ways to read "multi-phase grooming," only one is right:

- ❌ **Linear wizard** — every project marched Brief → Path → When. Death: most projects
  don't need scope work; forcing it rebuilds the chore.
- ✅ **Hub + gap-driven lenses** — **On Deck is the one hub.** It diagnoses each project's
  readiness gap and routes to the **single lens** that closes it. You only ever open the
  lens a project actually needs. The hub is what stops this from becoming "four doors."

**The routing is nearly free.** `refineProjectCards(d, p, verdict)` (`src/lib/refine.ts`)
already detects a project's gaps and returns ordered card *kinds*. We stop rendering those
as cards and instead **group them by lens** (§4 map). The gap-detection we trust is reused
verbatim; only the destination changes.

**Hub-and-lens is still *guided*, not a scavenger hunt.** On Deck's "Shape the N that need
it" is a **guided pass**: it sequences the projects needing work in demand order and walks
you through them one at a time, routing each to the single lens its gap needs — with visible
progress ("2 of 4") and a completion payoff (coverage climbs, "X weeks stocked"). The
difference from a wizard is *per-project, not per-phase*: you're walked through the *items
that need work*, each getting only its needed lens — never every project dragged through
every phase. So it **feels like being walked through the whole experience** without the
rigidity. This guided pass is required, not optional (§14).

## 3 · The four lenses

| Lens | Aspect | UI shape | AI does | Readiness axis | Initiatives? |
|---|---|---|---|---|---|
| **On Deck** *(built)* | When | timeline (portfolio) | demand ÷ capacity, the pinch | **Fits** | No — project-scale time |
| **The Brief** | What | document (one item) | drafts scope + acceptance from context, **interrogates** the gaps | **Defined** | **Yes** (needs it most) |
| **The Path** | How | outline (one item) | decomposes the outcome, spots the missing step, sizes | **Planned** | **Yes** (KRs + projects) |
| ~~Blockers~~ | In the way | linked list | — | *(Clear)* | **DEFERRED — not in v1 (§7)** |

**v1 is three lenses: On Deck (built) + The Brief + The Path.** Blockers is deferred (§7):
it's an extra step in a still-unvalidated flow and needs a schema decision — cut until the
core is proven. On Deck is portfolio-level (across projects); Brief + Path are per-item. On
Deck is also the **hub** that sends you into the other two.

## 4 · Readiness becomes an axis checklist (retires flat `tendedScore`)

Today "readiness" is one number (`tendedScore` = ripeness × soundness). With lenses it
becomes an **inspectable 3-axis read per item** — the same reframe already made for the
week (`weekReadiness`'s checklist). Each lens closes one axis (a 4th, `clear`, arrives with
Blockers — deferred, §7):

```
projectReadinessAxes(d, project, verdict, now) → {
  defined: boolean  // The Brief
  planned: boolean  // The Path
  fits:    boolean  // On Deck (advisory)
}
```

**Concrete predicates (v1 — structural; the commented soundness gate is a later upgrade):**
```ts
defined = project.outcome.trim() !== ""
       && (project.brief?.scope?.length ?? 0) > 0
       && (project.brief?.doneWhen?.length ?? 0) > 0
       && project.targetDate != null
       // upgrade: && verdict?.outcome.sound !== false
planned = tasksOf(d, project.id).some(t => t.status !== "done")
       // upgrade: && openTasks.every(t => t.durationMins > 0) && verdict?.steps.verdict !== "thin"
fits    = projectPace(d, project, now).read !== "overdue"
       && verdict?.time.read !== "unrealistic"   // advisory, never a gate
```

- **Schedulable = defined && planned.** `fits` is an advisory overlay (On Deck already
  shows it), never a gate. No new scoring — this reads existing fields + the new `brief`.
- For initiatives, swap `tasksOf` for "has ≥1 open child project or key result"
  (`projectsOf` / `keyResults`).

**Card-kind → lens map (the router):**

| `refineProjectCards` kind | Lens | Closes |
|---|---|---|
| `outcome`, `sharpen`, `due` | **The Brief** | Defined |
| `tasks` | **The Path** | Planned |
| `reality` | **On Deck** | Fits |
| `silent` / stuck (`readTending`) | **Blockers** | Clear |

On Deck's lane state stops being a flat *"needs shaping"* and names **which** — *"scope
unclear → Brief"*, *"no steps → Path"* — so the hub's routing is legible.

## 5 · The Brief lens — the next build (deep)

Requirements grooming is a **writing task**, so the surface is a document, not cards. The
one-pager for a single item:

**Outcome · In scope · Out of scope (non-goals) · Done when (acceptance) · Open questions ·
Constraints.**

The magic is **not** the template (a template is a form, and forms are banned as the front
door). The magic is what a world-class PM does across the table from you:

1. **Opens pre-filled.** AI drafts every section from what it already knows — the item's
   captures, its **domain charter/context** (`domain.context`, the routing brain we already
   built), the outcome line, linked activity. You never face a blank page.
2. **Interrogates.** It asks the 2–3 questions that expose the fuzz — *"Who's the user
   here?" "What's explicitly out?" "How will you know it's done?"* A vague brief is the root
   cause of mid-project thrash; answering those *is* the grooming. Plain-text answers (voice
   works), never a field matrix.
3. **Adjudicate, don't author.** Every drafted line is a verdict: Accept (1 tap), edit
   inline, or dismiss. The [refine-run](./refine-run.md) verdict-not-form idiom, on a
   document.

**Output:** a crisp brief that makes The Path almost trivial and flips **Defined** green.

**UI shape:** the brief as the surface; AI's questions + suggestions as a **margin rail**
(desktop) / inline chips (mobile) you answer and dismiss. Warm Paper — masthead item name,
hairline sections on the paper, the accepted brief reads as calm prose, not a form.

**Schema (the one real addition):** a `brief` jsonb on `projects` and `initiatives`:

```ts
interface Brief {
  scope: string[];        // in scope
  nonGoals: string[];     // explicitly out
  doneWhen: string[];     // acceptance criteria
  openQuestions: string[];// AI's interrogation, answered or open
  constraints: string[];
}
```

The existing `outcome` (one-liner) and `targetDate` stay where they are; the Brief lens
edits them alongside the new fields.

**Edge (new agent action):** `draftBrief: { kind, id }` → returns a proposed `Brief` +
the interrogation questions, grounded in `domain.context` + captures (same path
`draftOutcome` already uses; temp ~0.2 per the domain-context fix).

**The answer→brief loop (specify, don't leave open):** answering an interrogation question
does **not** silently mutate scope. The answer is appended to context and `draftBrief`
re-runs to propose *revised* sections, which you accept/dismiss (verdict-not-form all the
way down). So: `draftBrief` also accepts prior answers → `draftBrief: { kind, id, answers?:
string[] }`. Cheap, and keeps the human adjudicating.

**Wiring (so nothing's missed):** the `brief` column needs (1) a Supabase migration, (2)
mapping in the row→`Project`/`Initiative` transform in `vertical.ts`, (3) inclusion in the
`updateProject` / `updateInitiative` patch types. Standard, but name all three or one gets
dropped.

## 6 · The Path lens — decomposition as an outline

Mostly a **reshaping of what exists.** `ItemRun`'s "tasks" card already calls `scaffold`
(project → tasks) and `blueprint` (initiative → KRs + projects) with the human-first step
composer. The Path lens gives that room to breathe:

- An **outline** of the steps (project) or the structure (initiative), human-first: you
  rattle off steps, AI proposes only the **gaps** ("Suggest steps I'm missing" — the
  existing `scaffold`/`blueprint` enrich pass) and **sizes** each (durations, so On Deck's
  capacity math is honest — the [duration-accuracy](./priorities-and-projects.md) contract).
- Reorder by dependency; the missing-step verdict (`verify.steps.missing`) surfaces inline.
- Closes **Planned**.

Reuses `scaffold`, `blueprint`, `addTasks`, `addInitiativeSubtree`, the `StepComposer`.
Little new logic — mostly a better surface. **Gotcha:** `StepComposer` is currently a
local component *inside* `RefineRun.tsx` — extract it to a shared module first (e.g.
`components/grooming/StepComposer.tsx`) so the Path lens can reuse it and it survives
`ItemRun`'s deletion (§11).

## 7 · Blockers lens — DEFERRED (not in v1)

Cut from the initial build by decision (2026-07-05): it's an **extra step in a flow we
haven't validated yet**, and it's the only lens needing a schema decision (there's no
dependency model today — no `blockedBy` / `dependsOn` anywhere). Prove Brief + Path first;
revisit once the core grooming loop earns its keep.

When it returns, the open fork is: a **lightweight** per-item `blockers` jsonb list
(`{text, kind: "waiting"|"depends"|"risk", resolved, linkedId?}`) that auto-surfaces the
stalls `readTending` already detects — **vs.** a true project→project dependency graph
(bigger schema + UI). Recommendation stands: ship lightweight when the time comes. Until
then, the `clear` readiness axis is simply not computed.

## 8 · Does this apply to Initiatives?

Yes — the per-item lenses are **dual-altitude**:

- **On Deck (When):** projects only. Weekly time/capacity is project-scale; an initiative's
  horizon lives in the Summit / quarter, not the 3-week timeline. Initiatives never appear
  on On Deck — they're reached for grooming from the Initiatives floor / their Record.
- **The Brief (What):** **both — initiatives need it most.** An initiative's brief = the
  bet's thesis, its success criteria (key results), its boundary/non-goals.
- **The Path (How):** both. Project path = tasks (`scaffold`); initiative path = key
  results + child projects (`blueprint`). The split already exists in `ItemRun`.

So the two v1 lenses (Brief, Path) serve both altitudes; only On Deck is project-only.

## 9 · Access — from the Projects page, and everywhere

**Where the lenses render (resolve this first — it was ambiguous):** **v1 renders the
per-item lenses in the Groom flow's full-screen `Scaffold`, exactly where `ItemRun` renders
today** (`RefineRun.tsx`). The flow swaps the timeline → the routed lens for the tapped
item, same as it swaps to `ItemRun` now — so it works desktop *and* mobile identically with
zero new host. `startRun(refs)` generalizes to `openLens(ref, lens)`.

**A · On Deck = the portfolio hub** (already the home of the Groom flow). Each lane names
its gap (via the §4 router) and routes: tap a lane's **Brief** / **Path** chip → that lens
in the same scaffold → back to On Deck. The *triage* path. (This replaces the shipped lane's
single "Shape →" / "Shape the N" with gap-specific chips — a change to `OnDeckTimeline.tsx`.)

**B · The Record modal** (`src/components/record/RecordModal.tsx`) — a **later, second**
access point, not v1. It already hosts brief + tasks sections; a `Brief · Path` segmented
control there lets you groom an item you're already viewing without going through On Deck.
Nice-to-have; the flow-scaffold path is the required one.

**C · The Projects / Initiatives floor** (`FloorReadiness` / `FloorReadinessPanel` /
`FloorStanding`). The Standing's to-groom rows get a **lens tag** (the §4 router) and route
straight into the right lens (opening the Groom flow at that lens). The floor hero's one
action becomes **"Open On Deck."**

**Mobile:** On Deck is already phone-first; the per-item lenses inherit the same full-screen
`Scaffold`, so they're mobile-ready by construction. Every lens obeys the golden rule
(CLAUDE.md): single column ≤767px, ≥44px taps, safe areas, no hover-only affordance.

## 10 · Data + edge summary

- **Schema:** `brief` jsonb (§5) on `projects` + `initiatives`. Nothing else — On Deck and
  The Path ride existing rows/tasks. (`blockers` jsonb is deferred with §7.)
- **Edge (`supabase/functions/agent`):** add `draftBrief` (§5). Reuse `draftOutcome`,
  `scaffold`, `blueprint`, `verify` verbatim. All grounded in `domain.context`.
- **Pure libs:** `projectReadinessAxes` (§4) in `readiness.ts`; the card-kind→lens map in
  `refine.ts` (or a new `lenses.ts`). No new scoring.

## 11 · What replaces what

- **Retire:** `ItemRun` (the card deck inside `RefineRun.tsx`). Its cards dissolve into the
  lenses via the §4 map — nothing is lost, each gap gets a better surface.
- **Keep:** `RefineRun`'s Scaffold + On Deck home + `startRun` plumbing (the flow shell);
  the `refineProjectCards` gap-detection (now a router); `scaffold`/`blueprint`/`verify`
  edge; the Record modal (unchanged in v1). Extract `StepComposer` out first (§6).
- **Already retired:** `TendingFlow`, `RefinePortfolio` (per on-deck.md).

## 12 · Build order + readiness for a new chat

1. **Routing + axes** — `projectReadinessAxes` (§4) + the card→lens map; `OnDeckTimeline`
   lane chips name the gap and route (replacing "Shape the N"). *(pure + a shipped-file
   tweak; makes the hub route.)*
2. **Extract `StepComposer`** out of `RefineRun.tsx` (§6). *(tiny, unblocks Path.)*
3. **The Brief lens** — `brief` jsonb (migration + `vertical.ts` map + patch types) +
   `draftBrief` edge (with `answers?`) + the document surface with the interrogation rail,
   rendered in the Groom flow `Scaffold`. *(the headline build.)*
4. **The Path lens** — the extracted `StepComposer` + `scaffold`/`blueprint` in an outline
   surface. *(mostly UI over existing logic.)*
5. **Delete `ItemRun`** once Brief + Path cover its cards.

**Blockers is out of v1** (§7) — revisit after the core loop is validated.

**Ready to hand to a new chat now — YES, for the v1 set:** this umbrella + **The Brief** +
**The Path** + the routing/replacement are fully specified, with concrete predicates (§4),
the render host resolved (§9), the schema wiring named (§5), and `StepComposer` extraction
flagged (§6). No open decisions remain in v1 scope.

## 13 · Open knobs

- Lens order / labels of the On Deck lane chips (Brief before Path?).
- How aggressive the Brief's interrogation is (2 questions vs 4) — accuracy gate, per
  refine-run §1.
- Whether `due` (finish line) belongs to the Brief (Defined) or On Deck (Fits) — spec'd as
  Brief; validate against the running app.
- Whether `planned` should require sized durations + a non-thin `verify` (the §4 upgrade),
  or stay structural for v1.

## 14 · Definition of done — end-to-end acceptance (non-negotiable)

This ships **end-to-end or not at all.** "Done" means all of the following, **verified in
the running dev app (auto-login) at desktop AND 375px** — not typecheck alone:

1. From the **Projects floor**, one obvious action enters the experience (Open On Deck /
   the guided pass) — no command-palette scavenger hunt to find grooming.
2. On Deck names each project's gap and routes to the right lens, and the **guided pass
   (§2) walks you through every project that needs work** — one lens each, visible progress,
   a finish that shows coverage climb. Not a passive board you have to poke.
3. **The Brief lens** and **The Path lens** each: open pre-filled by AI, let you adjudicate
   (accept / edit / dismiss), persist, and **flip their readiness axis green** — reflected
   back on On Deck and the floor immediately.
4. From the **Initiatives floor**, the same experience minus On Deck: enter → walked through
   Brief + Path for the bets that need it.
5. No dead ends, no hover-only affordances, every step has a tap path, mobile single-column,
   safe areas respected.
6. The old card deck (`ItemRun`) is deleted and nothing regressed (`npm run build` green).

A build that adds the lenses but still enters via the command palette, or doesn't *sequence*
the pass, or leaves a lens that doesn't move its axis, is **not done.**

**Deploy dependency (call it out):** the Brief lens's AI drafting needs a new
`draftBrief` edge action **and** the `brief` column migration — both require a Supabase
deploy/migration on Phil's project (the "NEEDS DEPLOY" pattern). Until deployed, wire the
Brief UI to degrade gracefully (manual entry works; the AI draft lights up post-deploy).
The routing, axes, Path lens, floor wiring, and guided pass are **pure client** and ship
without any deploy.
