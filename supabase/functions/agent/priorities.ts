// Parse a person's free-form statement of their week into PRIORITIES — the few
// outcomes that, if they happen, make the week a win. The opposite of data
// entry: read what they wrote naturally and structure it (title + the "win" +
// the bet it serves). Proposal only; the client appends accepted items to the
// sprint's big_rocks and lets the user refine. Mirrors blueprint.ts.

import { completeJSON } from "./llm.ts";
import { buildProposalContext, ACTIVE_STATUSES } from "./proposalContext.ts";

export interface ParsedTask {
  title: string;
  energy: string;
  durationMins: number;
  deadline: string | null;
}

export interface PriorityProposal {
  priorities: { title: string; win: string; initiativeId: string | null; projectId: string | null; tasks: ParsedTask[] }[];
  tasks: ParsedTask[]; // standalone one-offs that aren't a priority
}

export async function parsePriorities(
  userId: string,
  input: { text?: string; today?: string },
): Promise<PriorityProposal> {
  const text = (input.text ?? "").trim();
  if (!text) return { priorities: [], tasks: [] };

  // Existing standing work, so a named priority can BIND to the thing it already
  // names — a project (most specific) or the broader initiative it serves. Drawn
  // from the shared proposal-context engine.
  const ctx = await buildProposalContext(userId);
  const activeInits = ctx.initiatives.filter((i) => ACTIVE_STATUSES.includes(i.status));
  const validInitIds = new Set(activeInits.map((i) => i.id));
  const betList = activeInits.length
    ? activeInits
        .map((i) => {
          const dom = i.domainId ? ctx.domainById.get(i.domainId)?.name ?? "" : "";
          return `- id:${i.id} — "${i.name}"${dom ? ` (${dom})` : ""}`;
        })
        .join("\n")
    : "(none)";

  const activeProjs = ctx.projects.filter((p) => ACTIVE_STATUSES.includes(p.status));
  const validProjIds = new Set(activeProjs.map((p) => p.id));
  const projList = activeProjs.length
    ? activeProjs
        .map((p) => {
          const dom = p.domainId ? ctx.domainById.get(p.domainId)?.name ?? "" : "";
          const init = p.initiativeId ? ctx.initiativeById.get(p.initiativeId)?.name ?? "" : "";
          return `- id:${p.id} — "${p.name}"${init ? ` · part of ${init}` : ""}${dom ? ` (${dom})` : ""}`;
        })
        .join("\n")
    : "(none)";

  const today = input.today || "(unknown — only set a deadline if an absolute date is stated)";
  const prompt = `Turn a person's free-form brain-dump of their week into structure. This is the opposite of data entry — read what they wrote the way they'd say it.

Today is ${today}. Resolve any relative timing ("Thursday", "by Friday", "EOW", "next week") to a YYYY-MM-DD date.

What they wrote:
"""
${text}
"""

Their existing standing work, for linking a priority to something that ALREADY exists:
PROJECTS (most specific — prefer these):
${projList}
INITIATIVES (broader bets):
${betList}

Separate two things:
1) PRIORITIES — the few OUTCOMES that, if they happen, make the week a win. For each:
   - "title": the outcome, verb-first and concise. A real outcome, not a vague theme.
   - "win": one line of what done looks like (infer it if they only implied it).
   - "projectId" / "initiativeId": link the priority to AT MOST ONE existing thing it NAMES.
       · Recognize, never classify — link only when the priority unmistakably names that exact project/bet (same work, not merely the same topic or domain).
       · Prefer the MOST SPECIFIC match: a named project ("projectId") over its parent initiative. Set at most ONE of the two; the other stays null.
       · Most priorities name nothing on these lists — that's normal and healthy. A wrong link is worse than none: when there's ANY doubt, set BOTH to null. Never invent an id.
   - "tasks": the concrete next actions to move it THIS week (verb-first, one-sitting sized 15-120 min).
2) TASKS — standalone one-offs they mentioned that are NOT a priority (errands, quick to-dos).

Every task (under a priority or standalone) has: {title, energy ("deep"|"decide"|"delegate"|"quick"), duration_minutes, deadline (YYYY-MM-DD or null — only if timing was implied)}.

duration_minutes must be an HONEST estimate of focused time, sized to the ACTUAL work and varied across tasks — a quick reply/edit is ~15, a real piece of building, writing, designing or analysis is usually 60–120+. Real project work rarely fits in 30. Never lazily stamp everything 30: a uniform 30 is almost always wrong and wrecks the schedule.

Rules:
- One priority per distinct outcome; don't split or merge. Don't pad — some dumps are all tasks and no priorities, and that's fine.
- No internal ids anywhere in the text.

Respond with JSON only:
{"priorities":[{"title":string,"win":string,"projectId":string|null,"initiativeId":string|null,"tasks":[{"title":string,"energy":string,"duration_minutes":number,"deadline":string|null}]}],"tasks":[{"title":string,"energy":string,"duration_minutes":number,"deadline":string|null}]}`;

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
    .map((p) => {
      const projectId = typeof p.projectId === "string" && validProjIds.has(p.projectId) ? p.projectId : null;
      // Most specific binding wins: a project subsumes its parent initiative, so
      // don't keep both (priorityWork would double-count the umbrella).
      const initiativeId = projectId
        ? null
        : typeof p.initiativeId === "string" && validInitIds.has(p.initiativeId) ? p.initiativeId : null;
      return {
        title: String(p.title ?? "").trim(),
        win: String(p.win ?? "").trim(),
        initiativeId,
        projectId,
        tasks: (Array.isArray(p.tasks) ? p.tasks : []).map(mapTask).filter((t): t is ParsedTask => t !== null).slice(0, 6),
      };
    })
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
  input: { title?: string; win?: string; initiativeId?: string | null; projectId?: string | null },
): Promise<{ tasks: { title: string; energy: string; durationMins: number }[] }> {
  const title = (input.title ?? "").trim();
  if (!title) return { tasks: [] };

  // Ground the breakdown in the standing work this priority binds to. Prefer the
  // most specific home (project), falling back to the initiative it serves. Both
  // resolved from the shared proposal-context engine (already user-scoped).
  const ctx = await buildProposalContext(userId);
  let initCtx = "";
  if (input.projectId) {
    const proj = ctx.projectById.get(input.projectId);
    if (proj) {
      const dom = proj.domainId ? ctx.domainById.get(proj.domainId)?.name : null;
      initCtx = `\nThis advances the project "${proj.name}"${proj.outcome ? ` (aim: ${proj.outcome})` : ""}${dom ? ` in ${dom}` : ""}.`;
    }
  } else if (input.initiativeId) {
    const init = ctx.initiativeById.get(input.initiativeId);
    if (init) {
      const dom = init.domainId ? ctx.domainById.get(init.domainId)?.name : null;
      initCtx = `\nThis serves the bet "${init.name}"${init.outcome ? ` (aim: ${init.outcome})` : ""}${dom ? ` in ${dom}` : ""}.`;
    }
  }

  const prompt = `A person has a PRIORITY for this week — an outcome they want to move. Propose the concrete next actions that move it THIS WEEK (this week's slice, not the whole project).

Priority: ${title}${input.win ? `\nWhat "done" looks like: ${input.win}` : ""}${initCtx}

Return 1-4 tasks, in execution order, that realistically fit in one week:
- "title": verb-first, one-sitting sized (15-120 min). Concrete, not a vague theme.
- "energy": one of "deep", "decide", "delegate", "quick".
- "duration_minutes": an HONEST estimate of focused time, sized to the actual work and varied across tasks — a quick edit is ~15-20, but real building, writing, designing or analysis is usually 60-120+. Real project work rarely fits in 30. Never lazily default to 30; a uniform 30 is almost always wrong and wrecks the schedule.

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
