// The routing kernel — ONE definition of "which domain does this belong to",
// for every runtime that files work (the inbox groom, the Groom wall's project
// routing, the agent).
//
// A capture arrives with no home. Inside a project, slot or initiative it
// inherits (that is not decided here — `createTaskCore` and `captureDraft` do it
// structurally, with no model). What is left is a LOOSE item with only its words
// to go on. This file turns those words into a *question for a classifier* and a
// classifier's answer into a *tier* — and nothing else. It never calls anything.
//
// Why a kernel: the thresholds are the product decision. 0.8 is where a filing
// is written for you; 0.5 is where it is only offered. Written in two places
// they drift, and a drift here is silent — a task lands in the wrong life area
// and nothing tells you. Both sides import these numbers; `tests/domain-routing`
// holds them.
//
// Measured on a real account (193 distinct tasks, 7 domains, titles only):
//   top-prob ≥ 0.9 → 88% right on 23% of tasks     ≥ 0.8 → 83% on 36%
//   ≥ 0.7 → 73% on 43%                              ≥ 0.5 → 58% on 70%
// 83% is not "silent" — which is why a 0.8 filing is *visible and undoable*, and
// why below it we only ever propose. Several of the "misses" were the history
// being mis-filed (D-088), not the model; the threshold is chosen against the
// noisy key on purpose, so it is the conservative reading.
//
// Constraints that keep it importable from both runtimes (same as planningRules):
//   1 · ZERO imports.   2 · Pure — no Deno, no window, no I/O.

// ── the numbers ──────────────────────────────────────────────────────────────

/** At or above: the domain is written onto the capture (still in the Inbox),
 *  marked as automatic, with an Undo. Below: only proposed. */
export const ROUTE_AUTO = 0.8;
/** At or above: worth showing as a proposal (Accept / ✕). Below: say nothing. */
export const ROUTE_SUGGEST = 0.5;
/** A capture only descends from its domain into a specific project / initiative
 *  when it is unmistakable — over-filing into a project is the expensive mistake. */
export const ROUTE_DESCEND = 0.9;
/** Recent tasks quoted per domain as live examples. The measured lift came from
 *  these (80% → 88% at the top tier); more than a handful is just tokens. */
export const EXEMPLARS_PER_DOMAIN = 5;
/** A domain needs this many wrong filings before anyone is told its charter is
 *  broad, and at least this share of everything routed to it. */
export const BROAD_MIN_MISSES = 3;
export const BROAD_MIN_RATE = 0.3;
/** The same wrong→right pair this often is a boundary worth writing down. */
export const PAIR_MIN = 3;

export type RouteTier = "auto" | "suggest" | "none";

export function tierFor(confidence: number): RouteTier {
  if (!(confidence > 0)) return "none";
  if (confidence >= ROUTE_AUTO) return "auto";
  if (confidence >= ROUTE_SUGGEST) return "suggest";
  return "none";
}

// ── what a domain looks like to the classifier ───────────────────────────────

/** Everything the router reads about a domain. Both runtimes map into this. */
export interface RouteDomain {
  id: string;
  name: string;
  charter?: string | null;
  intention?: string | null;
  context?: {
    scope?: string;
    boundary?: string;
    keywords?: string[];
    entities?: string[];
    exemplars?: string[];
  } | null;
  /** Recent titles already confirmed to live here (see `pickExemplars`). */
  recent?: string[];
}

const squash = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

/** One domain's description for the classifier. The CHARTER leads — it is what
 *  the person said the domain is (enrichDomain's own law); examples only
 *  corroborate it. A domain with nothing but a name still gets a description,
 *  and the classifier will (correctly) abstain on it. */
export function describeDomain(d: RouteDomain): string {
  const c = d.context ?? {};
  const parts = [
    `${squash(d.name)}.`,
    squash(d.charter) || squash(d.intention),
    squash(c.scope),
    c.boundary ? `Not: ${squash(c.boundary)}` : "",
    c.entities?.length ? `Names: ${c.entities.map(squash).join(", ")}.` : "",
    c.keywords?.length ? `Keywords: ${c.keywords.map(squash).join(", ")}.` : "",
    c.exemplars?.length ? `Typical: ${c.exemplars.map(squash).join("; ")}.` : "",
    d.recent?.length ? `Recent tasks here: ${d.recent.map(squash).join("; ")}.` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

export const DOMAIN_QUESTION_NAME = "domain";

/** The `choice` question over the person's domains. No "none" option on purpose:
 *  in measurement a "none" bucket swallowed items a person finds obvious, and a
 *  *threshold on the distribution* abstains better than a bucket does. */
export function domainQuestion(domains: RouteDomain[]) {
  return {
    type: "choice" as const,
    name: DOMAIN_QUESTION_NAME,
    instructions:
      "Which life area does this belong to? Pick the one it clearly fits; do not guess. " +
      "Judge against each area's description, not against which area is largest.",
    choices: domains.map((d) => ({ value: d.id, description: describeDomain(d) })),
  };
}

// ── the request / the answer ─────────────────────────────────────────────────

export interface DecisionRequest {
  model: string;
  input: string;
  questions: ReturnType<typeof domainQuestion>[] | Array<Record<string, unknown>>;
}

export const DECISIONS_MODEL = "gpt-6-luna";

/** A capture's text as the classifier sees it: title, plus the person's note if
 *  they wrote one. Nothing else — no ids, no dates, no other tasks. */
export function captureText(title: string, notes?: string | null): string {
  const t = squash(title);
  const n = squash(notes);
  return n ? `${t}\n${n}` : t;
}

export function domainRequest(domains: RouteDomain[], text: string): DecisionRequest {
  return { model: DECISIONS_MODEL, input: text, questions: [domainQuestion(domains)] };
}

export interface RouteVerdict {
  /** The `value` of the winning choice — a domain id (or a project/initiative id for descent). */
  id: string;
  /** Top of the returned distribution. This, not the `confidence` field, is
   *  what the thresholds were measured against. */
  probability: number;
  tier: RouteTier;
}

/** Read one `choice` answer out of a `/v1/decisions` response. Returns null for
 *  a refusal, a missing answer, a value that isn't one of `validIds` (a
 *  hallucinated id must collapse to "no verdict", never a filing), or anything
 *  malformed. */
export function readChoice(
  response: unknown,
  name: string,
  validIds: ReadonlySet<string>,
): RouteVerdict | null {
  const answers = (response as { answers?: unknown } | null)?.answers;
  if (!Array.isArray(answers)) return null;
  const a = answers.find((x) => (x as { name?: unknown })?.name === name) as
    | { type?: string; choice?: unknown; probabilities?: unknown }
    | undefined;
  if (!a || a.type !== "choice" || typeof a.choice !== "string") return null;
  if (!validIds.has(a.choice)) return null;
  const probs = Array.isArray(a.probabilities) ? (a.probabilities as Array<{ value?: unknown; probability?: unknown }>) : [];
  const top = probs.reduce((m, p) => (typeof p.probability === "number" && p.probability > m ? p.probability : m), 0);
  return { id: a.choice, probability: top, tier: tierFor(top) };
}

export function readDomainVerdict(response: unknown, domains: RouteDomain[]): RouteVerdict | null {
  return readChoice(response, DOMAIN_QUESTION_NAME, new Set(domains.map((d) => d.id)));
}

// ── descent: domain → the specific project / initiative ──────────────────────

export interface RouteHome {
  id: string;
  kind: "project" | "initiative";
  name: string;
  outcome?: string | null;
}

export const HOME_QUESTION_NAME = "home";

/** A SECOND request, sent only after the domain is known and strong — it depends
 *  on the first answer, so it cannot ride in the same call. The fallback choice
 *  `__domain__` means "this is about the area, not any one bet". */
export const NO_HOME = "__domain__";

export function homeRequest(homes: RouteHome[], domainName: string, text: string): DecisionRequest {
  return {
    model: DECISIONS_MODEL,
    input: text,
    questions: [
      {
        type: "choice",
        name: HOME_QUESTION_NAME,
        instructions:
          `This belongs to ${squash(domainName)}. Is it unmistakably about ONE of these specific pieces of work? ` +
          `If it only fits the area in general, choose the general option.`,
        choices: [
          ...homes.map((h) => ({
            value: h.id,
            description: `${h.kind === "project" ? "Project" : "Initiative"}: ${squash(h.name)}${h.outcome ? ` — ${squash(h.outcome)}` : ""}`,
          })),
          { value: NO_HOME, description: "Just the area in general — none of the specific work above." },
        ],
      },
    ],
  };
}

/** Descend only past `ROUTE_DESCEND`. Anything weaker stays at the domain. */
export function readHome(response: unknown, homes: RouteHome[]): { home: RouteHome; probability: number } | null {
  const v = readChoice(response, HOME_QUESTION_NAME, new Set([...homes.map((h) => h.id), NO_HOME]));
  if (!v || v.id === NO_HOME || v.probability < ROUTE_DESCEND) return null;
  const home = homes.find((h) => h.id === v.id);
  return home ? { home, probability: v.probability } : null;
}

// ── self-feeding: which tasks are fit to teach the router ────────────────────

/** The minimum a task needs to be considered as an example. */
export interface ExemplarTask {
  title: string;
  createdAt: string;
  /** The domain the task actually counts toward (a parented task's parent's —
   *  `resolveDomainId`, D-088), already resolved by the caller. */
  domainId: string | null;
  trashed?: boolean;
  /** An automatic filing nobody has confirmed yet is NOT evidence: an example
   *  taught by the router's own unreviewed guess is how an error reinforces
   *  itself. */
  autoUnconfirmed?: boolean;
}

/** Newest-first confirmed titles per domain, de-duplicated, capped. */
export function pickExemplars(tasks: ExemplarTask[], limit = EXEMPLARS_PER_DOMAIN): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const sorted = [...tasks].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  for (const t of sorted) {
    if (!t.domainId || t.trashed || t.autoUnconfirmed) continue;
    const title = squash(t.title);
    if (title.length < 3) continue;
    const list = out.get(t.domainId) ?? [];
    if (list.length >= limit || list.some((x) => x.toLowerCase() === title.toLowerCase())) continue;
    list.push(title.length > 80 ? `${title.slice(0, 79)}…` : title);
    out.set(t.domainId, list);
  }
  return out;
}

// ── self-feeding: what the corrections say ───────────────────────────────────

export type RouteOutcome = "confirmed" | "accepted" | "undone" | "corrected" | "rejected";

/** One reviewed routing. `suggestedId` is where the router sent it; `finalId` is
 *  where the person put it (null = they took it out and filed it nowhere). */
export interface RouteEvent {
  title: string;
  suggestedId: string;
  finalId: string | null;
  outcome: RouteOutcome;
}

/** An outcome that says the router was wrong. */
export const isMiss = (o: RouteOutcome): boolean => o === "undone" || o === "corrected" || o === "rejected";
/** An outcome that says the router was right. */
export const isHit = (o: RouteOutcome): boolean => o === "confirmed" || o === "accepted";

export interface PairMiss {
  fromId: string;
  /** null when the person undid the filing without choosing another home. */
  toId: string | null;
  titles: string[];
}

export interface DomainHealth {
  domainId: string;
  routed: number;
  missed: number;
  rate: number;
  /** Plain-English, only when the evidence clears the bar. Never an imperative (P4). */
  broad: boolean;
}

export interface RoutingReadout {
  /** Repeated wrong→right pairs — raw material for a `boundary` line. */
  pairs: PairMiss[];
  health: Map<string, DomainHealth>;
}

/** Fold reviewed routings into the two things a domain can be told:
 *  "you keep losing work to/from X" (pairs) and "you absorb wrong answers"
 *  (health.broad). Pure counting — the *wording* is the model's job inside
 *  enrichDomain, which only proposes. */
export function readRouting(events: RouteEvent[]): RoutingReadout {
  const counts = new Map<string, DomainHealth>();
  const pairMap = new Map<string, PairMiss>();
  for (const e of events) {
    const h = counts.get(e.suggestedId) ?? { domainId: e.suggestedId, routed: 0, missed: 0, rate: 0, broad: false };
    h.routed += 1;
    if (isMiss(e.outcome)) {
      h.missed += 1;
      // "rejected" has no destination; only a real move names a pair.
      if (e.outcome !== "rejected") {
        const key = `${e.suggestedId}>${e.finalId ?? ""}`;
        const p = pairMap.get(key) ?? { fromId: e.suggestedId, toId: e.finalId, titles: [] };
        if (p.titles.length < 6) p.titles.push(squash(e.title));
        pairMap.set(key, p);
      }
    }
    counts.set(e.suggestedId, h);
  }
  const health = new Map<string, DomainHealth>();
  for (const [id, h] of counts) {
    const rate = h.routed ? h.missed / h.routed : 0;
    health.set(id, { ...h, rate, broad: h.missed >= BROAD_MIN_MISSES && rate >= BROAD_MIN_RATE });
  }
  const pairs = [...pairMap.values()]
    .filter((p) => pairCount(events, p) >= PAIR_MIN)
    .sort((a, b) => pairCount(events, b) - pairCount(events, a));
  return { pairs, health };
}

function pairCount(events: RouteEvent[], p: PairMiss): number {
  let n = 0;
  for (const e of events) if (isMiss(e.outcome) && e.outcome !== "rejected" && e.suggestedId === p.fromId && e.finalId === p.toId) n += 1;
  return n;
}
