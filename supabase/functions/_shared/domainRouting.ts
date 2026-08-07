// The routing kernel — ONE definition of "how a domain describes itself to a
// classifier", for every path that files something into a domain.
//
// Nuvo decides "which domain does this belong to" in six independent places, and
// until this file existed each one re-serialized `domains.context` by hand. They
// had drifted into four different vocabularies:
//
//   · the chat agent got the whole blob as raw JSON
//   · passive inbox grooming and the event router each built their own
//     `scope · signals: … · NOT: …` line, dropping `keywords` and `exemplars`
//   · the project router (`groomAI.suggestDomain`) saw only `name: charter (scope)`
//     — it routed projects on two of the seven fields we generate
//   · `exemplars` was generated, capped, stored, and read by nothing at all
//
// So a field added to `enrichDomain` improved exactly one path and silently did
// nothing for the other five. The rules live here now, once, and every path
// imports this file. `tests/domain-routing.test.ts` fails if a surface builds its
// own domain routing line.
//
// Constraints that keep it importable from both runtimes — don't break them:
//   1 · ZERO imports. Deno resolves no bare specifiers here, and the browser
//       bundle should not grow a dependency to render seven strings.
//   2 · Pure. No `Deno`, no `window`, no `supabase`, no I/O.
//   3 · It lives under `supabase/functions/_shared/` because the edge bundler
//       only guarantees that path; Vite can import from anywhere in the repo.
//       Read it as "shared kernel", not as "server code".

// ── the vocabulary ───────────────────────────────────────────────────────────

/** Machine-facing routing context — what `enrichDomain` proposes and the human
 *  accepts. The first five fields are the original shape and are always present
 *  on a persisted blob; everything after is optional, so a context written
 *  before those fields existed still renders correctly. Never make one required. */
export interface DomainContext {
  /** ONE sentence on what this domain is. */
  scope: string;
  /** Proper nouns that signal this domain — orgs, products, codenames. */
  entities: string[];
  /** Recurring non-proper topic words. */
  keywords: string[];
  /** One line distinguishing it from its most confusable sibling. */
  boundary: string;
  /** Capture-like phrases that clearly belong here. */
  exemplars: string[];
  /** Recurring verbs/rituals — "sermon prep", "standup", "backtest a setup".
   *  Captures name an action far more often than a proper noun. */
  activities?: string[];
  /** Named humans WITH their role — "Obi — my manager at SCE". The role is what
   *  lets a classifier route "reply to Obi" when the charter never says "Obi". */
  people?: string[];
  /** Tools, systems, apps, repos, documents, accounts. */
  artifacts?: string[];
  /** Venues, offices, rooms. */
  places?: string[];
  /** Capture-like phrases that LOOK like this domain but belong to a named
   *  sibling. Near-misses between two confusable domains are the failure mode a
   *  single `boundary` sentence cannot express. */
  counterExemplars?: string[];
}

/** Everything a routing rule needs to know about a domain. Both runtimes map
 *  into this: the client's `Domain` already matches structurally, the server's
 *  row goes through {@link fromDomainRow}. */
export interface RoutableDomain {
  id: string;
  name: string;
  intention?: string | null;
  charter?: string | null;
  context: DomainContext | null;
}

/** A Supabase `domains` row, as far as the routing rules care. */
export interface DomainRow {
  id: string;
  name: string;
  intention?: string | null;
  charter?: string | null;
  context?: unknown;
}

/** Below this, a model's own stated confidence is a coin flip. A verdict under
 *  the floor is still CACHED (we never re-spend on it) but is not read as fact —
 *  it shows as unattributed rather than quietly inventing an hour on the wall. */
export const ROUTING_CONFIDENCE_FLOOR = 0.4;

// ── normalizing ──────────────────────────────────────────────────────────────

// deno-lint-ignore no-control-regex
const CONTROL = /[\x00-\x1F\x7F]/g;

/** Strip control characters and collapse whitespace. Both runtimes feed this
 *  straight into a prompt, so a stray newline in a user's charter would forge a
 *  line break in the domain block and confuse the id parsing. */
export function cleanText(s: unknown, max = 0): string {
  const out = (typeof s === "string" ? s : "").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  return max > 0 ? out.slice(0, max) : out;
}

function cleanItems(xs: unknown, max: number, cap = 48): string[] {
  if (!Array.isArray(xs)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const v = cleanText(x, cap);
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/** Per-field caps — one table, applied by `enrichDomain` on the way in and by
 *  the serializer on the way out, so a hand-edited blob can't blow a prompt. */
const CAPS: Record<string, { max: number; cap: number }> = {
  entities: { max: 15, cap: 48 },
  keywords: { max: 10, cap: 48 },
  exemplars: { max: 4, cap: 80 },
  activities: { max: 10, cap: 48 },
  people: { max: 12, cap: 64 },
  artifacts: { max: 10, cap: 48 },
  places: { max: 6, cap: 48 },
  counterExemplars: { max: 4, cap: 96 },
};

/** Coerce anything (a jsonb blob, a model's raw JSON) into a valid context.
 *  Returns null ONLY when there is no blob at all — a groomed-but-sparse domain
 *  keeps its (empty) context, because "groomed and Nuvo found little" and "never
 *  groomed" are different states and the UI voices them differently. */
export function normalizeContext(raw: unknown): DomainContext | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  return {
    scope: cleanText(r.scope, 200),
    entities: cleanItems(r.entities, CAPS.entities.max, CAPS.entities.cap),
    keywords: cleanItems(r.keywords, CAPS.keywords.max, CAPS.keywords.cap),
    boundary: cleanText(r.boundary, 200),
    exemplars: cleanItems(r.exemplars, CAPS.exemplars.max, CAPS.exemplars.cap),
    activities: cleanItems(r.activities, CAPS.activities.max, CAPS.activities.cap),
    people: cleanItems(r.people, CAPS.people.max, CAPS.people.cap),
    artifacts: cleanItems(r.artifacts, CAPS.artifacts.max, CAPS.artifacts.cap),
    places: cleanItems(r.places, CAPS.places.max, CAPS.places.cap),
    counterExemplars: cleanItems(r.counterExemplars, CAPS.counterExemplars.max, CAPS.counterExemplars.cap),
  };
}

/** A `domains` row → the routing vocabulary. */
export function fromDomainRow(row: DomainRow): RoutableDomain {
  return {
    id: row.id,
    name: cleanText(row.name),
    intention: row.intention ?? null,
    charter: row.charter ?? null,
    context: normalizeContext(row.context),
  };
}

// ── what makes a domain routable ─────────────────────────────────────────────

/** How much routing signal a domain actually carries, counting ONLY what
 *  {@link domainRoutingLine} emits — so a UI clarity mark can never again claim
 *  "clear" on a field no router reads (which is exactly what it did while
 *  `keywords` scored toward clarity and reached no router).
 *
 *  Weighted, because the classes are not equal. Named things, named actions and
 *  named near-misses decide a close call; `scope` and `keywords` describe a
 *  domain but rarely separate it from its neighbour — two domains can both be
 *  "the work I do for people I care about". */
export function routingStrength(d: RoutableDomain): number {
  const c = d.context;
  if (!c) return 0;
  const n = (xs?: string[]) => (xs?.length ?? 0);
  const strong = c.entities.length + n(c.people) + n(c.activities) + n(c.counterExemplars);
  const weak = n(c.artifacts) + n(c.places) + c.keywords.length + c.exemplars.length + (c.boundary ? 1 : 0);
  return strong * 2 + weak;
}

/** Signals that separate this domain from a sibling — the test for "can a
 *  classifier tell this apart", as opposed to "has it been groomed". */
export function discriminatingSignals(d: RoutableDomain): number {
  const c = d.context;
  if (!c) return 0;
  const n = (xs?: string[]) => (xs?.length ?? 0);
  return c.entities.length + n(c.people) + n(c.activities) + n(c.artifacts) + n(c.places) + n(c.counterExemplars);
}

/** Residual life-admin lands here — a 1:1 with a named friend, an errand, an
 *  appointment. A catch-all is defined by EXCLUSIONS, so it carries no positive
 *  signals of its own; without naming it, a classifier weak-matches every
 *  residual item onto whichever signal-rich domain happens to share a word.
 *
 *  The old rule was a name regex (`/personal|life|misc|other/i`) with "first
 *  domain that has no entities" as the fallback. That is Principle 16 in one
 *  line: it holds in an account whose catch-all happens to be called "Personal"
 *  and silently mis-fires everywhere else. Structure decides first now — the one
 *  domain with nothing to discriminate on and no boundary — and the name is
 *  demoted to a tiebreaker for the case where several domains are equally blank,
 *  which is the only situation where the old rule was doing real work. If it is
 *  still ambiguous there is no catch-all: guessing between two blank domains is
 *  worse than admitting we don't know. */
const RESIDUAL_NAME = /personal|life|misc|other|admin/i;

export function catchAllDomain(domains: RoutableDomain[]): RoutableDomain | null {
  const blank = domains.filter((d) => discriminatingSignals(d) === 0 && !d.context?.boundary);
  if (blank.length === 1) return blank[0];
  if (blank.length === 0) return null;
  const named = blank.filter((d) => RESIDUAL_NAME.test(d.name));
  return named.length === 1 ? named[0] : null;
}

// ── the serializer ───────────────────────────────────────────────────────────

export interface RoutingBlockOptions {
  /** Prefixed onto the bracketed id. `enrichInbox` uses "D:" because its answer
   *  space also holds initiatives and projects; the event router uses "". */
  idPrefix?: string;
  /** Omit the catch-all tag — for callers whose answer space has no residual
   *  bucket (routing a *project*, where "misc" is not a real answer). */
  noCatchAll?: boolean;
}

const LABELS: Array<[keyof DomainContext, string]> = [
  ["people", "who"],
  ["entities", "signals"],
  ["artifacts", "uses"],
  ["activities", "does"],
  ["places", "at"],
  ["keywords", "words"],
];

/** One domain, rendered for a routing prompt. Indented sub-lines rather than a
 *  single `·`-joined run: with seven fields the run became unreadable, and the
 *  domain count is small (a handful), so legibility beats token thrift. */
export function domainRoutingLine(d: RoutableDomain, o: RoutingBlockOptions & { catchAll?: boolean } = {}): string {
  const c = d.context;
  const head = `[${o.idPrefix ?? ""}${d.id}] ${cleanText(d.name)}${o.catchAll ? " [CATCH-ALL — residual life admin lands here]" : ""}`;
  const lines: string[] = [];

  // `is:` degrades all the way down, so an ungroomed domain still says something
  // true rather than rendering as a bare id (Principle 7 — messy data must work).
  const is = cleanText(c?.scope) || cleanText(d.charter) || cleanText(d.intention);
  if (is) lines.push(`  is: ${is}`);

  for (const [key, label] of LABELS) {
    const vals = (c?.[key] ?? []) as string[];
    if (Array.isArray(vals) && vals.length) lines.push(`  ${label}: ${vals.map((v) => cleanText(v)).join(", ")}`);
  }

  const ex = c?.exemplars ?? [];
  if (ex.length) lines.push(`  sounds like: ${ex.map((v) => `"${cleanText(v)}"`).join(", ")}`);

  const boundary = cleanText(c?.boundary);
  if (boundary) lines.push(`  NOT: ${boundary}`);

  const anti = c?.counterExemplars ?? [];
  if (anti.length) lines.push(`  looks like this but ISN'T: ${anti.map((v) => `"${cleanText(v)}"`).join(", ")}`);

  return lines.length ? `${head}\n${lines.join("\n")}` : head;
}

/** The whole domain block plus the resolved catch-all, in one call — so no
 *  caller has to remember to do the catch-all half. */
export function domainRoutingBlock(
  domains: RoutableDomain[],
  o: RoutingBlockOptions = {},
): { text: string; catchAllId: string | null } {
  if (!domains.length) return { text: "(none yet)", catchAllId: null };
  const catchAll = o.noCatchAll ? null : catchAllDomain(domains);
  const text = domains
    .map((d) => domainRoutingLine(d, { ...o, catchAll: catchAll?.id === d.id }))
    .join("\n");
  return { text, catchAllId: catchAll?.id ?? null };
}

// ── the offline matcher's corpus ─────────────────────────────────────────────

/** Every word a domain answers to, for the non-LLM token-overlap matcher
 *  (`suggestDomainForText`). The name is repeated so an exact mention dominates;
 *  counter-exemplars are deliberately EXCLUDED — they are the words this domain
 *  should lose on, and feeding them in would make a near-miss score higher. */
export function domainCorpus(d: RoutableDomain): string {
  const c = d.context;
  const list = (xs?: string[]) => (xs ?? []).join(" ");
  return [
    d.name, d.name, cleanText(d.charter), cleanText(d.intention),
    cleanText(c?.scope), list(c?.entities), list(c?.keywords),
    list(c?.people), list(c?.activities), list(c?.artifacts), list(c?.places),
    list(c?.exemplars),
  ].join(" ");
}

// ── cache invalidation ───────────────────────────────────────────────────────

/** Routing verdicts are cached — per event in `event_domain_routing`, per task
 *  on `tasks.suggestion` — so a completion is never spent twice on the same
 *  item. Without a staleness rule that cache is PERMANENT: re-grooming a domain,
 *  editing a charter, or adding a whole new domain re-opened nothing, and the
 *  wall kept showing verdicts formed before the domain existed.
 *
 *  The rule needs no new column, because both halves already exist:
 *
 *      epoch = max over domains of (context_at ?? created_at)
 *      a cached verdict is stale  <=>  routed_at < epoch
 *
 *  It is correct on all three events. Re-groomed and accepted -> `context_at`
 *  moves. A NEW domain -> its `created_at` is the max (the case a per-verdict
 *  context hash handles *worse*, since a new domain has no context at all).
 *  Deleted -> `event_domain_routing.domain_id` cascades, so those rows vanish on
 *  their own. Convergence is structural: a re-routed key is stamped `now()`,
 *  which is > epoch, so nothing reads stale twice. */
export function domainRoutingEpoch(
  rows: Array<{ created_at?: string | null; context_at?: string | null }>,
  nowISO: string,
): string {
  let max = "";
  for (const r of rows) {
    const t = r.context_at || r.created_at || "";
    if (t > max) max = t;
  }
  // Clamped, because `context_at` is written by the BROWSER: a client clock
  // running fast would push the epoch into the future and re-open every verdict
  // on every load, forever.
  return max > nowISO ? nowISO : max;
}

/** True when a cached verdict predates the current shape of the domains. A
 *  verdict with no timestamp at all is stale — it predates this rule. */
export function isVerdictStale(routedAt: string | null | undefined, epoch: string): boolean {
  if (!epoch) return false;
  return !routedAt || routedAt < epoch;
}

/** A short, stable hash of everything the routers read. NOT the staleness rule
 *  (the epoch above is cheaper and handles a brand-new domain better) — this
 *  answers the narrower question *"did accepting this groom actually change
 *  anything?"*, so re-accepting an identical proposal doesn't bump `context_at`
 *  and re-open thousands of verdicts for nothing.
 *
 *  Order-independent by construction (sorted, fixed key order), so re-ordering
 *  the domain wall is not a routing change. */
export function routingFingerprint(domains: RoutableDomain[]): string {
  const parts = domains
    .map((d) => {
      const c = d.context;
      const f = (xs?: string[]) => (xs ?? []).join("");
      return [
        d.id, cleanText(d.name), cleanText(d.charter), cleanText(d.intention),
        cleanText(c?.scope), cleanText(c?.boundary),
        f(c?.entities), f(c?.keywords), f(c?.exemplars),
        f(c?.activities), f(c?.people), f(c?.artifacts), f(c?.places), f(c?.counterExemplars),
      ].join("");
    })
    .sort();
  return `v1.${fnv1a(parts.join(""))}`;
}

/** FNV-1a, 32-bit, hex. Not a security hash — it only needs to be stable across
 *  both runtimes and to change when the input changes. Hand-rolled because this
 *  file may not import anything, and `crypto.subtle` is async. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
