# Domain routing — one description of a domain, for every path that files into it

Status: **shipped** (2026-08-07). How Nuvo decides *which life area does this belong to* — for a
capture, a project, a meeting and a chat turn — and why that answer used to differ depending on
which door the item came through. Builds on the same doctrine as
[`planning-kernel.md`](./planning-kernel.md) ("one rule, two runtimes"), applied to filing rather
than to the week. Sibling of [`grooming-lenses.md`](./grooming-lenses.md), which grooms an *item*;
this grooms the *domain* the item lands in.

**Six paths file something into a domain. They now share one description of what a domain is.**
Before this, each one serialized `domains.context` by hand, and four of the six threw most of it
away — which is how `keywords` and `exemplars` came to be generated on every groomed domain,
rendered in the UI, and read by no router at all.

---

## 1 · The two halves

**Generation** — `enrichDomain` (`supabase/functions/agent/enrichDomain.ts`) expands the human's
one-line **charter** into machine-facing routing context. The charter is authoritative: the work
currently filed under a domain can't define it, because that work is exactly what may be mis-filed.

**Delivery** — the **routing kernel** (`supabase/functions/_shared/domainRouting.ts`) turns that
context into the lines a classifier reads. Zero imports, pure, importable from Deno and the
browser, same constraints as `planningRules.ts`.

Generation without delivery is the failure this doc exists to prevent: a field added to the
generator improved exactly one of six paths and silently did nothing for the rest.

## 2 · The vocabulary

`domains.context` is `jsonb` (`00000000000023_domain_context.sql`), so the shape grows without a
migration. **Every field after the first five is optional** — a context written before they existed
must keep routing unchanged, forever.

| Field | Cap | Why it discriminates | Rendered |
|---|---|---|---|
| `scope` | 1 sentence | what this is | `is:` |
| `people` | 12 | named humans **with their role** — the role is what routes "reply to Obi" when the charter never says Obi, and what makes an unfamiliar colleague from the same place still land here | `who:` |
| `entities` | 15 | orgs, products, codenames; aliases folded ("SCE / Southern California Edison") | `signals:` |
| `activities` | 10 | the recurring things you *do* here. **Usually the highest-yield field**: captures and calendar events name an action far more often than a proper noun | `does:` |
| `artifacts` | 10 | tools, systems, accounts, recurring documents. "Upload the receipts to Dext" names only the tool | `uses:` |
| `places` | 6 | venues, offices, campuses | `at:` |
| `keywords` | 10 | recurring topic words | `words:` |
| `exemplars` | 4 | capture-like phrases that belong here | `sounds like:` |
| `boundary` | 1 line | what separates it from its most confusable sibling | `NOT:` |
| `counterExemplars` | 4 | phrases that **look** like this domain but belong to a named sibling | `looks like this but ISN'T:` |

**`counterExemplars` is the precision field.** Both routers already carried hand-written
anti-stretch prose, because the observed failure is a *near-miss between two confusable domains* —
a generic item pulled onto a signal-rich domain that happens to share a word. More positive signal
raises recall and *lowers* precision; a concrete negative example, naming the sibling, is the only
field that raises precision.

**Deliberately not a field: `verbs`.** Bare verbs ("review", "ship", "call", "plan") are the least
domain-discriminative token class in a planner — every domain does all of them — and they would
poison `domainCorpus`, where the offline matcher scores raw token overlap and would begin matching
on "review". `activities` carries the useful half ("sermon prep", not "prep").

## 3 · The six paths

| Path | Where | Kind |
|---|---|---|
| Chat agent | `agent/context.ts` → `agent/prompt.ts` | LLM, whole blob as `routingContext` |
| Passive inbox grooming | `agent/enrichInbox.ts` | LLM, batched, cached on `tasks.suggestion` |
| Calendar events | `route-events/index.ts` | LLM, batched, cached in `event_domain_routing` |
| Project → domain | `src/lib/groomAI.ts` | LLM, one-shot on the Groom wall |
| Initiative / shipped-work matcher | `src/lib/initiativeDeck.ts` | heuristic token overlap, no model |
| Proposal engine | `agent/proposalContext.ts` | LLM, display blurb |

All of them call `domainRoutingBlock()` or `domainCorpus()`. `tests/domain-routing.test.ts` fails if
a seventh copy appears — it greps for a hand-built `signals:` line, for a redeclared narrow
`DomainContext`, and for the retired catch-all name regex.

## 4 · The catch-all is structural, not a name

A catch-all domain is defined by **exclusions**: it has no positive signals of its own, so a
classifier weak-matches every residual item onto whichever signal-rich domain shares a word. It has
to be named explicitly in the prompt.

The old rule was `/personal|life|misc|other/i` against the domain's **name**. That is Principle 16
in one line — it holds in an account whose catch-all happens to be called "Personal" and silently
mis-fires everywhere else. `catchAllDomain()` now picks the one domain with no discriminating
signals and no boundary; the name is demoted to a tiebreaker for the case where several domains are
equally blank, which is the only situation the old rule was doing real work in. **If it is still
ambiguous there is no catch-all** — guessing between two blank domains is worse than admitting we
don't know.

`domainRoutingBlock(..., { noCatchAll: true })` suppresses it where a residual answer is meaningless:
routing a *project* into "miscellaneous" is not a real answer.

## 5 · What the item brings

A domain can only be as accurate as the thing being routed. The calendar router saw a **title and a
calendar name** — enough for "SCE quarterly review", useless for "1:1", "Sync", "Coffee", which is
most of a working week.

`_shared/eventSignal.ts` reads what each provider actually stores in `external_events.raw` — Google
(`attendees[].email/displayName`, `description`), Microsoft Graph (`attendees[].emailAddress`,
`bodyPreview`), iCloud (only caldav refs → degrade to nothing) — and emits attendees, location and a
de-boilerplated description. Resolved **server-side**: `useExternalEvents` deliberately doesn't
select `raw`, and attendee addresses have no business making a round trip through the browser.

Each attendee carries their **org domain** — `Obi Nwosu (@sce.com)`. The org is frequently a stronger
signal than the person: an unfamiliar name from a known employer still points at the day job.

> ⚠️ **The dedup key had to widen with it.** The router routes each unique *question* once and fans
> the verdict to every instance — what stops a daily standup costing thirty completions. Keyed on
> title alone, a 1:1 with your manager and a 1:1 with your pastor collapse into **one** verdict,
> discarding the signal that was just added. `eventSignalKey` keys on title + calendar + the sorted
> set of attendee **org domains**: it separates the cases that route differently without making
> every guest-list permutation its own completion.

## 6 · Verdicts re-open when the domains change

Both caches are permanent by design — a verdict is never re-spent. That was also the bug:
re-grooming a domain, editing a charter, or **adding a whole new domain** re-opened nothing, so the
wall kept showing verdicts formed before the domain existed. Ship a better router without this and
the user observes almost no change.

The rule needs no new column, because both halves already existed:

```
epoch = max over domains of (context_at ?? created_at)
a cached verdict is stale  ⟺  routed_at < epoch
```

Correct on all three events. Re-groomed → `context_at` moves. **New domain** → its `created_at` is
the max (the case a per-verdict context hash handles *worse*, since a new domain has no context at
all). Deleted → `event_domain_routing.domain_id` cascades and those rows vanish. Convergence is
structural: a re-routed key is stamped `now()`, which is `> epoch`.

Clamped to `now`, because `context_at` is written by the **browser** — a client clock running fast
would push the epoch into the future and re-open everything on every load, forever.

**Three guards on the spend**, because this is the code that decides how much the app costs:

1. The per-session `attempted` set is untouched — at most one completion per event per load, even if
   the cache read comes back incomplete.
2. `selectRoutingCandidates` (`src/lib/eventRouting.ts`) takes never-routed events **first**, then
   stale ones (unattributed before attributed, newest before oldest), capped by `STALE_BUDGET`. It is
   a pure function so the billing rule is testable without mounting React — see D-085 for why that
   matters.
3. `updateDomain` moves `context_at` only when `routingFingerprint` actually changed, so re-accepting
   an identical groom doesn't cost a full re-route sweep.

The same epoch invalidates `tasks.suggestion` through `needsGrooming(task, epoch)` — except for
**dismissed** suggestions, which stay dismissed: the user already ruled on that capture, and
re-asking because an unrelated domain changed is nagging.

## 7 · Confidence is now read

`confidence` has been collected on every routed event since the table existed and read by nobody, so
a 0.1 guess counted exactly like a 0.99. Below `ROUTING_CONFIDENCE_FLOOR` (0.4) a verdict stays
**cached** — never re-spend on it — but reads as unattributed rather than as fact. Honest emptiness
over confident fiction; the wall's hours are only as true as the attribution behind them.

Same floor on inbox placements, where it drops the *placement* and keeps the duration and energy —
those are separate judgments. A human correction always wins: `useEventRoutingMutations` writes
`confidence: 1` explicitly, because a partial upsert leaves the column alone and the correction
would otherwise inherit the model's score and be filtered out by its own floor.

## 8 · Clarity can no longer over-promise

`clarityOf` scored `entities + keywords` and called anything above zero **"clear · groomed"** —
while no router serialized keywords. It promised routing the app could not deliver, which is the one
thing a clarity mark must never do. It reads `routingStrength()` from the kernel now, which counts
only what the serializer emits (named things ×2, describing words ×1), with a middle state —
**"routes loosely"** — for a domain that has something but not enough.

Because the score lives beside the serializer, the mark can't drift from what the routers read again.

## 9 · Where the charter comes from

The charter is the whole foundation and nothing used to ask for it. `FirstRun` now offers one
optional line per domain ("who and what belongs here"), and the domain's clarity mark is a tap
straight into the grooming workbench. Both are **optional** — an account with every charter blank is
fully usable, and the serializer degrades to name + charter + intention (Principle 7). What changes
is that the thinnest possible signal is no longer the silent default.

`enrichDomain` also reads one corpus besides the charter: the **calendars the person themself mapped
to this domain** in Settings → Connections. That mapping is a human decision, not a model's, so the
recurring meeting titles on it are real evidence of what the domain does — and grounded by
construction. `event_domain_routing` verdicts are deliberately *not* fed back: they are this
system's own output, and re-reading them would amplify its own mistakes.

## 10 · Grounding

Proper nouns are filtered against the charter, the vow, the mapped-calendar titles and the children
that *fit* — so a mistakenly-tagged "Obi" can't seed Family's context. A wrong proper noun is the
expensive kind of wrong: it can capture another domain's work outright.

Two fixes to that filter:

- **Alias chaining.** An entity survives if it shares a token with something already grounded, which
  is what lets "Southern California Edison" through on the back of a grounded "SCE". The prompt asks
  for exactly that folding and the old single-pass filter then deleted it.
- **Scoped to proper nouns.** `activities`, `artifacts`, `keywords`, `exemplars` and
  `counterExemplars` are inferential by design — a one-line charter will never literally contain
  "sermon prep" — and a wrong guess there is cheap: it simply matches nothing. Filtering them only
  deleted correct inferences, and would have deleted most of the new fields.

## 11 · Verifying it

`npm test` covers the deterministic half — the serializer's output for a v1 blob, a v2 blob and a
malformed one; the catch-all rule without its name regex; the epoch and its clamp; each provider's
`raw` shape; the candidate-selection billing guards; and the drift guard.

The UI half is drivable here without credentials: `?domains` (`src/components/mobile/DomainHarness.tsx`)
renders the wall, the open domain and the desktop floor over fixtures — one fully-groomed v2 context
and one keywords-only domain, so the chip rows and the "routes loosely" state are both exercised.

The accuracy claim can't be checked in CI, because only real domains and real meeting titles prove
the model routes them correctly. `npm run routing:check` replays your live account against the new
prompts and diffs the verdicts against what's cached — **strictly read-only**, it never writes a row:

```
npm run routing:check                  # how every domain reads to a router + strength per domain
npm run routing:check -- --events 60   # replay real meetings, diff vs the cache
npm run routing:check -- --inbox       # replay the current inbox
npm run routing:check -- --domain SCE  # the stored context for one domain
```

## 12 · Deploy

`supabase functions deploy agent` **and** `supabase functions deploy route-events` — both bundle
`_shared/`, so the kernel ships with each. **No migration**: the context is jsonb and the staleness
rule reads columns that already exist.

Expect a one-time catch-up after deploying: every cached verdict predating the current domains is
stale, so the sweep re-routes them at `STALE_BUDGET` per load until it converges. Un-routed events
keep priority throughout.
