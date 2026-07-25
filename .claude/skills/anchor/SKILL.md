---
name: anchor
description: Run the anchor pass on a Nuvo product idea before designing or building it — checks which Question Ledger row it closes, which principle it strains, whether it was already decided, and the four no's. Use whenever someone proposes a feature, surface, or product change for Nuvo ("should we add…", "what if Nuvo…", "I want a screen that…"), or asks whether an idea is worth building. Also use to argue the case against an idea. Do NOT use for bug fixes, refactors, or purely visual work.
---

# The anchor pass

Purpose: find out whether an idea is **ours** before any design happens. A well-argued
**no** is a good outcome — the default failure mode here is agreeable expansion.

Full method: [`docs/product/ideation.md`](../../../docs/product/ideation.md) §3.

## First — which mode is this?

If the user is in **Spark** mode ("just give me angles", "brainstorm with me"), **stop and
give angles.** Judgment off, volume and range on. Only run this pass in **Anchor** mode.
If it's ambiguous, ask.

## Read before answering

1. [`personas.md`](../../../docs/product/personas.md) §5 — the Question Ledger
2. [`principles.md`](../../../docs/product/principles.md) — the 16 rules
3. [`decisions.md`](../../../docs/product/decisions.md) §2 (N-list) + §3 (open questions)
4. [`overview.md`](../../../docs/product/overview.md) §2 — what Nuvo is *not*

## The six questions — answer all six, in writing

1. **Whose question?** Which ledger row does it close, for which persona? Cite the ID. If
   none exists, argue that a real human asks it — or stop here.
2. **Which altitude?** Domain · Initiative · Project · Week · Day. Spanning three usually
   means it's several ideas wearing a coat.
3. **Which story step?** Capture · commit · land. A fourth step is a tax on the hero.
4. **Which failure does it prevent?** From [`brandscript.md`](../../../docs/product/brandscript.md) §6.
   No stakes → it will feel like clutter however well it's built.
5. **Which principle does it strain?** Cite the number, and say whether the strain is worth
   it and what the mitigation is.
6. **What does it replace?** New surfaces are a tax. The best ideas *retire* something.

## The four no's — any yes is almost certainly a no

- **Adds a pool** (Principle 10 · N-06)
- **Adds a name that overlaps an existing one** (Principle 11)
- **Only works with clean data** (Principle 7 — the abandonment trap)
- **Only true for the builder's own account** (Principle 16 — would it hold in a
  stranger's fresh account?)

## Then

- **Passes** → propose the *smallest honest version*, and offer to write the spec in
  `docs/` (mechanism), not `docs/product/` (why).
- **Fails** → say so plainly with the reason, and offer to log it in
  [`decisions.md`](../../../docs/product/decisions.md) §2. An unrecorded no comes back
  every quarter and costs the same conversation again.

Close by asking whether to record the outcome. Don't record silently.
