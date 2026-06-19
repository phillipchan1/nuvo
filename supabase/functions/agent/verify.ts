// Soundness — Nuvo's judgment of whether a project / initiative is genuinely
// READY for the time layer, not just structurally filled in. Reads the item, its
// tasks (and sub-projects for an initiative), the domain intention, and the
// person's working capacity, then judges four things: outcome quality, steps
// soundness, time-to-completion realism, and date sanity. Proposes only — the
// client caches the verdict (with a structural signature) and gates "tended" on it.

import { admin } from "../_shared/admin.ts";
import { completeJSON } from "./llm.ts";

type StepVerdict = "thin" | "sound" | "bloated";
type TimeRead = "comfortable" | "tight" | "unrealistic";

export interface VerdictOut {
  sound: boolean;
  confidence: number;
  outcome: { ok: boolean; note: string; suggestion?: string };
  steps: { ok: boolean; note: string; verdict: StepVerdict; missing?: string[] };
  time: { ok: boolean; note: string; read: TimeRead; estHours: number };
  dates: { ok: boolean; note: string };
}

const STEP_VERDICTS = new Set(["thin", "sound", "bloated"]);
const TIME_READS = new Set(["comfortable", "tight", "unrealistic"]);

export async function verifyItem(
  userId: string,
  input: { kind: "project" | "initiative"; id: string },
): Promise<VerdictOut> {
  const kind = input.kind === "initiative" ? "initiative" : "project";
  const table = kind === "initiative" ? "initiatives" : "projects";

  const { data: item, error } = await admin
    .from(table)
    .select("name, outcome, description, start_date, target_date, status, domain_id")
    .eq("id", input.id)
    .eq("user_id", userId)
    .single();
  if (error || !item) throw new Error(`${kind} not found`);

  const [domainRes, settingsRes] = await Promise.all([
    item.domain_id
      ? admin.from("domains").select("name, intention").eq("id", item.domain_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("user_settings").select("work_start_minutes, work_end_minutes").eq("user_id", userId).maybeSingle(),
  ]);
  const domain = domainRes.data;
  const s = settingsRes.data;
  const dailyHours = s ? Math.max(1, (s.work_end_minutes - s.work_start_minutes) / 60) : 8;

  // gather the work: a project's tasks, or an initiative's sub-projects + loose tasks
  let work = "";
  if (kind === "project") {
    const { data: tasks } = await admin
      .from("tasks")
      .select("title, status, duration_minutes")
      .eq("project_id", input.id)
      .neq("status", "trashed")
      .order("sort_order");
    work = (tasks ?? []).map((t) => `- [${t.status}] ${t.title} (${t.duration_minutes ?? 30}m)`).join("\n") || "(no tasks yet)";
  } else {
    const lines: string[] = [];
    const { data: projs } = await admin
      .from("projects")
      .select("id, name, outcome")
      .eq("initiative_id", input.id)
      .not("status", "in", '("cancelled")')
      .order("sort_order");
    for (const p of projs ?? []) {
      lines.push(`Project: ${p.name} — ${p.outcome || "(no outcome)"}`);
      const { data: ts } = await admin
        .from("tasks").select("title, status, duration_minutes")
        .eq("project_id", p.id).neq("status", "trashed").order("sort_order");
      for (const t of ts ?? []) lines.push(`  - [${t.status}] ${t.title} (${t.duration_minutes ?? 30}m)`);
    }
    const { data: loose } = await admin
      .from("tasks").select("title, status, duration_minutes")
      .eq("initiative_id", input.id).is("project_id", null).neq("status", "trashed");
    for (const t of loose ?? []) lines.push(`- [${t.status}] ${t.title} (${t.duration_minutes ?? 30}m)`);
    work = lines.join("\n") || "(no projects or tasks yet)";
  }

  const today = new Date().toISOString().slice(0, 10);
  const noun = kind === "initiative" ? "initiative (a bet with a finish line)" : "project (a concrete chunk of work)";

  const prompt = `You are judging whether a personal ${noun} is genuinely READY to hand to the scheduling layer — not just whether its fields are filled in. Be a discerning but fair copilot; don't nitpick a sound plan, don't rubber-stamp a vague one.

Today is ${today}. The person does about ${dailyHours.toFixed(0)}h of focused work per day.

Name: ${item.name}
Outcome: ${item.outcome || "(none stated)"}
${item.description ? `Notes: ${item.description}` : ""}
Start: ${item.start_date ?? "(none)"} · Finish line: ${item.target_date ?? "(none)"} · Status: ${item.status}
${domain ? `Domain: ${domain.name}. Standing intention: ${domain.intention}` : ""}

Work so far:
${work}

Judge four things, each with a note ≤14 words:
1. outcome — is it specific and VERIFIABLE (you'd know the moment it's done), not vague or generic? If weak, put a sharper one-line rewrite in "suggestion".
2. steps — are the tasks a reasonable and SUFFICIENT path to the outcome? "thin" = too few or missing critical steps (name them in "missing"), "sound" = a real path, "bloated" = padded with busywork.
3. time — estimate the remaining hours ("estHours"). Compare to the finish line and the person's capacity: "comfortable", "tight", or "unrealistic". With no finish line, only say "unrealistic" if the work is large and wholly undated; otherwise "comfortable".
4. dates — does the finish line make sense? Flag a finish line already in the past, or one with no plausible relation to the amount of work.

"sound" is true ONLY if: outcome.ok AND steps.verdict != "thin" AND time.read != "unrealistic" AND dates.ok.

Respond with JSON only:
{"sound":boolean,"confidence":0..1,
 "outcome":{"ok":boolean,"note":string,"suggestion":string},
 "steps":{"ok":boolean,"note":string,"verdict":"thin|sound|bloated","missing":[string]},
 "time":{"ok":boolean,"note":string,"read":"comfortable|tight|unrealistic","estHours":number},
 "dates":{"ok":boolean,"note":string}}`;

  const raw = await completeJSON<Record<string, unknown>>(prompt);
  return normalize(raw);
}

function obj(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function bool(v: unknown): boolean {
  return v === true;
}

function normalize(raw: Record<string, unknown>): VerdictOut {
  const o = obj(raw.outcome);
  const st = obj(raw.steps);
  const ti = obj(raw.time);
  const da = obj(raw.dates);

  const stepVerdict = (STEP_VERDICTS.has(str(st.verdict)) ? str(st.verdict) : "sound") as StepVerdict;
  const timeRead = (TIME_READS.has(str(ti.read)) ? str(ti.read) : "comfortable") as TimeRead;
  const missing = Array.isArray(st.missing) ? st.missing.map(str).filter(Boolean).slice(0, 5) : [];
  const suggestion = str(o.suggestion);

  const outcome = { ok: bool(o.ok), note: str(o.note), ...(suggestion ? { suggestion } : {}) };
  const steps = { ok: bool(st.ok), note: str(st.note), verdict: stepVerdict, ...(missing.length ? { missing } : {}) };
  const time = {
    ok: bool(ti.ok),
    note: str(ti.note),
    read: timeRead,
    estHours: Math.max(0, Math.round((Number(ti.estHours) || 0) * 10) / 10),
  };
  const dates = { ok: bool(da.ok), note: str(da.note) };

  // Derive `sound` from the parts so it can't contradict them.
  const sound = outcome.ok && steps.verdict !== "thin" && time.read !== "unrealistic" && dates.ok;
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0.6));

  return { sound, confidence, outcome, steps, time, dates };
}
