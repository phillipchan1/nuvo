---
name: product-audit
description: Run the Nuvo product audit — hold the running app against the product canon across six passes (truth, Question Ledger, principles, story, surfaces, and the stranger pass) and produce a dated audit with actions. Use when asked to audit, review, reflect on, or sanity-check the product, to re-score the Question Ledger, to find where the app has drifted from the docs, or to check what a brand-new account actually experiences. Not for code review or bug hunting.
---

# The Nuvo product audit

Full method + output template: [`docs/product/audit.md`](../../../docs/product/audit.md).

## The one rule that makes it real

**Drive the running app with real data.** Auditing the specs instead of the app is the
failure mode — the docs are the standard, the app is the subject. Start the dev server
(auto-login is configured; see root `CLAUDE.md`) and actually use it.

**Every finding needs an "I did X and saw Y."** If you never opened the app, you didn't
audit — say so rather than producing a doc-review dressed as an audit.

Don't mutate real data. Read, navigate, observe. Leave data-changing actions to the user or
ask first.

## Scope it first

Ask which passes to run if the user hasn't said. Defaults:

- **Only time for one?** Pass 2 (the ledger walk) — highest yield, ~25 min.
- **Two?** Add Pass 6 (the stranger pass) — it's the one the builder's own account can
  never reveal.
- **Full audit?** All six, ~2 hours.

## The six passes

1. **Truth** — contradictions against [`overview.md`](../../../docs/product/overview.md).
   One row of truth? Week still the only gate? Still four pools?
2. **Questions** — walk every [Question Ledger](../../../docs/product/personas.md) row in
   the app, timed. Score ✅ (<15s, no clean-data precondition) · ◐ · ○ · ✳. Then hunt
   **regressions** (was ✅, now ◐ — nobody files these), **clusters** (several ◐ sharing one
   missing mechanism → your next bet), and **phantom ✅s**.
3. **Principles** — try to find one real violation of each of the 16. Assume they exist.
4. **Story** — walk capture → commit → land as a new user with an empty account. Where does
   the hero fall out? Does anything make Nuvo the hero? Does the app ever shame?
5. **Surfaces** — inventory every reachable screen, desktop and mobile. One question each.
   Verdict: keep · sharpen · merge · retire. Be willing to write *retire*.
6. **Stranger** — a genuinely fresh account, not yours with filters. Seeded defaults,
   timezone, working hours, pre-calendar state, first-value moment, vocabulary, privacy.

## Output

Write to `docs/product/audits/YYYY-MM-DD.md` using the template in `audit.md`.

**Every audit ends with actions in exactly four buckets:** fix now · bet (→ `roadmap.md`
with the ledger row it closes) · decision to log (→ `decisions.md`) · doc to update.
An audit that produces only observations is a mood, not a method.

Then update the docs the audit changed — re-scored ledger rows, stale statuses, moved
canon. Otherwise the next audit measures against fiction.

## Grade honestly

Don't grade generously because you know why something is the way it is — the user doesn't.
Don't turn every finding into a feature; most findings are cuts. Don't skip mobile.
