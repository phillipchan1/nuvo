// The vertical store, live. Fetches domains/initiatives/projects/key-results
// and ALL non-trashed tasks from Supabase, builds the floors' VerticalData
// snapshot with buildVertical(), and exposes the same action surface the
// localStorage prototype had — now writing real rows. One task world: the
// floors edit the same rows the calendar blocks.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeQuiet, supabase } from "../lib/supabase";
import { planningWeekStartISO } from "../lib/dates";
import { restingStatus, type Sprint, type Task } from "../lib/types";
import {
  buildVertical,
  type Domain,
  type DomainRow,
  type Initiative,
  type InitiativeRow,
  type KeyResult,
  type Project,
  type ProjectRow,
  type VerticalData,
  type VTask,
} from "../lib/vertical";

export interface TaskParent {
  projectId?: string | null;
  initiativeId?: string | null;
  domainId?: string | null;
}

export interface VerticalStore {
  data: VerticalData;
  ready: boolean;

  // domains
  addDomain: () => Promise<Domain>;
  updateDomain: (id: string, patch: Partial<Domain>) => void;
  deleteDomain: (id: string) => void;

  // initiatives
  addInitiative: (domainId: string) => Promise<Initiative>;
  updateInitiative: (id: string, patch: Partial<Initiative>) => void;
  deleteInitiative: (id: string) => void;

  // key results
  addKeyResult: (initiativeId: string) => void;
  updateKeyResult: (initiativeId: string, krId: string, patch: Partial<KeyResult>) => void;
  deleteKeyResult: (initiativeId: string, krId: string) => void;

  // projects
  addProject: (domainId: string, initiativeId: string | null) => Promise<Project>;
  updateProject: (id: string, patch: Partial<Project>) => void;
  deleteProject: (id: string) => void;

  // tasks — created under a project/initiative/domain they land in `backlog`,
  // quiet by design: never in the inbox, never on Today, never roll.
  addTask: (parent: TaskParent, patch?: { title?: string }) => void;
  /** Bulk insert (AI scaffold accept): ordered drafts land in `backlog`. */
  addTasks: (
    parent: TaskParent,
    drafts: { title: string; energy: VTask["energy"]; durationMins: number }[],
  ) => Promise<void>;
  updateTask: (id: string, patch: Partial<VTask>) => void;
  deleteTask: (id: string) => void;
  toggleTask: (id: string) => void;
  /** The Sweep: file a capture into the vertical (and optionally the week).
   *  Routing processes it — status becomes `backlog`, it leaves the inbox. */
  routeTask: (
    id: string,
    dest: { projectId?: string | null; initiativeId?: string | null; domainId?: string | null; toWeek?: boolean },
  ) => void;
  /** The Anchor: place a task on a day (no time block yet). */
  planTaskFor: (id: string, dateISO: string) => void;
  /** Drop the date (and block), keep everything else — back to the pool. */
  unplanTask: (id: string) => void;

  // sprint funnel — the Week gate
  toggleTaskSprint: (id: string) => void;
  /** Bulk commit (suggested pull "add all"): one write, not N. */
  commitTasksToSprint: (ids: string[]) => void;
  addProjectReadyToSprint: (projectId: string) => void;
  clearSprint: () => void;
  setSprintGoal: (goal: string) => void;
  setFocusInitiatives: (ids: string[]) => void;
  markSprintReviewed: () => void;
}

const Ctx = createContext<VerticalStore | null>(null);

/** Fields whose change requires re-syncing the Google mirror event. */
const MIRROR_FIELDS: (keyof Task)[] = ["start_time", "duration_minutes", "title", "status", "do_date"];

async function userId(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) throw new Error("Not signed in");
  return session.user.id;
}

export function VerticalProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const weekStart = planningWeekStartISO();

  const domainsQ = useQuery({
    queryKey: ["vertical", "domains"],
    queryFn: async (): Promise<DomainRow[]> => {
      const { data, error } = await supabase.from("domains").select("*").order("sort_order");
      if (error) throw error;
      return data as DomainRow[];
    },
  });

  const initiativesQ = useQuery({
    queryKey: ["vertical", "initiatives"],
    queryFn: async (): Promise<InitiativeRow[]> => {
      const { data, error } = await supabase
        .from("initiatives")
        .select("*, key_results(*)")
        .order("sort_order");
      if (error) throw error;
      return data as InitiativeRow[];
    },
  });

  const projectsQ = useQuery({
    queryKey: ["vertical", "projects"],
    queryFn: async (): Promise<ProjectRow[]> => {
      const { data, error } = await supabase.from("projects").select("*").order("sort_order");
      if (error) throw error;
      return data as ProjectRow[];
    },
  });

  // Every non-trashed task, done included: completed blocks are the time
  // ledger the faithfulness/gain numbers derive from.
  const tasksQ = useQuery({
    queryKey: ["tasks", "all"],
    queryFn: async (): Promise<Task[]> => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .neq("status", "trashed")
        .order("sort_order")
        .order("created_at");
      if (error) throw error;
      return data as Task[];
    },
  });

  const sprintQ = useQuery({
    queryKey: ["sprint", weekStart],
    queryFn: async (): Promise<Sprint | null> => {
      const { data, error } = await supabase
        .from("sprints")
        .select("*")
        .eq("week_start", weekStart)
        .maybeSingle();
      if (error) throw error;
      return data as Sprint | null;
    },
  });

  const ready = Boolean(domainsQ.data && initiativesQ.data && projectsQ.data && tasksQ.data);

  const data = useMemo<VerticalData>(
    () =>
      buildVertical(
        domainsQ.data ?? [],
        initiativesQ.data ?? [],
        projectsQ.data ?? [],
        tasksQ.data ?? [],
        sprintQ.data ?? null,
      ),
    [domainsQ.data, initiativesQ.data, projectsQ.data, tasksQ.data, sprintQ.data],
  );

  const store = useMemo<VerticalStore>(() => {
    const invalidate = (...keys: string[][]) =>
      keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));

    /** Optimistically patch a row cache, then persist + reconcile. */
    const patchRows = <R extends { id: string }>(key: string[], id: string, rowPatch: Partial<R>) =>
      qc.setQueryData<R[]>(key, (old) => old?.map((r) => (r.id === id ? { ...r, ...rowPatch } : r)));

    const writeTable = async (table: string, id: string, rowPatch: Record<string, unknown>) => {
      const { error } = await supabase.from(table).update(rowPatch).eq("id", id);
      if (error) console.error(`[vertical] update ${table} failed`, error);
    };

    /** The current sprint row, created on first use. Creating/entering a new
     *  week releases unfinished commitments from PAST sprints back to their
     *  pools (the gate re-decides — nothing strands on a stale sprint_id). */
    const ensureSprint = async (): Promise<Sprint> => {
      const cached = qc.getQueryData<Sprint | null>(["sprint", weekStart]);
      if (cached) return cached;
      const uid = await userId();
      const { data: row, error } = await supabase
        .from("sprints")
        .upsert({ user_id: uid, week_start: weekStart }, { onConflict: "user_id,week_start" })
        .select("*")
        .single();
      if (error) throw error;
      qc.setQueryData(["sprint", weekStart], row);

      // parentless week-only captures go back to the inbox (never limbo)…
      await supabase
        .from("tasks")
        .update({ status: "inbox", sprint_id: null })
        .eq("status", "backlog")
        .is("project_id", null)
        .is("initiative_id", null)
        .is("domain_id", null)
        .is("do_date", null)
        .not("sprint_id", "is", null)
        .neq("sprint_id", row.id);
      // …and everything else unfinished is released to its backlog
      await supabase
        .from("tasks")
        .update({ sprint_id: null })
        .not("sprint_id", "is", null)
        .neq("sprint_id", row.id)
        .not("status", "in", '("done","trashed")');
      invalidate(["tasks"]);

      return row as Sprint;
    };

    const patchSprint = async (rowPatch: Partial<Sprint>) => {
      const sprint = await ensureSprint();
      qc.setQueryData<Sprint | null>(["sprint", weekStart], (old) =>
        old ? { ...old, ...rowPatch } : old,
      );
      await writeTable("sprints", sprint.id, rowPatch);
      invalidate(["sprint"]);
    };

    const patchTaskRow = async (id: string, rowPatch: Partial<Task>) => {
      patchRows<Task>(["tasks", "all"], id, rowPatch);
      await writeTable("tasks", id, rowPatch);
      // keep the Google "Nuvo" mirror in sync, same contract as useTasks
      if (MIRROR_FIELDS.some((f) => f in rowPatch)) invokeQuiet("task-mirror", { taskId: id });
      invalidate(["tasks"]);
    };

    return {
      data,
      ready,

      // ── domains ──────────────────────────────────────────────────────────
      addDomain: async () => {
        const uid = await userId();
        const sort = (domainsQ.data?.length ?? 0) + 1;
        const { data: row, error } = await supabase
          .from("domains")
          .insert({ user_id: uid, name: "New domain", icon: "◇", sort_order: sort })
          .select("*")
          .single();
        if (error) throw error;
        invalidate(["vertical"]);
        return {
          id: row.id, name: row.name, color: row.color, icon: row.icon,
          intention: row.intention, weeklyTargetHours: row.weekly_target_hours ?? 0,
          investedThisWeek: 0, quarterHours: 0, lastTouchedDays: 99, sort,
        };
      },
      updateDomain: (id, patch) => {
        const rowPatch: Record<string, unknown> = {};
        if (patch.name != null) rowPatch.name = patch.name;
        if (patch.color != null) rowPatch.color = patch.color;
        if (patch.icon != null) rowPatch.icon = patch.icon;
        if (patch.intention != null) rowPatch.intention = patch.intention;
        if (patch.weeklyTargetHours != null) rowPatch.weekly_target_hours = patch.weeklyTargetHours;
        if (patch.sort != null) rowPatch.sort_order = patch.sort;
        if (!Object.keys(rowPatch).length) return;
        patchRows<DomainRow>(["vertical", "domains"], id, rowPatch);
        void writeTable("domains", id, rowPatch).then(() => invalidate(["vertical"]));
      },
      deleteDomain: (id) => {
        void supabase.from("domains").delete().eq("id", id)
          .then(() => invalidate(["vertical"], ["tasks"]));
      },

      // ── initiatives ──────────────────────────────────────────────────────
      addInitiative: async (domainId) => {
        const uid = await userId();
        const { data: row, error } = await supabase
          .from("initiatives")
          .insert({ user_id: uid, domain_id: domainId, name: "New initiative" })
          .select("*")
          .single();
        if (error) throw error;
        invalidate(["vertical"]);
        return {
          id: row.id, domainId, name: row.name, outcome: "", description: "",
          startDate: null, targetDate: null, status: "active", progress: 0,
          momentum: "flat", keyResults: [],
        };
      },
      updateInitiative: (id, patch) => {
        const rowPatch: Record<string, unknown> = {};
        if (patch.name != null) rowPatch.name = patch.name;
        if (patch.outcome != null) rowPatch.outcome = patch.outcome;
        if (patch.description != null) rowPatch.description = patch.description;
        if ("startDate" in patch) rowPatch.start_date = patch.startDate;
        if ("targetDate" in patch) rowPatch.target_date = patch.targetDate;
        if (patch.status != null) rowPatch.status = patch.status;
        if (patch.momentum != null) rowPatch.momentum = patch.momentum;
        if (patch.progress != null) rowPatch.progress = patch.progress;
        if (patch.domainId != null) rowPatch.domain_id = patch.domainId;
        if (!Object.keys(rowPatch).length) return;
        patchRows<InitiativeRow>(["vertical", "initiatives"], id, rowPatch);
        void writeTable("initiatives", id, rowPatch).then(() => invalidate(["vertical"]));
      },
      deleteInitiative: (id) => {
        void supabase.from("initiatives").delete().eq("id", id)
          .then(() => invalidate(["vertical"], ["tasks"]));
      },

      // ── key results ──────────────────────────────────────────────────────
      addKeyResult: (initiativeId) => {
        void userId().then(async (uid) => {
          await supabase.from("key_results").insert({
            user_id: uid, initiative_id: initiativeId, name: "New result",
            sort_order: (data.initiatives.find((i) => i.id === initiativeId)?.keyResults.length ?? 0) + 1,
          });
          invalidate(["vertical"]);
        });
      },
      updateKeyResult: (_initiativeId, krId, patch) => {
        const rowPatch: Record<string, unknown> = {};
        if (patch.name != null) rowPatch.name = patch.name;
        if (patch.baseline != null) rowPatch.baseline_value = patch.baseline;
        if (patch.current != null) rowPatch.current_value = patch.current;
        if (patch.target != null) rowPatch.target_value = patch.target;
        if (patch.unit != null) rowPatch.unit = patch.unit;
        if (!Object.keys(rowPatch).length) return;
        void writeTable("key_results", krId, rowPatch).then(() => invalidate(["vertical"]));
      },
      deleteKeyResult: (_initiativeId, krId) => {
        void supabase.from("key_results").delete().eq("id", krId)
          .then(() => invalidate(["vertical"]));
      },

      // ── projects ─────────────────────────────────────────────────────────
      addProject: async (domainId, initiativeId) => {
        const uid = await userId();
        const { data: row, error } = await supabase
          .from("projects")
          .insert({
            user_id: uid, domain_id: domainId, initiative_id: initiativeId,
            name: "New project", status: "planned",
          })
          .select("*")
          .single();
        if (error) throw error;
        invalidate(["vertical"]);
        return {
          id: row.id, initiativeId, domainId, name: row.name, outcome: "",
          description: "", startDate: null, targetDate: null, status: "planned", progress: 0,
        };
      },
      updateProject: (id, patch) => {
        const rowPatch: Record<string, unknown> = {};
        if (patch.name != null) rowPatch.name = patch.name;
        if (patch.outcome != null) rowPatch.outcome = patch.outcome;
        if (patch.description != null) rowPatch.description = patch.description;
        if ("startDate" in patch) rowPatch.start_date = patch.startDate;
        if ("targetDate" in patch) rowPatch.target_date = patch.targetDate;
        if (patch.status != null) rowPatch.status = patch.status;
        if (patch.progress != null) rowPatch.progress = patch.progress;
        if ("initiativeId" in patch) rowPatch.initiative_id = patch.initiativeId;
        if (patch.domainId != null) rowPatch.domain_id = patch.domainId;
        if (!Object.keys(rowPatch).length) return;
        patchRows<ProjectRow>(["vertical", "projects"], id, rowPatch);
        void writeTable("projects", id, rowPatch).then(() => invalidate(["vertical"]));
      },
      deleteProject: (id) => {
        void supabase.from("projects").delete().eq("id", id)
          .then(() => invalidate(["vertical"], ["tasks"]));
      },

      // ── tasks ────────────────────────────────────────────────────────────
      addTask: (parent, patch) => {
        void userId().then(async (uid) => {
          const parented = Boolean(parent.projectId || parent.initiativeId || parent.domainId);
          await supabase.from("tasks").insert({
            user_id: uid,
            title: patch?.title ?? "",
            status: parented ? "backlog" : "inbox",
            project_id: parent.projectId ?? null,
            initiative_id: parent.initiativeId ?? null,
            domain_id: parent.domainId ?? null,
            energy: "quick",
            duration_minutes: 20,
          });
          invalidate(["tasks"]);
        });
      },
      addTasks: async (parent, drafts) => {
        if (!drafts.length) return;
        const uid = await userId();
        const baseSort = Date.now(); // keep the proposed a→b→c order
        const { error } = await supabase.from("tasks").insert(
          drafts.map((d, i) => ({
            user_id: uid,
            title: d.title,
            status: "backlog",
            project_id: parent.projectId ?? null,
            initiative_id: parent.initiativeId ?? null,
            domain_id: parent.domainId ?? null,
            energy: d.energy,
            duration_minutes: d.durationMins,
            sort_order: baseSort + i,
          })),
        );
        if (error) throw error;
        invalidate(["tasks"]);
      },
      updateTask: (id, patch) => {
        const rowPatch: Partial<Task> = {};
        if (patch.title != null) rowPatch.title = patch.title;
        if ("energy" in patch) rowPatch.energy = patch.energy ?? null;
        if (patch.durationMins != null) rowPatch.duration_minutes = patch.durationMins;
        if (!Object.keys(rowPatch).length) return;
        void patchTaskRow(id, rowPatch);
      },
      deleteTask: (id) => {
        void patchTaskRow(id, { status: "trashed" });
      },
      toggleTask: (id) => {
        const row = (tasksQ.data ?? []).find((x) => x.id === id);
        if (!row) return;
        if (row.status === "done") {
          void patchTaskRow(id, { status: restingStatus(row), completed_at: null });
        } else {
          void patchTaskRow(id, { status: "done", completed_at: new Date().toISOString() });
        }
      },

      routeTask: (id, dest) => {
        const patch: Partial<Task> = { status: "backlog" };
        if ("projectId" in dest) {
          patch.project_id = dest.projectId ?? null;
          const p = dest.projectId ? data.projects.find((x) => x.id === dest.projectId) : null;
          patch.initiative_id = p?.initiativeId ?? null;
          patch.domain_id = p?.domainId ?? null;
        }
        if ("initiativeId" in dest) {
          patch.initiative_id = dest.initiativeId ?? null;
          const i = dest.initiativeId ? data.initiatives.find((x) => x.id === dest.initiativeId) : null;
          if (i) patch.domain_id = i.domainId;
        }
        if ("domainId" in dest) patch.domain_id = dest.domainId ?? null;
        if (dest.toWeek) {
          void ensureSprint().then((sprint) => void patchTaskRow(id, { ...patch, sprint_id: sprint.id }));
        } else {
          void patchTaskRow(id, patch);
        }
      },
      planTaskFor: (id, dateISO) => {
        // placing on a day clears any existing time block (same contract as
        // useTasks.planFor) — the block is re-dragged on the calendar
        void patchTaskRow(id, { status: "planned", do_date: dateISO, start_time: null });
      },
      unplanTask: (id) => {
        void patchTaskRow(id, { status: "backlog", do_date: null, start_time: null });
      },

      // ── sprint funnel — the Week gate ───────────────────────────────────
      toggleTaskSprint: (id) => {
        const row = (tasksQ.data ?? []).find((x) => x.id === id);
        if (!row) return;
        if (row.sprint_id && row.sprint_id === data.sprint?.id) {
          // releasing from the week: a parentless week-only capture goes
          // back to the inbox rather than into invisible limbo
          void patchTaskRow(id, {
            sprint_id: null,
            status: row.status === "backlog" ? restingStatus({ ...row, sprint_id: null }) : row.status,
          });
        } else {
          void ensureSprint().then((sprint) => {
            // committing an inbox capture to the week processes it
            const patch: Partial<Task> = { sprint_id: sprint.id };
            if (row.status === "inbox") patch.status = "backlog";
            void patchTaskRow(id, patch);
          });
        }
      },
      commitTasksToSprint: (ids) => {
        if (!ids.length) return;
        void ensureSprint().then(async (sprint) => {
          await supabase.from("tasks").update({ sprint_id: sprint.id }).in("id", ids);
          await supabase.from("tasks").update({ status: "backlog" }).in("id", ids).eq("status", "inbox");
          invalidate(["tasks"]);
        });
      },
      addProjectReadyToSprint: (projectId) => {
        void ensureSprint().then(async (sprint) => {
          await supabase
            .from("tasks")
            .update({ sprint_id: sprint.id })
            .eq("project_id", projectId)
            .not("status", "in", '("done","trashed")');
          invalidate(["tasks"]);
        });
      },
      clearSprint: () => {
        const sprint = data.sprint;
        if (!sprint) return;
        void (async () => {
          // parentless week-only captures resurface in the inbox
          await supabase
            .from("tasks")
            .update({ status: "inbox", sprint_id: null })
            .eq("sprint_id", sprint.id)
            .eq("status", "backlog")
            .is("project_id", null)
            .is("initiative_id", null)
            .is("domain_id", null)
            .is("do_date", null);
          await supabase.from("tasks").update({ sprint_id: null }).eq("sprint_id", sprint.id);
          invalidate(["tasks"]);
        })();
      },
      setSprintGoal: (goal) => void patchSprint({ goal }),
      setFocusInitiatives: (ids) => void patchSprint({ focus_initiative_ids: ids }),
      markSprintReviewed: () => void patchSprint({ reviewed_at: new Date().toISOString() }),
    };
  }, [data, ready, qc, weekStart, domainsQ.data, tasksQ.data]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useVertical(): VerticalStore {
  const v = useContext(Ctx);
  if (!v) throw new Error("useVertical must be used within <VerticalProvider>");
  return v;
}
