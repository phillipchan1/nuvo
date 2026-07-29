# Testing the agent

**Status:** shipped 2026-07-29 · decision [D-050](./product/decisions.md#platform) ·
siblings [`planning-kernel.md`](./planning-kernel.md) (the same argument, applied to week
rules)

For two months every agent bug was found the same way: Phil hit it in a real
conversation, and the fix was another sentence added to a system prompt that had
grown to 4,000 words. That loop has a floor. Nothing proved a fix held, so every
fix had to be defensive; nothing proved a rule was still earning its place, so no
rule could be deleted. The prompt only ever grew, and rules that had quietly
started contradicting each other stayed in.

This is the way out. Three harnesses, because the agent fails in three different ways — the code can be wrong, the instructions can contradict each other, and the model can be told the wrong thing.

| | `agent-calendar.test.ts` | `agent-prompt-hygiene.test.ts` | `agent-prompt.eval.ts` |
|---|---|---|---|
| Answers | does the **code** do what it's told? | is the **prompt** self-consistent? | is the **model** told the right thing? |
| Needs | nothing | nothing | a live model + API key |
| Runs | `npm test`, in CI | `npm test`, in CI | `npm run eval`, by hand |
| Catches | provider routing, time conversion, duplicate detection, what the reply is handed | one rule stated twice, a hardcoded zone, a tool name that no longer exists, silent growth | tool choice, argument shape, the rules that only exist as prose |

## 1 · The tool tests — `npm test`

`executeTool` runs **unmodified**, against an in-memory account. No seam is
carved into production code for the tests: `vitest.config.ts` aliases the two
`npm:` specifiers the edge functions import, `tests/agent/setup.ts` defines
`Deno.env`, and `tests/agent/stubSupabaseJs.ts` makes `createClient()` return the
fake — so `admin` in `_shared/admin.ts` *is* the fake and the file under test is
the shipped file.

- **`tests/agent/fakeSupabase.ts`** — a Postgrest-shaped query builder, only as
  wide as the tools actually query. Anything unsupported throws by name, so an
  untested query fails loudly instead of returning `undefined` and passing.
- **`tests/agent/world.ts`** — Phil's shape reduced to what a calendar decision
  depends on: a default Google account, an iCloud account carrying **Family**, a
  read-only Microsoft account. It also stands in for `google-events` /
  `icloud-events` — **including the asymmetry that on a patch icloud-events
  updates the mirror row and google-events does not.** That is real, and a fake
  that tidied it away would let the bug it causes back in.

**Mutation-check anything you add here.** A test that cannot fail is worse than
no test, because it reads like coverage. Break the code on purpose, watch the
test go red, put it back. Every case in `agent-calendar.test.ts` was checked this
way against the bug it describes.

## 2 · The hygiene tests — `npm test`

No model needed. The prompt is an artifact, so it gets checked like one:

- **One rule, one home.** A registry of rules that have been duplicated (or are
  the shape of one that would be), each asserted to appear in the prompt *or* the
  tool schemas, never both. Two homes drift — that's how the calendar-inference
  rule ended up in the prompt in sentence case and in a schema in caps, where a
  grep for one missed the other.
- **No hardcoded zone.** Nothing the model reads may name `America/Los_Angeles`;
  only the fallback constant in code may.
- **No UTC claim.** No surface may tell the model to send a time as UTC.
- **Tools that exist.** Every tool name the prompt tells the model to call must
  be registered. Prompt rot is real: a rule outlives a rename, the model calls a
  dead name, and it reads like the model being stupid.
- **A size ratchet.** A word budget on the standing instructions, so adding a
  rule means finding one to delete. Raising it is allowed; raising it without
  noticing is not.

Mutation-check these too. Reintroducing each of the four contradictions this
file was written against turns exactly one test red.

### Where the words actually are

Measured when the harness landed — the numbers that make the case for the eval:

| Section | words | |
|---|---|---|
| Time and scheduling | 607 | mechanics |
| The Nuvo data model | 896 | mechanics |
| Guided flow: planning the week | 627 | mechanics |
| Where to put things | 485 | mechanics |
| Calendar events | 333 | mechanics |
| Marquee, vertical ops | 458 | mechanics |
| **Judgment** (scope, philosophy, when-to-execute, voice) | **678** | ~16% |

Two months of bug-fixing grew *only* the mechanics: `Time and scheduling` +209
and `Calendar events` +198 in a single session of fixes, while every judgment
section stayed byte-identical. That is the shape of the problem — the prompt
accumulates facts the model must be *told*, and told facts are what drift into
contradiction. The target is a prompt that is mostly the 678.

## 3 · The prompt eval — `npm run eval`

Needs `OPENROUTER_API_KEY` or `OPENAI_API_KEY` (and honours `AGENT_MODEL`). Not
in CI: it costs money and a live model is not deterministic. It sends the **real**
`STATIC_SYSTEM_PROMPT` and the **real** `TOOL_DEFINITIONS` with a fixture
snapshot, and asserts which tool the model reaches for and with what arguments.

This is the half that lets the prompt shrink:

```
EVAL_RUNS=5 npm run eval     # baseline pass rate
# delete the rule you suspect is dead weight
EVAL_RUNS=5 npm run eval     # did anything move?
```

**A rule whose removal doesn't move the numbers was costing tokens and attention
for nothing.** That is the only honest way to cut a prompt down, and it is why
this file exists.

Treat flakiness as data. A case that passes 3/5 is not a flaky test — it is a
genuinely ambiguous instruction, and the fix is in the prompt.

## 4 · Which layer should own a rule?

The question to ask before adding anything to the prompt.

**If the rule has one right answer, it belongs in code or in the context payload,
not in prose.** A rule in prose is probabilistic and negotiates with its
neighbours; a rule in code fires every time and cannot contradict another rule.
The fixes that stuck were the ones that removed a decision from the model
entirely:

- `context.dates` — a resolved date table, so "next Wednesday" is a lookup rather
  than arithmetic the model performs in its head
- the `when` string on every calendar result — so a confirmation quotes a time
  instead of converting one
- `eventsFnFor(provider)` — so "can I cancel this?" is never a judgement call

Each of those let a rule be **deleted**, not added.

**The prompt should carry judgment**: what to say when a week is overloaded, when
to push back, when to stay quiet. Today that is about a sixth of it (see the table above). The rest is mechanics the model is *told*, and mechanics are what drift into contradiction —
`start_time` was simultaneously documented as UTC, as local, and as
America/Los_Angeles, in three places, with only one matching the code.

## 5 · Adding a case

Prefer a real failure over an imagined one — ideally paste the transcript line
into the test's comment, so the next person knows what it is defending. Assert
the user-visible consequence (which row moved, what the reply is handed to say)
rather than the internal call shape, so a refactor doesn't break the test for the
wrong reason.

## Known gaps

- **`tests/` is not typechecked.** `npm run typecheck` covers `src` only;
  covering the test tree means resolving the Deno edge imports under `tsc`, which
  the repo deliberately doesn't do (CI parses them with esbuild instead). Vitest
  transpiles without checking, so a type error in a test surfaces at runtime.
- **Only the calendar tools have behavioural cases.** Task, priority and vertical
  writes go through the same `executeTool` and the same fakes — they just have no
  cases yet.
- **The eval is single-turn plus scripted history.** It cannot catch a failure
  that only appears after several real rounds of tool use.
