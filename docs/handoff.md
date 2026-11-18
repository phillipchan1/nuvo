# Hand-off — give a task to an agent you own

Status: **live** (2026-11-18 · D-250) — migration 96 on Neon (backup branch `pre-handoffs-20261118`), API Worker `dbabc18c`. Not yet driven against a live Grok Bot routine. Sits on [`mcp.md`](./mcp.md) (D-112): the
agent is a Full account token, and everything it does goes through the MCP server.

## 1 · The shape

```
You: right-click a task → Hand to Grok Bot → (optional line) ↵
  → POST /api/handoff {action:"hand"}           (session-authed, the Worker)
      tasks.handed_to = <connection>, start_time = null
      handoffs row (outcome 'open', your note)
      ring the doorbell, if the agent has one    (waitUntil, wake-only body)

Agent (on the doorbell, or on its own schedule):
  → MCP list_handoffs                            (only this token's open hand-offs)
  → MCP get_handoff {task_id}                    (the brief)
  → … does the work …
  → MCP report_handoff {task_id, outcome: done|back, note}
      done: task status 'done', handed_to kept  → "Done by Grok Bot"
      back: handed_to null, clock unchanged      → yours again, note on the hand-off
```

Why pull and not push: only Grok Bot has an inbound trigger, and its webhook body is reported as
unreliable (a 200 can mean nothing ran). Muse, Claude Duet and dots have no webhook at all, but all
of them can be MCP clients. So the task never travels in the doorbell; the doorbell only says
"you have work" (D-250 has the research).

## 2 · Data (migration 96, mirrored in `worker/schema/neon.sql`)

| Column / table | Meaning |
|---|---|
| `connections.takes_handoffs boolean` | This Full account token can be handed tasks. Its `name` is what the act says. |
| `connections.doorbell_url text` | Optional. `https://` only, SSRF-checked at ring time. |
| `connections.doorbell_key_enc/_iv/_key_version` | The doorbell's bearer, sealed with `sealToken` (AAD `connections:<id>:<user>`). Never readable over REST. |
| `tasks.handed_to uuid → connections` | Who the task is with. Kept after **done** so the row can say *Done by*. `ON DELETE SET NULL`. |
| `handoffs` | One row per attempt: `task_id`, `connection_id`, `note` (yours), `outcome` (`open · done · back · recalled`), `agent_note`, `rang_at`, `ring_error`, `closed_at`. Read-only over REST. |

A revoked token can't call MCP, so its open hand-offs would sit forever: revoking (or switching off
*Takes hand-offs*) is answered by the app showing **With X** with **Take back** — nothing is silently
reassigned.

## 3 · The brief — `buildHandoffBrief` (`supabase/functions/_shared/handoff.ts`, pure)

Everything about the task, so the agent needs no second call to start:

- the task: title, notes, steps (done or not), day, deadline, duration, priority, energy, how many
  times it has rolled
- **your line**, from the hand-off
- its project: name, outcome ("done means"), status, the other open tasks and the recently done ones
- its domain's name
- earlier hand-offs of this task and why they came back
- `answer_with`: how to reply (`report_handoff` with `done` or `back`)

The agent still has the full Full-account tool list, so it can read further (`get_snapshot`).

## 4 · The doorbell

`POST <doorbell_url>` with `Authorization: Bearer <key>` and
`{"source":"nuvo","message":"Nuvo: you have N task(s) handed to you. Call list_handoffs on the Nuvo MCP server."}`.
10s timeout, one try per hand-off; the outcome lands on the hand-off (`rang_at` or `ring_error`).
Settings has **Ring** to test it.

For Grok Bot: create a routine with a **Webhook** trigger, copy its URL and key into the doorbell,
and give the routine these instructions:

> When this runs, use the Nuvo connector. Call `list_handoffs`. For each task: call `get_handoff`,
> do the work it describes, then call `report_handoff` with `outcome: "done"` and a short note of
> what you did — or `outcome: "back"` and a note saying what stopped you. Never leave one open.

## 5 · The week and the day

A task that is **With** an agent is not the operator's hour:

- it leaves the week's demand and its project's remaining time (`isHandedOff` in
  `planningRules.ts`, read through the derived `VTask.assignee`);
- it is neither placed nor loose in the week crown, so it never says "needs a time"
  (`splitFor` in `useFindTime.ts`), and Find time offers it no hold (`useTodayHolds`);
- it is not one of **today's own tasks** (`dayReadiness`, both runtimes) — open *or* done by the
  agent — so the day ring measures your day and doesn't jump when an agent reports back.

It still shows in the lists it belongs to, reading **With X** / **Done by X**.

## 6 · Not done, on purpose

- No "agents" wall, no per-agent integration code. One mechanism; Grok Bot is the first driven.
- No push of the task body anywhere.
- No narrower token scope yet: the agent's token opens the whole account, as D-112 already does.
- `tasks.assignee` (migration 4, `'me' | 'agent'`) was never written by anything and can't say
  *which* agent. It stays as it is; the app's `VTask.assignee` is now *derived* from `handed_to`.
- A task the agent finished still counts toward an initiative's *invested hours* (done work that
  served it). Arguable; left alone until someone reads that number and asks.
- "Hand to X" sits beside the older **Hand the pre-work to Nuvo** in the task popover — two
  "hand" acts with different meanings (P11). Left as is; see D-250.
- No QA scenario yet: the catalog (`qa/`) isn't on `master`. When it lands, add one for
  Apps & devices → Takes hand-offs → Hand to … → With ….
