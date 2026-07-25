# Personas & the Question Ledger

**Status:** canonical v1 (2026-07-25) · **drafted from repo evidence — correct anything
that's wrong about you.** A persona you didn't verify is fiction with a headshot.

Two things live here:

1. **§1–4 · The people** — who Nuvo is for, and (just as important) who it is *not* for.
2. **§5 · The Question Ledger** — the questions actually on their minds, mapped to where
   Nuvo answers them and how honestly. **This is the most useful artifact in `docs/product/`.**
   It's the input to every ideation session and the spine of the [audit](./audit.md).

---

## 1 · P1 — The Multi-Domain Operator *(primary; this is Phil)*

> *"I don't need to do more. I need to stop losing the important thing to the urgent one —
> in four different worlds at the same time."*

**Shape of the life.** Four standing domains, each with real obligations, none of which can
be deferred indefinitely:

| Domain | What it demands | How it fails |
|---|---|---|
| **Work** | teams, a roadmap, meetings that fill the calendar by default | Eats every open hour. Wins by default because it's loudest. |
| **Church** | a season, volunteers, Sunday is a hard deadline every week | Non-negotiable dates with no project plan behind them. |
| **Trading** | market hours, review, discipline | Needs *protected recurring time*, not tasks. Dies first when work surges. |
| **Family** | a calendar that doesn't care about your sprint | Never generates a ticket, so it never enters the system — and gets starved silently. |

**A week in the life.** Sunday night he decides. Monday a work escalation eats the deep
block. Wednesday someone mentions a thing in Slack that becomes a promise. Thursday church
needs an answer by Sunday. Friday he can't tell whether the quarter's initiative moved at
all. Saturday he feels vaguely behind on everything and specifically behind on nothing.

**What he's tried, and why each fell short:**

| Tool | What it gave him | Where it broke |
|---|---|---|
| **Akiflow** | Excellent capture + time-blocking. The daily driver. | The week is all there is. No altitude above it — a project can't be *on pace* or *behind*. |
| **Sunsama** | Deliberate daily planning ritual | Same ceiling; and the ritual costs more than it returns when the week is chaotic. |
| **Notion / boards** | Somewhere to hold projects | Work goes in and never comes out onto a Tuesday. The board is a graveyard with good UI. |
| **Calendars alone** | Truth about meetings | Nothing about intent. Your priorities aren't on it, so they don't happen. |

**Emotional truth.** Competent, not overwhelmed — which is exactly why the failure mode is
invisible. He can hold it all *this* week. He can't hold it all *this quarter*, and nothing
tells him which one he's in.

**Success for him:** Sunday takes 20 minutes and ends with a week he believes. Friday takes
10 and ends with proof. No domain goes dark for a quarter without him deciding it.

**Anti-features for him:** anything that adds a place to check, requires clean data to be
useful, or nags.

---

## 2 · P2 — The Founder-Operator *(secondary)*

Runs a company and their own life with the same brain. Their domains are *Company · Product
· Sales · Self*, and the split is the same: strategy lives in a doc, execution lives in a
calendar, and the two only meet at a board meeting.

**Different from P1:** more comfortable with dashboards and metrics; more likely to want
delegation and shared visibility (which we refuse — see [`overview.md`](./overview.md) §2).
**Same as P1:** the untouched-important-project problem is identical.

**Why they matter:** they validate the commitment model outside a ministry/family context.
**Why they're secondary:** the pull toward multi-user is strong, and following it would
break the product.

---

## 3 · P3 — The Steward *(secondary)*

Ministry, nonprofit, or community lead. Hard recurring deadlines (Sunday, the event, the
season), volunteer labor they can't assign work to, and a strong sense that the work is a
calling rather than a job.

**Different from P1:** the vocabulary of *faithfulness*, *domain*, and *gain* lands
immediately and literally — this persona is why that language is in the product and should
stay there. Lower tolerance for anything that feels like corporate productivity theater.

---

## 4 · Anti-personas — who we will disappoint on purpose

| Anti-persona | What they'd ask for | Why we say no |
|---|---|---|
| **The team PM** | assignees, statuses, sprint boards, shared views | Multi-user forces consensus objects; every altitude gets blunter. |
| **The automation maximalist** | "just have AI schedule my whole day" | Removes the judgment the product exists to build. Nuvo proposes, you promote. |
| **The quantified-self collector** | streaks, scores, time-tracking rollups | Serves *optimizer*, not *steward*. Debt ledgers shame. |
| **The blank-canvas builder** | databases, custom fields, formulas | That's Notion. Nuvo has opinions on purpose. |
| **The task minimalist** | just a pretty checklist | Things 3 is better at this and cheaper. Don't compete there. |

Saying no to these is not a gap. It's the product.

---

## 5 · The Question Ledger

*The questions actually in the operator's head, by cadence. Column 3 is where Nuvo answers
it today; column 4 is how honestly.*

**Legend:** ✅ answered well · ◐ partial (answer exists but is hidden, manual, or requires
clean data) · ○ unanswered · ✳ answered by a spec that isn't built.

### Daily — *"what do I do right now?"*

| # | The question | Where Nuvo answers it | Honesty |
|---|---|---|---|
| D1 | What's the one thing today that actually matters? | Sunrise · Today list · Now | ✅ |
| D2 | What's already decided so I don't have to re-decide it? | Sunday-composed blocks | ✅ |
| D3 | I have 40 minutes — what fits? | availability gaps (`readDay` / `toBusyBlocks`) | ◐ *gap→task matching is manual* |
| D4 | What did I say I'd do and haven't? | rollover ↻ badge · overdue pinning | ✅ |
| D5 | Who is waiting on me? | — | ○ *no waiting-on/blocked-by surface; "In the way" lens is spec* |
| D6 | I just thought of something — where does it go so I stop holding it? | capture (⌘K / ⌥Space / voice) | ✅ |
| D7 | Did I actually finish, or just move it? | Sundown · completed blocks | ✅ |

### Weekly — *"am I carrying the right week?"*

| # | The question | Where Nuvo answers it | Honesty |
|---|---|---|---|
| W1 | Can I actually carry this week? | Commitment (demand ÷ capacity) + calibration | ✅ **the flagship answer** |
| W2 | If I only get three real hours, where do they go? | Priorities + Sunday pull | ◐ *ranking is implicit* |
| W3 | What should I drop, and what breaks if I do? | — | ○ *no consequence-of-cutting view* |
| W4 | Is it safe to say yes to this new thing? | Commitment ratio (indirectly) | ◐ *no "what would this cost me" simulation* |
| W5 | Which domain am I starving? | Domain floor · invested/quarter | ◐ *visible if you go look; nothing surfaces it* |
| W6 | Did anything move this week, or was I just busy? | **the Review** + evidence + the Find | ✅ |
| W7 | What's carrying over, and is that a pattern? | Review → back to week · `roll_count` | ◐ *pattern detection only via the Find* |
| W8 | Where did my time actually go? | completed blocks · activity sources | ◐ *actuals from calendar; non-calendar work invisible (spec)* |

### Project / quarterly — *"is the important thing alive?"*

| # | The question | Where Nuvo answers it | Honesty |
|---|---|---|---|
| Q1 | Is this project on pace, or quietly dying? | pace / required-rate math · On Deck | ✅ |
| Q2 | What's going to collide three weeks out that I can't see? | **On Deck** timeline | ✅ |
| Q3 | What does "done" even mean here? | grooming *What* lens | ✳ *spec* |
| Q4 | What are the actual steps? | Blueprint · scaffold · *How* lens | ◐ *AI scaffold ships; the lens is spec* |
| Q5 | What's stuck, waiting, or dependent? | *In the way* lens | ✳ *spec* |
| Q6 | Which bets do I pull this quarter, and which do I refuse? | Summit → Vows → Portfolio | ◐ *refusal isn't a first-class act* |
| Q7 | Am I being faithful in what I've been given? | Domain wall / chapel | ◐ *the philosophical question — deliberately gentle* |

### Ambient dread — *the questions that wake you up*

| # | The question | Where Nuvo answers it | Honesty |
|---|---|---|---|
| A1 | What am I forgetting? | inbox = one place, nothing lost | ✅ |
| A2 | What's about to blow up? | On Deck collisions · deadline-first compose | ◐ |
| A3 | Is there a promise I made that's nowhere in the system? | — | ○ *the hardest one; capture only catches what you remember to capture* |
| A4 | Am I lying to myself about this week? | calibration (planned vs proven) | ✅ **rare and valuable — protect it** |

### How to use this ledger

- **Ideating?** Start from an ○ or ◐ row, not from a feature idea. A feature that closes
  D5, W3, or A3 beats a feature that polishes an already-✅ row.
- **Auditing?** Re-score every row against the *running app* (not the specs). Rows that
  slipped from ✅ to ◐ are regressions nobody filed a bug for.
- **Reviewing a proposal?** If it maps to no row, either add the row (with evidence that a
  human actually asks it) or don't build it.
- **Keep it honest.** ✅ means *answered in the app, in under ~15 seconds, without clean
  data as a precondition.* If it needs a groomed backlog to work, it's ◐.

---

## 6 · Jobs to be done — the switch from Akiflow

The forces acting on the moment of change (Bob Moesta's framing). Useful because our user
*already switched*, so we can be precise.

**Push** (what makes the old way intolerable)
- The week is the ceiling. A project can't be "behind."
- Committing to a week is a guess; nothing checks it against reality.
- Domains other than work never enter the system, so they starve invisibly.

**Pull** (what attracts them to Nuvo)
- One funnel from calling to calendar.
- An honest answer to *"can I carry this week?"*
- A Friday that produces evidence instead of a feeling.

**Anxiety** (what makes switching scary) — *design against these directly*
- "Migrating years of tasks." → Capture is cheap; don't require a migration.
- "Another system I'll abandon in three weeks." → The app must be useful on day one with
  an empty backlog. **This is the strongest argument against anything that requires clean
  data to be valuable.**
- "It'll nag me." → Quiet by default, always.

**Habit** (what holds them to the old way)
- Muscle memory on shortcuts → keep the keyboard model familiar (`⌘K`, `⌥Space`).
- Trust in the calendar → the mirror calendar means their phone still shows the truth.

**The job, stated once:**

> *When I'm carrying several worlds at once and I can't tell whether the important things
> are moving, help me commit to a week I can actually carry and prove at the end of it what
> moved — so I can be faithful in what I've been given instead of just busy.*
