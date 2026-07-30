# The planning kernel — one rule, two runtimes

Status: **built** (2026-07-26 · D-032). Source: `supabase/functions/_shared/planningRules.ts`.
Enforced by `tests/planning-kernel.test.ts` (`npm test`) and `.github/workflows/checks.yml`.
Sits under [`on-deck.md`](./on-deck.md) (which owns *when* a project happens) and
[`priorities-and-projects.md`](./priorities-and-projects.md) (which owns what a priority is).

Nuvo answers *"what is my week?"* on two surfaces that run in different places: the SPA
(browser, `src/lib/*`) and the agent (Deno, `supabase/functions/*`). They read the same
database, but they used to reason about it with **separate implementations of the same
rules** — and separate implementations of one rule are not a style problem, they are a
countdown. **Every planning rule now has exactly one implementation, imported by both
runtimes, and a test that fails the moment a second one appears.**

---

## 1 · The three drifts that motivated it

Each of these shipped. None was caught by typecheck, build, or review.

| Drift | What the user saw |
|---|---|
| The agent read the sprint's `big_rocks`; every UI surface derived the slate from project spans | Asked to plan the week, Nuvo said *"no week priorities set yet"* over a deck holding several projects |
| `planningWeekStart` shifted Saturday to next Monday in the app, to *this* Monday on the server | On Saturdays the app planned the week ahead while the agent planned the week that was ending |
| `_shared/nlp.ts` is a 92-line re-implementation of the 207-line `src/lib/nlp.ts` | The same capture parses differently depending on whether you typed it into the app or said it to Nuvo — **still true; not yet folded into a kernel** |

> The pattern: **the UI evolves, the agent's copy doesn't, and nothing fails.** Both surfaces
> keep answering confidently — with different answers.

## 2 · The shape of the fix

Three layers, in increasing order of how much they buy you.

**a · One derivation.** The rules — what week am I planning, does this project's span cover
it, did it ship inside it, what's on the slate, what needs a sprint — live in the kernel as
pure functions over a minimal `SpanProject`. The client's `Project` matches structurally; a
Supabase row goes through `fromProjectRow`. Neither runtime owns the rule; both call it.

**b · One act.** A write is not a rule, so it can't be a shared *function* — the browser
writes through `useVertical`, the agent through the service role. What can be shared is
**what the act means**, so the kernel returns a **patch** and each side applies it:

```
bringIntoWeekPatch(project, weekStart) → { startDate, targetDate, status? } | null
takeOffWeekPatch()                     → { startDate: null, targetDate: null }
toRowPatch(patch)                      → snake_case, for the runtime that speaks it
```

`null` means "already there" — which is why the agent can say *"that's already this week's"*
instead of writing a no-op. Bringing a project into the week from a tap, a drag, the sprint
picker, or the chat now produces a byte-identical patch.

**c · One test that fails on divergence.** Layers (a) and (b) only hold while everyone keeps
calling them. `tests/planning-kernel.test.ts` holds the line three ways:

| Test class | Catches | Example |
|---|---|---|
| **Agreement** | the two *shapes* disagreeing | client `weekPushes(...)` vs the agent's `deriveSlateIds(...)` over one fixture set expressed both as view models and as rows |
| **Behavior** | the shared rule being *wrong* | Saturday plans the week ahead · a project that shipped Wednesday stays on the slate · a Sunday-anchored span doesn't leak into the prior week |
| **Drift guard** | a second implementation *appearing* | a source scan: no file outside the kernel may define `spansWeek`, `planningWeekStart`, `weekSpanFor`, `bringIntoWeekPatch`… and both agent files must import the kernel |

The drift guard is the load-bearing one. Agreement tests pass trivially while both sides call
the kernel; the scan is what notices when someone stops.

## 3 · The acts registry

The pairing to keep true. Adding a row means adding a kernel function first, then both ends.
Most rows live in `planningRules.ts`; a shared rule that isn't about the *week* gets its own
zero-import module beside it (e.g. `_shared/conferencing.ts`) and is cited inline below.

| Act | Kernel | UI | Agent |
|---|---|---|---|
| Which week am I planning | `planningWeekStart` | `planningWeekStartISO` (`lib/dates.ts`) | `context.ts`, `tools.ts` |
| What's on this week (scoreboard) | `isOnSlate` / `deriveSlateIds` | `weekPushes` → Priorities editor, phone slate, week card | `context.weekSlate` |
| What can I work on this week | `isOnDeckThisWeek` | `projectsOnDeck` → `suggestPull` | `context.weekSlate[].openTasks` |
| What has no week yet | `needsASprint` | deck pool "Needs a sprint" | `context.needsASprint` |
| Bring a project into the week | `bringIntoWeekPatch` | `BigRocks.bringIn`, `MobilePlanWeek.bringIn`, deck drop (`sprintSpanFor`) | `create_priority` |
| Take a project off the week | `takeOffWeekPatch` | `BigRocks.takeOff`, `MobilePlanWeek.takeOff` | `delete_priority` |
| Where a placement lands | `weekSpanFor` | `sprintSpanFor` (deck drag, sprint picker) | `create_priority` |
| Does this meeting get a video link | `shouldAddMeet` (`_shared/conferencing.ts`) | `DraftComposer` Meet toggle · Settings → Calendars | `create_calendar_event` (`add_meet`) |

## 4 · Rules for working on it

- **Never re-implement.** If you need a week rule in a new place, import it. If it doesn't
  exist yet, add it *to the kernel* and then call it from both ends.
- **Zero imports in the kernel.** Deno resolves no bare specifiers there (so no `date-fns`),
  and the browser bundle shouldn't grow a dependency for four date rules. Date arithmetic is
  plain UTC ms over `YYYY-MM-DD` — never local-midnight parsing, which gives different
  answers in different runtimes across a DST boundary.
- **It lives under `supabase/functions/_shared/`** because the edge bundler only guarantees
  that path; Vite can import from anywhere in the repo. Read it as *shared kernel*, not as
  server code.
- **A new agent tool that writes planning state needs a row in §3** — and its UI twin, or an
  explicit note in [`decisions.md`](./product/decisions.md) saying why there isn't one.

## 5 · What this does *not* cover yet

Named so nobody assumes the guarantee is wider than it is.

- **Capture parsing** (`nlp.ts`) is still two implementations, and they differ today. Same
  fix applies; not done.
- **The composer.** `composeWeek` / the pull / calibration run only in the client
  (`useWeekDraft`), so the agent can *propose* a shape but never computes the same one. Today
  the chat flow proposes in prose and writes through task tools; if the agent ever needs to
  compose a week, the composer has to move into the kernel — it's pure already.
- **Task-state rules** (`isOpenStatus`, rollover, `toBusyBlocks`) are client-only, and the
  agent reasons about them in prose from its prompt. That's a live drift surface; it hasn't
  bitten yet.
