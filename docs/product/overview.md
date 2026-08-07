# Nuvo — Product overview (the canon)

**Status:** canonical · maintained continuously · last reviewed 2026-07-25
**Authority:** this file wins over any spec in `docs/`. If a spec contradicts it, the spec is
stale or the canon needs an explicit change (log it in [`decisions.md`](./decisions.md)).

> **The one-liner.** *Nuvo is the one funnel from the things you're responsible for, down
> to the hour on your calendar — so a week of being busy is never mistaken for a week of
> being present.*

---

## 1 · What Nuvo is (facts, not slogans)

1. A **personal daily planner** — GTD-style inbox, tasks, and every calendar you own on
   one planning surface, with drag-and-drop time blocking. **One person's funnel per
   account** (see §2.1).
2. A **vertical**: Domain → Initiative → Project → Week → Day. The thing nobody else joins.
3. **Phase 1 of LifeOS.** The daily driver that replaces Akiflow.
4. **A paid subscription** — 14-day no-card trial, then $29/mo or $19/mo annual, per
   account. Nuvo is sold, not shared: the business model *is* single-player.
5. **One React SPA, two shells** — a Tauri macOS app and an installable iOS PWA from the
   same `dist/`.
6. **An assistant that proposes, never promotes.** Nuvo drafts into quiet pools; only the
   human moves work toward the calendar.

## 2 · What Nuvo is not (the non-goals)

These are not "not yet." They are **refusals**, and they are load-bearing — most of the
product's coherence comes from what it declines to be.

| Not | Because |
|---|---|
| A **team** tool | Shared objects are the problem: assignees, statuses, and permissions force consensus, and every altitude gets blunter to accommodate it. **Many accounts, yes. Many people inside one funnel, no.** |
| A **Notion / second brain** | Nuvo is about *what happens next Tuesday*, not about knowledge. No wiki, no databases-as-a-service, no blank canvas. |
| **"AI that runs your life"** | Auto-scheduling that owns your day removes the one thing the product is trying to build: your own judgment, informed. Nuvo composes a week *for you to accept*. |
| A **habit / streak tracker** | Debt ledgers and streaks shame. The app reports; it never nags. |
| A **generic project manager** | Boards stop at the board. Nuvo's whole claim is that a project lands on the hour. |
| A **CRM, notes app, or email client** | Adjacent, tempting, and out of scope for Phase 1. |

### 2.1 · Tenancy — single-**player**, multi-**tenant**

These get conflated constantly, and conflating them costs us either the market or the
product. Keep them apart:

| | Meaning | Our position |
|---|---|---|
| **Multi-tenant** | Many independent accounts on one deployment, each isolated | **Yes** — and now commercially load-bearing: each account is a paying customer. Every account is one person's funnel; RLS is the boundary. |
| **Multi-player** | Several people inside one funnel — assignees, shared projects, permissions, statuses others update | **No.** This is the refusal. It's what would blunt the altitudes. |

The refusal that carries the product's coherence is **single-player**, not "one user in the
database." Nothing about serving ten thousand operators requires any of them to share a
project — and none of the arithmetic (pace, demand ÷ capacity, calibration) works if a
task's progress depends on someone else's update.

**What this means in practice:** every doc in this folder must read as true for *any*
operator, not for the person who built it. A design that only works because the author
knows their own domains, timezone, or habits is a bug — see Principle 16.

## 3 · The core model

**A scheduled task IS a time block.** One row in `tasks`:

| `do_date` | `start_time` | Means |
|---|---|---|
| null | null | Unplanned — lives in a pool |
| set | null | Planned for the day, unblocked |
| set | set | Scheduled on the calendar — *this row is the block* |

There is **no separate event entity for tasks.** Everything downstream — rollover, the
mirror calendar, capacity math, the Review's evidence — is cheap because of this one
decision. Protect it.

### Four pools, one gate

```
inbox  →  backlog  →  WEEK  →  Day
(raw)     (processed,  (the only    (do_date,
          undated)      gate)        optionally a block)
```

- **inbox** — raw captures. Never planned from directly.
- **backlog** — processed and *deliberately undated*. Project and initiative work lives
  here. Never on Today, never rolled.
- **Week** — a `sprints` row; tasks point at it via `sprint_id`. **The only gate between
  the vertical and the calendar.** Nothing reaches the day without passing through a week
  you committed to.
- **Day** — `do_date`, optionally a block.

### The five altitudes

| Altitude | Answers | Kept alive by |
|---|---|---|
| **Domain** | Where have I committed to keep showing up and producing? | Summit (quarterly) |
| **Initiative** | What big outcome is this quarter for? | Summit · Blueprint |
| **Project** | What finite thing gets finished? | On Deck · the Refine run |
| **Week** | What am I actually carrying? | Sunday (compose) · the Review (close) |
| **Day** | What am I doing right now? | Sunrise · Sundown |

Every ceremony's output is **readiness for the floor below.** That is the whole machine.

## 4 · Why it exists — the split

Two halves of a life-in-motion never touch:

- **The vertical** knows *what matters and why.* It's measured in **deadlines**.
- **The planner** knows *what you're doing.* It's measured in **hours**.

With no shared currency, *"am I over-committed?"* has no honest answer, and the important
project quietly dies in a board while your Tuesday fills with the reactive. Nuvo's bridge
is the conversion in [`commitment-model.md`](../commitment-model.md):

```
required pace = remaining effort ÷ weeks until target
Commitment    = Σ required pace ÷ real available hours
```

That single conversion puts the portfolio and the week in the same unit. **It is the most
important idea in the product.** Anything that makes effort or capacity less trustworthy
attacks the core.

## 5 · Where we are (2026-07)

Statuses are owned by each spec's own header — this is a map, not the source of truth.

**Shipped:** capture + NLP parsing · drag-and-drop blocking · Google (two-way + "Nuvo"
mirror) / M365 (read) / iCloud (two-way CalDAV) / ICS · rollover · domains, initiatives,
projects on live rows · the Week gate · Sunday compose + calibration · Sunrise / Sundown ·
the Nuvo assistant (scaffold / blueprint / prepare / narrate) · Marquee · recurrence ·
slots · the **Review** with evidence + the Find · the **Refine run** (phone-first) ·
**On Deck** · **Stripe subscriptions** (trial → paywall → upgrade) · **Orientation** (the
8-step first-run tour) · native Mac download + auto-update.

**Spec, not fully built:** grooming lenses (What / How / In the way) · loose weeks ·
project slots · standing slots (partially landed) · activity sources (GitHub) · Apple Watch
capture.

**Tenancy state — honest read (updated 2026-07-26).** The architecture was always
multi-tenant (Supabase Auth + RLS per user). The product now is too: **billing, a 14-day
trial, a paywall, and an 8-step orientation tour shipped on master.** What's left is the
long tail of defaults that still encode the builder's life. Known gaps:

- ~~New-user seeding creates **four fixed domains**~~ — **fixed (D-026).** Signup seeds
  none; a first-run picker offers the five domain kinds and the account names its own.
- Working hours default to 480/990; timezone logic is anchored to America/Los_Angeles in
  rollover scheduling.
- ~~Signup is expected to be closed after the first account exists~~ — **resolved.** Signups
  must stay open; Nuvo sells subscriptions, so anyone who can't sign up can't become a
  customer.
- Beyond the domain picker there is still no cold-start path: the first *week* in a
  brand-new account is unproven, which collides head-on with Principle 7. The first-value
  moment is now named (D-028) but nothing is built against it.

*None of this is hard to fix. All of it is invisible until someone who isn't you signs up.*

## 6 · How we know it's working

**Per account — the signals that matter.** A personal planner has no meaningful DAU; being
*in* the app is not the goal. These should be *derivable from data we already have*, not
new instrumentation.

| Signal | Healthy | What it means when it rots |
|---|---|---|
| **Week composed** | every Sunday | The gate is being bypassed; the day is running the week |
| **Roll rate** (`roll_count`) | low and falling | The week was over-committed, or blocks are fiction |
| **Commitment ratio** | 0.7–1.0 | >1.0 = lying to yourself on Sunday; <0.7 = a bet isn't being pulled |
| **Backlog age** | bounded | Work is being captured but never groomed — the funnel is clogged |
| **Domain showing up** | no domain dark for a quarter | One world is eating the others (it's usually Family) |
| **Capture → structure latency** | minutes | Capture works; routing doesn't |
| **Review completed** | weekly | Nothing is closing the loop; Sunday starts cold |
| **Prepared blocks used** | rising | The assistant is helping at the moment of work, not just at planning time |

If a proposed feature can't move one of these, say out loud what it *is* for.

**Across accounts — the multi-tenant read.** Once there's more than one operator, a second
set of questions becomes answerable, and they're the ones that tell us whether the *product*
works or just *our* instance of it:

| Signal | Why it's the honest one |
|---|---|
| **Activation** — % of new accounts that compose a first week | The whole product is downstream of the gate. If they never compose, nothing else matters. |
| **Second week** — % that compose a *second* | The single best predictor. Week one can be curiosity; week two is a decision. |
| **Time to first block** | Measures whether the cold start works for a stranger. Ours is unmeasured. |
| **Weeks-composed streak distribution** | Not shown to users (Principle 9) — this is *our* instrument, not their scoreboard. |
| **Domains configured ≠ 4 defaults** | Direct evidence that the seeded template is a starting point, not an imposition. |
| **Review completion rate** | Whether the loop actually closes for people who aren't the author. |

**Rule:** these are aggregate and internal. Nothing here becomes a user-facing number, a
streak, or a nudge — that would violate Principles 4 and 9. We measure so we can build; the
operator is never told how they score.

## 7 · Scope boundary — Phase 1 of LifeOS

Phase 1 ends when a full quarter can be run end-to-end without leaving Nuvo: a Summit sets
initiatives, Blueprint builds the subtrees, On Deck + Refine keep projects ready, Sunday
composes a week the calibration says you can carry, the day gets executed, and the Review
proves what moved — **and a stranger can do all of that in a fresh account without
being told how.** That last clause is new, and it is the multi-tenant bar: the product
isn't done when it works for its author. **Everything else is Phase 2.** Write it down in
[`roadmap.md`](./roadmap.md) → *Parked*; don't build it.

---

**See also:** [`principles.md`](./principles.md) (the rules) ·
[`brandscript.md`](./brandscript.md) (the story) · [`personas.md`](./personas.md) (who and
their questions) · [`landscape.md`](./landscape.md) (the field) ·
[`glossary.md`](./glossary.md) (what we call things).
