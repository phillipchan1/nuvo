// The agent's one-shot intelligence endpoints — which body key runs which
// function, in the order the Supabase agent checked them. Shared by the
// Supabase agent (index.ts) and the Cloudflare Worker (worker/src/agentHttp.ts),
// so routing can't drift. Returns undefined when the body names no one-shot
// (the caller falls through to chat). A throw is the caller's 500 {error}.

import type { AgentDeps } from "./agentDeps.ts";
import { scaffoldProject, scaffoldDraft } from "./scaffoldCore.ts";
import { assessRecord } from "./assessCore.ts";
import { refineProject } from "./refineCore.ts";
import { blueprintInitiative, draftInitiativeProjects } from "./blueprintCore.ts";
import { draftOutcome } from "./draftOutcomeCore.ts";
import { clusterInbox } from "./clusterInboxCore.ts";
import { nameSlot } from "./nameSlotCore.ts";
import { enrichInboxBatch, routeProject } from "./enrichInboxCore.ts";
import { enrichDomain } from "./enrichDomainCore.ts";
import { verifyItem } from "./verifyCore.ts";
import { parsePriorities, breakdownPriority } from "./prioritiesCore.ts";
import { prepareTask } from "./prepareCore.ts";
import { narrate } from "./narrateCore.ts";
import { narrateReviewFind } from "./reviewFindCore.ts";

// deno-lint-ignore no-explicit-any
export async function runOneShot(deps: AgentDeps, userId: string, body: any): Promise<unknown | undefined> {
  // One-shot intelligence endpoints. All of them propose; only `prepare`
  // writes (to the task's own prework field — never to the plan).
  if (body.scaffold?.projectId) {
    return await scaffoldProject(deps, userId, String(body.scaffold.projectId), {
      guidance: body.scaffold.guidance,
      draftTitles: Array.isArray(body.scaffold.draftTitles) ? body.scaffold.draftTitles.map(String) : undefined,
      description: body.scaffold.description ? String(body.scaffold.description) : undefined,
      redraft: Array.isArray(body.scaffold.redraft) ? body.scaffold.redraft.map(String) : undefined,
    });
  }
  // Refine an existing backlog: typo/wording fixes + missing steps + a
  // sensible order, all proposed as a reviewable diff the client applies.
  if (body.refine?.projectId) {
    return await refineProject(deps, userId, String(body.refine.projectId));
  }
  // Assess: a world-class coach's pass over a project or initiative, returning
  // anchored findings the client overlays as inline margin notes (Accept/Dismiss).
  if (body.assess?.id && (body.assess.kind === "project" || body.assess.kind === "initiative")) {
    return await assessRecord(deps, userId, body.assess.kind, String(body.assess.id));
  }
  // Tending's "raw → shaped" advance: draft one outcome line for a project /
  // initiative that has a name but no goal yet.
  if (body.draftOutcome?.id) {
    return await draftOutcome(deps, userId, body.draftOutcome);
  }
  // Tending's soundness judgment: is this item genuinely ready (outcome, steps,
  // time, dates), or just structurally filled in?
  if (body.verify?.id) {
    return await verifyItem(deps, userId, body.verify);
  }
  // The create-moment variant: draft a project's first tasks from typed
  // context, before the project row exists.
  if (body.scaffoldDraft) {
    return await scaffoldDraft(deps, userId, body.scaffoldDraft);
  }
  if (body.blueprint) {
    return await blueprintInitiative(deps, userId, {
      ...body.blueprint,
      draftProjectNames: Array.isArray(body.blueprint.draftProjectNames)
        ? body.blueprint.draftProjectNames.map(String)
        : undefined,
    });
  }
  // Draft the projects (D-196): an initiative's missing projects across its
  // quarter's weeks. Proposal only; the client writes what you hold.
  if (body.draftProjects?.initiativeId) {
    return await draftInitiativeProjects(deps, userId, {
      initiativeId: String(body.draftProjects.initiativeId),
      weekStarts: Array.isArray(body.draftProjects.weekStarts) ? body.draftProjects.weekStarts.map(String) : [],
      guidance: body.draftProjects.guidance ? String(body.draftProjects.guidance) : undefined,
      redraft: Array.isArray(body.draftProjects.redraft) ? body.draftProjects.redraft.map(String) : undefined,
    });
  }
  // Free-text → the week's priorities (outcomes), inferring each win + the bet
  // it serves. The client appends the parse to the sprint's big_rocks.
  if (body.priorities) {
    return await parsePriorities(deps, userId, body.priorities);
  }
  // "What moves this priority?" → propose this week's next actions.
  if (body.breakdown) {
    return await breakdownPriority(deps, userId, body.breakdown);
  }
  if (body.prepare?.taskId) {
    return await prepareTask(deps, userId, String(body.prepare.taskId));
  }
  // Plan's "theme the inbox": group loose captures into a few named runs the
  // client can place as focus blocks across the week's open time.
  if (body.clusterInbox) {
    return await clusterInbox(deps, userId, body.clusterInbox);
  }
  // The Schedule's "suggest a name": one block, named from what's inside it.
  // Proposes only — the name lands in the popover's input, not on the row.
  if (body.nameSlot) {
    return await nameSlot(deps, userId, body.nameSlot);
  }
  // Passive grooming: guess a batch of inbox captures' homes (project/
  // initiative/domain), duration and energy in one call. Persists
  // suggestions only — files nothing.
  if (body.enrichInbox?.taskIds) {
    const taskIds = Array.isArray(body.enrichInbox.taskIds) ? body.enrichInbox.taskIds.map(String) : [];
    return await enrichInboxBatch(deps, userId, taskIds);
  }
  // Domain refinement: expand a charter blurb into routing context (entities,
  // keywords, boundary) grooming reads. Proposes only — the domain floor persists it.
  if (body.enrichDomain?.domainId) {
    return await enrichDomain(deps, userId, body.enrichDomain);
  }
  // Project → domain: the same classifier the Inbox uses. Null = no verdict,
  // and the Groom wall falls back to its chat-model guess.
  if (body.routeProject) {
    return { route: await routeProject(deps, userId, body.routeProject) };
  }
  if (body.narrate) {
    return await narrate(deps, body.narrate);
  }
  // Weekly Review Find — warm the one pre-selected discovery. Numbers stay client-side.
  if (body.reviewFind) {
    return await narrateReviewFind(deps, body.reviewFind);
  }
  return undefined;
}
