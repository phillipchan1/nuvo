// Parse a person's free-form statement of their week into PRIORITIES — the few
// outcomes that, if they happen, make the week a win. The opposite of data
// entry: read what they wrote naturally and structure it (title + the "win" +
// the bet it serves). Proposal only; the client appends accepted items to the
// sprint's big_rocks and lets the user refine. Mirrors blueprint.ts.

import { admin } from "../_shared/admin.ts";
import { completeJSON } from "./llm.ts";

export interface ParsedTask {
  title: string;
  energy: string;
  durationMins: number;
  deadline: string | null;
}

export interface PriorityProposal {
  priorities: { title: string; win: string; initiativeId: string | null; tasks: ParsedTask[] }[];
  tasks: ParsedTask[]; // standalone one-offs that aren't a priority
}

export async function parsePriorities(
  userId: string,
  input: { text?: string; today?: string },
): Promise<PriorityProposal> {
  const text = (input.text ?? "").trim();
  if (!text) return { priorities: [], tasks: [] };

  // active bets, so a priority can be linked to the initiative it serves
  const [{ data: initRows }, { data: domRows }] = await Promise.all([
    admin.from("initiatives").select("id, name, domain_id, status").eq("user_id", userId).in("status", ["backlog", "in_progress", "waiting"]),
    admin.from("domains").select("id, name").eq("user_id", userId),
  ]);
  const domName = new Map((domRows ?? []).map((d) => [d.id as string, d.name as string]));
  const inits = (initRows ?? []).map((i) => ({
    id: i.id as string,
    name: i.name as string,
    domain: domName.get(i.domain_id as string) ?? "",
  }));
  const validIds = new Set(inits.map((i) => i.id));
  const betList = inits.length
    ? inits.map((i) => `- id:${i.id} — "${i.name}"${i.domain ? ` (${i.domain})` : ""}`).join("\n")
    : "(none)";

  const today = input.today || "(unknown — only set a deadline if an absolute date is stated)";
  const prompt = `Turn a person's free-form brain-dump of their week into structure. This is the opposite of data entry — read what they wrote the way they'd say it.

Today is ${today}. Resolve any relative timing ("Thursday", "by Friday", "EOW", "next week") to a YYYY-MM-DD date.

What they wrote:
"""
${text}
"""

Their active bets (initiatives), for linking:
${betList}

Separate two things:
1) PRIORITIES — the few OUTCOMES that, if they happen, make the week a win. For each:
   - "title": the outcome, verb-first and concise. A real outcome, not a vague theme.
   - "win": one line of what done looks like (infer it if they only implied it).
   - "initiativeId": almost always null. ONLY set it when the priority EXPLICITLY names, or is unmistakably, one of the listed bets — same project/outcome, not just the same topic or domain. A wrong link is worse than none, so when there's any doubt at all, use null. Never invent an id.
   - "tasks": the concrete next actions to move it THIS week (verb-first, one-sitting sized 15-120 min).
2) TASKS — standalone one-offs they mentioned that are NOT a priority (errands, quick to-dos).

Every task (under a priority or standalone) has: {title, energy ("deep"|"decide"|"delegate"|"quick"), duration_minutes, deadline (YYYY-MM-DD or null — only if timing was implied)}.

Rules:
- One priority per distinct outcome; don't split or merge. Don't pad — some dumps are all tasks and no priorities, and that's fine.
- No internal ids anywhere in the text.

Respond with JSON only:
{"priorities":[{"title":string,"win":string,"initiativeId":string|null,"tasks":[{"title":string,"energy":string,"duration_minutes":number,"deadline":string|null}]}],"tasks":[{"title":string,"energy":string,"duration_minutes":number,"deadline":string|null}]}`;

  const raw = await completeJSON<{ priorities?: unknown[]; tasks?: unknown[] }>(prompt);

  const mapTask = (t: unknown): ParsedTask | null => {
    if (typeof t !== "object" || t === null) return null;
    const o = t as Record<string, unknown>;
    const title = String(o.title ?? "").trim();
    if (!title) return null;
    const dl = typeof o.deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.deadline) ? o.deadline : null;
    return {
      title,
      energy: ENERGIES.has(String(o.energy)) ? String(o.energy) : "quick",
      durationMins: Math.min(240, Math.max(10, Number(o.duration_minutes) || 30)),
      deadline: dl,
    };
  };

  const priorities = (raw.priorities ?? [])
    .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
    .map((p) => ({
      title: String(p.title ?? "").trim(),
      win: String(p.win ?? "").trim(),
      initiativeId: typeof p.initiativeId === "string" && validIds.has(p.initiativeId) ? p.initiativeId : null,
      tasks: (Array.isArray(p.tasks) ? p.tasks : []).map(mapTask).filter((t): t is ParsedTask => t !== null).slice(0, 6),
    }))
    .filter((p) => p.title)
    .slice(0, 8);

  const tasks = (raw.tasks ?? []).map(mapTask).filter((t): t is ParsedTask => t !== null).slice(0, 12);

  return { priorities, tasks };
}

const ENERGIES = new Set(["deep", "decide", "delegate", "quick"]);

// "What moves this?" — propose THIS WEEK's concrete next actions for a priority
// (its slice, not the whole project). Proposal only; the client creates the
// accepted tasks and commits them to the week.
export async function breakdownPriority(
  userId: string,
  input: { title?: string; win?: string; initiativeId?: string | null },
): Promise<{ tasks: { title: string; energy: string; durationMins: number }[] }> {
  const title = (input.title ?? "").trim();
  if (!title) return { tasks: [] };

  let initCtx = "";
  if (input.initiativeId) {
    const { data: init } = await admin
      .from("initiatives")
      .select("name, outcome, domain_id")
      .eq("id", input.initiativeId)
      .eq("user_id", userId)
      .maybeSingle();
    if (init) {
      const dom = init.domain_id
        ? (await admin.from("domains").select("name").eq("id", init.domain_id).maybeSingle()).data
        : null;
      initCtx = `\nThis serves the bet "${init.name}"${init.outcome ? ` (aim: ${init.outcome})` : ""}${dom?.name ? ` in ${dom.name}` : ""}.`;
    }
  }

  const prompt = `A person has a PRIORITY for this week — an outcome they want to move. Propose the concrete next actions that move it THIS WEEK (this week's slice, not the whole project).

Priority: ${title}${input.win ? `\nWhat "done" looks like: ${input.win}` : ""}${initCtx}

Return 1-4 tasks, in execution order, that realistically fit in one week:
- "title": verb-first, one-sitting sized (15-120 min). Concrete, not a vague theme.
- "energy": one of "deep", "decide", "delegate", "quick".
- "duration_minutes": a realistic estimate.

Don't pad — fewer real next actions beats a long list.

Respond with JSON only:
{"tasks":[{"title":string,"energy":string,"duration_minutes":number}]}`;

  const raw = await completeJSON<{ tasks?: unknown[] }>(prompt);
  const tasks = (raw.tasks ?? [])
    .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
    .map((t) => ({
      title: String(t.title ?? "").trim(),
      energy: ENERGIES.has(String(t.energy)) ? String(t.energy) : "quick",
      durationMins: Math.min(240, Math.max(10, Number(t.duration_minutes) || 30)),
    }))
    .filter((t) => t.title)
    .slice(0, 5);
  return { tasks };
}
