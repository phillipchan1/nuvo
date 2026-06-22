// Domain refinement — turn a user's one-line charter into the routing context
// passive grooming needs, AND catch work that's mis-filed under this domain.
//
// The hard lesson from real data: the work currently tagged to a domain CAN'T be
// the source of truth — e.g. "Get Obi to Enterprise" (SCE) and "Build IFVG
// Backtester" (Trading) were both sitting under "Family". So the CHARTER (what
// the person says the domain is) is authoritative; children only corroborate it.
// A child that contradicts the charter isn't context — it's a mis-file to flag.
//
// Proposes ONLY: the chapel persists the context on accept and re-homes mis-files
// on the user's say-so. Mirror of verify.ts.

import { admin } from "../_shared/admin.ts";
import { completeJSON } from "./llm.ts";

// deno-lint-ignore no-control-regex
const clean = (s: string): string => (s ?? "").replace(/[\x00-\x1F\x7F]/g, " ").trim();
const cleanList = (xs: unknown, max: number, cap = 48): string[] =>
  (Array.isArray(xs) ? xs : []).map((x) => clean(String(x)).slice(0, cap)).filter(Boolean).slice(0, max);

export interface DomainContext {
  scope: string;
  entities: string[];
  keywords: string[];
  boundary: string;
  exemplars: string[];
}

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

  const [sibRes, iniRes, projRes] = await Promise.all([
    admin.from("domains").select("id, name, intention, charter").eq("user_id", userId).neq("id", input.domainId).order("sort_order"),
    admin.from("initiatives").select("id, name, outcome").eq("user_id", userId).eq("domain_id", input.domainId),
    admin.from("projects").select("id, name, outcome").eq("user_id", userId).eq("domain_id", input.domainId),
  ]);
  const siblings = (sibRes.data ?? []) as { id: string; name: string; intention: string | null; charter: string | null }[];
  // Direct children only — tasks under a project follow their project when it
  // moves, so the re-home unit is the initiative / project / loose task.
  const looseRes = await admin
    .from("tasks").select("id, title").eq("user_id", userId).eq("domain_id", input.domainId).neq("status", "trashed").limit(40);

  const children: Child[] = [
    ...(iniRes.data ?? []).map((i) => ({ ref: `I:${i.id}`, kind: "initiative" as const, id: i.id, name: clean(i.name), text: `${clean(i.name)}${i.outcome ? ` — ${clean(i.outcome)}` : ""}` })),
    ...(projRes.data ?? []).map((p) => ({ ref: `P:${p.id}`, kind: "project" as const, id: p.id, name: clean(p.name), text: `${clean(p.name)}${p.outcome ? ` — ${clean(p.outcome)}` : ""}` })),
    ...(looseRes.data ?? []).map((t) => ({ ref: `T:${t.id}`, kind: "task" as const, id: t.id, name: clean(t.title), text: clean(t.title) })),
  ];

  const sibLine = siblings.map((s) => `- ${clean(s.name)}${s.charter || s.intention ? `: ${clean(s.charter || s.intention || "")}` : ""}`).join("\n") || "(none)";
  const childLine = children.map((c) => `[${c.ref}] ${c.kind}: ${c.text}`).join("\n") || "(nothing filed here yet)";

  const prompt = `You are refining one "domain" (a life area) for a planning assistant. Do TWO things: (A) build machine-facing ROUTING CONTEXT so terse inbox captures can be filed here later, and (B) catch work currently filed here that clearly DOESN'T belong.

CRITICAL: the CHARTER below is the source of truth for what this domain is. The work currently filed under it may be mis-tagged — do NOT let that work redefine the domain. Judge the work against the charter, not the other way around.

DOMAIN: ${clean(domain.name)}
CHARTER (what the person says this domain IS — authoritative): ${charter || "(none given — infer conservatively; keep context sparse)"}
${domain.intention ? `Their vow (an ambition, NOT a router): ${clean(domain.intention)}` : ""}

THE PERSON'S OTHER DOMAINS (where mis-filed work likely belongs):
${sibLine}

WORK CURRENTLY FILED UNDER ${clean(domain.name)} (judge each against the charter):
${childLine}

(A) Routing context, grounded ONLY in the charter and the work that genuinely fits it:
- entities: proper nouns that signal this domain — people, orgs, products, codenames, places. Pull only from the charter or fitting work; fold aliases ("SCE / Southern California Edison"). Never borrow a sibling's nouns. 0–15 items (empty is correct for a domain with little of its own).
- keywords: recurring non-proper topic words. 0–10.
- scope: ONE sentence on what this domain is.
- boundary: one line distinguishing it from its most confusable sibling.
- exemplars: 2–4 short capture-like phrases that clearly belong here.

(B) misfiled: every listed item that contradicts the charter and clearly belongs to a different domain. Give its bracketed ref and the NAME of the sibling domain it should move to. Be decisive about obvious mismatches (e.g. trading or day-job work under "Family"); leave genuinely ambiguous items out. If everything fits, return [].

Respond with JSON only:
{"scope":string,"entities":[string],"keywords":[string],"boundary":string,"exemplars":[string],"misfiled":[{"ref":string,"suggestDomain":string}]}`;

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

  // Ground entities against the charter + only the children that FIT (exclude the
  // mis-filed ones) — so a mistakenly-tagged "Obi" can't seed Family's context.
  const fitting = children.filter((c) => !misRefs.has(c.ref.toLowerCase()));
  const corpus = `${charter} ${fitting.map((c) => c.text).join(" ")} ${domain.name}`.toLowerCase();
  const grounded = (e: string): boolean => {
    const toks = e.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
    return toks.length > 0 && toks.some((t) => corpus.includes(t));
  };

  const context: DomainContext = {
    scope: clean(String(raw.scope ?? "")).slice(0, 200),
    entities: cleanList(raw.entities, 15).filter(grounded),
    keywords: cleanList(raw.keywords, 10),
    boundary: clean(String(raw.boundary ?? "")).slice(0, 200),
    exemplars: cleanList(raw.exemplars, 4, 80),
  };

  return { context, misfiled };
}
