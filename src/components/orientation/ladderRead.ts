import { at } from "../mobile/dayPlan";
import { domainById, taskDomainId, type Domain, type VerticalData } from "../../lib/vertical";
import type { Task } from "../../lib/types";
import type { LadderItem, LadderRung } from "./Ladder";

// What the ladder draws, read from what the account actually holds (D-200).
//
// One rule above all: **never a row the user didn't make.** A rung with nothing
// on it stays an open socket and says what it would earn (P7 — it must read on
// an empty account, and it must not invent). The welcome passes only domains;
// the walkthrough's last step passes everything, and gets whatever is true.
//
// Where the user's things are actually linked, the ladder follows the link: the
// task leads, its project (if it has one) is the project shown, that project's
// initiative is the initiative, and the domain is the one the work counts
// toward (`taskDomainId` — never the stale `domain_id` copy, D-088). Where they
// aren't linked — the usual day-one case, a loose capture and a separate
// project — each rung simply shows the newest thing on it. The drawing is "what
// you've put at each altitude", not a claimed lineage.

export interface LadderRead {
  rungs: LadderRung[];
  hour: { label: string; filled: boolean };
}

const live = (t: Task) => !t.trashed_at && t.status !== "done";
const newest = <T,>(xs: T[], key: (x: T) => string | null | undefined): T | undefined =>
  xs.reduce<T | undefined>((best, x) => ((key(x) ?? "") > (best ? key(best) ?? "" : "") ? x : best), undefined);

/** "Thu 9am" — the clock vocabulary (`at`, D-122), with the day it lands on. */
export function whenLabel(t: Task): string | undefined {
  if (!t.start_time) return undefined;
  const d = new Date(t.start_time);
  return `${d.toLocaleDateString([], { weekday: "short" })} ${at(d)}`;
}

/** The welcome's ladder: only the domains just named; every rung below is open. */
export function welcomeRungs(domains: Pick<Domain, "name" | "color">[]): LadderRung[] {
  return [
    { altitude: "domain", items: domains.map((d) => ({ name: d.name, color: d.color })) },
    { altitude: "initiative", items: [] },
    { altitude: "project", items: [] },
    { altitude: "task", items: [] },
  ];
}

export function readLadder(data: VerticalData | null | undefined, tasks: Task[] = []): LadderRead {
  const domains = data?.domains ?? [];
  const pool = tasks.filter(live);
  const timed = newest(pool.filter((t) => t.do_date && t.start_time), (t) => t.created_at);
  const task = timed ?? newest(pool.filter((t) => t.status === "inbox"), (t) => t.created_at);

  const projects = data?.projects ?? [];
  const project =
    (task?.project_id && projects.find((p) => p.id === task.project_id)) ||
    newest(projects, (p) => p.createdAt);
  const initiative = project?.initiativeId
    ? data?.initiatives.find((i) => i.id === project.initiativeId)
    : undefined;

  const domainId =
    project?.domainId ?? (task && data ? taskDomainId(data, task) : null) ?? null;
  const domain = domainId && data ? domainById(data, domainId) : undefined;
  const hue = domain?.color;

  const domainItems: LadderItem[] = domain
    ? [{ name: domain.name, color: domain.color }]
    : domains.map((d) => ({ name: d.name, color: d.color }));

  const when = task ? whenLabel(task) : undefined;
  return {
    rungs: [
      { altitude: "domain", items: domainItems },
      { altitude: "initiative", items: initiative ? [{ name: initiative.name, color: hue }] : [] },
      { altitude: "project", items: project ? [{ name: project.name, color: hue }] : [] },
      { altitude: "task", items: task ? [{ name: task.title, color: hue }] : [] },
    ],
    hour: when ? { label: when, filled: true } : { label: "an hour", filled: false },
  };
}
