// The Blueprint flow's intelligence: from a stated bet (name + outcome +
// domain), propose the whole subtree — measurable key results, 2-4 projects,
// and each project's first ordered tasks. Proposal only; the client renders
// the draft and writes accepted pieces itself (into quiet backlog).

import { admin } from "../_shared/admin.ts";
import { completeJSON } from "./llm.ts";

const ENERGIES = new Set(["deep", "decide", "delegate", "quick"]);

export interface BlueprintProposal {
  keyResults: { name: string; baseline: number; target: number; unit: string }[];
  projects: {
    name: string;
    outcome: string;
    tasks: { title: string; energy: string; durationMins: number }[];
  }[];
}

export async function blueprintInitiative(
  userId: string,
  input: { name: string; outcome: string; description?: string; domainId?: string },
): Promise<BlueprintProposal> {
  const domain = input.domainId
    ? (await admin.from("domains").select("name, intention").eq("id", input.domainId).eq("user_id", userId).maybeSingle()).data
    : null;

  const prompt = `You are shaping a personal initiative (a bet with a finish line) into an executable structure.

Initiative: ${input.name}
Outcome (what "done" looks like): ${input.outcome || "(not stated — infer a crisp one)"}
${input.description ? `Notes: ${input.description}` : ""}
${domain ? `Life domain: ${domain.name}. Standing intention: ${domain.intention}` : ""}

Propose:
- 2-3 key results: measurable, each with a numeric baseline (usually the current state, often 0), a target, and a short unit ("%", "mo", "d", "" for counts).
- 2-4 projects, in rough execution order, each with a one-line outcome and 3-6 first tasks in execution order (a → b → c). Task titles are verb-first and one-sitting sized (15–120 minutes). energy is one of "deep", "decide", "delegate", "quick".

Respond with JSON only:
{"keyResults":[{"name":string,"baseline":number,"target":number,"unit":string}],
 "projects":[{"name":string,"outcome":string,"tasks":[{"title":string,"energy":string,"duration_minutes":number}]}]}`;

  const raw = await completeJSON<{
    keyResults?: unknown[];
    projects?: unknown[];
  }>(prompt);

  const keyResults = (raw.keyResults ?? [])
    .filter((k): k is Record<string, unknown> => typeof k === "object" && k !== null)
    .map((k) => ({
      name: String(k.name ?? "").trim(),
      baseline: Number(k.baseline) || 0,
      target: Number(k.target) || 100,
      unit: String(k.unit ?? ""),
    }))
    .filter((k) => k.name)
    .slice(0, 4);

  const projects = (raw.projects ?? [])
    .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
    .map((p) => ({
      name: String(p.name ?? "").trim(),
      outcome: String(p.outcome ?? "").trim(),
      tasks: (Array.isArray(p.tasks) ? p.tasks : [])
        .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
        .map((t) => ({
          title: String(t.title ?? "").trim(),
          energy: ENERGIES.has(String(t.energy)) ? String(t.energy) : "quick",
          durationMins: Math.min(480, Math.max(5, Number(t.duration_minutes) || 30)),
        }))
        .filter((t) => t.title)
        .slice(0, 8),
    }))
    .filter((p) => p.name)
    .slice(0, 5);

  return { keyResults, projects };
}
