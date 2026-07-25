# The product audit — reflecting on what we actually built

**Status:** canonical method (2026-07-25)
**Purpose:** a repeatable way to hold the running app against the truth in this folder and
find where they've drifted. Output goes in `docs/product/audits/YYYY-MM-DD.md`.

**The rule that makes it worth doing:** audit the **running app with real data**, never the
specs, never a screenshot, never your memory of what shipped. Start the dev server
(auto-login is on — see root `CLAUDE.md`) and drive it. Every claim in an audit needs a
"I did X and saw Y."

**When to run:** at each Summit · before committing a quarter's bets · after any burst of
shipping · whenever ideation starts feeling untethered.

**Time budget:** ~90 minutes for the full five passes. Pass 2 alone (~25 min) is the
highest-yield if you only do one.

---

## Pass 1 · Truth — does the app match the canon?

Read [`overview.md`](./overview.md), then look for contradictions in the app.

- Does anything violate **"a scheduled task IS a time block"**? Any shadow entity?
- Is **the Week still the only gate**? Find every code path that writes `do_date`. Does any
  of them skip `sprint_id`? *(`grep` is a legitimate tool for this pass.)*
- Are the **four pools** still four? Has a fifth appeared under another name (a "staging"
  list, a "someday" filter, a smart view that behaves like a pool)?
- Does anything in §2 (**What Nuvo is not**) exist now anyway, in miniature?
- Are the **§6 signals** still derivable from data we have?

**Output:** a list of contradictions, each as *canon says X · app does Y · which is wrong.*

## Pass 2 · Questions — the ledger walk *(highest yield)*

Take the [Question Ledger](./personas.md#5--the-question-ledger) and, **for each row**,
actually try to answer the question in the running app. Time yourself.

Score honestly:

| Score | Bar |
|---|---|
| ✅ | Answered in the app, in **under ~15 seconds**, **without clean data as a precondition** |
| ◐ | The answer exists but is hidden, manual, multi-step, or needs a groomed backlog |
| ○ | Not answerable |
| ✳ | Only answered by a spec that isn't built |

Then look for the three interesting things:

1. **Regressions** — rows that were ✅ and are now ◐. Nobody files these as bugs; they're
   the most valuable find in the whole audit.
2. **Clusters** — several ◐ rows sharing one missing mechanism. That's your next bet, and
   it's cheaper than it looks.
3. **Phantom ✅s** — rows you *believe* are answered but couldn't actually demonstrate.

**Output:** the re-scored ledger table + the three lists. Update
[`personas.md`](./personas.md) with the new scores.

## Pass 3 · Principles — hunt one violation each

Walk [`principles.md`](./principles.md) and try to find **one real violation of every
principle.** Assume they exist; the default failure isn't breaking a principle, it's
breaking one without noticing.

High-yield places to look:

| Principle | Look at |
|---|---|
| 3 · propose/promote | Every AI output path — did an "accept" step get optimized away? |
| 4 · report/decide | Every count, every red thing, every imperative in copy |
| 5 · free text | Every create path — is there one that's form-only? Any non-plain input (dictation broken)? |
| 7 · day one | Log in with an empty backlog. Which screens are broken, empty, or lying? |
| 8 · one question | Name each surface's single question out loud. Which ones stutter? |
| 10 · no new nouns | Diff the app's vocabulary against [`glossary.md`](./glossary.md) |
| 13 · mobile | 375px, every reachable surface, tap targets, safe areas, bottom-bar clearance |
| 14 · Warm Paper | `grep` for opaque `bg-` on structural containers, raw hex, flat focus rings |

**Output:** violation · file/surface · intentional-or-drift · fix or log it in
[`decisions.md`](./decisions.md).

## Pass 4 · Story — does the plan survive contact?

Walk [`brandscript.md`](./brandscript.md)'s three-step plan as a *new user with an empty
account*: **capture → commit a week → land it and see the truth.**

- Where does the hero fall out? Name the exact screen.
- Does anything make **Nuvo** the hero instead of the user?
- Does the app ever *shame*? (Counts of undone things, red for non-urgent, an imperative
  aimed at the user.)
- Does the promised Success (§7) actually happen — can you get to "Friday you can prove it"
  in one real week?
- Is any **retired language** (§10) back in the UI?

**Output:** the fall-out point, plus any story errors.

## Pass 5 · Surfaces — the sweep

Inventory every reachable screen, desktop **and** mobile. For each, one row:

| Surface | Its one question | Answers it? | Mobile parity | Warm Paper | Verdict |
|---|---|---|---|---|---|

Verdicts: **keep · sharpen · merge · retire.** Be willing to write *retire* — an orphan
surface costs more than an unbuilt feature.

**Hunt specifically for:**
- **Orphan surfaces** — reachable, but nothing routes to them and no ceremony needs them.
- **Two surfaces, one question** (Principle 8 + 11 drift — e.g. the `TendingFlow` / Refine
  run overlap).
- **Clean-data-only screens** (Principle 7).
- **Dead specs** — docs describing something that never shipped and no longer should. Mark
  them `superseded` rather than deleting; delete only when it's actively misleading.

---

## The output — audit template

Copy this into `docs/product/audits/YYYY-MM-DD.md`.

```markdown
# Product audit — YYYY-MM-DD

**Driven against:** dev server, real data, commit `<sha>`
**Passes run:** 1–5 (or note which)

## Verdict in three sentences
<What's true. What's drifted. What to do about it.>

## 1 · Truth
| Canon says | App does | Which is wrong |

## 2 · Question Ledger (re-scored)
<the table, with deltas marked ↑ / ↓>
**Regressions:**
**Clusters (→ candidate bets):**
**Phantom ✅s:**

## 3 · Principle violations
| # | Principle | Violation | Where | Drift or intentional | Action |

## 4 · Story
**Fall-out point:**
**Story errors:**

## 5 · Surfaces
| Surface | Its one question | Answers it? | Mobile | Warm Paper | Verdict |

## Actions
1. <fix now — small, obviously right>
2. <bet — goes to roadmap.md Next, with the ledger row it closes>
3. <decision to log — goes to decisions.md>
4. <doc to update — canon changed, or a spec is stale>
```

**Every audit must end with actions in exactly those four buckets.** An audit that produces
only observations is a mood, not a method.

## Anti-patterns in auditing itself

- **Auditing the docs instead of the app.** The docs are the standard; the app is the
  subject. If you never opened the app, you didn't audit.
- **Grading generously** because you know why something is the way it is. The user doesn't.
- **Turning every finding into a feature.** Most findings are *cuts*.
- **Skipping mobile** because the finding is "the same." It usually isn't.
- **Not updating the docs afterward.** If the audit changed what's true, the canon changes
  with it — otherwise the next audit measures against fiction.
