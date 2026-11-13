// Get ready (D-206) — the live half of `lib/readyCards`. Reads the models the
// rest of the app already reads and hands their output to the pure composer;
// it re-derives nothing:
//
//   broken blocks      useRepairs' state (owned by the Planner — one instance)
//   no time, today     useTodayHolds (Find time, scoped to today; it falls back
//                      to the next opening this week when today is full)
//   the slate's loose  useWeekCrown rows' `loose`, placed by the SAME
//                      useTodayHolds call — one compose, so two cards never
//                      claim the same half hour
//   inbox guesses      the router's guess on the row (`fileGuess`), never a call
//   thin paths         useThinPaths (D-196)
//   one Memory read    useMemory's sure questions, ranked as Plan the week does
//
// Each act goes through the path the act already takes: the hold is the
// calendar's own `block` (with the Week gate's commit for slate work, as the
// crown's drag does), filing is the guess's own `acceptPatch` (FileOffer),
// Draft the path is `requestPathDraft` + open the record, Keep is Memory's own
// keep, Not now is the chips' two-week snooze. So both shells, and the chips at
// rest, agree about where everything goes.

import { useMemo, useRef } from "react";
import { useWeekCrown } from "../../hooks/useWeekCrown";
import { useDayTasks, useInboxTasks, type useTaskMutations } from "../../hooks/useTasks";
import { useTodayHolds } from "../../hooks/useFindTime";
import { useThinPaths } from "../../hooks/useThinPaths";
import { useVertical } from "../../hooks/useVertical";
import { todayISO } from "../../lib/dates";
import { projectById } from "../../lib/vertical";
import { thinChip } from "../../lib/thinPath";
import { requestPathDraft } from "../../lib/draftIntent";
import { reachToCrown, WEEK_REACH_KEY } from "../../lib/motion";
import { composeReadyCards, whenLabel, type ReadyCard, type ReadyInput } from "../../lib/readyCards";
import { fileGuess, filePatch, holdable } from "../nuvo/RailOffers";
import { notNow, useSnoozed } from "../nuvo/offerSnooze";
import { fitOf, type RepairState } from "./repairActs";
import { instantAt } from "./destinations";
import type { MemoryApi } from "../memory/MemoryPage";
import type { Task } from "../../lib/types";

type Mutations = ReturnType<typeof useTaskMutations>;

const RANK = { hours: 0, window: 1, habit: 2, repeat: 3 } as const;

/** The Reach from a card: to the project's crown row, or — an act with no
 *  project — to the week's track (`WEEK_REACH_KEY`, `[data-crown-week]`). */
export function reachFromCard(from: HTMLElement | null, projectId: string | null) {
  if (!from) return;
  void reachToCrown(from, projectId ?? WEEK_REACH_KEY);
}

export function useReadyCards({
  now,
  mutations,
  repairState,
  learned,
  onPlanWeek,
  onRepair,
  onOpenProject,
}: {
  now: Date;
  mutations: Mutations;
  /** the Planner's one repair state — omitted on the phone, whose repair card
   *  owns its own (two instances would both Handle the same break) */
  repairState?: RepairState | null;
  learned?: MemoryApi | null;
  onPlanWeek: () => void;
  onRepair?: () => void;
  onOpenProject: (projectId: string) => void;
}): ReadyCard[] {
  const today = todayISO(now);
  const crown = useWeekCrown();
  const { data: vertical, commitTasksToSprint } = useVertical();
  const { data: dayTasks = [] } = useDayTasks(today);
  const { data: inbox = [] } = useInboxTasks();
  const thin = useThinPaths();
  const snoozed = useSnoozed();

  const holdPool = useMemo(() => holdable(dayTasks, today), [dayTasks, today]);
  const loosePool = useMemo(() => {
    const seen = new Set(holdPool.map((t) => t.id));
    const out: { task: Task; projectId: string; projectName: string }[] = [];
    for (const r of crown?.rows ?? []) {
      if (r.state === "shipped" || r.state === "landed") continue;
      for (const t of r.loose) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        out.push({ task: t, projectId: r.projectId, projectName: r.title });
      }
    }
    return out;
  }, [crown, holdPool]);
  // One compose for both: today's work first (it is today's), then the slate's.
  const pool = useMemo(() => [...holdPool, ...loosePool.map((l) => l.task)], [holdPool, loosePool]);
  const holds = useTodayHolds(pool, now);

  // The acts read the latest of everything through a ref, so the cards'
  // identity only changes when what they SAY changes.
  const live = useRef({ holds, pool, inbox, repairState, learned, mutations, vertical, onPlanWeek, onRepair, onOpenProject, commitTasksToSprint });
  live.current = { holds, pool, inbox, repairState, learned, mutations, vertical, onPlanWeek, onRepair, onOpenProject, commitTasksToSprint };

  const memoryItem = useMemo(() => {
    if (!learned?.available) return null;
    return (
      learned.questions
        .filter((i) => i.observation && i.described.confidence === "sure")
        .sort((a, b) => RANK[a.observation!.kind] - RANK[b.observation!.kind])[0] ?? null
    );
  }, [learned]);

  return useMemo(() => {
    const L = () => live.current;
    const placeTask = (taskId: string, from: HTMLElement | null, slate: boolean) => {
      const { holds: hs, pool: ps, mutations: m } = L();
      const t = ps.find((x) => x.id === taskId);
      const p = hs.get(taskId);
      if (!t || !p) return;
      reachFromCard(from, t.project_id);
      // The Week gate (P2): slate work joins the week in the same gesture that
      // gives it a time — what the crown's drag onto the grid does.
      if (slate) L().commitTasksToSprint([t.id]);
      const when = whenLabel(p, today);
      m.block(t, instantAt(p.dayISO, p.startMin), p.durationMin, { undo: "toast", label: `Held ${when} — ${t.title}` });
    };

    const input: ReadyInput = {
      todayISO: today,
      weekISO: crown?.weekISO,
      snoozed,
      now: now.getTime(),
      repairs: (repairState?.open ?? []).map((r) => {
        const fit = fitOf(r, repairState?.ix ?? {});
        return {
          key: r.key,
          title: r.title,
          why: r.why === "missed" ? ("missed" as const) : ("meeting" as const),
          event: r.event ?? null,
          from: r.from,
          to: { dayISO: fit.dayISO, startMin: fit.startMin, durationMin: fit.durationMin },
          projectId: r.task?.project_id ?? r.slot?.project_id ?? null,
        };
      }),
      holds: holdPool.flatMap((t) => {
        const p = holds.get(t.id);
        return p ? [{ taskId: t.id, title: t.title, projectId: t.project_id, at: p }] : [];
      }),
      loose: loosePool.map((l) => ({
        taskId: l.task.id,
        title: l.task.title,
        projectId: l.projectId,
        projectName: l.projectName,
        at: holds.get(l.task.id) ?? null,
      })),
      inbox: inbox.flatMap((t) => {
        const g = fileGuess(t);
        return g ? [{ taskId: t.id, title: t.title, place: g.name, projectId: g.level === "project" ? g.targetId : null }] : [];
      }),
      thin: [...thin.values()].map((t) => ({ projectId: t.projectId, name: t.name, evidence: thinChip(t) })),
      memory: memoryItem
        ? { key: memoryItem.key, statement: memoryItem.described.statement, evidence: memoryItem.described.evidence, consequence: memoryItem.described.keep }
        : null,
      acts: {
        move: (key, from) => {
          const rs = L().repairState;
          const r = rs?.open.find((x) => x.key === key);
          if (!rs || !r) return;
          reachFromCard(from, r.task?.project_id ?? r.slot?.project_id ?? null);
          rs.take(r);
        },
        leave: (key) => {
          const rs = L().repairState;
          const r = rs?.open.find((x) => x.key === key);
          if (rs && r) rs.leave(r);
        },
        repairAll: () => L().onRepair?.(),
        hold: (id, from) => placeTask(id, from, false),
        holdLoose: (id, from) => placeTask(id, from, true),
        planWeek: () => L().onPlanWeek(),
        file: (id, from) => {
          const { inbox: ib, mutations: m, vertical: v } = L();
          const t = ib.find((x) => x.id === id);
          const g = t ? fileGuess(t) : null;
          if (!t || !g) return;
          const home =
            g.level === "project"
              ? (() => {
                  const p = projectById(v, g.targetId);
                  return p ? { initiativeId: p.initiativeId, domainId: p.domainId } : null;
                })()
              : null;
          const patch = filePatch(t, home);
          const before: Partial<Task> = {};
          for (const k of Object.keys(patch) as (keyof Task)[]) (before as Record<string, unknown>)[k] = t[k];
          reachFromCard(from, g.level === "project" ? g.targetId : null);
          m.patchTask(t.id, patch, { before, undo: "toast", kind: "fileToProject", title: t.title, label: `Filed in ${g.name} — ${t.title}` });
        },
        draftPath: (pid) => {
          requestPathDraft(pid);
          L().onOpenProject(pid);
        },
        keep: (key) => {
          const mem = L().learned;
          const item = mem?.questions.find((i) => i.key === key);
          if (mem && item) void mem.keep(item);
        },
        notNow: (key) => notNow(key),
      },
    };
    return composeReadyCards(input);
    // `now` is read for the snooze clock only; the cards change when the facts do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, crown, snoozed, repairState?.open, repairState?.ix, holdPool, loosePool, holds, inbox, thin, memoryItem]);
}
