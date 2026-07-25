# Nuvo docs — the map

Two layers, and the difference matters:

| Layer | Where | Answers | Changes |
|---|---|---|---|
| **Why** — product truth | [`docs/product/`](./product/) | Who this is for · what we refuse · what "good" means | Rarely, deliberately |
| **How** — mechanism | `docs/*.md` | How one feature works, and why it's designed that way | Every time we build |

> Build conventions (mobile rules, Warm Paper enforcement, verify-against-live-code) live in
> the root [`CLAUDE.md`](../CLAUDE.md). Product backstory lives here.

---

## The why layer — `docs/product/`

| Doc | What it's for |
|---|---|
| **[overview.md](./product/overview.md)** | **The canon.** What Nuvo is, what it isn't, the core model, the funnel, where we are, and how we know it's working. *Wins over any spec.* |
| **[principles.md](./product/principles.md)** | The 16 rules, each with a *violated when* — **the audit standard.** |
| **[personas.md](./product/personas.md)** | Who this serves, who we disappoint on purpose, and **the Question Ledger** — the questions in their heads, scored by how honestly we answer them. Archetypes; the builder is cited as *persona zero*, not the definition. |
| **[brandscript.md](./product/brandscript.md)** | StoryBrand SB7: the hero, the villain (**Drift**), the guide, the plan, the stakes. Governs product decisions, not just copy. |
| **[landscape.md](./product/landscape.md)** | The field, the gap we own, and the feature-envy guardrail. |
| **[roadmap.md](./product/roadmap.md)** | Bets with the question each one closes. Now (max three) · Next · Later · Parked. |
| **[decisions.md](./product/decisions.md)** | The decision log — including **what we decided not to do**, so it stops coming back. |
| **[glossary.md](./product/glossary.md)** | Naming canon, incl. user-facing ↔ code drift (`Priority` = `big_rocks`, `Week` = `sprints`). |
| **[audit.md](./product/audit.md)** | The six-pass method for holding the running app against the truth (incl. the **stranger pass**), + the output template. |
| **[ideation.md](./product/ideation.md)** | How we brainstorm without drifting: the three modes, the anchor pass, the four no's, and how to work with Claude on product thinking. |

## The how layer — mechanism specs

Statuses are owned by each doc's own header.

**The engine**
- [`commitment-model.md`](./commitment-model.md) — Demand ÷ Capacity. **The most important idea in the product.**
- [`readiness-model.md`](./readiness-model.md) — the funnel made visible; the ambient gauge.
- [`priorities-and-projects.md`](./priorities-and-projects.md) — how a Priority binds to standing work.
- [`execution-flows.md`](./execution-flows.md) — the vertical meets the week; pools, the gate, the flows.

**Planning & grooming**
- [`on-deck.md`](./on-deck.md) — the project timeline you open first (the *When* lens).
- [`grooming-lenses.md`](./grooming-lenses.md) — one hub, four views (*When · What · How · In the way*).
- [`refine-run.md`](./refine-run.md) — grooming as a winnable game (phone-first).
- [`weekly-review.md`](./weekly-review.md) — the closing valve; evidence + the Find.
- [`loose-weeks.md`](./loose-weeks.md) — giving a loose task an answer to "when?"

**Time**
- [`standing-slots.md`](./standing-slots.md) — recurring time with an affinity that acts as a magnet.
- [`project-slots.md`](./project-slots.md) — protected project time, so capacity stops lying.
- [`activity-sources.md`](./activity-sources.md) — actuals from the world; GitHub as instance #2.

**Surfaces & craft**
- [`design-language.md`](./design-language.md) — **Warm Paper.** Read before building any surface.
- [`marquee.md`](./marquee.md) — Nuvo shows an answer as well as telling it.
- [`APPLE_WATCH.md`](./APPLE_WATCH.md) — wrist capture via Shortcuts → the `agent` endpoint.
- [`../KEYBOARD_SHORTCUTS.md`](../KEYBOARD_SHORTCUTS.md) — the keyboard model.

---

## Reading orders

**I'm about to build a feature** → `product/principles.md` → the relevant mechanism spec →
`design-language.md` → root `CLAUDE.md` (mobile + verification rules).

**I'm ideating** → `product/ideation.md` → the Question Ledger in `product/personas.md` →
`product/decisions.md` §2 (the N-list).

**I'm writing copy** → `product/brandscript.md` → `product/glossary.md` →
`marketing/HANDOFF.md`.

**I'm auditing** → `product/audit.md`, with `product/overview.md` and
`product/principles.md` open.

**I'm new here** → root `readme.md` → `product/overview.md` → `product/personas.md` →
`design-language.md`.

## Conventions for docs in this folder

1. **Open with a status line** — `canonical` · `spec` · `spec, in build` · `built <date>` ·
   `design proposal` · `superseded by <doc>`. The roadmap trusts these; keep them current.
2. **Then one paragraph of thesis** — the idea in a sentence, before any mechanism.
3. **Link the siblings you build on**, at the top. Specs here are a graph, not a pile.
4. **Update the status header the day it ships.**
5. **Supersede, don't delete.** A spec we abandoned is evidence; mark it and move on.
6. **New user-facing name → [`glossary.md`](./product/glossary.md) entry.** No exceptions.
