# The Weekly Review — the "Reflect" surface

Status: **shipped** (Review surface). Week's Plan / Review lives on Schedule; sealed
`week_reviews` snapshots; completed-task breakdown (by day / by domain). **The Find is
no longer shown** (D-068) — compose path retained, no UI reader.

**Updated 2026-08-01 — Find removed from the Review UI (D-068); breakdown is completed
tasks by day or by domain (task chips, not hour bars).**

**Updated 2026-07-31 — Review breakdown.** Lived weeks end with **The breakdown**:
Day / Domain toggle. **By day** is a full-width Mon→Sun spread (Schedule Spread
grammar: hairline lanes, floating receipt chips); **By domain** is domain lanes of
the same completed-task chips (count in the crown, not hours). Quiet days keep their lane.

**Updated 2026-07-30 (D-060/61/62) — the forming face was rebuilt.** It renders **the week's
projects** derived from their On Deck spans (it was reading `sprints.big_rocks` as a list,
which since D-031 holds only the verdict — so it was blind to the week's real projects), each
row carrying its outcome, its open work, the placed-vs-loose split, and D-039's span remedies
inline. **Cut:** both free-text capture boxes and the standalone Highlights list (its
receipts expand under each domain in the weave instead). The **hours weave is now
forming-collapsed / sealed-expanded** — open decision #2 below is closed. `note_to_monday`
is still written and still read by nothing; that's now a logged open thread (D-062), not a
silent gap. The 70/30 and forward-folding doctrines below are what the cuts were made
against and are unchanged.

## What it is

A **weekly looking-back ritual** — the mirror of Sunday. Sunday *opens* the week (sets
Priorities); the Review *closes* it: harvest the Gain, reckon with each Priority, carry
the unfinished forward so Sunday never starts cold. It is the missing **closing valve**
on the funnel (we had a forward weekly valve, Sunday, and no backward one).

- **User-facing artifact name: "the Review"** (agile *sprint review* lineage — demo what
  got done, the Gain half; not the *retro*/process half). The archive = "your Reviews".
- Prompted at a **configurable time** (e.g. Friday afternoon). Not forced; an invitation.
- Rejected names: Harvest / any farming or pastoral metaphor (Phil dislikes them, same
  reason he dislikes "tend"). Keep it agile-plain.

## The Find (evidence-backed discovery) — **removed from UI (D-068)**

Shipped once as "exactly one Find per Review." In practice it wasn't valuable; the
Review's landed projects + completed-task breakdown answer the same question more
honestly. Code (`composeWeekFinds`, sealed Find fields) still runs so old snapshots
don't break — nothing renders it.

Every Review may surface **exactly one** Find — something the numbers noticed that you
couldn't see while inside the week. Product rules:

1. **Hide when nothing is notable.** Confidence + unexpectedness gates; no manufactured profundity.
2. **Receipts are first-class.** Every claim expands into tasks / meetings / shipped work.
3. **Corrections update the source** (`tasks.domain_id` or `event_domain_routing`), then
   the Review reseals — never a cosmetic Review-only override.
4. **Code owns the facts; AI only warms the voice.** `composeWeekFinds` is pure;
   `agent/reviewFind` narrates the selected candidate only.
5. **Investment loop:** That's true · Not quite · Keep this · Carry to Monday
   (Note to Monday surfaces on Today Mon–Wed).

Candidate kinds: hidden bet, plan/reality mismatch, comeback, protected time, domain
shift, repeated carry, shipped off-book. Tone variety soft-prefers celebration over
scolding when scores are close.

### Storage

`week_reviews` (migration 33): sealed `report` jsonb + `find_narration` + `find_response`
+ `find_kept` + `note_to_monday`. Past weeks prefer the snapshot; live recompute is the
fallback. Source corrections call reseal.

### Key files

- `src/lib/weekEvidence.ts` — canonical receipts ledger
- `src/lib/weekFinds.ts` — candidate engine + gating
- `src/lib/composeWeek.ts` — WeekReport includes `evidence` + `find`
- `src/hooks/useWeekReport.ts` / `useWeekReview.ts`
- `src/components/floors/WeekFind.tsx` / `WeekEvidence.tsx`
- `supabase/functions/agent/reviewFind.ts`

## Navigation — the third Spine section

The Spine currently has two subheaders: `EXECUTE` (Today, Schedule) and `BUILD`
(Project, Initiative, Domain). The Review reveals a **third section, `REFLECT`**, and
**Domain moves into it**:

- **Execute** — Today, Schedule *(do the day/week)*
- **Build** — Project, Initiative *(construct the work)*
- **Reflect** — **Domain + the Review** *(the long arc + the conscience)*

Rationale: Domain is already "barely edited, calm, conscience-layer, measured by
faithfulness over a long arc" — that's reflection, not construction. The Review is the
weekly heartbeat of that same faithfulness, so they pair. **Deliberate tension to own:**
in the pure funnel Domain is the *top* (where Project→Initiative culminate); moving it to
Reflect commits to "Domain is where you examine faithfulness, not where the build stack
terminates." We think that's true to how it's actually used.

Deeper read: the app has **three axes** and the Spine only draws one. Space (the Spine —
the funnel), Time (the flows — Today/Sunday/Review/Summit, the cadences), and Memory (the
archive of Reviews). The Reviews archive is the first real **memory axis** — and it is
literally the evidence for the Domain "faithfulness over a long arc" thesis (a stack of
Reviews over a quarter *is* the long arc the Summit looks back on).

## Anatomy of a Review (Phil's edits applied)

1. **The emblem** — a wordless, symbolic, generative graphic; the *cover* and the hook
   (see below). This is the centerpiece, not a stat strip.
2. **The line** — Nuvo's one-paragraph first-person letter (the narrative).
3. **Priorities** — each `big_rock` with a verdict: **landed / carried / open**.
   *(Phil's favorite element.)*
4. **Where the hours went** — on a **lived** week this is **The breakdown** at the end:
   completed tasks only, toggle **By day** (Mon→Sun spread) / **By domain** (lanes of the
   same chips, count not hours). Forming weeks still lead with the conscience sentence
   mid-page.
5. **Note to Monday** — free-text "here's what I'm thinking for Monday," captured here,
   surfaced in **Today** when Monday opens. A letter from Friday-you to Monday-you. The
   qualitative sibling of carry-forward; reuses the Today brief + low-data-entry.
6. **Carried into next week** — unfinished Priorities (increment `roll_count`) + loose
   tasks → pre-seeds Sunday.

**CUT (too dashboardy):** "tasks done" and "focused hours". Throughput counts, and
"focused hours" had no honest definition. The only quantitative top-line that survives is
"3 of 4 priorities" — because it's an *outcome*, not a count. Everything else quantitative
folds into Priorities + the hours weave.

## The emblem — generative art, NOT a diffusion image

The hook ("I can't wait for my Friday Review") is a **beautiful, symbolic, narrative
graphic that's different every week**. Build it as **generative art parameterized by the
week's real data**, never a generated photo. Why not diffusion: slow, costs money per
week, can't be stored meaningfully (a 2MB blob disconnected from data), and drifts toward
generic "AI art" lameness.

The emblem is a **pure function of a tiny spec** (~30 numbers): `renderEmblem(spec) → SVG`.
The spec is *derived from rows*, so it's storable as a small row and regenerates instantly.
The picture **is** the data, symbolically — so it's genuinely different and a little
unpredictable each week (variable reward), and the archive becomes a **wall of weeks**, a
gallery of unique marks = the year, visualized = the memory axis made visual.

First-pass symbolic language (one option, see open decisions): **celestial** — central sun
= the week's dominant bet; concentric **rings = domains**, each ring's angular sweep ∝ its
hours; **points of light = priorities** (whole = landed, half/amber = carried, faint open
ring = open); faint ambient dots = done-work. A lean week renders lopsided; a balanced week
a full mandala; a quiet domain a barely-there ember.

## The generation architecture — nano-proof (the load-bearing decision)

Concern: a small/cheap model (e.g. gpt-4.1-nano) can't reliably emit SVG or layout. It
doesn't have to. **The model never draws and never touches a number.** Split:

**Code owns everything structural ("the design + data language"):**
- `renderEmblem(spec)` — deterministic; spec derived from rows (ring sweeps = real hours,
  priority states = real verdicts, dot count = real done-count).
- All numbers, verdicts, the hours weave, carry-forward, layout. Deterministic.

**The model returns a tiny, schema-locked, text-only object:**
```ts
{
  title: string,            // one line
  letter: string,           // 3–4 sentences, first person
  featured: number[],       // PICK 3 indices into the moments code computed
  conscienceNote: string | null,
  motif: "celestial" | "woven" | "architectural",  // ENUM
  inscription: number | null // PICK 1 of N pre-written, or null
}
```

Three guarantees:
1. **Numbers are narrated, never generated** — same rule as `composeBrief` ("numbers must
   stay real"). The model is given real figures only to write *about* them.
2. **Visual choices are enumerated, not freeform** — `motif` is one of three; `featured`
   are indices into a computed list; `inscription` is pick-one-of-N. A small model picks
   from a menu reliably even when it can't author from scratch (generative-within-a-grammar
   where the grammar is a dropdown).
3. **Graceful fallback** — bad/slow model output → deterministic templated sentence (as
   `composeBrief` already does). The model is an **enhancement, not a dependency**; v1 can
   ship with no LLM at all and layer nano in later.

## Build on what exists (don't rebuild)

- ⚠️ **Stale since D-031, corrected 2026-07-30 (D-060).** *"Priorities = `big_rocks`"* is no
  longer how a week is read. The slate is **derived from each project's On Deck span**
  (`weekPushes`); `big_rocks` (jsonb on `sprints`) survives **only** as the per-week verdict,
  looked up by `project_id`. `priorityWork()` still supplies the done/total tracking, and
  `weekPlacement()` beside it supplies the placed-vs-loose split. A **sealed** week is the
  exception and reads its stored rocks verbatim — that snapshot is the historical record and
  is never re-derived.
- **`roll_count`** already exists on each priority and is *never incremented* — the Review
  is the moment that increments it (carry-forward, the long-deferred TODO).
- ~~**The Gain / `Standback`** already holds `BigRocksReckoning` — promote it into the
  Review ritual.~~ **Never happened, and it can't now:** the Review grew its own reckoning
  (`WeekProjectRow`), and as of 2026-07-30 `Standback.tsx` / `bigRocks.tsx` / `lib/standback.ts`
  have no importers at all — the whole chain is dead and queued for deletion.
- **`composeBrief`** (`lib/brief.ts`) is the deterministic-first-person-from-real-numbers
  pattern to mirror for the weekly letter (`composeWeekStory`).
- **`supabase/functions/agent/priorities.ts`** (the free-text→structured parser, gpt-4.1-
  mini) is the pattern for the nano fill-fields call.
- **Storage cost is a non-issue**: a Review is a few KB (prose + the ~30-number emblem
  spec) — ~150–250KB/year. Store every week forever; the archive is the product.

## Emotional north star

The Review should land like **exhaling — a sigh of relief reward after a long week.** Not a
report you *review*; a moment you *receive*. It's **told like a story**: emblem → the line →
priorities → time. This is the reason the throughput stats were cut — anything that reads as
a dashboard interrupts the sigh. Gap→Gain framed, affirming, faith-aware, never an audit.

## Voice — warm, and distinct from the rest of the app

The Review's narrative voice is a **different register from the app's everyday Nuvo.**
Everyday Nuvo is a chief-of-staff — crisp, useful, time-aware ("push my 1:1 to tomorrow").
The Review's Nuvo is **a wise friend at the end of the week** — warm, unhurried, affirming,
a little tender; it notices effort, names what was hard, blesses the quiet. Same Nuvo,
different room. Implementation: a **separate system prompt / persona** for the Review's nano
call, with its own few-shot examples, so the warmth is engineered, not hoped for. (The
Week's Plan companion shares this warmer register; everyday Today stays chief-of-staff.)

## The companion family + the Week's Plan (new sibling)

The Review revealed a missing present-tense surface. The full family:

> **Sunday** sets the week → **Week's Plan** *lives* the week (present tense, mid-week) →
> **Review** reflects on it (Friday).

And it mirrors the day exactly:

| scale | narrated companion | calendar workspace |
|-------|--------------------|--------------------|
| day   | **Today**          | Day view           |
| week  | **Week's Plan** ←new| Schedule / Week view |

The **Week's Plan is the weekly twin of Today** — same soul, longer horizon — and it is the
**true home for Priorities**, which currently have no good home (awkwardly docked on the
Schedule rung; see [[nuvo-big-rocks]]). It holds *intent*; Schedule holds *time*. This is the
"this week's dashboard ≠ the schedule" surface Phil reached for earlier. Phil also notes
**Today itself needs reworking**; the two companions should be designed together so they
share structure (don't fork — same pattern, different time scale).

Week's Plan anatomy (first pass, see `weeks_plan_companion_wednesday` mockup): the warm
brief line (the voice) · the **forming emblem** · Priorities with progress + their next
scheduled block · where the week stands (capacity + domain balance forming) · the road
ahead (back-half at a glance). Reuses `readDay`/availability logic at week scale; mirror
`composeBrief` as a weekly `composeWeekBrief`.

## The living emblem (ties the family together)

The emblem is **alive across the week**, not just a Friday artifact. The Week's Plan shows
it **forming** — ghost rings with partial bright arcs for hours-so-far, most priority-lights
still dim/outlined — and the Review is when it's **sealed** whole. You watch your week take
shape as light mid-week; Friday is the reveal. This is the earned "can't wait for Friday"
pull (Hooked / variable reward), and it means `renderEmblem(spec)` takes a *progress* state
(forming vs sealed), not just final data.

## The 0-context build prompt (assemble LAST)

Phil wants a fresh-session, zero-context prompt to build this out — assembled **after** the
design settles (voice + Week's Plan + emblem metaphor decided). This doc + the
`nuvo-weekly-review` memory are written as its seed. Don't draft the final handoff prompt
until the open decisions below are closed.

## The 70/30 doctrine — DECIDED (2026-06-19), and it sets the navigation

Phil's resolution, the keystone: **the app is ~70% future, ~30% past.** It is *not* a tool
for remembering the past — multi-domain operators **underappreciate** the past, so Nuvo
surfaces it *briefly* in order to **make connections with the future.** This decides nav and
revises the earlier "Reflect section" idea:

- **No third Spine section. Domain does NOT move.** Keep the simple nav Phil loves. A
  `Reflect` rung would weight the past at ~50% — contradicts 70/30. (Burying it signals
  *unimportance*; a whole section signals *over*-importance. Neither — it's 30%.)
- **The Review is a *moment*, not a *place*** — like Sunday and Summit (which already have no
  rung). It **arrives** (prompted at the configured time), is **received** (the sigh), then
  **folds its value forward** (carry-forward → Sunday, note-to-Monday → Today), and recedes.
- **The Week's Plan lives on the Schedule rung — NOT a new rung, NOT in EXECUTE-as-a-peer.**
  Schedule is the only nav surface that already *is* the week (its natural time horizon).
  Revises the earlier "up front with Today in EXECUTE" idea — Today is the *day* companion on
  rung 1; Schedule (rung 2) gains the *week* companion. No new rung. Honors Phil's minimalism.
- **The archive is time-navigation, NOT a place — and NOT in Domain.** Domain is *timeless*
  (no time axis); a week-by-week archive there is incongruent (Phil's catch — retracts the
  earlier "hang it off Domain"). Instead you reach past weeks by **walking ‹ › backward** —
  the same gesture that already moves the calendar.

## The unification — Week's Plan ≡ the Review (one surface, two states)

The keystone simplification: **the Review is just the Week's Plan of a week that has ended.**
Forming → sealed. *Same component*, one `isPast` flag; the emblem you watch fill all week
*seals* when the week closes. So:

> Schedule **is the week**: a time grid (the calendar) + a narrated face (the Plan). You walk
> weeks with ‹ ›. This week = a forming Plan. Last week = a sealed Review. The archive isn't a
> screen — it's *past positions of the same surface.*

No separate archive view, no Domain entanglement, no new rung. The Friday Review still
*arrives* as a prompted moment (the reveal/sigh); afterward it just *is* last week's sealed
Plan, browsable by walking back.

**Entry point = one button in the Schedule top bar** (where `Today / ‹ › / Jun 21–27 / Day·
Week·Month` lives): a **"This week" button whose glyph is the living emblem** — it fills
across the week right in the toolbar (an ambient gauge: feel where the week stands at a
glance, no reading), and clicking it opens the Plan/Review floor over the calendar. The glyph
is both the status and the door — the minimalist move (one mark = gauge + button). NOT the
bottom shortcut-hint bar (cramped, tied to the task list, half-dead — Phil flagged several
shortcuts don't work; separate cleanup). Mockup: `schedule_topbar_weeks_plan_entry`.

**Forward-folding doctrine (governs the whole Review):** *every backward element must hand
something forward.* Looking back is the vehicle; a future connection is the cargo. A priority
reckoned → carries / seeds Sunday. A quiet domain noticed → a flag for next week. The note →
Monday. If a part only describes the past and connects nothing forward, it's the 30%
bloating — cut it. (This is also the real reason it's not a dashboard: a dashboard is pure
past, zero forward; the Review is past-in-service-of-future.) Connects to the gentle-steward
doctrine in [[nuvo-funnel-thesis]] (opportunity/Gain, never debt/shame).

## Open decisions (choose deliberately — don't default)

1. ~~The emblem's symbolic language~~ — **DECIDED: celestial.** Sun = dominant bet; orbital
   rings = domains (sweep ∝ hours); satellites = priorities (filled = landed, **half-moon =
   carried**, **open ring = open**); faint dots = ambient done-work. Phil saw it rendered and
   liked it. Keep the half-moon/open-ring state vocabulary regardless.
2. ~~Conscience note: picture or prose or both?~~ — **DECIDED (2026-07-30, D-061): prose
   while it's forming, picture once it's sealed.** Resolved on the forward-folding rule
   rather than on tone — mid-week a quiet domain is *actionable*, so naming it hands
   something forward; once the week is sealed nothing can be done, so a sentence there is
   pure audit and the ember carries it alone. The forming face therefore leads with one
   sentence and puts the weave behind a disclosure; the sealed face shows the weave
   expanded and says nothing. Guards for a stranger's account: silent when no domain has
   hours yet, at most two domains named. Still honors the gentle-steward doctrine ("the app
   reports, you decide"; opportunity not debt; never shame a quiet domain).
3. ~~Where Reviews live navigationally~~ — **DECIDED:** the Review is a prompted moment AND
   the sealed state of the Week's Plan, which lives on the **Schedule** rung (the week's
   natural horizon). Entry = a living-emblem "This week" button in the Schedule top bar.
   Archive = walking ‹ › backward (past = sealed Plans). NOT Domain (timeless, no time axis).
   No new rung. See "The unification" above.
