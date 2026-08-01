# Personas & the Question Ledger

**Status:** canonical v2 (2026-07-25) · **archetypes, not one person.** A persona you
didn't verify is fiction with a headshot.

Two things live here:

1. **§1–4 · The people** — who Nuvo is for, and (just as important) who it is *not* for.
2. **§5 · The Question Ledger** — the questions actually on their minds, mapped to where
   Nuvo answers them and how honestly. **This is the most useful artifact in `docs/product/`.**
   It's the input to every ideation session and the spine of the [audit](./audit.md).

### On persona zero, and the N=1 risk

Nuvo is built by one of its users. That's a real advantage — the taste and the problem
diagnosis are first-hand, not focus-grouped. It's also the product's biggest research risk,
and it gets worse the moment there's a second account.

So we hold two things apart:

- **Persona zero** (the builder) is *evidence* — a detailed, verified instance of P1. Cite
  it as such: *"persona zero runs Work / Church / Trading / Family."*
- **The archetype** is the *definition*, and it has to be true for operators whose worlds
  are named nothing like that.

**The discipline:** whenever a persona detail is specific enough to design against, ask
whether it's archetypal or just persona zero's instance. Instance-level details make great
*examples* and terrible *defaults* (Principle 16). Every claim below marked ⓞ comes from
persona zero and is **unvalidated beyond N=1** — treat those as hypotheses to test with the
second and third real operator, not as findings.

---

## 1 · P1 — The Multi-Domain Operator *(primary)*

> *"I don't need to do more. I need to stop losing the important thing to the urgent one —
> in several different worlds at the same time."*

**Shape of the life.** Three to five **standing domains** — areas of perpetual
responsibility, not projects — each with real obligations, none deferrable indefinitely.
The *names* vary wildly between operators; the **kinds** and their failure modes don't.
That's what we design against:

| Domain kind | What it demands | How it fails | Instances |
|---|---|---|---|
| **The paid work** | teams, a roadmap, meetings that fill the calendar by default | Eats every open hour. Wins by default because it's loudest and has other people enforcing it. | job · company · practice · clients |
| **The committed community** | a season, other people depending on you, recurring hard dates | Non-negotiable deadlines with no project plan behind them. | church · nonprofit board · coaching · volunteering |
| **The discipline** | protected recurring time; consistency matters more than output | Needs *time*, not tasks — so a task-shaped tool can't hold it. Dies first when work surges. | trading · training · writing · a craft · study |
| **The relational** | presence, on a calendar that doesn't care about your deadlines | Never generates a ticket, so it never enters the system, and gets starved **silently** — the failure nobody notices until it's expensive. | family · marriage · aging parents · friendship |
| **The stewardship** *(often implicit)* | periodic attention, high cost of neglect | Invisible until a deadline or a mistake. | finances · health · home · admin |

> **Design consequence — now built (D-026).** These are *kinds*, so the app never assumes
> names. Persona zero's instance is Work / Church / Trading / Family ⓞ, which is exactly why
> the old four-domain seed was a Principle 16 violation rather than a helpful head start.
> Signup now seeds nothing and the first-run picker offers these five kinds with examples,
> each named by the account. The *discipline* and *relational* kinds are deliberately
> first-class there — they're the two every task-shaped competitor drops.

**A week in the life.** Sunday night they decide. Monday a work escalation eats the deep
block. Wednesday someone mentions a thing in passing that becomes a promise. Thursday the
community commitment needs an answer by the weekend. Friday they can't tell whether the
quarter's initiative moved at all. Saturday they feel vaguely behind on everything and
specifically behind on nothing.

**What they've tried, and why each fell short** *(the specific tool history is ⓞ; the
ceilings are structural and generalize):*

| Tool | What it gave him | Where it broke |
|---|---|---|
| **Akiflow** | Excellent capture + time-blocking. The daily driver. | The week is all there is. No altitude above it — a project can't be *on pace* or *behind*. |
| **Sunsama** | Deliberate daily planning ritual | Same ceiling; and the ritual costs more than it returns when the week is chaotic. |
| **Notion / boards** | Somewhere to hold projects | Work goes in and never comes out onto a Tuesday. The board is a graveyard with good UI. |
| **Calendars alone** | Truth about meetings | Nothing about intent. Your priorities aren't on it, so they don't happen. |

**Emotional truth.** Competent, not overwhelmed — which is exactly why the failure mode is
invisible. They can hold it all *this* week. They can't hold it all *this quarter*, and
nothing tells them which one they're in.

**Success for them:** Sunday takes 20 minutes and ends with a week they believe. Friday
takes 10 and ends with proof. No domain goes dark for a quarter without them deciding it.

**Anti-features for them:** anything that adds a place to check, requires clean data to be
useful, or nags.

**What varies across instances of P1** — the axes to hold loosely until real operators
tell us otherwise: how many domains (3–5), whether the paid work is employment or their own
company, whether the *discipline* domain exists at all, how much of the week is
meeting-bound (this drives capacity math hard), and how religiously they'd actually do a
Sunday ritual. **Every one of these is currently a hypothesis with N=1.**

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
vocation rather than a job.

**Different from P1:** the vocabulary of *faithfulness*, *stewardship*, and *gain* lands
immediately and literally. Lower tolerance for anything that feels like corporate
productivity theater.

> **Register — resolved (D-027).** Nuvo's convictions are Christian; **its vocabulary
> isn't, and you don't have to be to use it.** Explicit language ("where you are *called*
> to be faithful") is out. Tangential language — *steward · faithful · vow · gain ·
> discipline* — stays, because it carries the moral seriousness the product actually runs
> on, and every one of those words is fully usable by someone who shares none of the
> convictions. **The excellence is the witness; the copy doesn't have to be.** P3 still
> gets a product whose weight they recognize; P2 is never asked to adopt a stance.

---

## 4 · Anti-personas — who we will disappoint on purpose

| Anti-persona | What they'd ask for | Why we say no |
|---|---|---|
| **The team PM** | assignees, statuses, sprint boards, shared views | Shared objects force consensus; every altitude gets blunter. *Not a tenancy limit — see [`overview.md`](./overview.md) §2.1.* |
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
| D8 | Getting this on the calendar means three messages and a guess — can you just set it up with them? | **Nuvo chat → the invite card** (resolve who from contacts, stage, one tap to send) · the composer's guest picker | ◐ *new row 2026-08-01 (D-069). The scheduling half is answered — a name becomes a person, the event and the invite go out on one tap, and two Matts get asked about instead of guessed. Deliberately ◐, not ✅: it is **not yet deployed**, nobody has staged an invite from a live chat turn, and the thread it's usually replying to still has to be pasted or screenshotted in — Nuvo reads it, it doesn't live there.*

### Weekly — *"am I carrying the right week?"*

| # | The question | Where Nuvo answers it | Honesty |
|---|---|---|---|
| W1 | Can I actually carry this week? | Commitment (demand ÷ capacity) + calibration | ✅ **the flagship answer** |
| W2 | If I only get three real hours, where do they go? | Priorities + Sunday pull · **the Week's Plan's placed-vs-loose line** | ◐ *re-scored 2026-07-30 (D-060): each project now says how much of what's left has a time and how much is loose, which is the raw material for the answer — but nothing **ranks** them, so it stays ◐* |
| W3 | What should I drop, and what breaks if I do? | Plan the week's span remedies · **the same acts on each Week's Plan row** | ✅ *re-scored 2026-07-30. D-039 (2026-07-27) claimed to close this and the table was never updated — a stale ○. D-060 also lifted the remedies out of Sunday, so the question is answerable mid-week, which is when it's actually asked.* |
| W4 | Is it safe to say yes to this new thing? | Commitment ratio (indirectly) | ◐ *no "what would this cost me" simulation* |
| W5 | Which domain am I starving? | Domain floor · invested/quarter · **the Week's Plan conscience read** | ◐ *re-scored 2026-07-30 (D-061): it is now **surfaced unasked** on a week that can still change, in plain language. Deliberately still ◐, not ✅ — the read names the quiet domain and hands nothing forward, because a "flag it for next week" button has no reader (D-062). It goes ✅ when the act exists with its reader.* |
| W6 | Did anything move this week, or was I just busy? | **the Review** + evidence + the Find | ✅ |
| W7 | What's carrying over, and is that a pattern? | Review → back to week · `roll_count` | ◐ *stays ◐. Carrying is at least **honest** now (2026-07-30, D-060): the old "Carry to next week" wrote a rock into a week whose slate is derived from spans, so it did nothing at all; it's a real span write. Pattern detection is still only the Find.* |
| W8 | Where did my time actually go? | completed blocks · activity sources | ◐ *actuals from calendar; non-calendar work invisible (spec)* |

### Project / quarterly — *"is the important thing alive?"*

| # | The question | Where Nuvo answers it | Honesty |
|---|---|---|---|
| Q1 | Is this project on pace, or quietly dying? | pace / required-rate math · On Deck | ✅ |
| Q2 | What's going to collide three weeks out that I can't see? | **On Deck** timeline | ✅ |
| Q3 | What does "done" even mean here? | the **record's lead line** · Groom deck *Brief* lens | ✅ *re-scored 2026-07-29 (D-050): the outcome sits directly under the name, and when empty it asks the question. Was ✳ against a spec that had since shipped.* |
| Q4 | What are the actual steps? | the **record's Tasks hero** · *Path* lens · AI scaffold | ◐ *re-scored 2026-07-29: the Path lens shipped and the steps are now the record's hero (`t` to add), but an empty project still leans on AI to get its first list* |
| Q5 | What's stuck, waiting, or dependent? | *In the way* lens | ✳ *spec* |
| Q6 | Which bets do I pull this quarter, and which do I refuse? | Summit → Vows → Portfolio | ◐ *refusal isn't a first-class act* |
| Q7 | Am I being faithful in what I've been given? | Domain wall / open domain | ◐ *the philosophical question — deliberately gentle* |

### Ambient dread — *the questions that wake you up*

| # | The question | Where Nuvo answers it | Honesty |
|---|---|---|---|
| A1 | What am I forgetting? | inbox = one place, nothing lost | ✅ |
| A2 | What's about to blow up? | On Deck collisions · deadline-first compose | ◐ |
| A3 | Is there a promise I made that's nowhere in the system? | — | ○ *the hardest one; capture only catches what you remember to capture* |
| A4 | Am I lying to myself about this week? | calibration (planned vs proven) | ✅ **rare and valuable — protect it** |

### Arrival & trust — *the questions a stranger asks*

These only exist once the account isn't yours. Persona zero never asks them, which is
exactly why they're all unanswered — nobody in the building has ever needed an answer.

| # | The question | Where Nuvo answers it | Honesty |
|---|---|---|---|
| **O1** | What is this, and what do I do first? | the **Orientation fork** — *Show me around* (visual tour) or *Walk me through it* (live, docked panel over the real app) | ✅ *re-scored 2026-07-30 (D-059). Driven in the dev app on both shells. "What do I do first" is now literally the first step, and the live door hands you the act instead of describing it.* |
| **O2** | These aren't my domains — how do I make them mine? | **first-run picker** (`FirstRun.tsx`) — five kinds, named by you | ✅ *D-026. Unverified against a running app — see the note below.* |
| **O3** | Do I have to connect a calendar before this is useful? | — | ○ *the whole capacity model degrades silently without one; nothing says so* |
| **O4** | Who can see my calendar and my work? | — | ○ *no privacy surface. Single-player is a **selling point** we never state.* |
| **O5** | What happens if I fall off for two weeks? | rollover · backlog stays undated | ◐ *the model handles it well; nothing reassures you it will* |
| **O6** | Is this worth the setup before I trust it with my week? | the walkthrough's live door — capture → block → project → ask Nuvo, each in the real app | ◐ *re-scored 2026-07-30 (D-059): a five-minute win now exists and ends with a non-empty account. Still ◐ because it's opt-in behind a door, and nobody has watched a stranger take it.* |

> **Read this cluster as a block.** These ○s aren't separate features — they're one missing
> thing (a cold start), and that's the difference between multi-tenant *architecture* and a
> multi-tenant *product*. It's also the cheapest cluster on the board: O1/O2/O6 are largely
> copy and a first-run flow, not new mechanism.
>
> **⚠️ O2's ✅ is provisional.** The picker is written, typechecks, and builds — but it has
> **not been driven in a running app**, and the migration behind it has **not been applied**
> to any project. Per the scoring bar, a row isn't honestly ✅ until someone watched it work.
> Re-score this one in the next [stranger pass](./audit.md).

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

The forces acting on the moment of change (Bob Moesta's framing). Reconstructed from
persona zero's switch ⓞ — precise, but **N=1**. The single highest-value research we could
do is a real switch interview with operators two and three; until then, treat the weights
below as hypotheses and the *categories* as sound.

**Push** (what makes the old way intolerable)
- The week is the ceiling. A project can't be "behind."
- Committing to a week is a guess; nothing checks it against reality.
- Domains other than work never enter the system, so they starve invisibly.

**Pull** (what attracts them to Nuvo)
- One funnel from commitment to calendar.
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
