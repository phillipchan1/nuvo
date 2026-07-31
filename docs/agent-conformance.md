# The chat's conformance battery — what Nuvo can do, and how we know

**Status:** live · battery at `tests/agent/` · deterministic half runs in CI
**Owner rule:** a chat capability that isn't in this map doesn't exist, and one
that's in this map without a scenario is a claim, not a capability.

---

## 1 · The problem this exists for

Every other part of Nuvo fails loudly. A broken component throws, a broken type
fails `tsc`, a broken week rule fails the planning kernel's conformance suite.
**The chat fails quietly and confidently.** It answers in fluent English either
way, and the only signal that it got something wrong is a person noticing.

The record backs that up. Each of these shipped, passed typecheck and build, and
was found by a human using the app:

| When | What it did | What was actually wrong |
|---|---|---|
| 2026-07-26 | "No week priorities set" over a full deck | the agent read `big_rocks`; every UI surface derived the week from project spans |
| 2026-07-27 | Saturday planned a different week in chat than on screen | `planningWeekStart` written twice, drifted |
| 2026-07-28 | Booked a call onto a calendar hidden months earlier | the write-target list didn't filter hidden calendars; no rule against inferring one |
| 2026-07-31 | "9am slot where I'll do X, Y and Z" → three consecutive one-hour tasks | the agent had no slot vocabulary at all, and "slot" already meant *free window* in its prompt |

The pattern is the same every time: **the chat and the app disagreed, and only
the chat was willing to say something.** The planning kernel fixed that for the
*week's rules* by making one implementation both runtimes import. This battery
is the same move for the chat's *behavior* — it drives the deployed loop, the
deployed prompt and the deployed tool list, and fails when they stop agreeing
with what we said the chat does.

---

## 2 · How it's built

Two tiers, because the two failure modes are different.

### Tier 1 — deterministic (`npm test`, ~50ms, runs on every push)

`tests/agent-contract.test.ts`. No model, no network, no cost. It pins
everything about the chat that isn't judgment:

- **Vocabulary ↔ behavior.** Every tool offered to the model has a handler;
  every handler is reachable; every tool the prompt names by hand exists. (This
  caught its first bug within a minute of being written.)
- **Definition shape.** Every tool has a description, an object schema, and no
  `required` field it never defines — the shapes providers reject at runtime.
- **The snapshot.** Build a fixture world, assemble the turn the real way, and
  assert that every field the prompt tells the model to read is actually in the
  JSON. The `todayFreeSlots` → `todayOpenWindows` rename would have silently
  broken availability answers without this.
- **Prompt-cache layering.** The static system message stays byte-identical and
  free of interpolated dates; the volatile half stays second.
- **One name, one meaning.** The prompt may not call a computed gap a "slot".
- **The turn loop** (`loop.ts`) against a scripted model: a tool that throws is
  fed back rather than killing the reply · acting-then-going-quiet still
  produces a summary · a `point_at`-only turn gets a caption · the round limit
  terminates · malformed tool JSON doesn't crash the turn · suggestions are
  parsed out and ids scrubbed.
- **The battery's own hygiene** — unique ids, no scenario asserting on a tool
  that doesn't exist, and this document and the suite covering the same groups.

### Tier 2 — behavioral (`npm run eval`, live model, costs tokens)

`tests/agent/`. One scenario = a fixture world + what the user says + what a
correct agent does about it. It runs the **real** system prompt, the **real**
message assembly, the **real** tool definitions and the **real** turn loop.
Two things are swapped:

- **The database is a fixture** (`world.ts`). Four worlds — `loaded`, `cold`,
  `traveling`, `overloaded` — each frozen at one instant so "today" and "this
  week" mean the same thing on every run. Fixtures rather than a live account
  on purpose: an account-shaped test passes for reasons nobody chose
  (Principle 16).
- **Tool calls are recorded, not executed.** A scenario asserts on what the
  agent *decided to do*, which is where chat bugs live. The handlers are
  ordinary code and are tested as ordinary code.

Assertions are about tools and arguments, not prose — `create_slot` once, at
`09:00`, with three items inside, and no `schedule_task`. Where the words are
the deliverable ("never say the week is empty"), the assertion is a narrow
regex over the reply, never a vibe.

**Pass rate, not pass/fail.** The thing under test is a sampled model. Every
scenario is weighted:

- **`must`** — the contract. Held to **100%**. One of these red is a broken
  chat, and a release should not go out over it.
- **`should`** — judgment. Held to **80%** over repeats. A dip is a place to go
  look, not a stop-ship.

```bash
npm run eval                      # every scenario, once each
npm run eval -- --group slots     # one capability
npm run eval -- --only slot-one   # one scenario
npm run eval -- --repeat 5        # five runs each → real pass rates
npm run eval:replay               # recorded runs: deterministic, free
```

A live run writes a **cassette** per scenario (`tests/agent/cassettes/`).
`eval:replay` replays them with no model at all. Replay can't catch a judgment
regression — only a live run can, which is why `npm run eval` is what gates a
prompt change — but it catches the whole plumbing class (a renamed tool, a
context field that stopped being sent, a loop that stopped feeding results
back) for free, on every push.

### The seams that made this possible

The agent function used to be one Deno file with the prompt, the loop and the
transport inline, reachable only by deploying it. It's now:

| File | What it owns | Importable outside Deno |
|---|---|---|
| `agent/prompt.ts` | the identity and every rule, as strings | ✅ |
| `agent/toolDefs.ts` | the vocabulary — every tool, as pure data | ✅ |
| `agent/contextShape.ts` | the snapshot's shape + its serializer | ✅ |
| `agent/turn.ts` | how a turn's messages are assembled | ✅ |
| `agent/loop.ts` | rounds, tool results, the empty-reply rules | ✅ |
| `agent/tools.ts` · `verticalTools.ts` | what a tool *does* (service role) | ❌ Deno |
| `agent/context.ts` | reading the account (service role) | ❌ Deno |
| `agent/index.ts` | HTTP, auth, SSE — wiring, and nothing else | ❌ Deno |

The rule that keeps it honest: **the battery never re-implements anything on
the left.** A battery holding its own copy of the prompt would pass while the
deployed chat did something else — which is the exact failure the planning
kernel was built to prevent (`docs/planning-kernel.md`).

---

## 3 · The capability map

What the chat is supposed to be able to do, against everything the app can do.
`✅` = a scenario pins it · `◐` = works, partially pinned · `○` = the chat
can't do it and should be able to · `—` = deliberately not the chat's job.

### A · Capture and placement — `capture`

| Capability | Tool | State |
|---|---|---|
| Free-text capture → inbox, nothing invented | `create_task` | ✅ `capture-inbox` |
| "Need to work on X" never becomes a date | — | ✅ `capture-no-phantom-date` |
| Items named against a project → that project's backlog | `create_task` | ✅ `capture-into-project` |
| Date only → planned · date + time → scheduled | `create_task` | ✅ `capture-timed` |
| Title hygiene — verb-first, no parent echo | `create_task` | ✅ `capture-title-hygiene` |
| Domain routing from `routingContext` | `create_task` | ◐ covered via `structure-routes-by-domain` |
| Voice / dictated capture | `create_task` | ◐ same path, no transcription scenario |
| Image attachments (a screenshot of a schedule) | — | ○ no scenario; the harness sends text only |

### B · Slots — one block of time that holds several tasks — `slots`

| Capability | Tool | State |
|---|---|---|
| One window + several pieces of work → ONE named block | `create_slot` | ✅ `slot-one-window-many-items` |
| The block's name is written by the agent, not echoed | `create_slot` | ✅ `slot-names-the-throughline` |
| One thing at a stated time is still a plain block | `schedule_task` | ✅ `slot-single-item-is-not-a-slot` |
| Adding to a block goes inside it | `add_to_slot` | ✅ `slot-add-to-existing` |
| Moving a block carries its work | `reschedule_slot` | ✅ `slot-move-carries-its-work` |
| Releasing a block keeps the work on the day | `delete_slot` | ◐ handler tested, no scenario |
| Held time reads as busy | context | ✅ `slot-time-is-busy` |
| Slot tied to a project / domain (standing time) | `create_slot` | ◐ argument supported, no scenario |
| Recurring slots ("every morning is Trading") | — | ○ `recurrences` exists; the chat can't write one |

### C · Calendar — `calendar`

| Capability | Tool | State |
|---|---|---|
| Create on the default when none is named | `create_calendar_event` | ✅ `cal-never-infers-from-subject` |
| A named calendar beats the stored default | `create_calendar_event` | ✅ `cal-named-calendar-wins` |
| Never infer a calendar from the subject | — | ✅ `cal-never-infers-from-subject` |
| Re-home rather than duplicate | `move_event` | ✅ `cal-move-not-duplicate` |
| Cancel / decline asks first | `cancel_event` | ✅ `cal-cancel-asks-first` |
| A confirmed cancel executes at once | `cancel_event` | ✅ `cal-confirmed-cancel-executes` |
| Reschedule an existing event | `reschedule_event` | ◐ no scenario |
| A booked meeting carries a real Meet link | `create_calendar_event` | ◐ pinned in `tests/conferencing.test.ts` |

### D · The week — `week`

| Capability | Tool | State |
|---|---|---|
| Reads the slate before saying anything about the week | context | ✅ `week-slate-is-not-empty` |
| Guided weekly plan: propose, then commit | — | ✅ `week-plan-proposes-first` |
| Bringing a bet onto the week carries its project | `create_priority` | ✅ `week-priority-carries-project` |
| Taking one off clears the span, keeps the work | `delete_priority` | ◐ no scenario |
| Recording a verdict | `complete_priority` | ◐ no scenario |
| Naming the cost on a full week | — | ✅ `week-overload-names-the-cost` |
| Composing the week's actual shape | — | — the composer is client-only (`useWeekDraft`); the chat proposes, the ritual places |

### E · Availability and judgment — `availability`

| Capability | Tool | State |
|---|---|---|
| Availability from computed windows only | context | ✅ `avail-from-windows-only` |
| Names a rolling item instead of re-dating it | — | ✅ `judgment-names-the-rollover` |
| An empty account gets an honest empty answer | — | ✅ `cold-account-invents-nothing` |
| "I have 40 minutes, what fits?" (ledger row **D3**) | — | ○ the chat is the surface that could close it |

### F · Structure — `structure`

| Capability | Tool | State |
|---|---|---|
| Create domain / initiative / project / key result | `create_*` | ◐ one scenario, one path |
| Route a new project to the right life area | `create_project` | ✅ `structure-routes-by-domain` |
| Never claim a write that failed | — | ✅ `structure-no-phantom-claims` |
| Delete duplicates — ask once, then execute | `delete_project` | ◐ no scenario |

### G · Showing alongside telling — `marquee`

| Capability | Tool | State |
|---|---|---|
| A data answer brings its surface forward | `point_at` | ✅ `marquee-points-at-the-answer` |
| A confirmation doesn't move the screen | — | ✅ `marquee-quiet-on-confirmations` |

### H · Guardrails — `guardrails`

| Capability | State |
|---|---|
| Off-topic → one sentence, no tools | ✅ `guard-off-topic` |
| No uuids or field names in a reply | ✅ `guard-no-ids-in-reply` |
| Ambiguity asks once, with tappable options | ✅ `guard-ambiguity-asks-once` |
| Undo — every write carries its inverse | ◐ pinned by shape, not by scenario |

---

## 4 · Adding to the battery

The bar for a scenario: it names something a person asked for, or a way the
chat was actually wrong. It must assert on **a tool, its arguments, or a
refusal to act** — "the model should be smart" is not a scenario.

1. Add it to `tests/agent/scenarios.ts` in the right group. Fill in `because:`
   when it comes from a real bug — the failure output prints it, and six months
   later that sentence is the whole reason the line is defensible.
2. `must` if a release should stop for it; `should` otherwise.
3. Record a cassette: `npm run eval -- --only <id>`.
4. Update the map above in the same commit — `npm test` fails when the map and
   the suite disagree about which groups exist.

New **capability**? It's a product change: run the anchor checks
(`CLAUDE.md` → Question Ledger row, the principle it strains, whether it was
already decided, the four no's) before the tool exists, then add the tool, the
scenario and the map row together.

---

## 5 · Known gaps, named rather than hidden

- **The handlers aren't driven end-to-end.** The battery asserts what the agent
  decided; nothing yet runs `executeTool` against a real database and checks
  the rows. A seam over `admin` (or a Supabase test project in CI) is the next
  real step — it's the difference between "asked for the right thing" and "the
  right thing happened".
- **Replay can't catch judgment.** Cassettes freeze one model's answers. They
  protect the plumbing; they say nothing about whether a prompt edit made the
  chat dumber. Only `npm run eval` does, and it costs tokens.
- **One model.** The battery runs whatever `AGENT_MODEL` points at. A model
  swap needs a full live run at `--repeat 5` before it ships.
- **No multi-turn drift test.** Scenarios are ≤3 turns. Nothing pins behavior
  across a long conversation, where the 24-message history cap starts dropping
  context.
- **Images aren't exercised.** The chat accepts screenshots; the harness sends
  text only.
