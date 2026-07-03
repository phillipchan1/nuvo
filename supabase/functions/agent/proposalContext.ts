// The shared proposal-context engine. The lightweight, propose-only LLM functions
// (clusterInbox, parsePriorities, breakdownPriority, refine) all need the same
// thing: the person's vertical — their domains (and what each one IS, from the
// charter they wrote), the projects and the outcomes they drive, the initiatives
// they serve. Each used to re-query and re-shape this independently; this loads it
// ONCE and hands back the rows, fast lookup maps, and the two bits of judgment they
// share — "which domain does this belong to?" and "what is this domain, in a line?".
//
// This is the seed of a single context engine for proposals (sibling to the chat
// agent's richer buildContext). The natural next layer is a user "operating
// context" (who they are, what they're driving toward) — add it here so every
// proposal inherits it for free.

import { admin } from "../_shared/admin.ts";

export interface PDomain { id: string; name: string; charter: string; scope: string; intention: string; }
export interface PProject { id: string; name: string; outcome: string; domainId: string | null; initiativeId: string | null; status: string; }
export interface PInitiative { id: string; name: string; outcome: string; domainId: string | null; status: string; }

/** A vertical reference any task/row carries — used to resolve its domain. */
export interface VerticalRef { domain_id?: string | null; project_id?: string | null; initiative_id?: string | null; }

export interface ProposalContext {
  domains: PDomain[];
  projects: PProject[];
  initiatives: PInitiative[];
  domainById: Map<string, PDomain>;
  projectById: Map<string, PProject>;
  initiativeById: Map<string, PInitiative>;
  /** Resolve a row's domain: its own domain, else its project's, else its bet's. */
  domainIdOf(ref: VerticalRef): string | null;
  /** A one-line "what is this domain" blurb — the charter (the user's own truth)
   *  first, the derived routing scope as fallback. "" when there's nothing to say. */
  domainBlurb(domainId: string | null): string;
}

/** Statuses that count as live work for binding/listing candidates. */
export const ACTIVE_STATUSES = ["backlog", "in_progress", "waiting"];

export async function buildProposalContext(userId: string): Promise<ProposalContext> {
  const [{ data: domRows }, { data: projRows }, { data: initRows }] = await Promise.all([
    admin.from("domains").select("id, name, charter, context, intention").eq("user_id", userId),
    admin.from("projects").select("id, name, outcome, domain_id, initiative_id, status").eq("user_id", userId),
    admin.from("initiatives").select("id, name, outcome, domain_id, status").eq("user_id", userId),
  ]);

  const domains: PDomain[] = (domRows ?? []).map((d) => {
    const ctx = d.context as { scope?: unknown } | null;
    const scope = ctx && typeof ctx === "object" ? String(ctx.scope ?? "").trim() : "";
    return {
      id: d.id as string,
      name: d.name as string,
      charter: String(d.charter ?? "").trim(),
      scope,
      intention: String(d.intention ?? "").trim(),
    };
  });
  const projects: PProject[] = (projRows ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    outcome: String(p.outcome ?? "").trim(),
    domainId: (p.domain_id as string | null) ?? null,
    initiativeId: (p.initiative_id as string | null) ?? null,
    status: p.status as string,
  }));
  const initiatives: PInitiative[] = (initRows ?? []).map((i) => ({
    id: i.id as string,
    name: i.name as string,
    outcome: String(i.outcome ?? "").trim(),
    domainId: (i.domain_id as string | null) ?? null,
    status: i.status as string,
  }));

  const domainById = new Map(domains.map((d) => [d.id, d]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const initiativeById = new Map(initiatives.map((i) => [i.id, i]));

  const domainIdOf = (ref: VerticalRef): string | null =>
    (ref.domain_id ?? null) ??
    (ref.project_id ? projectById.get(ref.project_id)?.domainId ?? null : null) ??
    (ref.initiative_id ? initiativeById.get(ref.initiative_id)?.domainId ?? null : null);

  const domainBlurb = (domainId: string | null): string => {
    if (!domainId) return "";
    const d = domainById.get(domainId);
    if (!d) return "";
    const desc = (d.charter || d.scope).replace(/\s+/g, " ");
    return desc ? `- ${d.name}: ${desc.slice(0, 160)}` : `- ${d.name}`;
  };

  return { domains, projects, initiatives, domainById, projectById, initiativeById, domainIdOf, domainBlurb };
}
