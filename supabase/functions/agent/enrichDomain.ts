// Domain refinement — turn a user's one-line charter into the routing context
// passive grooming needs, AND catch work that's mis-filed under this domain.
//
// The hard lesson from real data: the work currently tagged to a domain CAN'T be
// the source of truth — e.g. "Get Obi to Enterprise" (SCE) and "Build IFVG
// Backtester" (Trading) were both sitting under "Family". So the CHARTER (what
// the person says the domain is) is authoritative; children only corroborate it.
// A child that contradicts the charter isn't context — it's a mis-file to flag.
//
// The one corpus that IS trustworthy besides the charter: the calendars the
// person themself mapped to this domain in Settings → Connections. That mapping
// is a human decision, not a model's, so the meetings on it are real evidence of
// what this domain actually does week to week. Deliberately NOT used:
// `event_domain_routing` verdicts — those are this system's own output, and
// feeding them back would amplify its own mistakes.
//
// Proposes ONLY: the domain floor persists the context on accept and re-homes mis-files
// on the user's say-so. Mirror of verify.ts.

import { admin } from "../_shared/admin.ts";
import { completeJSON } from "./llm.ts";
import { cleanText, type DomainContext, normalizeContext } from "../_shared/domainRouting.ts";

const clean = (s: string): string => cleanText(s);

export type { DomainContext };

export interface MisfiledItem {
  kind: "initiative" | "project" | "task";
  id: string;
  name: string;
  suggestDomain: string; // sibling domain name, "" if unsure
  suggestDomainId: string | null;
}

export interface DomainRefinement {
  context: DomainContext;
  misfiled: MisfiledItem[];
}

type Child = { ref: string; kind: MisfiledItem["kind"]; id: string; name: string; text: string };

/** Titles of meetings on calendars the person mapped to THIS domain by hand.
 *  Deduped and frequency-ordered, so a weekly ritual outranks a one-off. Empty
 *  whenever no calendar is mapped — which is most domains, and fine. */
async function mappedCalendarActivity(userId: string, domainId: string): Promise<string[]> {
  const { data: settings } = await admin
    .from("user_settings").select("calendar_domain_map").eq("user_id", userId).maybeSingle();
  const map = (settings?.calendar_domain_map ?? {}) as Record<string, string>;
  const keys = Object.entries(map).filter(([, d]) => d === domainId).map(([k]) => k);
  if (!keys.length) return [];

  // `calendar_domain_map` is keyed "account_id:calendar_id" — the composite
  // `calendarKey()` builds on the client, composite because every account's
  // primary calendar is literally id "primary". Query on calendar_id (the
  // indexed half) and re-check the composite in memory.
  const wanted = new Set(keys);
  const calendarIds = [...new Set(keys.map((k) => k.slice(k.indexOf(":") + 1)))];
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { data: rows } = await admin
    .from("external_events")
    .select("title, account_id, calendar_id")
    .eq("user_id", userId)
    .in("calendar_id", calendarIds)
    .gte("start_at", since)
    .limit(500);

  const counts = new Map<string, number>();
  for (const r of rows ?? []) {
    if (!wanted.has(`${r.account_id}:${r.calendar_id}`)) continue;
    const t = clean(String(r.title ?? "")).slice(0, 60);
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([t]) => t);
}

export async function enrichDomain(
  userId: string,
  input: { domainId: string; charter?: string },
): Promise<DomainRefinement> {
  const { data: domain, error } = await admin
    .from("domains")
    .select("id, name, intention")
    .eq("id", input.domainId)
    .eq("user_id", userId)
    .single();
  if (error || !domain) throw new Error("Domain not found");

  const charter = clean(input.charter ?? "");

  const [sibRes, iniRes, projRes, calendarTitles] = await Promise.all([
    admin.from("domains").select("id, name, intention, charter, context").eq("user_id", userId).neq("id", input.domainId).order("sort_order"),
    admin.from("initiatives").select("id, name, outcome").eq("user_id", userId).eq("domain_id", input.domainId),
    admin.from("projects").select("id, name, outcome").eq("user_id", userId).eq("domain_id", input.domainId),
    mappedCalendarActivity(userId, input.domainId).catch(() => [] as string[]),
  ]);
  const siblings = (sibRes.data ?? []) as { id: string; name: string; intention: string | null; charter: string | null; context: unknown }[];
  // Direct children only — tasks under a project follow their project when it
  // moves, so the re-home unit is the initiative / project / loose task.
  const looseRes = await admin
    .from("tasks").select("id, title").eq("user_id", userId).eq("domain_id", input.domainId).neq("status", "trashed").limit(40);

  const children: Child[] = [
    ...(iniRes.data ?? []).map((i) => ({ ref: `I:${i.id}`, kind: "initiative" as const, id: i.id, name: clean(i.name), text: `${clean(i.name)}${i.outcome ? ` — ${clean(i.outcome)}` : ""}` })),
    ...(projRes.data ?? []).map((p) => ({ ref: `P:${p.id}`, kind: "project" as const, id: p.id, name: clean(p.name), text: `${clean(p.name)}${p.outcome ? ` — ${clean(p.outcome)}` : ""}` })),
    ...(looseRes.data ?? []).map((t) => ({ ref: `T:${t.id}`, kind: "task" as const, id: t.id, name: clean(t.title), text: clean(t.title) })),
  ];

  // Siblings carry their own routing context now, not just a charter: a good
  // `boundary` and honest counter-exemplars can only be written against what the
  // neighbour actually claims.
  const sibLine = siblings.map((s) => {
    const c = normalizeContext(s.context);
    const desc = clean(s.charter || s.intention || "");
    const marks = [c?.entities.join(", "), c?.people?.join(", ")].filter(Boolean).join(", ");
    return `- ${clean(s.name)}${desc ? `: ${desc}` : ""}${marks ? ` [claims: ${marks}]` : ""}`;
  }).join("\n") || "(none)";
  const childLine = children.map((c) => `[${c.ref}] ${c.kind}: ${c.text}`).join("\n") || "(nothing filed here yet)";
  const calendarLine = calendarTitles.length
    ? `\nRECURRING MEETINGS ON CALENDARS THE PERSON THEMSELF MAPPED TO ${clean(domain.name)} (real evidence of what this domain does — trustworthy, unlike the filed work above):\n${calendarTitles.map((t) => `- ${t}`).join("\n")}\n`
    : "";

  const prompt = `You are refining one "domain" (a life area) for a planning assistant. Do TWO things: (A) build machine-facing ROUTING CONTEXT so terse inbox captures, projects and calendar events can be filed here later, and (B) catch work currently filed here that clearly DOESN'T belong.

CRITICAL: the CHARTER below is the source of truth for what this domain is. The work currently filed under it may be mis-tagged — do NOT let that work redefine the domain. Judge the work against the charter, not the other way around.

DOMAIN: ${clean(domain.name)}
CHARTER (what the person says this domain IS — authoritative): ${charter || "(none given — infer conservatively; keep context sparse)"}
${domain.intention ? `Their vow (an ambition, NOT a router): ${clean(domain.intention)}` : ""}

THE PERSON'S OTHER DOMAINS (where mis-filed work likely belongs, and what each already claims):
${sibLine}

WORK CURRENTLY FILED UNDER ${clean(domain.name)} (judge each against the charter):
${childLine}
${calendarLine}
(A) Routing context, grounded ONLY in the charter, the mapped-calendar meetings, and the work that genuinely fits. Think about what a TERSE capture that belongs here would actually say — it usually names a person, a tool or an activity, and almost never names the domain:
- entities: proper nouns that signal this domain — orgs, products, codenames. Fold aliases ("SCE / Southern California Edison"). Never borrow a sibling's nouns. 0–15 items (empty is correct for a domain with little of its own).
- people: named humans WITH their role, one string each — "Obi — my manager", "Pastor Mike — lead pastor". The role matters more than the name: it is what lets an unfamiliar colleague from the same place still route here. 0–12.
- activities: the recurring things the person DOES here, as they'd say them — "sermon prep", "standup", "backtest a setup", "school pickup". Captures and calendar events name actions far more often than proper nouns, so this is usually the highest-yield field. 0–10.
- artifacts: tools, systems, apps, repos, accounts and recurring documents used here — "Planning Center", "Dext", "the board deck". A capture like "upload the receipts to Dext" names only the tool. 0–10.
- places: venues, offices, campuses, rooms. 0–6.
- keywords: recurring non-proper topic words not already covered above. 0–10.
- scope: ONE sentence on what this domain is.
- boundary: one line distinguishing it from its most confusable sibling, named.
- exemplars: 2–4 short capture-like phrases that clearly belong here.
- counterExemplars: 2–4 short capture-like phrases that LOOK like they belong here but actually belong to a named sibling — "quarterly board deck (that's SCE, not Church)". Near-misses between two confusable domains are the main way filing goes wrong, so be concrete and name the sibling.

(B) misfiled: every listed item that contradicts the charter and clearly belongs to a different domain. Give its bracketed ref and the NAME of the sibling domain it should move to. Be decisive about obvious mismatches (e.g. trading or day-job work under "Family"); leave genuinely ambiguous items out. If everything fits, return [].

Respond with JSON only:
{"scope":string,"entities":[string],"people":[string],"activities":[string],"artifacts":[string],"places":[string],"keywords":[string],"boundary":string,"exemplars":[string],"counterExemplars":[string],"misfiled":[{"ref":string,"suggestDomain":string}]}`;

  const raw = await completeJSON<Record<string, unknown>>(prompt);

  // Resolve mis-files back to real ids + a sibling domain id.
  const byRef = new Map(children.map((c) => [c.ref.toLowerCase(), c]));
  const sibByName = new Map(siblings.map((s) => [clean(s.name).toLowerCase(), s]));
  const misRaw = Array.isArray(raw.misfiled) ? raw.misfiled : [];
  const misfiled: MisfiledItem[] = [];
  const misRefs = new Set<string>();
  for (const m of misRaw) {
    const mm = m as { ref?: unknown; suggestDomain?: unknown };
    const ref = clean(String(mm.ref ?? "")).toLowerCase();
    const child = byRef.get(ref);
    if (!child || misRefs.has(ref)) continue;
    misRefs.add(ref);
    const sib = sibByName.get(clean(String(mm.suggestDomain ?? "")).toLowerCase());
    misfiled.push({ kind: child.kind, id: child.id, name: child.name, suggestDomain: sib ? sib.name : "", suggestDomainId: sib?.id ?? null });
  }

  // Ground PROPER NOUNS against the charter, the mapped-calendar meetings, the
  // vow, and only the children that FIT (excluding the mis-filed ones) — so a
  // mistakenly-tagged "Obi" can't seed Family's context. A wrong proper noun is
  // the expensive kind of wrong: it can capture another domain's work outright.
  //
  // Deliberately NOT applied to activities / artifacts / keywords / exemplars /
  // counterExemplars. Those are inferential by design — a one-line charter will
  // never literally contain "sermon prep" — and a wrong guess there is cheap: it
  // simply matches nothing. Filtering them only deleted correct inferences.
  const fitting = children.filter((c) => !misRefs.has(c.ref.toLowerCase()));
  const corpus = [
    charter,
    clean(domain.intention ?? ""),
    fitting.map((c) => c.text).join(" "),
    calendarTitles.join(" "),
    domain.name,
  ].join(" ").toLowerCase();
  const tokensOf = (e: string): string[] => e.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  const inCorpus = (e: string): boolean => {
    const toks = tokensOf(e);
    return toks.length > 0 && toks.some((t) => corpus.includes(t));
  };

  /** Grounded directly, OR sharing a token with something already grounded —
   *  which is what lets "Southern California Edison" survive on the back of a
   *  grounded "SCE". The prompt asks for exactly that alias folding, and the old
   *  single-pass filter then deleted it. */
  const groundList = (xs: unknown, max: number, cap: number): string[] => {
    const items = normalizeList(xs, max, cap);
    const kept = items.filter(inCorpus);
    const keptTokens = new Set(kept.flatMap(tokensOf));
    return items.filter((e) => inCorpus(e) || tokensOf(e).some((t) => keptTokens.has(t)));
  };

  const context = normalizeContext({
    scope: raw.scope,
    boundary: raw.boundary,
    entities: groundList(raw.entities, 15, 48),
    people: groundList(raw.people, 12, 64),
    artifacts: groundList(raw.artifacts, 10, 48),
    places: groundList(raw.places, 6, 48),
    keywords: raw.keywords,
    activities: raw.activities,
    exemplars: raw.exemplars,
    counterExemplars: raw.counterExemplars,
  })!;

  return { context, misfiled };
}

/** Local pre-pass so the grounding filter sees the same cleaned strings the
 *  kernel will store. `normalizeContext` re-applies the caps on the way out. */
function normalizeList(xs: unknown, max: number, cap: number): string[] {
  return (Array.isArray(xs) ? xs : [])
    .map((x) => clean(String(x)).slice(0, cap))
    .filter(Boolean)
    .slice(0, max);
}
