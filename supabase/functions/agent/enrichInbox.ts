// Passive inbox grooming — Nuvo's cached *suggestion* for raw captures. Reads
// the tasks plus the user's open vertical (domains, in-flight initiatives and
// projects) and proposes the most specific existing home each genuinely fits, a
// duration, an energy register, and a one-line reason. Proposes ONLY: nothing is
// filed and no field is changed — the client caches the verdict (with a
// title+notes signature) and re-grooms when the capture changes. Mirror of
// verify.ts for the project/initiative soundness layer.
//
// Batched: the client sends every capture that needs grooming in one call and
// this fans them into at most two LLM completions total (one for captures
// whose placement is already locked and only need energy/duration, one for
// captures that still need placement inferred) — never one completion per
// capture.

import { admin } from "../_shared/admin.ts";
import { completeJSON } from "./llm.ts";
import {
  EXEMPLARS_PER_DOMAIN,
  ROUTE_AUTO,
  captureText,
  pickExemplars,
  type ExemplarTask,
  type RouteDomain,
  type RouteHome,
} from "../_shared/domainRouting.ts";
import { decisionsAvailable, mapLimit, routeDomain, routeHome } from "./decisions.ts";

type Energy = "deep" | "decide" | "delegate" | "quick";
type Level = "project" | "initiative" | "domain" | "none";

const ENERGIES = new Set(["deep", "decide", "delegate", "quick"]);
const LEVELS = new Set(["project", "initiative", "domain", "none"]);

// A batch this large would blow past a reasonable prompt size; the client
// re-fires on the next load for anything left over, converging over a few
// opens without ever sending a giant prompt.
const MAX_BATCH = 25;

export interface InboxSuggestion {
  sig: string; // structural signature of title+notes; stale when it no longer matches
  level: Level;
  targetId: string | null; // the project / initiative / domain it belongs under
  targetLabel: string; // plain-english home, e.g. "Q3 deck" or "Trading"
  domainId: string | null; // the domain it threads up to (for coloring the chip)
  domainColor: string | null;
  durationMinutes: number | null;
  energy: Energy | null;
  rationale: string; // ≤14 words: why it fits there
  confidence: number; // 0..1
  /** The domain was WRITTEN onto the capture (confidence ≥ ROUTE_AUTO), not just
   *  proposed. The row shows it as filed, with an Undo. */
  auto?: boolean;
  /** What the person did with it — the router's only feedback. Set by the client. */
  outcome?: "confirmed" | "accepted" | "undone" | "corrected" | "rejected";
  /** Which engine placed it: the Decisions classifier, or the chat-model fallback. */
  engine?: "decisions" | "llm";
}

// Postgres jsonb rejects NUL / other C0 control chars ("unsupported Unicode
// escape sequence"); the model — and imported task/project names — occasionally
// carry one. Strip them from every string before it lands in the suggestion.
// deno-lint-ignore no-control-regex
const clean = (s: string): string => (s ?? "").replace(/[\x00-\x1F\x7F]/g, " ").trim();

/** The capture's identity for staleness — must match the client's grooming.ts. */
export function suggestionSig(title: string, notes: string): string {
  return clean(`${title ?? ""} ${notes ?? ""}`).toLowerCase();
}

type TaskRow = {
  id: string;
  title: string;
  notes: string | null;
  project_id: string | null;
  initiative_id: string | null;
  domain_id: string | null;
  duration_minutes: number | null;
};
export type Domain = { id: string; name: string; color: string | null; intention: string | null; charter: string | null; context: unknown };
type Initiative = { id: string; name: string; outcome: string | null; domain_id: string | null };
type Project = { id: string; name: string; outcome: string | null; domain_id: string | null; initiative_id: string | null };

/** Grooms a batch of inbox captures in (at most) two LLM calls and persists
 *  each verdict. Returns the suggestion per task id (tasks the model didn't
 *  return a verdict for, or that fail to resolve, are omitted). */
export async function enrichInboxBatch(
  userId: string,
  taskIds: string[],
): Promise<Record<string, InboxSuggestion>> {
  const ids = [...new Set(taskIds)].slice(0, MAX_BATCH);
  if (!ids.length) return {};

  const { data: taskRows, error } = await admin
    .from("tasks")
    .select("id, title, notes, project_id, initiative_id, domain_id, duration_minutes")
    .in("id", ids)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const tasks = (taskRows ?? []) as TaskRow[];
  if (!tasks.length) return {};

  const [domRes, iniRes, projRes] = await Promise.all([
    admin.from("domains").select("id, name, color, intention, charter, context").eq("user_id", userId).order("sort_order"),
    admin
      .from("initiatives")
      .select("id, name, outcome, domain_id, status")
      .eq("user_id", userId)
      .not("status", "in", '("complete","cancelled")')
      .order("sort_order"),
    admin
      .from("projects")
      .select("id, name, outcome, domain_id, initiative_id, status")
      .eq("user_id", userId)
      .not("status", "in", '("complete","cancelled")')
      .order("sort_order"),
  ]);

  const domains = (domRes.data ?? []) as Domain[];
  const initiatives = (iniRes.data ?? []) as Initiative[];
  const projects = (projRes.data ?? []) as Project[];
  const resolveDomain = (id: string | null): Domain | undefined => domains.find((d) => d.id === id);

  type Locked = { task: TaskRow; level: Level; targetId: string; targetLabel: string; domainId: string | null };
  const locked: Locked[] = [];
  const unlocked: TaskRow[] = [];

  for (const task of tasks) {
    const lockedProject = task.project_id ? projects.find((p) => p.id === task.project_id) : null;
    const lockedInitiative = !lockedProject && task.initiative_id
      ? initiatives.find((i) => i.id === task.initiative_id)
      : null;
    const lockedDomain = !lockedProject && !lockedInitiative && task.domain_id
      ? domains.find((d) => d.id === task.domain_id)
      : null;

    if (lockedProject) {
      locked.push({
        task,
        level: "project",
        targetId: lockedProject.id,
        targetLabel: clean(lockedProject.name),
        domainId: lockedProject.domain_id ?? initiatives.find((i) => i.id === lockedProject.initiative_id)?.domain_id ?? null,
      });
    } else if (lockedInitiative) {
      locked.push({
        task,
        level: "initiative",
        targetId: lockedInitiative.id,
        targetLabel: clean(lockedInitiative.name),
        domainId: lockedInitiative.domain_id ?? null,
      });
    } else if (lockedDomain) {
      locked.push({ task, level: "domain", targetId: lockedDomain.id, targetLabel: clean(lockedDomain.name), domainId: lockedDomain.id });
    } else {
      unlocked.push(task);
    }
  }

  const results: Record<string, InboxSuggestion> = {};

  if (locked.length) {
    const effort = await estimateEffort(locked.map((l) => l.task));
    locked.forEach((l) => {
      const e = effort.get(l.task.id);
      if (!e) return;
      results[l.task.id] = {
        sig: suggestionSig(l.task.title, l.task.notes ?? ""),
        level: l.level,
        targetId: l.targetId,
        targetLabel: l.targetLabel,
        domainId: l.domainId,
        domainColor: resolveDomain(l.domainId)?.color ?? null,
        ...e,
      };
    });
  }

  // ── placement for loose captures: the Decisions classifier first ──────────────
  // A classifier with calibrated probabilities beats asking a chat model to
  // grade its own confidence. Only when it is unavailable (no key, beta not
  // enabled, timeout) does a capture fall through to the chat-model path below.
  let stillUnlocked = unlocked;
  const autoFiled = new Set<string>();
  if (unlocked.length && decisionsAvailable() && domains.length) {
    const routeDomains = await routeDomainsFor(userId, domains);
    const verdicts = await mapLimit(unlocked, 6, async (task) => {
      const text = captureText(task.title, task.notes);
      const v = await routeDomain(routeDomains, text);
      if (!v || v.tier === "none") return { task, v, home: null };
      // Descend only from a strong domain, and only into a home that lives in it.
      let home: { home: RouteHome; probability: number } | null = null;
      if (v.probability >= ROUTE_AUTO) {
        const homes: RouteHome[] = [
          ...initiatives.filter((i) => i.domain_id === v.id).map((i) => ({ id: i.id, kind: "initiative" as const, name: clean(i.name), outcome: i.outcome })),
          ...projects.filter((p) => p.domain_id === v.id).map((p) => ({ id: p.id, kind: "project" as const, name: clean(p.name), outcome: p.outcome })),
        ];
        home = await routeHome(homes, domains.find((d) => d.id === v.id)?.name ?? "", text);
      }
      return { task, v, home };
    });

    const placed = verdicts.filter((x) => x.v);
    const effort = await estimateEffort(placed.map((x) => x.task));
    const missed: TaskRow[] = [];
    for (const { task, v, home } of verdicts) {
      if (!v) { missed.push(task); continue; } // classifier unavailable for this one → old path
      const e = effort.get(task.id) ?? { durationMinutes: null, energy: null, rationale: "", confidence: v.probability };
      const sig = suggestionSig(task.title, task.notes ?? "");
      const dom = resolveDomain(v.id);
      if (v.tier === "none" || !dom) {
        results[task.id] = { sig, level: "none", targetId: null, targetLabel: "", domainId: null, domainColor: null, ...e, confidence: v.probability, engine: "decisions" };
        continue;
      }
      if (home) {
        results[task.id] = {
          sig, level: home.home.kind, targetId: home.home.id, targetLabel: clean(home.home.name),
          domainId: dom.id, domainColor: dom.color ?? null, ...e, confidence: home.probability, engine: "decisions",
        };
        continue;
      }
      const auto = v.tier === "auto";
      if (auto) autoFiled.add(task.id);
      results[task.id] = {
        sig, level: "domain", targetId: dom.id, targetLabel: clean(dom.name),
        domainId: dom.id, domainColor: dom.color ?? null, ...e,
        rationale: e.rationale || `Reads like ${clean(dom.name)}`, confidence: v.probability, engine: "decisions", ...(auto ? { auto: true } : {}),
      };
    }
    stillUnlocked = missed;
  }

  if (stillUnlocked.length) {
    const fmt = (s: string | null, max = 80) =>
      s ? ` — ${clean(s.length > max ? s.slice(0, max) + "…" : s)}` : "";
    const domLine = domains.map((d) => {
      const c = (d.context ?? null) as { scope?: string; entities?: string[]; boundary?: string } | null;
      const bits: string[] = [];
      if (c?.scope) bits.push(clean(c.scope));
      else if (d.intention) bits.push(clean(d.intention));
      if (c?.entities?.length) bits.push(`signals: ${c.entities.map(clean).join(", ")}`);
      if (c?.boundary) bits.push(`NOT: ${clean(c.boundary)}`);
      return `[D:${d.id}] ${clean(d.name)}${bits.length ? ` — ${bits.join(" · ")}` : ""}`;
    }).join("\n") || "(none yet)";
    const iniLine = initiatives.map((i) => `[I:${i.id}] ${clean(i.name)}${fmt(i.outcome)}`).join("\n") || "(none)";
    const projLine = projects.map((p) => `[P:${p.id}] ${clean(p.name)}${fmt(p.outcome)}`).join("\n") || "(none)";
    const itemsLine = stillUnlocked
      .map((t, i) => `[${i}] "${clean(t.title)}"${t.notes ? ` — their note: ${clean(t.notes)}` : ""}`)
      .join("\n");

    const prompt = `You are quietly grooming raw items in a person's inbox — guessing where each belongs so they don't have to file it by hand. Be a sharp, conservative copilot: only place an item somewhere you're genuinely confident it fits.

The person's life structure is Domain → Initiative (a bet with a finish line) → Project (a concrete chunk of work) → Task. Here is everything currently open:

DOMAINS (life areas):
${domLine}

INITIATIVES:
${iniLine}

PROJECTS:
${projLine}

The items to groom:
${itemsLine}

For EACH item, decide:
1. placement — file by ALTITUDE, biasing UP. Default to the DOMAIN whose signals/scope the item matches (use the entities and NOT-boundaries above — an item naming a domain's signal almost certainly belongs to that domain). Descend to a specific initiative or project ONLY when the item is unmistakably about that exact bet or deliverable; otherwise stay at the domain. Over-filing into a project is the expensive mistake — when unsure between a project and its domain, choose the domain. Return "none" only when it matches no domain at all. Return the bracketed id (e.g. "D:..", "I:..", "P:..") or "none".
2. durationMinutes — a realistic single-sitting estimate (5–240) if the item implies one; null if you truly can't tell.
3. energy — the register: "deep" (focused making/thinking), "decide" (review/reply/judge), "delegate" (hand off / follow up), or "quick" (shallow errand/admin).
4. rationale — ≤14 words, plain English, why it lands there (or why it's standalone). No ids.
5. confidence — 0..1, how sure you are of the placement.

Return exactly one entry for EVERY index listed above — do not skip any.

Respond with JSON only:
{"items":[{"i":<item index>,"level":"project|initiative|domain|none","targetId":string|null,"durationMinutes":number|null,"energy":"deep|decide|delegate|quick","rationale":string,"confidence":number}]}`;

    const raw = await completeJSON<{ items?: Array<Record<string, unknown>> }>(prompt);
    for (const item of raw.items ?? []) {
      const idx = Number(item.i);
      if (!Number.isInteger(idx) || idx < 0 || idx >= stillUnlocked.length) continue;
      const task = stillUnlocked[idx];
      results[task.id] = normalize(item, suggestionSig(task.title, task.notes ?? ""), { domains, initiatives, projects });
    }
  }

  // Honour the human's pinned duration over any estimate, and persist.
  const rows: Array<{ id: string; suggestion: InboxSuggestion; suggested_at: string }> = [];
  const now = new Date().toISOString();
  for (const task of tasks) {
    const s = results[task.id];
    if (!s) continue;
    if (typeof task.duration_minutes === "number") s.durationMinutes = task.duration_minutes;
    rows.push({ id: task.id, suggestion: s, suggested_at: now });
  }

  await Promise.all(
    rows.map(async (r) => {
      if (autoFiled.has(r.id) && r.suggestion.level === "domain" && r.suggestion.targetId) {
        // Write the domain — but only onto a capture that STILL has no home. The
        // person may have filed it while the classifier was thinking; their hand
        // wins, and the guess is spent rather than left to contradict it. The
        // task stays in the Inbox (status untouched): filing out of triage is a
        // separate, deliberate act (A1 — nothing is lost, nothing is hidden).
        const { data: wrote } = await admin
          .from("tasks")
          .update({ domain_id: r.suggestion.targetId, suggestion: r.suggestion, suggested_at: r.suggested_at })
          .eq("id", r.id)
          .eq("user_id", userId)
          .eq("status", "inbox")
          .is("domain_id", null)
          .is("project_id", null)
          .is("initiative_id", null)
          .select("id");
        if (wrote?.length) return;
        const spent: InboxSuggestion = { ...r.suggestion, auto: false, dismissed: true } as InboxSuggestion;
        r.suggestion = spent;
        results[r.id] = spent;
      }
      await admin.from("tasks").update({ suggestion: r.suggestion, suggested_at: r.suggested_at }).eq("id", r.id).eq("user_id", userId);
    }),
  );

  return results;
}

function str(v: unknown): string {
  return typeof v === "string" ? clean(v) : "";
}

function normalize(
  raw: Record<string, unknown>,
  sig: string,
  tree: { domains: Domain[]; initiatives: Initiative[]; projects: Project[] },
): InboxSuggestion {
  const energyRaw = str(raw.energy);
  const energy = (ENERGIES.has(energyRaw) ? energyRaw : null) as Energy | null;
  const rationale = str(raw.rationale).slice(0, 140);
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0.5));

  const dur = Number(raw.durationMinutes);
  const durationMinutes = Number.isFinite(dur) && dur > 0 ? Math.min(240, Math.max(5, Math.round(dur))) : null;

  // The model returns a bracketed id ("P:..") or a bare id; strip the prefix and
  // resolve against the real tree so a hallucinated id collapses to "none".
  let level = (str(raw.level) || "none") as Level;
  if (!LEVELS.has(level)) level = "none";
  const rawId = str(raw.targetId).replace(/^[DIP]:/i, "");

  let targetId: string | null = null;
  let targetLabel = "";
  let domainId: string | null = null;

  const resolveDomain = (id: string | null): Domain | undefined => tree.domains.find((d) => d.id === id);

  if (level === "project") {
    const p = tree.projects.find((x) => x.id === rawId);
    if (p) {
      targetId = p.id;
      targetLabel = clean(p.name);
      domainId = p.domain_id ?? tree.initiatives.find((i) => i.id === p.initiative_id)?.domain_id ?? null;
    } else level = "none";
  } else if (level === "initiative") {
    const i = tree.initiatives.find((x) => x.id === rawId);
    if (i) {
      targetId = i.id;
      targetLabel = clean(i.name);
      domainId = i.domain_id ?? null;
    } else level = "none";
  } else if (level === "domain") {
    const d = resolveDomain(rawId);
    if (d) {
      targetId = d.id;
      targetLabel = clean(d.name);
      domainId = d.id;
    } else level = "none";
  }

  const domainColor = resolveDomain(domainId)?.color ?? null;

  return { sig, level, targetId, targetLabel, domainId, domainColor, durationMinutes, energy, rationale, confidence, engine: "llm" };
}

type Effort = Pick<InboxSuggestion, "durationMinutes" | "energy" | "rationale" | "confidence">;

/** Duration + energy for tasks whose HOME is already decided (filed by hand, or
 *  placed by the classifier). It never judges placement. One completion for the
 *  whole batch; a failure degrades to "no estimate", never to a failed groom. */
async function estimateEffort(tasks: TaskRow[]): Promise<Map<string, Effort>> {
  const out = new Map<string, Effort>();
  if (!tasks.length) return out;
  const itemsLine = tasks
    .map((t, i) => `[${i}] "${clean(t.title)}"${t.notes ? ` — ${clean(t.notes)}` : ""}`)
    .join("\n");
  const prompt = `You are estimating effort for tasks that have already been filed to a home — only estimate energy and duration, do not judge placement.

Tasks:
${itemsLine}

For EACH task, estimate:
1. durationMinutes — realistic single-sitting estimate (5–240); null if unclear.
2. energy — "deep" (focused making/thinking), "decide" (review/reply/judge), "delegate" (hand off / follow up), or "quick" (shallow errand/admin).
3. rationale — ≤14 words, plain English, why this energy register.
4. confidence — 0..1.

Return exactly one entry for EVERY index listed above — do not skip any.

Respond with JSON only:
{"items":[{"i":<task index>,"durationMinutes":number|null,"energy":"deep|decide|delegate|quick","rationale":string,"confidence":number}]}`;
  let raw: { items?: Array<Record<string, unknown>> };
  try {
    raw = await completeJSON<{ items?: Array<Record<string, unknown>> }>(prompt);
  } catch (e) {
    console.warn("[enrichInbox] effort estimate failed:", e instanceof Error ? e.message : "error");
    return out;
  }
  for (const item of raw.items ?? []) {
    const idx = Number(item.i);
    if (!Number.isInteger(idx) || idx < 0 || idx >= tasks.length) continue;
    const energyRaw = str(item.energy);
    const dur = Number(item.durationMinutes);
    out.set(tasks[idx].id, {
      energy: (ENERGIES.has(energyRaw) ? energyRaw : null) as Energy | null,
      rationale: str(item.rationale).slice(0, 140),
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0.5)),
      durationMinutes: Number.isFinite(dur) && dur > 0 ? Math.min(240, Math.max(5, Math.round(dur))) : null,
    });
  }
  return out;
}

/** The domains as the router reads them: charter-led, with each one's newest
 *  CONFIRMED tasks quoted as live examples (the measured accuracy lift).
 *
 *  Which tasks count is the self-feeding rule, and it is deliberately narrow: a
 *  parented task is evidence for its PARENT's domain (its own copy goes stale —
 *  D-088), and an automatic filing nobody has reviewed yet is NOT evidence, or
 *  the router would learn from its own guess. */
export async function routeDomainsFor(userId: string, domains: Domain[]): Promise<RouteDomain[]> {
  const [taskRes, projRes] = await Promise.all([
    admin
      .from("tasks")
      .select("title, created_at, domain_id, project_id, status, suggestion")
      .eq("user_id", userId)
      .is("parent_task_id", null)
      .neq("status", "trashed")
      .order("created_at", { ascending: false })
      .limit(400),
    admin.from("projects").select("id, domain_id").eq("user_id", userId),
  ]);
  const projDomain = new Map((projRes.data ?? []).map((p: { id: string; domain_id: string | null }) => [p.id, p.domain_id]));
  const sample: ExemplarTask[] = (taskRes.data ?? []).map((t: {
    title: string; created_at: string; domain_id: string | null; project_id: string | null; status: string;
    suggestion: InboxSuggestion | null;
  }) => ({
    title: t.title,
    createdAt: t.created_at,
    domainId: (t.project_id ? projDomain.get(t.project_id) : null) ?? t.domain_id,
    autoUnconfirmed: Boolean(t.suggestion?.auto && !t.suggestion.outcome && t.status === "inbox"),
  }));
  const recent = pickExemplars(sample, EXEMPLARS_PER_DOMAIN);
  return domains.map((d) => ({
    id: d.id,
    name: clean(d.name),
    intention: d.intention,
    charter: d.charter,
    context: (d.context ?? null) as RouteDomain["context"],
    recent: recent.get(d.id) ?? [],
  }));
}

/** Which domain does a PROJECT belong to? Same router, same domain descriptions,
 *  same thresholds as the Inbox — a project is just more words to read. Proposes
 *  only (the Groom wall shows a chip); returns null when the classifier is
 *  unavailable or unsure, so the caller can fall back. */
export async function routeProject(
  userId: string,
  input: { name?: string; outcome?: string; description?: string; steps?: string[] },
): Promise<{ domainId: string; probability: number; tier: string } | null> {
  if (!decisionsAvailable()) return null;
  const name = clean(input.name ?? "");
  if (!name) return null;
  const { data } = await admin
    .from("domains")
    .select("id, name, color, intention, charter, context")
    .eq("user_id", userId)
    .order("sort_order");
  const domains = (data ?? []) as Domain[];
  if (!domains.length) return null;
  const text = [
    name,
    input.outcome ? `Outcome: ${clean(input.outcome)}` : "",
    input.description ? clean(input.description).slice(0, 400) : "",
    input.steps?.length ? `Steps: ${input.steps.slice(0, 12).map(clean).join("; ")}` : "",
  ].filter(Boolean).join("\n");
  const v = await routeDomain(await routeDomainsFor(userId, domains), text);
  return v && v.tier !== "none" ? { domainId: v.id, probability: v.probability, tier: v.tier } : null;
}
