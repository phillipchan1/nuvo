# Working in `docs/` — instructions for Claude

This folder is Nuvo's memory. The root [`CLAUDE.md`](../CLAUDE.md) says **how we build**;
this says **what's true and why**, and how to keep it that way.

Read [`README.md`](./README.md) for the map. This file is the contract.

---

## 1 · Order of authority

When two sources disagree, higher wins:

```
1. The user (Phil), in this conversation
2. docs/product/overview.md + principles.md      ← the canon
3. docs/product/{brandscript,personas,landscape,decisions,glossary}.md
4. docs/*.md mechanism specs                      ← how a feature works
5. The code
6. Your priors about how planners are usually built   ← lowest, always
```

**The code is not the canon.** If the app contradicts `overview.md`, that's a finding, not
a correction — surface it. And if a proposal contradicts the canon, say so *explicitly*
before designing it; the canon can change, but only deliberately and with a
[`decisions.md`](./product/decisions.md) entry.

## 2 · Before proposing any product idea — the anchoring contract

Never open with a feature. Open with these, briefly, in the response itself:

1. **Which [Question Ledger](./product/personas.md#5--the-question-ledger) row** does it
   close? Cite the ID (`W3`, `D5`, `Q5`…). If none exists, say so and argue that a human
   actually asks it.
2. **Which [principle](./product/principles.md) does it strain?** Cite the number. Most
   good ideas strain one — naming it is the point.
3. **Has this already been decided?** Check [`decisions.md`](./product/decisions.md) §2
   (the N-list) and §3 (open questions). If it's there, lead with that.
4. **The three no's** — does it add a pool, add an overlapping name, or only work with
   clean data? Any yes → lead with the objection.

Then propose. This costs three sentences and prevents most wasted work.

**Run the [anchor pass](./product/ideation.md#3--the-anchor-pass--six-questions) in full**
when the user is deciding whether to build something. Skip it in Spark mode — if the user
says "just give me angles," give angles and hold the judgment.

## 3 · Mode discipline

The user will often be in one of the three modes from
[`ideation.md`](./product/ideation.md). If it's ambiguous, **ask which one** rather than
splitting the difference:

- **Spark** — generate. Judgment off. Volume and range are the goal.
- **Anchor** — evaluate. Try to *kill* the idea using our own docs. Agreeable expansion is
  the failure mode here; a well-argued `no` is a good outcome.
- **Shape** — design. Write a mechanism spec in `docs/`, in the house style (§5).

## 4 · Doc maintenance — do this without being asked

| When this happens | Update this |
|---|---|
| A spec ships | Its **status header**, the same day. [`roadmap.md`](./product/roadmap.md) trusts it. |
| A new user-facing name appears | [`glossary.md`](./product/glossary.md). No exceptions. |
| An idea is rejected | [`decisions.md`](./product/decisions.md) §2, **with the reason** — an unrecorded no comes back every quarter. |
| A real architectural/product call is made | [`decisions.md`](./product/decisions.md) §1, with consequence. |
| An audit re-scores a question | [`personas.md`](./product/personas.md) §5 |
| A bet starts or finishes | [`roadmap.md`](./product/roadmap.md) — Now holds **max three** |
| What Nuvo *is* changes | [`overview.md`](./product/overview.md), and say plainly that the canon moved |
| A spec is abandoned | Mark it `superseded by <doc>` — **don't delete.** |

If a change makes a doc wrong and you don't have time to fix it, **say which doc is now
stale** rather than leaving it silently false.

## 5 · Writing style for docs here

Match the house voice — [`on-deck.md`](./on-deck.md), [`readiness-model.md`](./readiness-model.md),
and [`commitment-model.md`](./commitment-model.md) are the best examples.

- **Status line, then a one-paragraph thesis**, then mechanism. Never mechanism first.
- **Link the siblings you build on** at the top. Specs are a graph.
- Short sentences. Concrete verbs. Bold the load-bearing claim, once.
- **Tables for anything comparative.** Prose for anything causal.
- Explain *why*, not just *what* — the why is the part that's expensive to recover later.
- Write for a fresh build chat: someone should be able to implement from the doc alone.
- No marketing fog. No hedging fog either — take a position and mark the uncertainty
  separately.

## 6 · Honesty rules — non-negotiable

- **Never invent product facts.** No fabricated user research, metrics, quotes, competitor
  behavior, or usage data. If something is inferred from the repo, mark it inferred.
- **Never fabricate a status.** If you don't know whether something shipped, check the code
  or say you didn't check. Wrong statuses poison the roadmap.
- **Persona details are drafted, not researched.** Anything about the user's real life is a
  draft for them to correct — flag it as such.
- **Distinguish "the doc says" from "the app does."** They drift. That drift is exactly what
  [`audit.md`](./product/audit.md) exists to find, so don't paper over it.
- **Cite.** Claims about Nuvo should point at a doc, a file, or an observation in the running
  app. Uncited claims are opinions — fine, but label them.

## 7 · When asked to audit

Follow [`audit.md`](./product/audit.md). The one rule that makes it real: **drive the
running dev app with real data** (auto-login is set up — see root `CLAUDE.md`). Auditing the
specs instead of the app is the failure mode. Every finding needs an *I did X and saw Y*,
and every audit ends with actions in four buckets: fix now · bet · decision to log · doc to
update.

Don't mutate real data to audit. Read, navigate, and observe; leave data-changing actions
to the user or ask first.
