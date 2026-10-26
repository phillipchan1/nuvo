# Domain routing — filing a capture without asking

Status: **built, not yet deployed** (2026-10-20 · D-159). Source:
`supabase/functions/_shared/domainRouting.ts` (the kernel),
`supabase/functions/agent/decisions.ts` (the classifier call),
`supabase/functions/agent/enrichInbox.ts` (where it runs),
`supabase/functions/agent/routingHistory.ts` (the report card).
Enforced by `tests/domain-routing.test.ts` and `tests/auto-file.test.ts`.
Closes the *follow-through* of ledger row **D6** (capture → where does it go) and keeps
**W8 / W5 / Q7** truthful — those answer wrongly when work is filed under the wrong domain
(D-085, D-088).

## The decision tree

1. **It already has a home → inherit it. No model.** Created inside a project, slot or
   initiative, the domain is that parent's (`createTaskCore`, `captureDraft`). This is most
   real capture, and it is deliberately not the router's business.
2. **It is loose → ask the classifier.** One `choice` question over the person's domains,
   read from their **charter first** (`describeDomain`), plus each domain's five newest
   *confirmed* tasks as live examples. Via the OpenAI **Decisions API** (`gpt-6-luna`,
   `POST /v1/decisions`): a classifier with a probability distribution, billed on input only.
3. **Read the top probability, not a self-reported confidence.**

   | Top probability | What happens | Why |
   |---|---|---|
   | **≥ 0.8** | The domain is **written** onto the capture. It stays in the Inbox. The row shows it as filed, with **Undo**. | Measured 83% right on 36% of tasks. Visible and undoable, never silent. |
   | **0.5 – 0.8** | **Proposed** — the Inbox's existing *Accept / ✕*. | 58–73% right. Good for a chip, not for a write. |
   | **< 0.5** | Nothing shown. | A bare title is genuinely ambiguous ("Deploy"). |
   | **≥ 0.9 and a specific project/initiative in that domain fits unmistakably** | Proposed *at that altitude* (a second, dependent request). Never auto-written. | Over-filing into a project is the expensive mistake. |

4. **No classifier → the old path.** No `OPENAI_API_KEY` (OpenRouter does not serve this
   endpoint), a 4xx (it is in public beta; one reviewer saw "not enabled for your account"),
   or a timeout: that capture falls through to the chat-model grooming `enrichInbox` always
   had. A failure here is never a failed groom.

## What it does *not* do

- **It never moves a capture out of the Inbox.** Filing out of triage is a separate,
  deliberate act (A1). It only fills the *domain*, the lowest-stakes field.
- **It never schedules.** No date, no block, no slot (N-01).
- **It never overwrites a hand.** The write is guarded `domain_id IS NULL AND project_id IS
  NULL AND initiative_id IS NULL`; a capture the person filed while it was thinking keeps
  their filing, and the guess is spent.
- **It does not add a surface or a name.** The Inbox's row, the Groom wall's chip and the
  domain floor's *How Nuvo files things here* panel already existed. The only new word is
  *Undo*.

## Self-feeding — no new store

Every verdict lives on the task's existing `suggestion` JSON (`outcome`):

| Outcome | Set when |
|---|---|
| `accepted` | Accept on a proposal |
| `rejected` | ✕ on a proposal |
| `undone` | Undo on an automatic filing |
| `corrected` | The person re-filed it to a *different* domain (`patchTask`'s refile guard) |
| `confirmed` | Re-filed to the *same* domain — or, **inferred**, an automatic filing triaged out of the Inbox with its domain intact and never undone |

- **Examples:** the newest confirmed tasks per domain are quoted to the classifier. A parented
  task counts for its **parent's** domain (D-088), and an **automatic filing nobody has
  reviewed does not count** — a router that learns from its own unreviewed guess reinforces
  its errors.
- **Misses → boundary:** `readRouting` (kernel) folds the outcomes into repeated
  wrong→right *pairs* (≥ 3) and per-domain *health*. `enrichDomain` is told the pairs
  and asked to sharpen the **boundary line only** — never the scope. Same *propose, then
  Accept* flow as before.
- **Broad domain:** a domain with ≥ 3 misses **and** ≥ 30% of what was routed to it gets a
  plain-English note in *How Nuvo files things here* — a report, not an instruction (P4).

## Projects

`routeProject` (agent) runs the same router for the Groom wall's *"looks like Frontier"* chip.
Proposal only, as before; falls back to the old chat guess when there is no verdict.

## Evidence this was built on

A real account, 193 distinct filed tasks, 7 domains, **titles only**:

| Setup | Top-prob ≥ 0.9 | ≥ 0.8 | ≥ 0.7 |
|---|---|---|---|
| Charters, Personal as a competing choice | 19% filed · 81% right | 31% · 58% | 41% · 51% |
| Personal removed (it was a sink) | 27% · 80% | 40% · 67% | 50% · 60% |
| **Personal removed + 5 recent tasks per domain** | **23% · 88%** | **36% · 83%** | **43% · 73%** |

Two lessons are baked into the kernel: **a catch-all domain must not be a competing choice**
(it swallowed 83 of 193), and **examples beat a smarter model**. Several "misses" were the
history being mis-filed, so the measured numbers are the *conservative* reading.

## Open

- **Not deployed or driven against production.** The edge path has only been parse-checked
  (no Deno here); the classifier call was verified against the live API with a probe, and the
  Inbox row's three states were driven in the dev app on both shells.
- **Gym and lunch** — the case that started this — was not in the sampled history. Verify on
  real captures after deploy.
- **Beta.** `/v1/decisions` limits (choices per request, rate) are unstated. The fallback is
  the safety net; watch for the share of captures served by `engine: "llm"`.
- **Thresholds are a first reading.** Re-tune from real `outcome`s, not from this table.
