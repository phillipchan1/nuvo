// The vertical store, live. Fetches domains/initiatives/projects/key-results
// and ALL non-trashed tasks from Supabase, builds the floors' VerticalData
// snapshot with buildVertical(), and exposes the same action surface the
// localStorage prototype had — now writing real rows. One task world: the
// floors edit the same rows the calendar blocks.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { invokeQuiet, supabase } from "../lib/supabase";
import { useExternalEvents } from "./useCalendar";
import { useSettings } from "./useSettings";
import { useEventRouting } from "./useEventRouting";
import { planningWeekStartISO } from "../lib/dates";
import {
  DEFAULT_DURATION_MINUTES,
  DEFAULT_PROJECT_DURATION_MINUTES,
  restingStatus,
  type BigRock,
  type Sprint,
  type Task,
  type TaskStatus,
} from "../lib/types";
import {
  buildVertical,
  normalizeInitiativeStatus,
  type Domain,
  type DomainRow,
  type Initiative,
  type InitiativeRow,
  type KeyResult,
  type Project,
  type ProjectRow,
  type SoundnessVerdict,
  type VerticalData,
  type VTask,
} from "../lib/vertical";

/** Stable identity so the build memo doesn't churn while settings load. */
const EMPTY_MAP: Record<string, string> = {};

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
  /** First-run only: create several named domains in one write. */
  seedDomains: (specs: { name: string; color: string }[]) => Promise<void>;
  updateDomain: (id: string, patch: Partial<Domain>) => void;
  deleteDomain: (id: string) => void;

  // initiatives — created blank by default; pass `init` to seed the moment
  // (name/goal/dates) so the create flow lands a fully-shaped bet in one write.
  addInitiative: (domainId: string, init?: Partial<Initiative>) => Promise<Initiative>;
  updateInitiative: (id: string, patch: Partial<Initiative>) => void;
  deleteInitiative: (id: string) => void;
  deleteInitiatives: (ids: string[]) => void;

  // key results
  addKeyResult: (initiativeId: string, init?: Partial<KeyResult>) => void;
  updateKeyResult: (initiativeId: string, krId: string, patch: Partial<KeyResult>) => void;
  deleteKeyResult: (initiativeId: string, krId: string) => void;

  // projects — created blank by default; pass `init` to seed name/goal/dates
  // so the create moment lands a fully-shaped project in one write.
  addProject: (domainId: string, initiativeId: string | null, init?: Partial<Project>) => Promise<Project>;
  updateProject: (id: string, patch: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  deleteProjects: (ids: string[]) => void;

  // tasks — created under a project/initiative/domain they land in `backlog`,
  // quiet by design: never in the inbox, never on Today, never roll.
  addTask: (parent: TaskParent, patch?: { title?: string; durationMins?: number }) => void;
  /** Bulk insert (AI scaffold accept): ordered drafts land in `backlog`. */
  addTasks: (
    parent: TaskParent,
    drafts: { title: string; energy: VTask["energy"]; durationMins: number; bigRockId?: string | null }[],
  ) => Promise<void>;
  /** Like addTasks, but the drafts also land in the current week's sprint (and may carry a deadline / big rock). */
  addTasksToWeek: (
    parent: TaskParent,
    drafts: { title: string; energy: VTask["energy"]; durationMins: number; deadline?: string | null; bigRockId?: string | null }[],
  ) => Promise<void>;
  updateTask: (id: string, patch: Partial<VTask>) => void;
  /** Soft-delete (status → trashed). Returns the prior raw status so the caller
   *  can offer an exact Undo via `restoreTask`. */
  deleteTask: (id: string) => Task["status"] | undefined;
  /** Undo a delete (or any soft status change): put the row back to `status`. */
  restoreTask: (id: string, status: Task["status"]) => void;
  /** Persist an explicit task order — sort_order follows the given id sequence. */
  reorderTasks: (ids: string[]) => void;
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

  /** Send a parented task to the Inbox triage queue (status → inbox, keeping its
   *  project/initiative home), or pull it back out to its backlog. Raw and
   *  unscheduled while it sits in the inbox — released from any week commitment. */
  toggleTaskInbox: (id: string) => void;

  // sprint funnel — the Week gate
  toggleTaskSprint: (id: string) => void;
  /** Bulk commit (suggested pull "add all"): one write, not N. */
  commitTasksToSprint: (ids: string[]) => void;
  addProjectReadyToSprint: (projectId: string) => void;
  clearSprint: () => void;
  setSprintGoal: (goal: string) => void;
  setFocusInitiatives: (ids: string[]) => void;

  // big rocks — the week's named outcomes (a small, varying set), on the sprint row
  /** Add a blank rock to author by hand. */
  addBigRock: () => void;
  /** Append parsed priorities (from the agent's free-text shaping); pass `id` to
   *  control the rock's id (so its tasks can link to it). `done_at`/`roll_count`
   *  are for putting a rock BACK exactly as it was (agent undo) — a fresh rock
   *  leaves them off and starts open at zero. */
  addBigRocks: (items: { id?: string; title: string; win?: string; initiative_id?: string | null; project_id?: string | null; done_at?: string | null; roll_count?: number }[]) => void;
  updateBigRock: (id: string, patch: Partial<Omit<BigRock, "id">>) => void;
  removeBigRock: (id: string) => void;
  /** The Review's forward-fold: carry unfinished priorities into THIS week's
   *  sprint (the one Sunday opens), bumping each one's `roll_count`. Deduped by
   *  id, so re-carrying is idempotent. Returns how many were newly carried. */
  carryBigRocksForward: (rocks: BigRock[]) => number;
  /** Check a rock off as moved this week (or un-check it). */
  toggleBigRockDone: (id: string) => void;
  /** Land/unland this week's push for a project — upserts the verdict record. */
  togglePushLanded: (projectId: string) => void;
  /** Per-day compose contexts (normal/light/travel/off) for the planning week. */
  setDayContexts: (map: Record<string, string>) => void;
  markSprintReviewed: () => void;

  /** The Composer's accept: write the proposed blocks in one pass. A single
   *  task scheduled directly IS the time block (no slot wrapper); pass durationMins
   *  to size it and sprintId to pull a loose inbox capture into the committed week. */
  applySchedule: (
    placements: { id: string; doDateISO: string; startISO: string; durationMins?: number }[],
    opts?: { sprintId?: string | null },
  ) => Promise<void>;
  /** Materialize batched focus blocks: create slot rows and move their tasks inside. */
  applySlots: (
    slots: { title: string; doDateISO: string; startISO: string; durationMins: number; domainId: string | null; color: string | null; taskIds: string[] }[],
    opts?: { sprintId?: string | null },
  ) => Promise<void>;
  /** Standing-slot routing (docs/standing-slots.md): move already-committed tasks
   *  INTO pre-existing recurring slots as children — slot_id set, do_date = the
   *  slot's day, start_time cleared, status planned. The plan's "layer 0". */
  assignToStanding: (
    specs: { slotId: string; doDateISO: string; taskIds: string[] }[],
    opts?: { sprintId?: string | null },
  ) => Promise<void>;
  /** The Plan flow's one commit: commit the kept candidates to the week,
   *  schedule the placed ones, and stamp the sprint goal + reviewed — all
   *  against the current planning week's sprint, in order, one await. */
  planWeek: (input: {
    commitTaskIds: string[];
    placements: {
      id: string;
      doDateISO: string;
      startISO: string;
      durationMins?: number;
      /** When present, this placement is an extra sitting of an overdue task
       *  that was split — materialize it as its own row cloned from `id`
       *  (the source task) rather than rescheduling the source in place. */
      splitChild?: { title: string };
    }[];
    goal: string;
  }) => Promise<void>;
  /** The Blueprint's accept: create a whole initiative subtree (KRs,
   *  projects, ordered backlog tasks) and return the initiative id. */
  addInitiativeTree: (domainId: string, tree: BlueprintTree) => Promise<string>;

  /** Tending's accept for a Shaped initiative: attach KRs + sub-projects (with
   *  ordered tasks) to an EXISTING initiative — the in-place sibling of
   *  addInitiativeTree. */
  addInitiativeSubtree: (initiativeId: string, tree: InitiativeSubtree) => Promise<void>;
  /** Stamp an item as tended (the grooming-recency / snooze marker); `rest`
   *  parks it (status → waiting / "Resting") in the same write. */
  tend: (kind: "project" | "initiative", id: string, opts?: { rest?: boolean }) => Promise<void>;
  /** Cache Nuvo's soundness judgment (verification + verified_at). Judging is
   *  read-only to the plan — it does NOT stamp tended_at (that's an action). */
  saveVerdict: (kind: "project" | "initiative", id: string, verdict: SoundnessVerdict) => Promise<void>;
}

/** The attachable half of a BlueprintTree — what Tending grows under an
 *  already-existing initiative. */
export interface InitiativeSubtree {
  keyResults: BlueprintTree["keyResults"];
  projects: BlueprintTree["projects"];
}

export interface BlueprintTree {
  name: string;
  outcome: string;
  description?: string;
  targetDate?: string | null;
  keyResults: { name: string; baseline: number; target: number; unit: string }[];
  projects: {
    name: string;
    outcome: string;
    tasks: { title: string; energy: VTask["energy"]; durationMins: number }[];
  }[];
}

const Ctx = createContext<VerticalStore | null>(null);

/** Fields whose change requires re-syncing the Google mirror event. */
const MIRROR_FIELDS: (keyof Task)[] = ["start_time", "duration_minutes", "title", "status", "do_date"];

async function userId(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) throw new Error("Not signed in");
  return session.user.id;
}

/** Temp row so a create lands in the UI before the insert round-trips. */
function optimisticTask(input: {
  id: string;
  title: string;
  status: TaskStatus;
  projectId?: string | null;
  initiativeId?: string | null;
  domainId?: string | null;
  durationMins?: number | null;
  energy?: Task["energy"];
  sprintId?: string | null;
  bigRockId?: string | null;
  deadline?: string | null;
  sortOrder?: number;
}): Task {
  const now = new Date().toISOString();
  return {
    id: input.id,
    user_id: "",
    created_at: now,
    updated_at: now,
    title: input.title,
    notes: "",
    status: input.status,
    do_date: null,
    start_time: null,
    duration_minutes: input.durationMins ?? DEFAULT_DURATION_MINUTES,
    deadline: input.deadline ?? null,
    priority: "none",
    roll_count: 0,
    completed_at: null,
    project_id: input.projectId ?? null,
    initiative_id: input.initiativeId ?? null,
    domain_id: input.domainId ?? null,
    key_result_id: null,
    sprint_id: input.sprintId ?? null,
    big_rock_id: input.bigRockId ?? null,
    energy: input.energy ?? "quick",
    assignee: "me",
    prework: "",
    prework_at: null,
    suggestion: null,
    suggested_at: null,
    google_event_id: null,
    sort_order: input.sortOrder ?? Date.now(),
    slot_id: null,
    recurrence_id: null,
    recurrence_date: null,
    recurrence_overridden: false,
    task_labels: [],
  };
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

  // Attended calendar events feed the same domain ledger as completed blocks.
  // Pull the 13-week pulse window (oldest week the open domain renders → end of the
  // current week) so meeting actuals line up with the task series.
  const eventsRange = useMemo(() => {
    const ws = new Date(`${weekStart}T00:00:00`).getTime();
    return {
      start: new Date(ws - 13 * 7 * 86_400_000).toISOString(),
      end: new Date(ws + 7 * 86_400_000).toISOString(),
    };
  }, [weekStart]);
  const eventsQ = useExternalEvents(eventsRange.start, eventsRange.end);
  const { settings } = useSettings();
  const calendarDomainMap = settings?.calendar_domain_map ?? EMPTY_MAP;
  const eventRouting = useEventRouting();

  // Activity actuals (merged PRs, …) → last-touched per project, so Motion reads
  // a project as moving even with no completed tasks. Recent window is enough.
  const activityQ = useQuery({
    queryKey: ["activity_units", "motion"],
    queryFn: async (): Promise<Array<{ project_id: string | null; occurred_at: string }>> => {
      const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("activity_units")
        .select("project_id, occurred_at")
        .gte("occurred_at", since);
      if (error) throw error;
      return (data ?? []) as Array<{ project_id: string | null; occurred_at: string }>;
    },
    staleTime: 60_000,
    retry: false, // table may not exist pre-migration
    meta: { silent: true },
  });
  const lastActivityByProject = useMemo(() => {
    const map: Record<string, string> = {};
    for (const u of activityQ.data ?? []) {
      if (!u.project_id) continue;
      if (!map[u.project_id] || u.occurred_at > map[u.project_id]) map[u.project_id] = u.occurred_at;
    }
    return map;
  }, [activityQ.data]);

  const ready = Boolean(domainsQ.data && initiativesQ.data && projectsQ.data && tasksQ.data);

  const data = useMemo<VerticalData>(
    () =>
      buildVertical(
        domainsQ.data ?? [],
        initiativesQ.data ?? [],
        projectsQ.data ?? [],
        tasksQ.data ?? [],
        sprintQ.data ?? null,
        new Date(),
        eventsQ.data ?? [],
        calendarDomainMap,
        eventRouting,
        lastActivityByProject,
      ),
    [domainsQ.data, initiativesQ.data, projectsQ.data, tasksQ.data, sprintQ.data, eventsQ.data, calendarDomainMap, eventRouting, lastActivityByProject],
  );

  const store = useMemo<VerticalStore>(() => {
    const invalidate = (...keys: string[][]) =>
      keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));

    /** Optimistically patch a row cache, then persist + reconcile. */
    const patchRows = <R extends { id: string }>(key: string[], id: string, rowPatch: Partial<R>) =>
      qc.setQueryData<R[]>(key, (old) => old?.map((r) => (r.id === id ? { ...r, ...rowPatch } : r)));

    const removeRows = <R extends { id: string }>(key: string[], ids: string[]) => {
      if (!ids.length) return;
      const drop = new Set(ids);
      qc.setQueryData<R[]>(key, (old) => old?.filter((r) => !drop.has(r.id)));
    };

    const deleteProjectRows = async (ids: string[]) => {
      if (!ids.length) return;
      removeRows<ProjectRow>(["vertical", "projects"], ids);
      try {
        const uid = await userId();
        // Detach children first — clearer than relying on FK + RLS during cascade.
        for (const table of ["tasks", "slots", "recurrences"] as const) {
          const q = supabase.from(table).update({ project_id: null }).eq("user_id", uid);
          const { error } = ids.length === 1
            ? await q.eq("project_id", ids[0])
            : await q.in("project_id", ids);
          if (error) throw error;
        }
        const { error } = ids.length === 1
          ? await supabase.from("projects").delete().eq("id", ids[0]).eq("user_id", uid)
          : await supabase.from("projects").delete().in("id", ids).eq("user_id", uid);
        if (error) throw error;
        invalidate(["vertical", "projects"], ["tasks"], ["slots"], ["recurrences"]);
      } catch (err) {
        console.error("[vertical] delete project(s) failed", err);
        invalidate(["vertical", "projects"], ["tasks"], ["slots"], ["recurrences"]);
      }
    };

    const writeTable = async (table: string, id: string, rowPatch: Record<string, unknown>) => {
      const { error } = await supabase.from(table).update(rowPatch).eq("id", id);
      if (error) {
        console.error(`[vertical] update ${table} failed`, error);
        throw error;
      }
    };

    /** Persist an optimistic vertical patch; on failure, refetch so the UI
     *  doesn't stay on a lie, and surface the error. */
    const persistVertical = (table: string, id: string, rowPatch: Record<string, unknown>) => {
      void writeTable(table, id, rowPatch)
        .then(() => invalidate(["vertical"]))
        .catch((e) => {
          invalidate(["vertical"]);
          toast.error(e instanceof Error ? e.message : `Couldn't update that ${table.replace(/_/g, " ")}.`);
        });
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
          intention: row.intention, charter: row.charter ?? "", context: row.context ?? null,
          weeklyTargetHours: row.weekly_target_hours ?? 0,
          investedThisWeek: 0, meetingHoursThisWeek: 0, quarterHours: 0, lastTouchedDays: 99, weeks: new Array(13).fill(0), sort,
        };
      },
      // Signup seeds no domains (migration 42) — the first-run picker calls this
      // with what the account named for itself. One write, then a single refetch.
      seedDomains: async (specs) => {
        if (!specs.length) return;
        const uid = await userId();
        const base = domainsQ.data?.length ?? 0;
        const { error } = await supabase.from("domains").insert(
          specs.map((s, i) => ({
            user_id: uid,
            name: s.name,
            color: s.color,
            icon: "◇",
            sort_order: base + i + 1,
          })),
        );
        if (error) throw error;
        invalidate(["vertical"]);
      },
      updateDomain: (id, patch) => {
        const rowPatch: Record<string, unknown> = {};
        if (patch.name != null) rowPatch.name = patch.name;
        if (patch.color != null) rowPatch.color = patch.color;
        if (patch.icon != null) rowPatch.icon = patch.icon;
        if (patch.intention != null) rowPatch.intention = patch.intention;
        if (patch.charter != null) rowPatch.charter = patch.charter;
        if (patch.context !== undefined) {
          rowPatch.context = patch.context;
          rowPatch.context_at = new Date().toISOString();
        }
        if (patch.weeklyTargetHours != null) rowPatch.weekly_target_hours = patch.weeklyTargetHours;
        if (patch.sort != null) rowPatch.sort_order = patch.sort;
        if (!Object.keys(rowPatch).length) return;
        patchRows<DomainRow>(["vertical", "domains"], id, rowPatch);
        persistVertical("domains", id, rowPatch);
      },
      deleteDomain: (id) => {
        void supabase.from("domains").delete().eq("id", id)
          .then(() => invalidate(["vertical"], ["tasks"]));
      },

      // ── initiatives ──────────────────────────────────────────────────────
      addInitiative: async (domainId, init) => {
        const uid = await userId();
        const insert: Record<string, unknown> = {
          user_id: uid,
          domain_id: domainId,
          name: init?.name?.trim() || "New initiative",
        };
        if (init?.outcome != null) insert.outcome = init.outcome.trim();
        if (init?.description != null) insert.description = init.description.trim();
        if ("startDate" in (init ?? {})) insert.start_date = init?.startDate ?? null;
        if ("targetDate" in (init ?? {})) insert.target_date = init?.targetDate ?? null;
        if (init?.status != null) insert.status = init.status;
        const { data: row, error } = await supabase
          .from("initiatives")
          .insert(insert)
          .select("*")
          .single();
        if (error) throw error;
        invalidate(["vertical"]);
        return {
          id: row.id, domainId, name: row.name, outcome: row.outcome ?? "",
          description: row.description ?? "", startDate: row.start_date ?? null,
          targetDate: row.target_date ?? null,
          status: normalizeInitiativeStatus(row.status ?? "in_progress"), progress: row.progress ?? 0,
          momentum: (row.momentum ?? "flat") as Initiative["momentum"], keyResults: [],
          createdAt: row.created_at ?? null, tendedAt: row.tended_at ?? null,
          verification: null, verifiedAt: null, brief: null,
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
        if ("brief" in patch) rowPatch.brief = patch.brief;
        if (!Object.keys(rowPatch).length) return;
        patchRows<InitiativeRow>(["vertical", "initiatives"], id, rowPatch);
        persistVertical("initiatives", id, rowPatch);
      },
      deleteInitiative: (id) => {
        void supabase.from("initiatives").delete().eq("id", id)
          .then(() => invalidate(["vertical"], ["tasks"]));
      },
      deleteInitiatives: (ids) => {
        if (!ids.length) return;
        void (async () => {
          await supabase.from("projects").update({ initiative_id: null }).in("initiative_id", ids);
          await supabase.from("key_results").delete().in("initiative_id", ids);
          await supabase.from("initiatives").delete().in("id", ids);
          invalidate(["vertical"], ["tasks"]);
        })();
      },

      // ── key results ──────────────────────────────────────────────────────
      addKeyResult: (initiativeId, init) => {
        void userId().then(async (uid) => {
          const row: Record<string, unknown> = {
            user_id: uid, initiative_id: initiativeId,
            name: init?.name ?? "New result",
            sort_order: (data.initiatives.find((i) => i.id === initiativeId)?.keyResults.length ?? 0) + 1,
          };
          if (init?.baseline != null) row.baseline_value = init.baseline;
          if (init?.current != null) row.current_value = init.current;
          if (init?.target != null) row.target_value = init.target;
          if (init?.unit != null) row.unit = init.unit;
          await supabase.from("key_results").insert(row);
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
        persistVertical("key_results", krId, rowPatch);
      },
      deleteKeyResult: (_initiativeId, krId) => {
        void supabase.from("key_results").delete().eq("id", krId)
          .then(() => invalidate(["vertical"]));
      },

      // ── projects ─────────────────────────────────────────────────────────
      // Like addTask, creates land in the cache FIRST (Todoist-fast) so a project
      // typed into the initiative record's composer appears the instant you hit
      // Enter — the insert then reconciles the temp id with the real row. A large
      // sort_order appends the new project after the existing ones.
      addProject: async (domainId, initiativeId, init) => {
        const tempId = crypto.randomUUID();
        const name = init?.name?.trim() || "New project";
        const status = (init?.status ?? "backlog") as Project["status"];
        const sortOrder = Date.now();
        const optimistic: ProjectRow = {
          id: tempId,
          initiative_id: initiativeId,
          key_result_id: null,
          domain_id: domainId,
          name,
          outcome: init?.outcome?.trim() ?? "",
          description: init?.description?.trim() ?? "",
          start_date: init?.startDate ?? null,
          target_date: init?.targetDate ?? null,
          status,
          progress: 0,
          shipped_at: null,
          sort_order: sortOrder,
          created_at: new Date().toISOString(),
          tended_at: null,
          verification: null,
          verified_at: null,
          brief: null,
        };
        void qc.cancelQueries({ queryKey: ["vertical", "projects"] });
        qc.setQueryData<ProjectRow[]>(["vertical", "projects"], (old) =>
          old ? [...old, optimistic] : [optimistic],
        );
        const rowToProject = (row: ProjectRow): Project => ({
          id: row.id, initiativeId, keyResultId: row.key_result_id ?? null, domainId,
          name: row.name, outcome: row.outcome ?? "",
          description: row.description ?? "", startDate: row.start_date ?? null,
          targetDate: row.target_date ?? null,
          status: (row.status ?? "backlog") as Project["status"],
          storedStatus: (row.status ?? "backlog") as Project["status"],
          progress: row.progress ?? 0,
          shippedAt: row.shipped_at ?? null,
          createdAt: row.created_at ?? null, tendedAt: row.tended_at ?? null,
          verification: null, verifiedAt: null, brief: null,
        });
        try {
          const uid = await userId();
          const insert: Record<string, unknown> = {
            user_id: uid,
            domain_id: domainId,
            initiative_id: initiativeId,
            name,
            status,
            sort_order: sortOrder,
          };
          if (init?.outcome != null) insert.outcome = init.outcome.trim();
          if (init?.description != null) insert.description = init.description.trim();
          if ("startDate" in (init ?? {})) insert.start_date = init?.startDate ?? null;
          if ("targetDate" in (init ?? {})) insert.target_date = init?.targetDate ?? null;
          const { data: row, error } = await supabase
            .from("projects")
            .insert(insert)
            .select("*")
            .single();
          if (error) throw error;
          qc.setQueryData<ProjectRow[]>(["vertical", "projects"], (old) =>
            old?.map((r) => (r.id === tempId ? (row as ProjectRow) : r)),
          );
          invalidate(["vertical"]);
          return rowToProject(row as ProjectRow);
        } catch (e) {
          qc.setQueryData<ProjectRow[]>(["vertical", "projects"], (old) =>
            old?.filter((r) => r.id !== tempId),
          );
          console.error("[vertical] addProject failed", e);
          toast.error(e instanceof Error ? e.message : "Couldn't add that project.");
          throw e;
        }
      },
      updateProject: (id, patch) => {
        const rowPatch: Record<string, unknown> = {};
        if (patch.name != null) rowPatch.name = patch.name;
        if (patch.outcome != null) rowPatch.outcome = patch.outcome;
        if (patch.description != null) rowPatch.description = patch.description;
        if ("startDate" in patch) rowPatch.start_date = patch.startDate;
        if ("targetDate" in patch) rowPatch.target_date = patch.targetDate;
        // Shipping stamps the DAY it happened, here at the one choke point every
        // surface goes through — the record, the deck, the groom wall, the
        // context menu — so the ship date can never depend on which button you
        // used. Un-shipping clears it: the week's scoreboard reads this to keep
        // a project you shipped mid-week on its week instead of erasing it.
        if (patch.status != null) {
          rowPatch.status = patch.status;
          if ("shippedAt" in patch) rowPatch.shipped_at = patch.shippedAt;
          else rowPatch.shipped_at = patch.status === "complete" ? new Date().toISOString() : null;
        } else if ("shippedAt" in patch) rowPatch.shipped_at = patch.shippedAt;
        if (patch.progress != null) rowPatch.progress = patch.progress;
        if ("initiativeId" in patch) rowPatch.initiative_id = patch.initiativeId;
        if ("keyResultId" in patch) rowPatch.key_result_id = patch.keyResultId;
        if (patch.domainId != null) rowPatch.domain_id = patch.domainId;
        if ("brief" in patch) rowPatch.brief = patch.brief;
        if (!Object.keys(rowPatch).length) return;
        void qc.cancelQueries({ queryKey: ["vertical", "projects"] });
        patchRows<ProjectRow>(["vertical", "projects"], id, rowPatch);
        persistVertical("projects", id, rowPatch);
      },
      deleteProject: (id) => {
        void deleteProjectRows([id]);
      },
      deleteProjects: (ids) => {
        void deleteProjectRows(ids);
      },

      // ── tasks ────────────────────────────────────────────────────────────
      // Creates land in the cache FIRST (Todoist-fast), then the insert
      // reconciles the temp id with the real row. Without the optimistic write
      // the list only updates after insert + a full ["tasks"] refetch — which
      // can sit blank for tens of seconds on a slow/hung round-trip.
      addTask: (parent, patch) => {
        const tempId = crypto.randomUUID();
        const parented = Boolean(parent.projectId || parent.initiativeId || parent.domainId);
        const status: TaskStatus = parented ? "backlog" : "inbox";
        const title = patch?.title ?? "";
        const durationMins =
          patch?.durationMins ??
          (parented ? DEFAULT_PROJECT_DURATION_MINUTES : DEFAULT_DURATION_MINUTES);
        const optimistic = optimisticTask({
          id: tempId,
          title,
          status,
          projectId: parent.projectId,
          initiativeId: parent.initiativeId,
          domainId: parent.domainId,
          durationMins,
        });
        void qc.cancelQueries({ queryKey: ["tasks"] });
        qc.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) =>
          old ? [...old, optimistic] : [optimistic],
        );
        void (async () => {
          try {
            const uid = await userId();
            const { data: row, error } = await supabase
              .from("tasks")
              .insert({
                user_id: uid,
                title,
                status,
                project_id: parent.projectId ?? null,
                initiative_id: parent.initiativeId ?? null,
                domain_id: parent.domainId ?? null,
                energy: "quick",
                duration_minutes: durationMins,
              })
              .select("*")
              .single();
            if (error) throw error;
            qc.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) =>
              old?.map((t) => (t.id === tempId ? (row as Task) : t)),
            );
            invalidate(["tasks"]);
          } catch (e) {
            qc.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) =>
              old?.filter((t) => t.id !== tempId),
            );
            console.error("[vertical] addTask failed", e);
            toast.error(e instanceof Error ? e.message : "Couldn't add that task.");
          }
        })();
      },
      addTasks: async (parent, drafts) => {
        if (!drafts.length) return;
        const baseSort = Date.now();
        const temps = drafts.map((d, i) =>
          optimisticTask({
            id: crypto.randomUUID(),
            title: d.title,
            status: "backlog",
            projectId: parent.projectId,
            initiativeId: parent.initiativeId,
            domainId: parent.domainId,
            durationMins: d.durationMins,
            energy: d.energy,
            bigRockId: d.bigRockId,
            sortOrder: baseSort + i,
          }),
        );
        const tempIds = new Set(temps.map((t) => t.id));
        void qc.cancelQueries({ queryKey: ["tasks"] });
        qc.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) =>
          old ? [...old, ...temps] : temps,
        );
        try {
          const uid = await userId();
          const { data: rows, error } = await supabase
            .from("tasks")
            .insert(
              drafts.map((d, i) => ({
                user_id: uid,
                title: d.title,
                status: "backlog" as const,
                project_id: parent.projectId ?? null,
                initiative_id: parent.initiativeId ?? null,
                domain_id: parent.domainId ?? null,
                big_rock_id: d.bigRockId ?? null,
                energy: d.energy,
                duration_minutes: d.durationMins,
                sort_order: baseSort + i,
              })),
            )
            .select("*");
          if (error) throw error;
          const real = (rows ?? []) as Task[];
          qc.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) => {
            if (!old) return real;
            const kept = old.filter((t) => !tempIds.has(t.id));
            return [...kept, ...real];
          });
          invalidate(["tasks"]);
        } catch (e) {
          qc.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) =>
            old?.filter((t) => !tempIds.has(t.id)),
          );
          console.error("[vertical] addTasks failed", e);
          toast.error(e instanceof Error ? e.message : "Couldn't add those tasks.");
          throw e;
        }
      },
      addTasksToWeek: async (parent, drafts) => {
        if (!drafts.length) return;
        const sprint = await ensureSprint();
        const baseSort = Date.now();
        const temps = drafts.map((d, i) =>
          optimisticTask({
            id: crypto.randomUUID(),
            title: d.title,
            status: "backlog",
            projectId: parent.projectId,
            initiativeId: parent.initiativeId,
            domainId: parent.domainId,
            durationMins: d.durationMins,
            energy: d.energy,
            sprintId: sprint.id,
            bigRockId: d.bigRockId,
            deadline: d.deadline,
            sortOrder: baseSort + i,
          }),
        );
        const tempIds = new Set(temps.map((t) => t.id));
        void qc.cancelQueries({ queryKey: ["tasks"] });
        qc.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) =>
          old ? [...old, ...temps] : temps,
        );
        try {
          const uid = await userId();
          const { data: rows, error } = await supabase
            .from("tasks")
            .insert(
              drafts.map((d, i) => ({
                user_id: uid,
                title: d.title,
                status: "backlog" as const,
                project_id: parent.projectId ?? null,
                initiative_id: parent.initiativeId ?? null,
                domain_id: parent.domainId ?? null,
                sprint_id: sprint.id,
                big_rock_id: d.bigRockId ?? null,
                deadline: d.deadline ?? null,
                energy: d.energy,
                duration_minutes: d.durationMins,
                sort_order: baseSort + i,
              })),
            )
            .select("*");
          if (error) throw error;
          const real = (rows ?? []) as Task[];
          qc.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) => {
            if (!old) return real;
            const kept = old.filter((t) => !tempIds.has(t.id));
            return [...kept, ...real];
          });
          invalidate(["tasks"]);
        } catch (e) {
          qc.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) =>
            old?.filter((t) => !tempIds.has(t.id)),
          );
          console.error("[vertical] addTasksToWeek failed", e);
          toast.error(e instanceof Error ? e.message : "Couldn't add those tasks.");
          throw e;
        }
      },
      updateTask: (id, patch) => {
        const rowPatch: Partial<Task> = {};
        if (patch.title != null) rowPatch.title = patch.title;
        if ("energy" in patch) rowPatch.energy = patch.energy ?? null;
        if (patch.durationMins != null) rowPatch.duration_minutes = patch.durationMins;
        if ("keyResultId" in patch) rowPatch.key_result_id = patch.keyResultId ?? null;
        if (!Object.keys(rowPatch).length) return;
        void patchTaskRow(id, rowPatch);
      },
      deleteTask: (id) => {
        const prev = (tasksQ.data ?? []).find((x) => x.id === id)?.status;
        void patchTaskRow(id, { status: "trashed" });
        return prev;
      },
      restoreTask: (id, status) => {
        void patchTaskRow(id, { status });
      },
      reorderTasks: (ids) => {
        if (!ids.length) return;
        void (async () => {
          ids.forEach((id, i) => patchRows<Task>(["tasks", "all"], id, { sort_order: i }));
          for (let i = 0; i < ids.length; i++) await writeTable("tasks", ids[i], { sort_order: i });
          invalidate(["tasks"]);
        })();
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

      toggleTaskInbox: (id) => {
        const row = (tasksQ.data ?? []).find((x) => x.id === id);
        if (!row) return;
        if (row.status === "inbox") {
          // pull it back out of triage to its home backlog
          void patchTaskRow(id, { status: "backlog" });
        } else {
          // Release it: unscheduled and off the week. A task inside a PROJECT has
          // a home and rests there — only a capture with no home belongs in the
          // inbox. Forcing "inbox" here is what put project work into triage,
          // nagging about a project slotted to a different week.
          //
          // A domain tag is deliberately NOT a home (an SCE-tagged capture is
          // still unsorted). restingStatus() disagrees — it counts domain/sprint
          // as parented — so don't swap this for it until that's reconciled.
          void patchTaskRow(id, {
            status: row.project_id ? "backlog" : "inbox",
            do_date: null,
            start_time: null,
            slot_id: null,
            sprint_id: null,
          });
        }
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
      setDayContexts: (map) => void patchSprint({ day_contexts: map }),

      // ── big rocks — the week's named outcomes, jsonb on the sprint row ───
      addBigRock: () => {
        const rocks = data.bigRocks;
        const rock: BigRock = {
          id: crypto.randomUUID(),
          title: "",
          win: "",
          initiative_id: null,
          done_at: null,
          roll_count: 0,
        };
        void patchSprint({ big_rocks: [...rocks, rock] });
      },
      addBigRocks: (items) => {
        if (!items.length) return;
        const rocks: BigRock[] = items.map((it) => ({
          id: it.id ?? crypto.randomUUID(),
          title: it.title,
          win: it.win ?? "",
          initiative_id: it.initiative_id ?? null,
          project_id: it.project_id ?? null,
          done_at: it.done_at ?? null,
          roll_count: it.roll_count ?? 0,
        }));
        void patchSprint({ big_rocks: [...data.bigRocks, ...rocks] });
      },
      updateBigRock: (id, patch) =>
        void patchSprint({
          big_rocks: data.bigRocks.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        }),
      removeBigRock: (id) =>
        void patchSprint({ big_rocks: data.bigRocks.filter((r) => r.id !== id) }),
      carryBigRocksForward: (rocks) => {
        const have = new Set(data.bigRocks.map((r) => r.id));
        const fresh = rocks.filter((r) => !have.has(r.id));
        if (!fresh.length) return 0;
        const carried: BigRock[] = fresh.map((r) => ({
          ...r,
          done_at: null,
          roll_count: (r.roll_count ?? 0) + 1,
        }));
        void patchSprint({ big_rocks: [...data.bigRocks, ...carried] });
        return carried.length;
      },
      toggleBigRockDone: (id) =>
        void patchSprint({
          big_rocks: data.bigRocks.map((r) =>
            r.id === id ? { ...r, done_at: r.done_at ? null : new Date().toISOString() } : r,
          ),
        }),
      // Membership is derived from the On Deck span, so a push can exist with no
      // rock behind it yet. The rock is ONLY the verdict record — upsert it the
      // moment a verdict is actually cast, keyed by project.
      togglePushLanded: (projectId) => {
        const existing = data.bigRocks.find((r) => r.project_id === projectId);
        if (existing) {
          void patchSprint({
            big_rocks: data.bigRocks.map((r) =>
              r === existing ? { ...r, done_at: r.done_at ? null : new Date().toISOString() } : r,
            ),
          });
          return;
        }
        const proj = data.projects.find((p) => p.id === projectId);
        const rock: BigRock = {
          id: crypto.randomUUID(),
          title: proj?.name ?? "",
          win: proj?.outcome ?? "",
          initiative_id: null,
          project_id: projectId,
          done_at: new Date().toISOString(),
          roll_count: 0,
        };
        void patchSprint({ big_rocks: [...data.bigRocks, rock] });
      },
      markSprintReviewed: () => void patchSprint({ reviewed_at: new Date().toISOString() }),

      applySchedule: async (placements, opts) => {
        for (const p of placements) {
          // a direct block — the task itself carries the time (slot cleared)
          const patch: Record<string, unknown> = { status: "planned", do_date: p.doDateISO, start_time: p.startISO, slot_id: null };
          if (p.durationMins != null) patch.duration_minutes = p.durationMins;
          if (opts?.sprintId) patch.sprint_id = opts.sprintId;
          const { error } = await supabase.from("tasks").update(patch).eq("id", p.id);
          if (error) console.error("[compose] apply failed", error);
          else invokeQuiet("task-mirror", { taskId: p.id });
        }
        invalidate(["tasks"]);
      },

      applySlots: async (specs, opts) => {
        if (!specs.length) return;
        const uid = await userId();
        for (const s of specs) {
          const { data: slot, error } = await supabase
            .from("slots")
            .insert({
              user_id: uid,
              title: s.title,
              do_date: s.doDateISO,
              start_time: s.startISO,
              duration_minutes: s.durationMins,
              domain_id: s.domainId,
              color: s.color,
            })
            .select("id")
            .single();
          if (error) { console.error("[batch] slot insert failed", error); continue; }
          if (s.taskIds.length) {
            // children lose their own block (start_time null), keep the slot's day;
            // an optional sprintId pulls loose inbox captures into the committed
            // week (status leaves 'inbox') so a slotted run counts as week work.
            const patch: Record<string, unknown> = { slot_id: slot.id, do_date: s.doDateISO, start_time: null, status: "planned" };
            if (opts?.sprintId) patch.sprint_id = opts.sprintId;
            const { error: tErr } = await supabase
              .from("tasks")
              .update(patch)
              .in("id", s.taskIds);
            if (tErr) console.error("[batch] slot task assign failed", tErr);
          }
          invokeQuiet("slot-mirror", { slotId: slot.id });
        }
        invalidate(["slots"], ["tasks"]);
      },

      assignToStanding: async (specs, opts) => {
        if (!specs.length) return;
        for (const s of specs) {
          if (!s.taskIds.length) continue;
          // children ride the slot's day, lose their own block, and join the
          // committed week (status leaves 'inbox'/'backlog' → planned)
          const patch: Record<string, unknown> = {
            slot_id: s.slotId, do_date: s.doDateISO, start_time: null, status: "planned",
          };
          if (opts?.sprintId) patch.sprint_id = opts.sprintId;
          const { error } = await supabase.from("tasks").update(patch).in("id", s.taskIds);
          if (error) console.error("[standing] assign failed", error);
        }
        invalidate(["slots"], ["tasks"]);
      },

      planWeek: async ({ commitTaskIds, placements, goal }) => {
        const sprint = await ensureSprint();

        // 1 · every kept candidate becomes a week commitment (the funnel),
        //     and any inbox capture among them is processed out of the inbox
        if (commitTaskIds.length) {
          await supabase.from("tasks").update({ sprint_id: sprint.id }).in("id", commitTaskIds);
          await supabase
            .from("tasks")
            .update({ status: "backlog" })
            .in("id", commitTaskIds)
            .eq("status", "inbox");
        }
        // 2 · the placed subset also lands on the calendar
        for (const p of placements) {
          // an overdue task carved across sittings: parts 2+ become their own
          // rows (a task row can only hold one time block), cloned from the source
          if (p.splitChild) {
            const { data: src } = await supabase
              .from("tasks")
              .select("user_id, project_id, domain_id, initiative_id, energy, deadline")
              .eq("id", p.id)
              .single();
            if (!src) continue;
            const { data: child, error } = await supabase
              .from("tasks")
              .insert({
                ...src,
                title: p.splitChild.title,
                status: "planned",
                do_date: p.doDateISO,
                start_time: p.startISO,
                duration_minutes: p.durationMins ?? null,
                sprint_id: sprint.id,
              })
              .select("id")
              .single();
            if (error) console.error("[plan] split sitting failed", error);
            else if (child) invokeQuiet("task-mirror", { taskId: child.id });
            continue;
          }
          const { error } = await supabase
            .from("tasks")
            .update({
              status: "planned", do_date: p.doDateISO, start_time: p.startISO, sprint_id: sprint.id,
              ...(p.durationMins != null ? { duration_minutes: p.durationMins } : {}),
            })
            .eq("id", p.id);
          if (error) console.error("[plan] schedule failed", error);
          else invokeQuiet("task-mirror", { taskId: p.id });
        }
        // 3 · stamp the week: goal + reviewed (focus/contexts persist live as
        //     they're toggled, so they're already on the row)
        const rowPatch = { goal, reviewed_at: new Date().toISOString() };
        qc.setQueryData<Sprint | null>(["sprint", weekStart], (old) => (old ? { ...old, ...rowPatch } : old));
        await writeTable("sprints", sprint.id, rowPatch);

        invalidate(["tasks"], ["sprint"]);
      },

      addInitiativeTree: async (domainId, tree) => {
        const uid = await userId();
        const { data: init, error } = await supabase
          .from("initiatives")
          .insert({
            user_id: uid, domain_id: domainId, name: tree.name,
            outcome: tree.outcome, description: tree.description ?? "",
            target_date: tree.targetDate ?? null,
          })
          .select("id")
          .single();
        if (error) throw error;

        if (tree.keyResults.length) {
          await supabase.from("key_results").insert(
            tree.keyResults.map((k, i) => ({
              user_id: uid, initiative_id: init.id, name: k.name,
              baseline_value: k.baseline, current_value: k.baseline,
              target_value: k.target, unit: k.unit, sort_order: i,
            })),
          );
        }
        for (const [pi, p] of tree.projects.entries()) {
          const { data: proj, error: pErr } = await supabase
            .from("projects")
            .insert({
              user_id: uid, domain_id: domainId, initiative_id: init.id,
              name: p.name, outcome: p.outcome, status: "backlog", sort_order: pi,
            })
            .select("id")
            .single();
          if (pErr) throw pErr;
          if (p.tasks.length) {
            await supabase.from("tasks").insert(
              p.tasks.map((t, ti) => ({
                user_id: uid, title: t.title, status: "backlog",
                project_id: proj.id, initiative_id: init.id, domain_id: domainId,
                energy: t.energy, duration_minutes: t.durationMins,
                sort_order: ti,
              })),
            );
          }
        }
        invalidate(["vertical"], ["tasks"]);
        return init.id as string;
      },

      addInitiativeSubtree: async (initiativeId, tree) => {
        const uid = await userId();
        const init = data.initiatives.find((i) => i.id === initiativeId);
        const domainId = init?.domainId ?? "";
        if (tree.keyResults.length) {
          const base = init?.keyResults.length ?? 0;
          await supabase.from("key_results").insert(
            tree.keyResults.map((k, i) => ({
              user_id: uid, initiative_id: initiativeId, name: k.name,
              baseline_value: k.baseline, current_value: k.baseline,
              target_value: k.target, unit: k.unit, sort_order: base + i,
            })),
          );
        }
        const baseSort = data.projects.filter((p) => p.initiativeId === initiativeId).length;
        for (const [pi, p] of tree.projects.entries()) {
          const { data: proj, error: pErr } = await supabase
            .from("projects")
            .insert({
              user_id: uid, domain_id: domainId, initiative_id: initiativeId,
              name: p.name, outcome: p.outcome, status: "backlog", sort_order: baseSort + pi,
            })
            .select("id")
            .single();
          if (pErr) throw pErr;
          if (p.tasks.length) {
            await supabase.from("tasks").insert(
              p.tasks.map((t, ti) => ({
                user_id: uid, title: t.title, status: "backlog",
                project_id: proj.id, initiative_id: initiativeId, domain_id: domainId,
                energy: t.energy, duration_minutes: t.durationMins, sort_order: ti,
              })),
            );
          }
        }
        invalidate(["vertical"], ["tasks"]);
      },

      tend: async (kind, id, opts) => {
        const table = kind === "project" ? "projects" : "initiatives";
        const key = kind === "project" ? ["vertical", "projects"] : ["vertical", "initiatives"];
        const rowPatch: Record<string, unknown> = { tended_at: new Date().toISOString() };
        if (opts?.rest) rowPatch.status = "waiting";
        patchRows(key, id, rowPatch);
        await writeTable(table, id, rowPatch);
        invalidate(["vertical"]);
      },

      saveVerdict: async (kind, id, verdict) => {
        const table = kind === "project" ? "projects" : "initiatives";
        const key = kind === "project" ? ["vertical", "projects"] : ["vertical", "initiatives"];
        const rowPatch: Record<string, unknown> = { verification: verdict, verified_at: new Date().toISOString() };
        patchRows(key, id, rowPatch);
        await writeTable(table, id, rowPatch);
        invalidate(["vertical"]);
      },
    };
  }, [data, ready, qc, weekStart, domainsQ.data, tasksQ.data]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useVertical(): VerticalStore {
  const v = useContext(Ctx);
  if (!v) throw new Error("useVertical must be used within <VerticalProvider>");
  return v;
}
