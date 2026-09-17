/**
 * What a typed line becomes — the one mapping from a parsed capture to a task.
 *
 * Every add box in the app (the rail, a record's list, a slot, the phone's
 * sheet, ⌘K) used to do this itself, and they disagreed: most kept only the
 * title and a duration and dropped the date, labels, priority and note the
 * parser had already found; one showed a repeat chip and then created a plain
 * task. The surface now only says where it is (`CaptureContext`); this decides
 * what the words mean.
 *
 * Precedence, most specific first:
 *   typed tokens  >  the host's context  >  defaults
 * — `@project` beats "you're in a project", `tomorrow` beats "you're on Today".
 */

import type { NewTaskInput } from "../hooks/useTasks";
import type { SeriesTemplate } from "../hooks/useRecurrence";
import { captureTitle, resolveRoute, type ParsedCapture, type RouteTarget } from "./nlp";
import type { RecurrenceRule } from "./recurrence";
import { DEFAULT_PROJECT_DURATION_MINUTES, type Label } from "./types";

/** Where the add box is. Everything optional: the rail's Inbox passes nothing. */
export interface CaptureContext {
  projectId?: string | null;
  initiativeId?: string | null;
  domainId?: string | null;
  /** A slot's children land inside it, on its day, in its home. */
  slot?: { id: string; do_date: string; project_id: string | null; domain_id: string | null } | null;
  /** The day the host is showing (the rail's Today tab, a calendar day). */
  doDate?: string | null;
  /** A clock the host already chose (a tap on the day canvas); typed time wins. */
  startTime?: Date | null;
  /** The length that goes with `startTime`. */
  durationMinutes?: number | null;
  /** Insert position within the host's list (add above / below). */
  sortOrder?: number;
}

export interface CaptureEnv {
  labels: Label[];
  routeTargets: RouteTarget[];
  /** A project's own home, so a task filed into it carries the right initiative/domain (D-088). */
  homeOfProject: (projectId: string) => { initiativeId: string | null; domainId: string | null } | null;
  homeOfInitiative: (initiativeId: string) => { domainId: string | null } | null;
  todayISO: string;
  /** The account's default length for an unfiled block (Settings). */
  defaultDurationMins: number;
}

export type CaptureAction =
  | { kind: "task"; input: NewTaskInput }
  | { kind: "series"; rule: RecurrenceRule; anchorISO: string; template: SeriesTemplate };

interface Home {
  project_id: string | null;
  initiative_id: string | null;
  domain_id: string | null;
}

function homeFrom(p: ParsedCapture, ctx: CaptureContext, env: CaptureEnv): { home: Home; routed: boolean } {
  const routed = p.route ? resolveRoute(p.route, env.routeTargets) : null;
  if (routed?.kind === "project") {
    const h = env.homeOfProject(routed.id);
    return { routed: true, home: { project_id: routed.id, initiative_id: h?.initiativeId ?? null, domain_id: h?.domainId ?? null } };
  }
  if (routed?.kind === "initiative") {
    const h = env.homeOfInitiative(routed.id);
    return { routed: true, home: { project_id: null, initiative_id: routed.id, domain_id: h?.domainId ?? null } };
  }
  if (routed?.kind === "domain") {
    return { routed: true, home: { project_id: null, initiative_id: null, domain_id: routed.id } };
  }
  if (ctx.projectId) {
    const h = env.homeOfProject(ctx.projectId);
    return {
      routed: false,
      home: {
        project_id: ctx.projectId,
        initiative_id: h?.initiativeId ?? ctx.initiativeId ?? null,
        domain_id: h?.domainId ?? ctx.domainId ?? null,
      },
    };
  }
  if (ctx.initiativeId) {
    const h = env.homeOfInitiative(ctx.initiativeId);
    return { routed: false, home: { project_id: null, initiative_id: ctx.initiativeId, domain_id: h?.domainId ?? ctx.domainId ?? null } };
  }
  if (ctx.slot) {
    return { routed: false, home: { project_id: ctx.slot.project_id, initiative_id: null, domain_id: ctx.slot.domain_id } };
  }
  return { routed: false, home: { project_id: null, initiative_id: null, domain_id: ctx.domainId ?? null } };
}

/** The action a typed line asks for, or null when there's nothing to create. */
export function draftFromCapture(
  p: ParsedCapture,
  raw: string,
  ctx: CaptureContext,
  env: CaptureEnv,
): CaptureAction | null {
  const { home, routed } = homeFrom(p, ctx, env);
  // An @token that matched nothing stays in the title for grooming to home.
  const title = (routed ? p.title : captureTitle(p, raw)).trim() || raw.trim();
  if (!title) return null;

  const filed = Boolean(home.project_id || home.initiative_id || home.domain_id);
  const duration = p.durationMinutes ?? (filed ? DEFAULT_PROJECT_DURATION_MINUTES : null);

  if (p.recurrence) {
    return {
      kind: "series",
      rule: p.recurrence,
      anchorISO: p.recurrenceAnchor ?? p.doDate ?? ctx.slot?.do_date ?? ctx.doDate ?? env.todayISO,
      template: {
        title,
        duration_minutes: duration ?? env.defaultDurationMins,
        time_of_day_minutes: p.startTime ? p.startTime.getHours() * 60 + p.startTime.getMinutes() : null,
        project_id: home.project_id,
        domain_id: home.domain_id,
        priority: p.priority,
      },
    };
  }

  // A typed day or time takes the task out of the slot it was typed into —
  // it asked to be somewhere else.
  const typedWhen = Boolean(p.doDate || p.startTime);
  const slot = ctx.slot && !typedWhen ? ctx.slot : null;
  const doDate = p.doDate ?? slot?.do_date ?? ctx.doDate ?? null;
  const start = p.startTime ?? (slot ? null : ctx.startTime ?? null);
  const length =
    p.durationMinutes ?? (start && !p.startTime ? (ctx.durationMinutes ?? env.defaultDurationMins) : duration);

  const labelIds = p.labels
    .map((name) => env.labels.find((l) => l.name.toLowerCase() === name.toLowerCase())?.id)
    .filter((id): id is string => Boolean(id));

  return {
    kind: "task",
    input: {
      title,
      notes: p.notes ?? undefined,
      do_date: doDate,
      start_time: start?.toISOString() ?? null,
      duration_minutes: length,
      priority: p.priority,
      labelIds,
      slot_id: slot?.id ?? null,
      project_id: home.project_id,
      initiative_id: home.initiative_id,
      domain_id: home.domain_id,
      sort_order: ctx.sortOrder,
      // Filed work with no day rests in its home's backlog, not in triage.
      status: !doDate && filed ? "backlog" : undefined,
    },
  };
}
