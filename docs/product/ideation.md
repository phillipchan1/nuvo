# Ideation playbook — how we brainstorm without drifting

**Status:** canonical method (2026-07-25)
**The problem it solves:** brainstorming is generative and cheap, which is exactly why it
drifts. Ten good ideas that each strain a different principle add up to a worse product
than three that compound. This is how we stay anchored to the truth in this folder while
still thinking freely.

**The core move:** *diverge without anchors, converge with them.* Anchoring too early kills
the idea; anchoring too late ships the wrong thing.

---

## 1 · The three modes — know which one you're in

| Mode | Goal | Anchors | Output |
|---|---|---|---|
| **Spark** | Get it out of your head | **None.** Judgment off. | A line in the Spark list (§6) |
| **Anchor** | Find out if it's *ours* | All of them (§3) | Anchored idea, or a `no` with a reason |
| **Shape** | Design it properly | The specs in `docs/` | A design proposal doc |

Most bad sessions are a Spark and an Anchor happening at the same time. Say which mode
you're in out loud — including when working with Claude.

## 2 · Before any session — the five-minute prime

Read, in this order (or ask Claude to summarize them back):

1. [`overview.md`](./overview.md) §2 — **what we're not.** Refreshes the refusals.
2. The [Question Ledger](./personas.md#5--the-question-ledger) — especially ○ and ◐ rows.
3. [`decisions.md`](./decisions.md) §2 — **the N-list.** Half of all "new" ideas are here.
4. [`roadmap.md`](./roadmap.md) — what's already in Now.

> **Start from a question, not a feature.** The single highest-leverage habit in this whole
> folder. "How would someone know who's waiting on them?" (D5 ○) produces better ideas than
> "we should add a blocked-by field."

## 3 · The anchor pass — six questions

Run every idea through these before designing anything. Write the answers down; the writing
is the filter.

1. **Whose question?** Which [Question Ledger](./personas.md) row does it close, for which
   persona? *(If none: is this a real question a human asks? Then add the row. If it isn't,
   stop.)*
2. **Which altitude?** Domain · Initiative · Project · Week · Day. If it spans three, it's
   probably several ideas wearing a coat.
3. **Which of the three story steps?** Capture · commit · land ([`brandscript.md`](./brandscript.md) §4).
   A fourth step is a tax on the hero.
4. **Which failure does it prevent?** Name one from brandscript §6. No stakes → it'll feel
   like clutter no matter how well it's built.
5. **Which principle does it strain?** ([`principles.md`](./principles.md).) Most good ideas
   strain one — that's fine. Naming it is not optional.
6. **What does it replace?** New surfaces are a tax. The best ideas *retire* something.

**The three no's** — if any is true, the answer is almost certainly no:

- **It adds a pool.** (Principle 10 · N-06)
- **It adds a name that overlaps an existing one.** (Principle 11)
- **It only works with clean data.** (Principle 7 — the abandonment trap)

## 4 · Idea intake template

Keep it short. If it doesn't fit on a screen, it's a spec, not an idea.

```markdown
### <Name it in the user's words, not the mechanism's>

**Spark:** <the raw thought, one or two sentences>
**Question it closes:** <ledger row, e.g. W3 ○ "what should I drop">
**Altitude:** <Domain / Initiative / Project / Week / Day>
**Story step:** <capture | commit | land>
**Failure it prevents:** <from brandscript §6>
**Principle strained:** <#n, and why it's worth it>
**Replaces:** <what goes away — or "nothing", said honestly>
**Smallest honest version:** <what could exist in a day and still be true>
**Three no's:** pool? name? clean-data? — <no/no/no>
```

## 5 · Spark → shipped: the pipeline

```
Spark list  →  anchor pass  →  design proposal      →  build  →  status update
(§6, cheap)    (§3, 10 min)     (docs/<name>.md)                  (spec header)
                    │
                    └── no →  decisions.md §2, with the reason
```

**Rules:**

- A `no` is **written down** ([`decisions.md`](./decisions.md) §2). An unrecorded no comes
  back every quarter and costs the same conversation again.
- A design proposal lives in **`docs/`** (mechanism), not `docs/product/` (why). It opens
  with a **status line**, a one-paragraph **thesis**, and links to the siblings it builds on
  — match the house style of [`on-deck.md`](../on-deck.md) or
  [`readiness-model.md`](../readiness-model.md), which are the best examples in the repo.
- When it ships, **update the spec's status header the same day** — the roadmap trusts it.
- If it changed what's true, update the canon here too.

## 6 · The Spark list

Uncommitted ideas live at the bottom of this file, not in your head and not in Now. One
line each. No judgment, no ordering, no promises. Prune ruthlessly at each Summit — an idea
that's been sitting for two quarters without pulling at you is a `no` you haven't said yet.

*(Add sparks below. Format: `- <idea> — <the question it might close, if you know>`)*

---

### Sparks

<!-- Add freely. Nothing here is a commitment. -->

- _(empty — start dropping thoughts here)_

---

## 7 · Working with Claude on product thinking

Nuvo's docs are set up so an agent can be a real thinking partner rather than a
suggestion machine. What actually works:

**Say the mode.** *"Spark mode — no anchors, give me twelve angles on X"* produces very
different output than *"Anchor mode — run this through the six questions and try to kill
it."* Without a mode, you get mush.

**Ask for the case against.** The default failure of an LLM in ideation is agreeable
expansion. *"Argue the strongest case that we should NOT build this, citing our own
principles"* is the single most useful prompt in this folder.

**Make it cite.** *"Which ledger row, which principle, which prior decision?"* Claims that
can't cite a doc are opinions — sometimes good ones, but label them.

**Use the ledger as the generator.** *"Take the ○ and ◐ rows, cluster them by the missing
mechanism, and tell me which single mechanism closes the most."* This is where clusters —
the cheap, high-value bets — come from.

**Make it audit before it invents.** *"Before proposing anything, drive the running app and
tell me what's actually there."* Real data beats speculation; the dev auto-login exists for
exactly this.

**Prompts worth reusing:**

- *"Run the [anchor pass](#3--the-anchor-pass--six-questions) on this idea. Be strict about the three no's."*
- *"Which of our principles does this strain, and is the strain worth it?"*
- *"Has some version of this already been decided? Check `decisions.md` §2."*
- *"What's the smallest version of this that's still honest?"*
- *"What would we have to retire to earn this?"*
- *"Re-score these ledger rows against the running app — where did we regress?"*
- *"Give me the version of this idea that a world-class product team would ship, then the version we'd actually ship this month, and the difference."*
