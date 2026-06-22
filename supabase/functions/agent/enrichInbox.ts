// Passive inbox grooming — Nuvo's cached *suggestion* for one raw capture. Reads
// the task plus the user's open vertical (domains, in-flight initiatives and
// projects) and proposes the most specific existing home it genuinely fits, a
// duration, an energy register, and a one-line reason. Proposes ONLY: nothing is
// filed and no field is changed — the client caches the verdict (with a
// title+notes signature) and re-grooms when the capture changes. Mirror of
// verify.ts for the project/initiative soundness layer.

import { admin } from "../_shared/admin.ts";
import { completeJSON } from "./llm.ts";

type Energy = "deep" | "decide" | "delegate" | "quick";
type Level = "project" | "initiative" | "domain" | "none";

const ENERGIES = new Set(["deep", "decide", "delegate", "quick"]);
const LEVELS = new Set(["project", "initiative", "domain", "none"]);

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
}

// Postgres jsonb rejects NUL / other C0 control chars ("unsupported Unicode
// escape sequence"); the model — and imported task/project names — occasionally
// carry one. Strip them from every string before it lands in the suggestion.
// deno-lint-ignore no-control-regex
const clean = (s: string): string => s.replace(/[\x00-\x1F\x7F]/g, " ").trim();

/** The capture's identity for staleness — must match the client's grooming.ts. */
export function suggestionSig(title: string, notes: string): string {
  return clean(`${title ?? ""} ${notes ?? ""}`).toLowerCase();
}

export async function enrichInbox(userId: string, taskId: string): Promise<InboxSuggestion> {
  const { data: task, error } = await admin
    .from("tasks")
    .select("title, notes")
    .eq("id", taskId)
    .eq("user_id", userId)
    .single();
  if (error || !task) throw new Error("Task not found");

  // The open vertical the capture could plausibly belong to. Skip finished /
  // cancelled work — you don't file a fresh capture into a closed project.
  const [domRes, iniRes, projRes] = await Promise.all([
    admin.from("domains").select("id, name, color, intention, context").eq("user_id", userId).order("sort_order"),
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

  const sig = suggestionSig(task.title, task.notes ?? "");

  const fmt = (s: string | null, max = 80) =>
    s ? ` — ${clean(s.length > max ? s.slice(0, max) + "…" : s)}` : "";
  // A domain's routing context (entities + boundary) is the strongest signal we
  // have — feed it in when the user has refined the domain; fall back to the vow.
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

  const prompt = `You are quietly grooming one raw item in a person's inbox — guessing where it belongs so they don't have to file it by hand. Be a sharp, conservative copilot: only place it somewhere you're genuinely confident it fits.

The item:
"${clean(task.title)}"${task.notes ? `\nTheir note: ${clean(task.notes)}` : ""}

The person's life structure is Domain → Initiative (a bet with a finish line) → Project (a concrete chunk of work) → Task. Here is everything currently open:

DOMAINS (life areas):
${domLine}

INITIATIVES:
${iniLine}

PROJECTS:
${projLine}

Decide:
1. placement — file by ALTITUDE, biasing UP. Default to the DOMAIN whose signals/scope the capture matches (use the entities and NOT-boundaries above — a capture naming a domain's signal almost certainly belongs to that domain). Descend to a specific initiative or project ONLY when the capture is unmistakably about that exact bet or deliverable; otherwise stay at the domain. Over-filing into a project is the expensive mistake — when unsure between a project and its domain, choose the domain. Return "none" only when it matches no domain at all. Return the bracketed id (e.g. "D:..", "I:..", "P:..") or "none".
2. durationMinutes — a realistic single-sitting estimate (5–240) if the task implies one; null if you truly can't tell.
3. energy — the register: "deep" (focused making/thinking), "decide" (review/reply/judge), "delegate" (hand off / follow up), or "quick" (shallow errand/admin).
4. rationale — ≤14 words, plain English, why it lands there (or why it's standalone). No ids.
5. confidence — 0..1, how sure you are of the placement.

Respond with JSON only:
{"level":"project|initiative|domain|none","targetId":string|null,"durationMinutes":number|null,"energy":"deep|decide|delegate|quick","rationale":string,"confidence":number}`;

  const raw = await completeJSON<Record<string, unknown>>(prompt);
  const suggestion = normalize(raw, sig, { domains, initiatives, projects });

  const { error: upErr } = await admin
    .from("tasks")
    .update({ suggestion, suggested_at: new Date().toISOString() })
    .eq("id", taskId)
    .eq("user_id", userId);
  if (upErr) throw new Error(upErr.message);

  return suggestion;
}

type Domain = { id: string; name: string; color: string | null; intention: string | null; context: unknown };
type Initiative = { id: string; name: string; outcome: string | null; domain_id: string | null };
type Project = { id: string; name: string; outcome: string | null; domain_id: string | null; initiative_id: string | null };

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

  return { sig, level, targetId, targetLabel, domainId, domainColor, durationMinutes, energy, rationale, confidence };
}
