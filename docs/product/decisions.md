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
  (Work / Church / Trading / Family) stop being a convenience and become a claim about the
  user's life. They must become a named-by-the-account template (Q-06).
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

**D-025 · 2026-07-25 · Persona zero is evidence, not the definition.** The builder is a
verified instance of P1, cited as ⓞ; the archetype is what we design against.
→ Instance-level details are examples, never defaults (Principle 16). Claims marked ⓞ are
**unvalidated beyond N=1** and get tested against real operators two and three.
*Status: standing.*

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
| **Q-01** | Does mobile get the vertical (floors, records), or stay capture + agenda + Refine? | Decides whether the phone can answer W5/Q1, or stays an execution surface | A real read on where grooming actually happens |
| **Q-02** | Is *refusal* a first-class act at Summit — an explicit "not this quarter" object? | Q6 in the Question Ledger is ◐ because there's nowhere to put a no | Wanting a "refused bets" surface at all |
| **Q-03** | Does non-calendar work become visible via activity sources beyond GitHub? | W8 ("where did my time go") is ◐ while shipped-but-unblocked work is invisible | The GitHub instance proving the pattern |
| **Q-04** | Should `TendingFlow` be retired now the Refine run has proven out? | Two grooming paths is a Principle 11 violation waiting to happen | Refine run confidence on real data |
| **Q-05** | What is the transitional CTA on the marketing site? | Currently direct CTA only — the biggest funnel gap (brandscript §5) | Picking one and writing it |
| **Q-06** | What replaces the four seeded domains? | Today a new account is handed one operator's life as fact (Principle 16, ledger O2). Options: pick-from-kinds, name-your-own, or start empty with one example | Deciding how much structure a stranger needs on day one |
| **Q-07** | Where do timezone and working hours come from for a new account? | Rollover is LA-anchored and hours default to 480/990. Both are silent wrongness for anyone else — and capacity math depends on them | Reading how the rollover cron and `user_settings` actually resolve per user |
| **Q-08** | Does the "called to be faithful" register stay, soften, or become selectable? | Domain's definition is currently religious in register. Beloved by P3, potentially alienating to P2. **Narrow-and-beloved vs. broad-and-blander is a positioning fork, not a copy tweak** | Wanting to know; testable with operators two and three |
| **Q-09** | What is the first-value moment for a stranger (ledger O6)? | We can't design onboarding without naming the 5-minute win. Candidate: *capture three things and see them land on a real calendar* | Picking it |
