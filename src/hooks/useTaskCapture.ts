/**
 * The one way a typed line becomes a task — parse, map, create.
 *
 * Every add box calls `capture(text)`; none of them builds a `NewTaskInput`
 * itself. The context is the only thing a surface contributes (see
 * `lib/captureDraft.ts` for why that line is drawn where it is).
 */

import { createContext, useCallback, useContext, useMemo } from "react";
import { draftFromCapture, type CaptureAction, type CaptureContext, type CaptureEnv, type SlotDraftInput } from "../lib/captureDraft";
import { parseCapture, type ParsedCapture, type RouteTarget } from "../lib/nlp";
import { todayISO } from "../lib/dates";
import type { Label, Task } from "../lib/types";
import { useLabels } from "./useCalendar";
import { useRecurrenceMutations } from "./useRecurrence";
import { useTaskMutations, type NewTaskInput } from "./useTasks";
import type { SeriesTemplate } from "./useRecurrence";
import type { RecurrenceRule } from "../lib/recurrence";
import { useOptionalVertical } from "./useVertical";
import { isOpenStatus } from "../lib/vertical";
import { useSettings } from "./useSettings";
import { DEFAULT_DURATION_MINUTES } from "../lib/types";

const NO_LABELS: Label[] = [];

export interface CaptureEnvWithColor extends CaptureEnv {
  /** A home's identity colour (its domain's), for suggestion swatches and chips. */
  colorOf: (t: RouteTarget) => string | null;
}

/** The vertical and labels a capture resolves against. Empty outside the shell. */
export function useCaptureEnv(): CaptureEnvWithColor {
  const vertical = useOptionalVertical();
  const { labels } = useLabels();
  const { settings } = useSettings();
  const defaultDurationMins = settings?.default_task_duration_minutes ?? DEFAULT_DURATION_MINUTES;
  const data = vertical?.data;
  return useMemo<CaptureEnvWithColor>(() => {
    const projects = data?.projects ?? [];
    const initiatives = data?.initiatives ?? [];
    // Only open homes are offered — filing into something already shipped
    // is a mistake the suggestion list shouldn't make easy.
    const openProjects = projects.filter((p) => isOpenStatus(p.status));
    const openInitiatives = initiatives.filter((i) => isOpenStatus(i.status));
    const domains = data?.domains ?? [];
    const routeTargets: RouteTarget[] = [
      ...openProjects.map((p) => ({ id: p.id, kind: "project" as const, name: p.name })),
      ...openInitiatives.map((i) => ({ id: i.id, kind: "initiative" as const, name: i.name })),
      ...domains.map((d) => ({ id: d.id, kind: "domain" as const, name: d.name })),
    ];
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const initiativeById = new Map(initiatives.map((i) => [i.id, i]));
    const domainById = new Map(domains.map((d) => [d.id, d]));
    return {
      labels: labels ?? NO_LABELS,
      routeTargets,
      homeOfProject: (id) => {
        const p = projectById.get(id);
        return p ? { initiativeId: p.initiativeId, domainId: p.domainId } : null;
      },
      homeOfInitiative: (id) => {
        const i = initiativeById.get(id);
        return i ? { domainId: i.domainId } : null;
      },
      colorOf: (t) => {
        const domainId =
          t.kind === "domain" ? t.id : t.kind === "project" ? projectById.get(t.id)?.domainId : initiativeById.get(t.id)?.domainId;
        return (domainId && domainById.get(domainId)?.color) || null;
      },
      todayISO: todayISO(),
      defaultDurationMins,
    };
  }, [data?.projects, data?.initiatives, data?.domains, labels, defaultDurationMins]);
}

export interface CaptureResult {
  action: CaptureAction;
  /** The created row, for a single task (not a series). */
  task?: Task;
}

/** Labels typed with `#` that don't exist yet. */
export function missingLabels(p: ParsedCapture, labels: Label[]): string[] {
  const have = new Set(labels.map((l) => l.name.toLowerCase()));
  return [...new Set(p.labels.map((n) => n.toLowerCase()))].filter((n) => !have.has(n));
}

/**
 * Where captured work goes. The app never sets this — the real mutations are
 * the default. A harness or a test provides one so the whole capture path
 * (parse → context → action) runs without writing anything.
 */
export interface TaskCaptureSink {
  create: (input: NewTaskInput) => Promise<unknown>;
  createSeries: (input: { kind: "task"; rule: RecurrenceRule; anchorISO: string; template: SeriesTemplate }) => Promise<unknown>;
  /** The capture door's Slot face (`useSlotCapture`). Optional: most harnesses only take tasks. */
  createSlot?: (input: SlotDraftInput) => Promise<unknown> | unknown;
  createSlotSeries?: (input: { kind: "slot"; rule: RecurrenceRule; anchorISO: string; template: SeriesTemplate }) => Promise<unknown>;
}
export const TaskCaptureSinkContext = createContext<TaskCaptureSink | null>(null);

export function useTaskCapture(context: CaptureContext = {}) {
  const env = useCaptureEnv();
  const { createLabel } = useLabels();
  const mutations = useTaskMutations();
  const recurrence = useRecurrenceMutations();
  const sink = useContext(TaskCaptureSinkContext);

  /** What `text` would create here, without creating it — for previews and drafts. */
  const preview = useCallback(
    (text: string, literal?: ReadonlySet<string>): CaptureAction | null => {
      const raw = text.trim();
      if (!raw) return null;
      return draftFromCapture(parseCapture(raw, new Date(), { literal }), raw, context, env);
    },
    [context, env],
  );

  /**
   * Create what `text` says. The task is in the caches before the first await
   * inside `createTask`, so callers clear their field without waiting; the
   * promise only reports a failure.
   */
  const capture = useCallback(
    async (text: string, literal?: ReadonlySet<string>): Promise<CaptureResult | null> => {
      const raw = text.trim();
      if (!raw) return null;
      const parsed = parseCapture(raw, new Date(), { literal });
      // A `#label` that doesn't exist yet is made, not silently dropped — the
      // chip already said "new".
      const made = sink ? [] : await Promise.all(missingLabels(parsed, env.labels).map((name) => createLabel({ name })));
      const action = draftFromCapture(parsed, raw, context, made.length ? { ...env, labels: [...env.labels, ...made] } : env);
      if (!action) return null;
      if (action.kind === "series") {
        await (sink?.createSeries ?? recurrence.createSeries)({
          kind: "task",
          rule: action.rule,
          anchorISO: action.anchorISO,
          template: action.template,
        });
        return { action };
      }
      if (sink) {
        await sink.create(action.input);
        return { action };
      }
      const task = await mutations.create(action.input);
      return { action, task };
    },
    [context, env, createLabel, recurrence, mutations, sink],
  );

  return { capture, preview, env };
}
