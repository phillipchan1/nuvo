# Decision log

**Status:** living · append-only in spirit (supersede, don't delete)
**Why this exists:** so we stop relitigating. The most valuable half of this file is §2 —
the things we **decided not to do** and why. An idea that comes back with no new
information gets pointed at its entry and closed.

**Format:** `D-nnn · date · decision — why → consequence.` Status is `standing`,
`superseded by D-nnn`, or `revisit (trigger)`.

> Entries D-001…D-018 were reconstructed from the repo on 2026-07-25 (readme, `CLAUDE.md`,
> and `docs/` specs). Dates are approximate where the original decision wasn't dated.
> **New entries should be written at the time of the decision.**

---

## 1 · Standing decisions

### Model

**D-001 · A scheduled task IS a time block.** One `tasks` row; no separate event entity.
→ Rollover, mirror sync, capacity math, and the Review's evidence are all cheap. Reversing
this would double every sync path. *Status: standing — foundational.*

**D-002 · Four pools, one gate.** `inbox → backlog → Week → Day`, with backlog
**deliberately undated**. → Project work can't leak onto Today; the Sunday commitment number
means something. *Status: standing.*

**D-003 · Single-*player*, not single-*tenant*.** No assignees, permissions, or shared
state **inside a funnel**. → Every altitude stays sharp and the arithmetic stays honest
(pace and calibration both break if a task's progress depends on someone else). Costs us
the team market on purpose. **Clarified 2026-07-25:** this was written as "single-user
only," which conflated a product refusal with a deployment shape and was being used to
argue against things it doesn't actually forbid. Serving many independent accounts is
explicitly *in* scope — see D-024 and [`overview.md`](./overview.md) §2.1.
*Status: standing (restated).*

**D-004 · Priorities bind to projects along a crystallization line** rather than being
either "just a sentence" or "always a project." A priority is always a real node that *can*
own tasks, and may stay a pure intention forever. → No nagging to "grow up." Spec:
[`priorities-and-projects.md`](../priorities-and-projects.md). *Status: standing.*

**D-005 · The assistant proposes into quiet pools; only the human promotes toward the
calendar.** → No auto-scheduling, ever. This is the story's Hero test, not just a taste
call. *Status: standing — Principle 3.*

**D-006 · No farming or pastoral metaphors.** "Harvest" rejected for the weekly ritual;
"tend" rejected for grooming. Named **the Review** (agile *sprint review* lineage — the
demo half, not the retro half). → Voice stays agile-plain.
*Status: standing. Code debt: `TendingFlow`, `src/lib/tending.ts`.*

**D-007 · Accepted naming drift, documented.** Priorities = `big_rocks`; Week = `sprints`.
→ Renaming the columns isn't worth the migration; [`glossary.md`](./glossary.md) is the
contract instead. *Status: standing — revisit only during an unrelated migration.*

**D-008 · Recurrence is materialized, not computed.** A `recurrences` row holds rule +
template; occurrences are stamped as ordinary `tasks`/`slots` rows to a 35-day
`HORIZON_DAYS`, topped up on app open and after rollover. → Drag, resize, and slot children
need zero special-casing. *Status: standing.*

**D-009 · A recurring occurrence never rolls over.** A missed one is just missed — tomorrow
already has its own. → No infinite pile-up of yesterday's habit. *Status: standing.*

**D-010 · Recurring series are not mirrored to the Google "Nuvo" calendar.** ~25 concurrent
mirror writes raced on OAuth token refresh and 500'd. → Series live in Nuvo only.
*Status: **revisit** — trigger: a batched/queued mirror writer.*

### Platform

**D-011 · FullCalendar over Schedule-X** — external drag-in from the task rail is natively
supported. *Status: standing.*

**D-012 · One SPA, two shells, no router.** Auth-gated single `index.html`; `ResponsiveShell`
picks `MobileShell` (<768px) or the desktop shell. → One `dist/` serves the Tauri app and
the iOS PWA. *Status: standing — Principle 15.*

**D-013 · Pointer events for all drag.** The Tauri webview swallows HTML5 drag-and-drop.
*Status: standing — non-negotiable.*

**D-014 · The service worker never runs in Tauri.** Guarded on `'__TAURI_INTERNALS__'` +
`isSecureContext`, and the PWA plugin is disabled at build time (`TAURI_BUILD=1`).
*Status: standing.*

**D-015 · Calendar providers by capability, not parity.** Google two-way + mirror · M365
read-only (striped, dashed, not draggable) · iCloud two-way over CalDAV with an
app-specific password in Vault · ICS read. → We ship what each API honestly supports and
*show* the difference rather than faking parity. *Status: standing.*

**D-016 · All model/API keys live in Supabase secrets, never the frontend.** The agent edge
function is the only path to the model. *Status: standing — security-load-bearing.*

**D-017 · Dev auto-login, tree-shaken from production.** `VITE_DEV_EMAIL`/`VITE_DEV_PASSWORD`
in gitignored `.env.local`, guarded by `import.meta.env.DEV`. → Every UI change can be
verified against the *running app* with real data. *Status: standing.*

**D-018 · Marketing is a separate Vite app in the same repo** (`marketing/`, own Vercel
project), sharing tokens but not the SPA shell. → Design truth stays close; the product
bundle stays clean. *Status: standing.*

### Design

**D-019 · Warm Paper: the canvas is continuous.** Full-bleed structural containers stay
transparent and separate with hairlines; opaque backgrounds over `.atmosphere` are the
"frost seam." *Status: standing.*

**D-020 · Focus lifts, it doesn't outline.** No flat focus rings on focal elements — glass
+ `--shadow-lift` + a small rise. *Status: standing.*

**D-021 · At most one Find per Review, hidden when nothing is notable.** Confidence +
unexpectedness gates. → No manufactured profundity. *Status: standing — Principle 6.*

**D-022 · Marquee's vocabulary is data, not code.** Targets live in a client-side registry
sent to the agent per request; the edge function only relays "point at `<key>`". → It never
changes as targets grow. *Status: standing — the pattern to copy for any future agent
vocabulary.*

**D-023 · On Deck is the start of grooming, not the deck.** Portfolio-level timeline first
(coarse calls), then the per-project card run. → Sorting by *when it's needed* rather than
*how unready it is.* *Status: standing.*

### Tenancy

**D-024 · 2026-07-25 · Nuvo is a multi-tenant product.** Many independent operators, one
deployment, each account isolated by RLS on `user_id`. → The data model already supports
this; the *product* doesn't yet ([`overview.md`](./overview.md) §5, "Tenancy state").
Consequences we're accepting:

- **Defaults become product decisions.** The new-user trigger's four seeded domains
  (Work / Church / Trading / Family) stopped being a convenience and became a claim about
  the user's life. **Resolved in D-026** — signup now seeds none.
- **Timezone and working hours can't be assumed.** Rollover is scheduled against
  America/Los_Angeles; 480/990 working hours are one operator's day.
- **Signup stays open**, which reverses the "disable signups after your account exists"
  guidance in the root `readme.md` — that guidance now describes a *personal deployment*,
  not the product.
- **Cold start becomes load-bearing.** Principle 7 was always true; multi-tenancy makes it
  the difference between a product and a personal tool, because the builder's account is
  never empty and so day-one breakage is invisible to the only person testing.
- **Aggregate signals become available and necessary** ([`overview.md`](./overview.md) §6) —
  internal only, never surfaced to operators (Principles 4 and 9).

*Status: standing — the direction. Implementation is unbuilt; see
[`roadmap.md`](./roadmap.md).*

**D-029 · 2026-07-26 · Nuvo is a paid subscription** — 14-day no-card trial, then $29/mo
or $19/mo annual, per account (`supabase/functions/stripe-*`, migration 41,
`docs/billing-setup.md`). Everyone goes through the same trial/paywall, including the
builder — no founder override. → Multi-tenancy stops being a direction and becomes the
business model; **each account is a paying customer, so every Principle 16 default is now
a revenue-affecting bug, not a tidiness issue.** Signups must stay open (this reverses the
old personal-deployment guidance). Aggregate signals in [`overview.md`](./overview.md) §6
gain a real use: activation and second-week are now trial-conversion inputs.
*Status: standing — decided on master, recorded here after the fact.*

**D-025 · 2026-07-25 · Persona zero is evidence, not the definition.** The builder is a
verified instance of P1, cited as ⓞ; the archetype is what we design against.
→ Instance-level details are examples, never defaults (Principle 16). Claims marked ⓞ are
**unvalidated beyond N=1** and get tested against real operators two and three.
*Status: standing.*

**D-026 · 2026-07-25 · Signup seeds no domains; the account names its own.** *(Resolves
Q-06 → option B, "pick from kinds".)* `handle_new_user()` no longer inserts Work / Church /
Trading / Family; it seeds the settings row only (migration
`00000000000038_domain_seed.sql`). Zero domains is the client's signal to run the first-run
picker (`src/components/FirstRun.tsx`), which offers the **five domain kinds** from
[`personas.md`](./personas.md) §1 — work · community · discipline · people · stewardship —
each with examples and an editable name, plus "add your own".
→ Rejected: *start empty* (Principle 7 — the concept is too unusual to survive zero
examples, and a blank canvas is something we refuse elsewhere) and *blander defaults*
(Work / Personal / Health — the same mistake with worse names, and generic defaults are
precisely the ones nobody edits). → Consequence: the weakest moment in the product becomes
the moment that teaches what a domain is, and it teaches **by asking rather than
asserting**. Closes ledger O2, and part of O1 and O6.
*Status: standing. Migration written; **not yet applied to any project** — needs
`supabase db push`.*

**D-027 · 2026-07-25 · The register: convictions drive the product, vocabulary doesn't
gate it.** *(Resolves Q-08.)* Nuvo is built on Christian convictions about time,
responsibility, and doing work well — **and you don't have to share them to use it.**
Explicit language is out (*called · calling · what God has given you · ministry* as a
default); tangential language stays (*steward · faithful · vow · gain · discipline ·
presence · showing up*), because it carries the moral seriousness the product runs on and
is fully usable by anyone. **The excellence is the witness; the copy doesn't have to be.**
→ Applied: Domain is now *"where you've committed to show up."* Marketing lost "the
calling", "called to be faithful", and Church-as-a-default-tile. The `faithfulness()` code
identifier stays (D-007 precedent — documented drift, not a rename).
→ The test for any future copy: *would a reader who shares none of these convictions still
find this the most precise word, or would they feel addressed as an outsider?*
*Status: standing — full rule in [`brandscript.md`](./brandscript.md) §10.*

**D-028 · 2026-07-25 · The first-value moment is "capture three things and watch them land
on a real calendar."** *(Resolves Q-09.)* → Onboarding is designed backward from that
moment; anything that delays it is cut. It's also the honest one — it demonstrates the
capture→calendar path that no competitor's vertical reaches.
*Status: standing — nothing built against it yet.*

**D-030 · 2026-07-26 · The phone gets the planner decks, as decks — not as lists.**
*(Partially resolves Q-01: the strategic altitudes are on mobile, and they now* edit *.)*
The Projects and Initiatives tabs were read-only rankings; they are now the same surface
the desktop runs, **rotated into a swipe**: page one is the pool, then one page per sprint
(projects) or quarter (initiatives). Press-and-hold a card and drop it on the column strip
to time-box it — the desktop drag, on a thumb — with a tap path through the record for
every move, so nothing is drag-only (mobile golden rule #4). Editing is **sprint-centric**:
a project's record now opens on a scale of the next four sprints with its span lit across
them, not two date fields; a bet's opens on quarters with its runway counted in sprints.
Both surfaces and the desktop deck write placement through one function
(`sprintSpanFor`), so the same drop lands the same way anywhere.
→ Consequence: the pool is named **"Needs a sprint"** at the project altitude on both
shells (it read "Needs a week" on desktop while the columns said "Sprint 31" — an
overlapping name, Principle 11). → Rejected: *vertical sprint sections* (loses the time
axis, and the phone stops being the same surface) and *keeping the demand-ranked list*
(it answered Q1/Q2 but could not make the call the deck exists to make). → Watch: the
long-press threshold (260 ms) and whether one-handed reach to the strip holds up for real
thumbs. *Status: standing — built and driven at 375px in a render harness; **not yet
driven in a real account on a real phone**.*

**D-031 · 2026-07-26 · Plan the week is a phone act too — and the agent plans from the
same slate the app does.** *(Further narrows Q-01: the phone now runs the weekly ritual;
grooming — shaping a single project — is still the open half.)*
Two halves of one problem. **(a)** Asking Nuvo to "help me plan this week" produced a read
that never mentioned the projects already committed to the week — it said *"no week
priorities set yet"* while the deck held several. The cause was a model mismatch, not a
prompt gap: the app derives the week's priorities from each project's On Deck span
(`weekPushes`), while the agent could only see the sprint's `big_rocks` jsonb — which is
just the per-week **verdict** and is usually empty. The agent's context now derives the
same slate (`weekSlate`, plus `needsASprint` / `nextWeekSlate` and each slate project's
open tasks), and the priority tools move the **project**: `create_priority` with a
project_id writes its Mon–Fri span (the same write as dropping its card on this week's
column), `delete_priority` clears it, `complete_priority` can record a verdict for a slate
project that has no stored record yet. A priority written with no project is now reported
back as what it is — a note that appears on no planning surface. *Tension with D-004
(priorities bind along a crystallization line and may stay pure intention): the model still
allows an unbound priority, but every built week surface — the Priorities editor, the phone's
slate, the week's plan card — renders the derived slate, so an unbound one is invisible in
practice. The agent now says so instead of writing one silently. Where that lands for good is
[`priorities-and-projects.md`](../priorities-and-projects.md), flagged there, not decided
here.* **(b)** The desktop had a
weekly ritual and the phone had none, so the phone's only route into the week was the chat.
`src/components/mobile/MobilePlanWeek.tsx` runs the same act in three thumb-sized steps —
**Slate → Pull → Shape** — entered from a card at the top of the Week segment.
→ Consequence: the composer is now shared. Everything that decides *what* the week is (the
pull, standing-slot routing, project-slot clustering, `composeWeek`, the commit) moved out
of `SundayRitual` into **`useWeekDraft`**; each shell owns only its layout and gestures. Two
surfaces computing their own week would have been two answers to "what is my week" — the
exact drift (a) was caused by. → Also fixed on the way: dropping a project-slot block
removed nothing (the block id isn't a task id), and a fresh install read UI zoom as
`Number(null)` → clamped to **0.8**, rendering the whole app at 80% on any new device.
→ Rejected: a phone port of the week *grid* (a seven-column time grid can't be tapped at
375px; the day-by-day list is the same information at thumb scale) and teaching the agent to
write `big_rocks` more cleverly (it would still be writing to a surface nobody reads).
*Status: standing — typechecks, builds, and driven at 375px in a render harness
(`?planweek`); **not yet driven in a real account**, so W1/W2 stay scored as they were.*

**D-032 · 2026-07-26 · Planning rules have exactly one implementation, and a test that fails
when a second appears.** The app and the agent run in different runtimes over the same data,
and every rule we wrote twice drifted: the agent read `big_rocks` while the UI derived the
slate from spans (D-031), and `planningWeekStart` shifted Saturday to next Monday in the app
but to *this* Monday on the server — so on Saturdays the two planned **different weeks**. None
of it failed a typecheck, a build, or a review; both surfaces just answered confidently and
differently. → The week's rules now live in a dependency-free kernel
(`supabase/functions/_shared/planningRules.ts`) imported by both; writes share the **act** as a
returned *patch* (`bringIntoWeekPatch` / `takeOffWeekPatch`) that each runtime applies with its
own client, so a tap and a chat message place a project identically;
`tests/planning-kernel.test.ts` holds it three ways — agreement (client derivation vs the
agent's, over one fixture set in both shapes), behavior (the weekend rule, shipped-inside-the-week,
the Sunday-boundary leak), and a **drift guard** that scans the tree and fails if any file
outside the kernel defines a rule it owns. CI runs it on every push
(`.github/workflows/checks.yml` — the first non-release workflow; ~1 min, releases stay manual).
→ The kernel lives under `supabase/functions/_shared/` because the edge bundler only guarantees
that path, not because it is server code. → Rejected: *Postgres RPCs as the one implementation*
(genuinely single-sourced, but it moves planning logic into migrations and away from the pure
functions the UI needs synchronously — revisit if a third client appears) and *generating the
server copy from the client* (a copy with a checksum is still a copy). → **Known gap, named
rather than hidden:** `_shared/nlp.ts` is still a reduced re-implementation of `src/lib/nlp.ts`,
so the same capture parses differently in the two paths; and the composer (`composeWeek`, the
pull, calibration) is client-only, so the agent can propose a week's shape but never computes
the same one. Both are listed in [`planning-kernel.md`](../planning-kernel.md) §5.
*Status: standing — 25 conformance tests green; each guard verified by deliberately
reintroducing the drift and watching it fail.*

**D-033 · 2026-07-26 · Task duration is a preset sitting, never a free-text 20m stamp.**
Getting projects in (GroomWall, QuickCreate, `addTask`) was defaulting every step to
**20 minutes** — fiction that wrecks W1 (can I carry this week?). Duration now uses one
shared preset list (`DURATION_PRESETS`: 15 · 30 · 45 · 60 · 90 · 120 · 180 · 240) as a
dropdown chip wherever a sitting is sized; project-backed steps default to **45**
(matches `MIN_PROJECT_BLOCK`); loose/quick stays **30**. AI still *proposes* durations
on scaffold / New Project / plan-week tools (Principle 3 — human promotes); the human
edits via the same presets on the proposal and on Plan-the-week Pull (desktop + phone).
→ Closes the "duration accuracy is a grooming property" gap named in
[`priorities-and-projects.md`](../priorities-and-projects.md). → Rejected: free-text
minute fields (thumb-hostile, invites nonsense) and gating the week until every task is
groomed (Principle 7 — useful on day one). *Status: standing.*

**D-034 · 2026-07-26 · Plan the week is named after what it holds, not after our
mechanics — and both shells run the same four steps.** *(Supersedes the step names in
D-031; the shared-composer half of D-031 stands unchanged.)*

The flow spoke three vocabularies for one act: the phone stepped **Slate → Pull →
Shape**, the desktop said **"Slot the projects" → "Slot the work"** and railed its
sources as *Carrying forward · The projects · Clear the inbox*. Every one of those
verbs was ours, not the operator's — "slate", "pull" and "shape" appear nowhere else in
the product, so the flow's own navigation taught a first-time reader nothing about what
they were being asked to decide. Said out loud, the act is plain: **you're deciding on
projects, on the stuff that didn't get done, and on new captures — then when it all
happens.** → The steps are now **Projects · Leftovers · Inbox → The week**, identical on
both shells, each opening with the question it answers rather than a verb. Code names
(`suggestPull`, `PullSuggestion`, `weekSlate`, the `loose` lane key) are untouched —
documented drift, per D-007.

**Leftovers, chosen over "Loose ends", with the honesty moved into the question.** The
lane also holds work that's *due* this week and one small task per quiet domain
(`suggestPull` sources 4 and 5), neither of which is literally a leftover. Operator's
call; the mitigation is that the step asks **"What didn't get done, and what's due?"**
and labels its two groups *Carried over* and *Due, or going quiet*. Also avoids a
collision: "Loose ends" is already the name of an unrelated line on `WeekPanel`
(Principle 11).

**The funnel is drawn, not implied.** `WeekIntakeBar` (over `src/lib/intake.ts`) is one
component on both shells: the four steps as lanes with live counts, over a single
capacity track — the immovable calendar, then each source stacked on it, against
Calibration's proven pace, with the room left in `--slot` and any overrun in `--signal`.
Nuvo already *had* a funnel (inbox → backlog → Week → Day) and the weekly plan is its
gate; this just shows it. → **W1** ("can I carry this week?") is now answered *while*
you decide instead of only at the commit bar, which is where it was useless. `laneOf`
is the single lane rule — carried beats project attachment, because a slipped task is a
leftover to re-time, not a fresh push, and burying it under its project is how
carry-forward stopped being a decision.

**Four steps, but deliberately not a wizard.** The desktop's five *gated* steps were
removed once before and must not come back: every lane here is clickable at any time
(including backwards from the grid), the week is fully composed on open, and the
capacity track carries the live read on every step. That last part is what pays for
splitting the sources off the grid — you no longer need them side by side to see the
consequence of keeping something.

**Strains Principle 10** (don't add a name without paying for it): "Leftovers" is one
new user-facing name, paid for by retiring five (*Slate*, *Pull*, *Shape*, *Slot the
projects*, *Slot the work*) and by being a step rather than a pool.
→ Also fixed on the way: the `?planweek` harness crashed on open (its rows called
`useVertical` outside a provider), so the step components are now fully prop-driven;
and the phone's "group carried work into blocks" action was a 14px tap target.
→ Left open: the ceremony's *doc* name is still **Sunday** while every surface says
**Plan the week**. Flagged in [`glossary.md`](./glossary.md), not decided here.
*Status: standing — typechecks, builds, and driven at 375px and desktop density in the
`?planweek` harness; **not yet driven in a real account** (no credentials in the build
environment), so W1/W2 stay scored as they were.*

---

## 2 · Things we decided **not** to do

| # | The idea | Why not | Would change if… |
|---|---|---|---|
| **N-01** | Auto-schedule the day (Motion-style) | Removes the judgment the product exists to build; when it's wrong you have no model of why | Never — this is identity, not a feature gap |
| **N-02** | Multi-**player**: shared funnels, assignees, someone else's dashboard | Consensus objects blunt every altitude (D-003). ⚠️ **Not** an argument against multi-tenancy — that's D-024, and it's a yes | A separate product, not this one |
| **N-03** | A separate "event" entity for scheduled tasks | Doubles every sync path (D-001) | Never |
| **N-04** | Streaks, scores, karma, debt ledgers | Serves *optimizer*; we serve *steward* | Never |
| **N-05** | Notion-style databases / custom fields | A blank canvas is a product you have to finish | Never |
| **N-06** | A fifth pool | The funnel's power is its small vocabulary (Principle 10) | Two independent instances prove the need |
| **N-07** | Push notifications for planning nudges | The app reports, you decide (Principle 4) | Time-critical *now* signals only, opt-in |
| **N-08** | A native watchOS app for capture | Shortcuts → the `agent` endpoint already works on every watch, today, with dictation ([`APPLE_WATCH.md`](../APPLE_WATCH.md)) | We want a complication or an offline queue |
| **N-09** | Extracting `packages/design` fully now | Stub is enough while there are two consumers | A third consumer appears |
| **N-10** | Folding marketing into the SPA | D-018 | Never |

---

## 3 · Open questions (decide these deliberately)

| # | Question | Why it matters | Blocked on |
|---|---|---|---|
| **Q-01** | ~~Does mobile get the vertical?~~ **Partly answered by D-030 and D-031** — the phone gets the *planning* surfaces (the decks, editable), the light records, and now the weekly ritual (Plan the week). Still open: does it get **grooming** — shaping one project to ready (the Groom deck / `ItemRun`) — or does shaping stay a desktop act? | Decides whether the phone can answer W5/Q1, or stays an execution surface | A real read on where grooming actually happens |
| **Q-02** | Is *refusal* a first-class act at Summit — an explicit "not this quarter" object? | Q6 in the Question Ledger is ◐ because there's nowhere to put a no | Wanting a "refused bets" surface at all |
| **Q-03** | Does non-calendar work become visible via activity sources beyond GitHub? | W8 ("where did my time go") is ◐ while shipped-but-unblocked work is invisible | The GitHub instance proving the pattern |
| **Q-04** | Should `TendingFlow` be retired now the Refine run has proven out? | Two grooming paths is a Principle 11 violation waiting to happen | Refine run confidence on real data |
| **Q-05** | What is the transitional CTA on the marketing site? | Currently direct CTA only — the biggest funnel gap (brandscript §5) | Picking one and writing it |
| **Q-10** | Two first-run surfaces now exist — the **Orientation** tour (8 steps, teaches the app) and the **domain picker** (collects what you carry). Do they compose, merge, or does one go? | Principle 8 (one surface, one question) and Principle 11. They're currently sequenced picker → tour, which is defensible — *collect, then teach* — but nobody has watched a stranger go through both back to back | Driving the pair in a fresh account |
| **Q-07** | Where do timezone and working hours come from for a new account? | Rollover is LA-anchored and hours default to 480/990. Both are silent wrongness for anyone else — and capacity math depends on them | Reading how the rollover cron and `user_settings` actually resolve per user |
