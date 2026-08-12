// The vertical store, live. Fetches domains/initiatives/projects/key-results
// and ALL non-trashed tasks from Supabase, builds the floors' VerticalData
// snapshot with buildVertical(), and exposes the same action surface the
// localStorage prototype had — now writing real rows. One task world: the
// floors edit the same rows the calendar blocks.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeQuiet, supabase } from "../lib/supabase";
import { useExternalEvents } from "./useCalendar";
import { useSettings } from "./useSettings";
import { useEventRouting } from "./useEventRouting";
import { useOptionalUndoStack } from "./useUndoStack";
import { fetchAllTasks, patchCaches } from "./useTasks";
import { insertSlotCache, patchSlotCaches } from "./useSlots";
import { invalidateWhenSafe, makeOp, queueWrite, type SyncTable } from "../lib/sync";
import { planningWeekStartISO } from "../lib/dates";
import { upsertPushVerdict } from "../lib/priorities";
import { titleCase } from "../lib/text";
import {
  DEFAULT_DURATION_MINUTES,
  DEFAULT_PROJECT_DURATION_MINUTES,
  restingStatus,
  type BigRock,
  type Slot,
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
  /** The current week's sprint id, creating the row if this is its first use.
   *  Any surface that places work in time must pass this to `applySchedule`, or
   *  it writes a `do_date` with no `sprint_id` and slips work past the gate (P2). */
  ensureWeek: () => Promise<string>;
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
  /** Materialize batched focus blocks: create slot rows and move their tasks inside.
   *
   *  `existingSlotId` tops up a sitting that is already on the calendar instead of
   *  minting a second one beside it — the block keeps the time it already has and
   *  only grows to cover the work being added. Re-planning mid-week used to INSERT
   *  a twin with the same project title, because nothing could ask whether the
   *  project already had a sitting this week. */
  applySlots: (
    slots: { title: string; doDateISO: string; startISO: string; durationMins: number; domainId: string | null; color: string | null; projectId?: string | null; existingSlotId?: string | null; taskIds: string[] }[],
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

/** DEV verify harnesses only: mount a fabricated store so a surface that reads
 *  `useVertical()` can be driven at phone width without an account (see
 *  `mobile/DomainHarness.tsx`, reached at `?domains`). Never used by the app. */
/** Mirrors the `domains.color` schema default (migration 1). Client-minted rows
 *  must name it so the optimistic domain matches the persisted one. */
const NEW_DOMAIN_COLOR = "#6B7280";

export function VerticalStoreProvider({ value, children }: { value: VerticalStore; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

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
  const { recordUndo } = useOptionalUndoStack();
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
  // ledger the presence/gain numbers derive from. Shares useTasks' paged
  // fetcher — one definition of "all tasks", complete past the max_rows cap.
  const tasksQ = useQuery({
    queryKey: ["tasks", "all"],
    queryFn: fetchAllTasks,
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

  // What the user took out of the busy math stays out of the hours ledger too —
  // a hidden calendar is usually a duplicate import of one already mapped to a
  // domain, so counting both would double every meeting in it.
  const actualsFilter = useMemo(
    () => ({
      hiddenCalendarIds: new Set(settings?.hidden_calendar_ids ?? []),
      hiddenEventKeys: new Set((settings?.hidden_events ?? []).map((h) => h.key)),
    }),
    [settings?.hidden_calendar_ids, settings?.hidden_events],
  );

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

  // buildVertical reads the clock (today's ledger column, staleness, "has this
  // event ended"). It used to be handed a raw `new Date()` that was NOT in the
  // dependency array, so the memo froze whatever instant the last data change
  // happened — an app left open overnight kept deriving yesterday's "today"
  // until some unrelated refetch shook it loose. A 5-minute tick (kicked
  // immediately when the tab returns) is precise enough for every read
  // buildVertical does, and cheap enough to rebuild on.
  const [buildNow, setBuildNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setBuildNow(new Date());
    const t = window.setInterval(tick, 5 * 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const data = useMemo<VerticalData>(
    () =>
      buildVertical(
        domainsQ.data ?? [],
        initiativesQ.data ?? [],
        projectsQ.data ?? [],
        tasksQ.data ?? [],
        sprintQ.data ?? null,
        buildNow,
        eventsQ.data ?? [],
        calendarDomainMap,
        eventRouting,
        lastActivityByProject,
        actualsFilter,
      ),
    [domainsQ.data, initiativesQ.data, projectsQ.data, tasksQ.data, sprintQ.data, buildNow, eventsQ.data, calendarDomainMap, eventRouting, lastActivityByProject, actualsFilter],
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

    /**
     * Delete projects and detach their children.
     *
     * Same shape as `deleteInitiativeRows`, and the same reason: the detach was
     * three set-based updates (`.eq("project_id", …)` across tasks, slots and
     * recurrences), and a predicate the server evaluates later can match rows
     * the user never saw. Children are resolved from the cache and queued one
     * op each.
     *
     * `recurrences` is NOT in the outbox's table list, so its detach still goes
     * straight to the network and is lost offline. The FK (`on delete set null`)
     * repairs it server-side when the project delete lands, so the outcome is
     * correct either way — but the write itself is not offline-capable, and that
     * is why `recurrences` appears in the not-converted list in
     * `docs/offline-sync.md`.
     */
    const deleteProjectRows = async (ids: string[]) => {
      if (!ids.length) return;
      const doomed = new Set(ids);
      removeRows<ProjectRow>(["vertical", "projects"], ids);

      const tasks = qc.getQueryData<Task[]>(["tasks", "all"]) ?? [];
      const slots = qc.getQueryData<Slot[]>(["slots"]) ?? [];

      for (const t of tasks) {
        if (t.project_id && doomed.has(t.project_id)) {
          patchCaches(qc, t.id, { project_id: null });
          await queueWrite(makeOp("tasks", "update", t.id, { project_id: null }));
        }
      }
      for (const s of slots) {
        if (s.project_id && doomed.has(s.project_id)) {
          await queueWrite(makeOp("slots", "update", s.id, { project_id: null }));
        }
      }
      for (const id of ids) await queueWrite(makeOp("projects", "delete", id));

      invalidateWhenSafe(qc, "projects", ["vertical", "projects"]);
      invalidateWhenSafe(qc, "tasks", ["tasks"]);
      invalidateWhenSafe(qc, "slots", ["slots"]);
    };

    /**
     * Delete initiatives and detach what hangs off them.
     *
     * The old version leaned on set-based SQL — `.in("initiative_id", ids)` for
     * the project detach and the key-result delete. The outbox cannot express
     * that: an op names one row, because a predicate evaluated on the server
     * days later would match a different set than the user saw when they acted.
     * So the affected rows are resolved from the local cache *now* and queued
     * individually, which also makes each one independently retriable.
     *
     * The trade is honest and worth naming: rows this device has never loaded
     * are not detached. In a single-player app the cache holds the user's whole
     * portfolio, so the gap is theoretical — and the FK (`on delete set null`
     * for projects, `on delete cascade` for key results) is still the backstop
     * that makes the database correct regardless.
     */
    const deleteInitiativeRows = (ids: string[]) => {
      if (!ids.length) return;
      const doomed = new Set(ids);

      const projects = qc.getQueryData<ProjectRow[]>(["vertical", "projects"]) ?? [];
      // Key results have no query key of their own — they ride the initiatives
      // query (`select "*, key_results(*)"`), so they come off the derived model
      // rather than the cache. Reading `["vertical","key_results"]` would have
      // silently returned nothing and queued no deletes at all.
      const keyResults = data.initiatives
        .filter((i) => doomed.has(i.id))
        .flatMap((i) => i.keyResults);

      removeRows<InitiativeRow>(["vertical", "initiatives"], ids);

      void (async () => {
        for (const p of projects) {
          if (p.initiative_id && doomed.has(p.initiative_id)) {
            patchRows<ProjectRow>(["vertical", "projects"], p.id, {
              initiative_id: null,
            } as Partial<ProjectRow>);
            await queueWrite(makeOp("projects", "update", p.id, { initiative_id: null }));
          }
        }
        for (const kr of keyResults) {
          await queueWrite(makeOp("key_results", "delete", kr.id));
        }
        for (const id of ids) await queueWrite(makeOp("initiatives", "delete", id));

        invalidateWhenSafe(qc, "initiatives", ["vertical"]);
        invalidateWhenSafe(qc, "tasks", ["tasks"]);
      })();
    };

    /**
     * The single update path for every vertical row.
     *
     * Queues rather than writes. It resolves once the op is durable, so callers
     * that `await` it are awaiting *safety*, not a round-trip — and it no longer
     * throws on a dead network, which is why the rollback-and-toast branch below
     * is gone rather than merely quieter.
     */
    const writeTable = async (table: SyncTable, id: string, rowPatch: Record<string, unknown>) => {
      await queueWrite(makeOp(table, "update", id, rowPatch));
    };

    /**
     * Persist an optimistic vertical patch.
     *
     * This used to refetch on failure "so the UI doesn't stay on a lie" and
     * raise a toast. Both were artefacts of a write that could be lost: the
     * refetch existed to undo the optimistic patch, and the toast to apologise
     * for it. A queued write is not lost, so the honest behaviour is to keep the
     * patch on screen and let the outbox deliver it. Genuine rejections surface
     * once, in the sync strip, where they can actually be retried.
     */
    const persistVertical = (table: SyncTable, id: string, rowPatch: Record<string, unknown>) => {
      void queueWrite(makeOp(table, "update", id, rowPatch));
      invalidateWhenSafe(qc, table, ["vertical"]);
    };

    /** Every task the caches know about, deduped by id. The local stand-in for
     *  the `.in(...)` / `.eq(...)` predicates the server used to resolve. */
    const allCachedTasks = (): Task[] => {
      const seen = new Map<string, Task>();
      for (const [, rows] of qc.getQueriesData<Task[]>({ queryKey: ["tasks"] })) {
        for (const t of rows ?? []) seen.set(t.id, t);
      }
      return [...seen.values()];
    };

    /** Queue one patch per task and refresh once. */
    const patchTasks = async (ids: Iterable<string>, patch: Partial<Task>) => {
      for (const id of ids) {
        patchCaches(qc, id, patch);
        await queueWrite(makeOp("tasks", "update", id, patch as Record<string, unknown>));
      }
      invalidateWhenSafe(qc, "tasks", ["tasks"]);
    };

    /**
     * The current sprint row, created on first use.
     *
     * **This is the one place the weekly ritual still needs a connection, and
     * only in a narrow case.** Tasks reference `sprint_id`, so committing work
     * to a week needs the sprint's real id. When the week's row is already in
     * cache — true whenever the app has been opened online at any point this
     * week — everything below runs offline. When it is not, the client cannot
     * safely invent one: another device may already have created that week's
     * row with a different id, our insert would lose the
     * `unique (user_id, week_start)` race, and every task referencing our
     * invented id would fail its foreign key and park. Refusing here costs the
     * user a clear message; guessing would cost them the whole plan.
     */
    const ensureSprint = async (): Promise<Sprint> => {
      const cached = qc.getQueryData<Sprint | null>(["sprint", weekStart]);
      if (cached) {
        releaseStaleCommitments(cached.id);
        return cached;
      }

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        throw new Error(
          "This week hasn't been opened online yet — connect once to start planning it.",
        );
      }

      const uid = await userId();
      const { data: row, error } = await supabase
        .from("sprints")
        .upsert({ user_id: uid, week_start: weekStart }, { onConflict: "user_id,week_start" })
        .select("*")
        .single();
      if (error) throw error;
      qc.setQueryData(["sprint", weekStart], row);
      releaseStaleCommitments((row as Sprint).id);
      return row as Sprint;
    };

    /**
     * Entering a week releases unfinished commitments from PAST sprints back to
     * their pools, so nothing strands on a stale `sprint_id`.
     *
     * The two set-based updates this replaces were predicates the server
     * resolved (`sprint_id is not null and sprint_id <> current and status not
     * in (done, trashed)`), which is unsafe to queue: evaluated days later they
     * would sweep up work the user committed in the meantime. Resolved from the
     * cache and queued per row instead.
     */
    const releaseStaleCommitments = (currentSprintId: string) => {
      const seen = new Map<string, Task>();
      for (const [, rows] of qc.getQueriesData<Task[]>({ queryKey: ["tasks"] })) {
        for (const t of rows ?? []) seen.set(t.id, t);
      }

      void (async () => {
        for (const t of seen.values()) {
          if (!t.sprint_id || t.sprint_id === currentSprintId) continue;
          if (t.status === "done" || t.status === "trashed") continue;

          // A parentless week-only capture goes back to the inbox rather than
          // into limbo; everything else is released to its own backlog.
          const orphan =
            t.status === "backlog" &&
            !t.project_id &&
            !t.initiative_id &&
            !t.domain_id &&
            !t.do_date;
          const patch = orphan
            ? { status: "inbox" as const, sprint_id: null }
            : { sprint_id: null };

          patchCaches(qc, t.id, patch);
          await queueWrite(makeOp("tasks", "update", t.id, patch));
        }
        invalidateWhenSafe(qc, "tasks", ["tasks"]);
      })();
    };

    const patchSprint = async (rowPatch: Partial<Sprint>) => {
      const sprint = await ensureSprint();
      qc.setQueryData<Sprint | null>(["sprint", weekStart], (old) =>
        old ? { ...old, ...rowPatch } : old,
      );
      // Addressed by the week, not by `sprint.id` — `sprints` is natural-keyed
      // in the transport so an offline client can patch a week it has never
      // learned the uuid for.
      void sprint;
      await queueWrite(makeOp("sprints", "update", weekStart, rowPatch as Record<string, unknown>));
      invalidate(["sprint"]);
    };

    const patchTaskRow = async (id: string, rowPatch: Partial<Task>) => {
      // Same fragmented ["tasks", ...] cache space useTasks.ts owns — patch every
      // membership-sensitive fragment (inbox/day/anytime/scheduled/slot/all/sprint),
      // not just ["tasks","all"], or the other views go stale until their own refetch.
      patchCaches(qc, id, rowPatch);
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
        // The id is minted here, not by Postgres — the caller gets a real
        // primary key back immediately, so the domain it opens for editing is
        // the same row the insert will create even if that insert is still
        // sitting in the outbox.
        const id = crypto.randomUUID();
        const sort = (domainsQ.data?.length ?? 0) + 1;
        const row = {
          name: "New domain",
          icon: "◇",
          sort_order: sort,
          // Named explicitly rather than left to the column default. The row is
          // now built on the client, so an omitted colour would render one shade
          // optimistically and a different one after the insert lands. (Not a
          // design token — this mirrors the schema default in migration 1.)
          color: NEW_DOMAIN_COLOR,
        };

        qc.setQueryData<DomainRow[]>(["vertical", "domains"], (old) =>
          old ? [...old, { id, ...row } as DomainRow] : old,
        );
        await queueWrite(makeOp("domains", "insert", id, row));
        invalidateWhenSafe(qc, "domains", ["vertical"]);

        return {
          id, name: row.name, color: row.color, icon: row.icon,
          intention: "", charter: "", context: null,
          weeklyTargetHours: 0,
          investedThisWeek: 0, meetingHoursThisWeek: 0, quarterHours: 0,
          lastTouchedDays: null, lastShip: null,
          weeks: new Array(13).fill(0), days: new Array(7).fill(0), sort,
        };
      },
      // Signup seeds no domains (migration 42) — the first-run picker calls this
      // with what the account named for itself. One op per domain rather than
      // one batched insert: the outbox is per-row, and a batch that half-lands
      // has no safe retry.
      seedDomains: async (specs) => {
        if (!specs.length) return;
        const base = domainsQ.data?.length ?? 0;
        for (const [i, s] of specs.entries()) {
          await queueWrite(
            makeOp("domains", "insert", crypto.randomUUID(), {
              name: titleCase(s.name),
              color: s.color,
              icon: "◇",
              sort_order: base + i + 1,
            }),
          );
        }
        invalidateWhenSafe(qc, "domains", ["vertical"]);
      },
      updateDomain: (id, patch) => {
        const rowPatch: Record<string, unknown> = {};
        if (patch.name != null) rowPatch.name = titleCase(patch.name);
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
        removeRows<DomainRow>(["vertical", "domains"], [id]);
        void queueWrite(makeOp("domains", "delete", id));
        invalidateWhenSafe(qc, "domains", ["vertical"]);
        invalidateWhenSafe(qc, "tasks", ["tasks"]);
      },

      // ── initiatives ──────────────────────────────────────────────────────
      addInitiative: async (domainId, init) => {
        const id = crypto.randomUUID();
        const name = init?.name?.trim() ? titleCase(init.name) : "New initiative";
        const outcome = init?.outcome?.trim() ?? "";
        const description = init?.description?.trim() ?? "";
        const startDate = init?.startDate ?? null;
        const targetDate = init?.targetDate ?? null;
        const status = init?.status ?? "in_progress";
        const sortOrder = Date.now();
        const createdAt = new Date().toISOString();

        const insert: Record<string, unknown> = {
          domain_id: domainId,
          name,
          sort_order: sortOrder,
        };
        if (init?.outcome != null) insert.outcome = outcome;
        if (init?.description != null) insert.description = description;
        if ("startDate" in (init ?? {})) insert.start_date = startDate;
        if ("targetDate" in (init ?? {})) insert.target_date = targetDate;
        if (init?.status != null) insert.status = status;

        // The optimistic row must satisfy the full InitiativeRow shape — a
        // partial `insert` spread here left `outcome` undefined for callers
        // that omit it (e.g. mobile's quick-add), which crashed every reader
        // that does `initiative.outcome.trim()`.
        const optimisticRow: InitiativeRow = {
          id, domain_id: domainId, name, outcome, description,
          start_date: startDate, target_date: targetDate, status,
          momentum: "flat", progress: 0, sort_order: sortOrder,
          created_at: createdAt, tended_at: null,
          verification: null, verified_at: null, brief: null,
          key_results: [],
        };
        qc.setQueryData<InitiativeRow[]>(["vertical", "initiatives"], (old) =>
          old ? [...old, optimisticRow] : [optimisticRow],
        );
        await queueWrite(makeOp("initiatives", "insert", id, insert));
        invalidateWhenSafe(qc, "initiatives", ["vertical"]);

        return {
          id, domainId, name, outcome, description, startDate, targetDate,
          status: normalizeInitiativeStatus(status),
          progress: 0,
          momentum: "flat" as Initiative["momentum"], keyResults: [],
          createdAt, tendedAt: null,
          verification: null, verifiedAt: null, brief: null,
        };
      },
      updateInitiative: (id, patch) => {
        const rowPatch: Record<string, unknown> = {};
        if (patch.name != null) rowPatch.name = titleCase(patch.name);
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
      deleteInitiative: (id) => deleteInitiativeRows([id]),
      deleteInitiatives: (ids) => deleteInitiativeRows(ids),

      // ── key results ──────────────────────────────────────────────────────
      addKeyResult: (initiativeId, init) => {
        const row: Record<string, unknown> = {
          initiative_id: initiativeId,
          name: init?.name ?? "New result",
          sort_order: (data.initiatives.find((i) => i.id === initiativeId)?.keyResults.length ?? 0) + 1,
        };
        if (init?.baseline != null) row.baseline_value = init.baseline;
        if (init?.current != null) row.current_value = init.current;
        if (init?.target != null) row.target_value = init.target;
        if (init?.unit != null) row.unit = init.unit;
        void queueWrite(makeOp("key_results", "insert", crypto.randomUUID(), row));
        invalidateWhenSafe(qc, "key_results", ["vertical"]);
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
        void queueWrite(makeOp("key_results", "delete", krId));
        invalidateWhenSafe(qc, "key_results", ["vertical"]);
      },

      // ── projects ─────────────────────────────────────────────────────────
      // Like addTask, creates land in the cache FIRST (Todoist-fast) so a project
      // typed into the initiative record's composer appears the instant you hit
      // Enter — the insert then reconciles the temp id with the real row. A large
      // sort_order appends the new project after the existing ones.
      addProject: async (domainId, initiativeId, init) => {
        const tempId = crypto.randomUUID();
        const name = init?.name?.trim() ? titleCase(init.name) : "New project";
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
        const insert: Record<string, unknown> = {
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

        // `tempId` is no longer temporary — it is the row's real primary key, so
        // the reconcile-and-swap that used to follow the insert is gone, and so
        // is the catch that removed the optimistic row when the write failed. A
        // queued create is not a failed create.
        await queueWrite(makeOp("projects", "insert", tempId, insert));
        invalidateWhenSafe(qc, "projects", ["vertical"]);
        return rowToProject(optimistic);
      },
      updateProject: (id, patch) => {
        const rowPatch: Record<string, unknown> = {};
        if (patch.name != null) rowPatch.name = titleCase(patch.name);
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
        // Queued, like `useTasks.createTask`. These two paths had diverged:
        // capturing from the rail survived a dead network and adding a task
        // inside a project record did not — the same act with two different
        // answers depending on which surface you happened to be on, which is
        // worse than being uniformly online-only because there is no rule to
        // learn. `tempId` is the row's real primary key, so the reconcile-swap
        // and the unwind-on-failure are both gone.
        void queueWrite(
          makeOp("tasks", "insert", tempId, {
            title,
            status,
            project_id: parent.projectId ?? null,
            initiative_id: parent.initiativeId ?? null,
            domain_id: parent.domainId ?? null,
            energy: "quick",
            duration_minutes: durationMins,
          }),
        ).then(() => invalidateWhenSafe(qc, "tasks", ["tasks"]));
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

        void qc.cancelQueries({ queryKey: ["tasks"] });
        qc.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) =>
          old ? [...old, ...temps] : temps,
        );
        // One op per draft rather than one batch insert: a batch that
        // half-lands has no safe retry, whereas each per-row upsert is
        // independently idempotent. The optimistic rows already carry the ids
        // the inserts will use, so nothing is swapped afterwards.
        for (const [i, d] of drafts.entries()) {
          await queueWrite(
            makeOp("tasks", "insert", temps[i].id, {
              title: d.title,
              status: "backlog",
              project_id: parent.projectId ?? null,
              initiative_id: parent.initiativeId ?? null,
              domain_id: parent.domainId ?? null,
              big_rock_id: d.bigRockId ?? null,
              energy: d.energy,
              duration_minutes: d.durationMins,
              sort_order: baseSort + i,
            }),
          );
        }
        invalidateWhenSafe(qc, "tasks", ["tasks"]);
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

        void qc.cancelQueries({ queryKey: ["tasks"] });
        qc.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) =>
          old ? [...old, ...temps] : temps,
        );
        // Per-row ops, ids already minted into the optimistic rows.
        for (const [i, d] of drafts.entries()) {
          await queueWrite(
            makeOp("tasks", "insert", temps[i].id, {
              title: d.title,
              status: "backlog",
              project_id: parent.projectId ?? null,
              initiative_id: parent.initiativeId ?? null,
              domain_id: parent.domainId ?? null,
              sprint_id: sprint.id,
              big_rock_id: d.bigRockId ?? null,
              deadline: d.deadline ?? null,
              energy: d.energy,
              duration_minutes: d.durationMins,
              sort_order: baseSort + i,
            }),
          );
        }
        invalidateWhenSafe(qc, "tasks", ["tasks"]);
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
        const row = (tasksQ.data ?? []).find((x) => x.id === id);
        const prev = row?.status;
        void patchTaskRow(id, { status: "trashed" });
        if (prev) {
          recordUndo({
            label: "Task deleted",
            shortLabel: "Task deleted",
            batchLabel: (n) => `${n} tasks deleted`,
            batchShortLabel: (n) => `${n} deleted`,
            tier: "toast",
            coalesceKey: "trash",
            undo: () => void patchTaskRow(id, { status: prev }),
          });
        }
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
          const before = { status: row.status, completed_at: row.completed_at };
          void patchTaskRow(id, { status: restingStatus(row), completed_at: null });
          recordUndo({
            label: `Reopened — ${row.title}`,
            shortLabel: "Reopened",
            batchLabel: (n) => `${n} tasks reopened`,
            batchShortLabel: (n) => `${n} reopened`,
            tier: "toast",
            coalesceKey: "uncomplete",
            undo: () => void patchTaskRow(id, before),
          });
        } else {
          const before = { status: row.status, completed_at: row.completed_at };
          void patchTaskRow(id, { status: "done", completed_at: new Date().toISOString() });
          recordUndo({
            label: `Marked done — ${row.title}`,
            shortLabel: "Marked done",
            batchLabel: (n) => `${n} tasks marked done`,
            batchShortLabel: (n) => `${n} marked done`,
            tier: "toast",
            coalesceKey: "complete",
            undo: () => void patchTaskRow(id, before),
          });
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
      ensureWeek: async () => (await ensureSprint()).id,
      commitTasksToSprint: (ids) => {
        if (!ids.length) return;
        void ensureSprint().then(async (sprint) => {
          // The second statement was `.in(ids).eq("status","inbox")` — a
          // predicate the server re-evaluated. Decided here instead, against
          // the state the user actually acted on.
          const byId = new Map(allCachedTasks().map((t) => [t.id, t]));
          for (const id of ids) {
            const patch: Partial<Task> =
              byId.get(id)?.status === "inbox"
                ? { sprint_id: sprint.id, status: "backlog" }
                : { sprint_id: sprint.id };
            patchCaches(qc, id, patch);
            await queueWrite(makeOp("tasks", "update", id, patch as Record<string, unknown>));
          }
          invalidateWhenSafe(qc, "tasks", ["tasks"]);
        });
      },
      addProjectReadyToSprint: (projectId) => {
        void ensureSprint().then(async (sprint) => {
          const ids = allCachedTasks()
            .filter(
              (t) =>
                t.project_id === projectId && t.status !== "done" && t.status !== "trashed",
            )
            .map((t) => t.id);
          await patchTasks(ids, { sprint_id: sprint.id });
        });
      },
      clearSprint: () => {
        const sprint = data.sprint;
        if (!sprint) return;
        void (async () => {
          for (const t of allCachedTasks()) {
            if (t.sprint_id !== sprint.id) continue;
            // parentless week-only captures resurface in the inbox
            const orphan =
              t.status === "backlog" &&
              !t.project_id &&
              !t.initiative_id &&
              !t.domain_id &&
              !t.do_date;
            const patch: Partial<Task> = orphan
              ? { status: "inbox", sprint_id: null }
              : { sprint_id: null };
            patchCaches(qc, t.id, patch);
            await queueWrite(makeOp("tasks", "update", t.id, patch as Record<string, unknown>));
          }
          invalidateWhenSafe(qc, "tasks", ["tasks"]);
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
        const proj = data.projects.find((p) => p.id === projectId);
        const landed = !data.bigRocks.find((r) => r.project_id === projectId)?.done_at;
        void patchSprint({
          big_rocks: upsertPushVerdict(
            data.bigRocks,
            { id: projectId, name: proj?.name ?? "", outcome: proj?.outcome ?? "" },
            landed,
            new Date().toISOString(),
          ),
        });
      },
      markSprintReviewed: () => void patchSprint({ reviewed_at: new Date().toISOString() }),

      applySchedule: async (placements, opts) => {
        for (const p of placements) {
          // a direct block — the task itself carries the time (slot cleared)
          const patch: Record<string, unknown> = { status: "planned", do_date: p.doDateISO, start_time: p.startISO, slot_id: null };
          if (p.durationMins != null) patch.duration_minutes = p.durationMins;
          if (opts?.sprintId) patch.sprint_id = opts.sprintId;
          patchCaches(qc, p.id, patch as Partial<Task>);
          await queueWrite(makeOp("tasks", "update", p.id, patch));
          if (navigator.onLine) invokeQuiet("task-mirror", { taskId: p.id });
        }
        invalidateWhenSafe(qc, "tasks", ["tasks"]);
      },

      applySlots: async (specs, opts) => {
        if (!specs.length) return;
        for (const s of specs) {
          // The slot id is minted here when the sitting is new, so the tasks
          // that ride it can reference it without waiting for a round-trip.
          const slotId = s.existingSlotId ?? crypto.randomUUID();

          if (s.existingSlotId) {
            // Top up: the block keeps the day and time it already holds — the
            // person put it there. Only its length moves, to cover what's being
            // added. Never reposition a sitting the week has already lived with.
            patchSlotCaches(qc, slotId, { duration_minutes: s.durationMins });
            await queueWrite(
              makeOp("slots", "update", slotId, { duration_minutes: s.durationMins }),
            );
          } else {
            insertSlotCache(qc, {
              id: slotId,
              user_id: "",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              title: s.title,
              do_date: s.doDateISO,
              start_time: s.startISO,
              duration_minutes: s.durationMins,
              project_id: s.projectId ?? null,
              domain_id: s.domainId,
              color: s.color ?? null,
              google_event_id: null,
              recurrence_id: null,
              recurrence_date: null,
              recurrence_overridden: false,
            });
            await queueWrite(
              makeOp("slots", "insert", slotId, {
                title: s.title,
                do_date: s.doDateISO,
                start_time: s.startISO,
                duration_minutes: s.durationMins,
                domain_id: s.domainId,
                // The sitting says WHICH project it is. Without this a slot could
                // only be traced back through its children's project_id, so
                // nothing could ask "does this project already have a sitting this
                // week?" — which is why a mid-week re-plan minted a twin instead
                // of topping the first one up.
                project_id: s.projectId ?? null,
                color: s.color,
              }),
            );
          }

          if (s.taskIds.length) {
            // children lose their own block (start_time null), keep the slot's day;
            // an optional sprintId pulls loose inbox captures into the committed
            // week (status leaves 'inbox') so a slotted run counts as week work.
            const patch: Record<string, unknown> = {
              slot_id: slotId,
              do_date: s.doDateISO,
              start_time: null,
              status: "planned",
            };
            if (opts?.sprintId) patch.sprint_id = opts.sprintId;
            await patchTasks(s.taskIds, patch as Partial<Task>);
          }
          if (navigator.onLine) invokeQuiet("slot-mirror", { slotId });
        }
        invalidateWhenSafe(qc, "slots", ["slots"]);
        invalidateWhenSafe(qc, "tasks", ["tasks"]);
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
          await patchTasks(s.taskIds, patch as Partial<Task>);
        }
        invalidateWhenSafe(qc, "slots", ["slots"]);
      },

      planWeek: async ({ commitTaskIds, placements, goal }) => {
        const sprint = await ensureSprint();

        // 1 · every kept candidate becomes a week commitment (the funnel),
        //     and any inbox capture among them is processed out of the inbox
        if (commitTaskIds.length) {
          const byId = new Map(allCachedTasks().map((t) => [t.id, t]));
          for (const id of commitTaskIds) {
            const patch: Partial<Task> =
              byId.get(id)?.status === "inbox"
                ? { sprint_id: sprint.id, status: "backlog" }
                : { sprint_id: sprint.id };
            patchCaches(qc, id, patch);
            await queueWrite(makeOp("tasks", "update", id, patch as Record<string, unknown>));
          }
        }

        // 2 · the placed subset also lands on the calendar
        const byId = new Map(allCachedTasks().map((t) => [t.id, t]));
        for (const p of placements) {
          // an overdue task carved across sittings: parts 2+ become their own
          // rows (a task row can only hold one time block), cloned from the source
          if (p.splitChild) {
            // The source row is read from the cache rather than re-fetched — a
            // queued split cannot wait on a round-trip, and the fields it copies
            // (parentage, energy, deadline) are all already loaded.
            const src = byId.get(p.id);
            if (!src) continue;
            const childId = crypto.randomUUID();
            await queueWrite(
              makeOp("tasks", "insert", childId, {
                project_id: src.project_id,
                domain_id: src.domain_id,
                initiative_id: src.initiative_id,
                energy: src.energy,
                deadline: src.deadline,
                title: p.splitChild.title,
                status: "planned",
                do_date: p.doDateISO,
                start_time: p.startISO,
                duration_minutes: p.durationMins ?? null,
                sprint_id: sprint.id,
              }),
            );
            if (navigator.onLine) invokeQuiet("task-mirror", { taskId: childId });
            continue;
          }
          const patch: Record<string, unknown> = {
            status: "planned",
            do_date: p.doDateISO,
            start_time: p.startISO,
            sprint_id: sprint.id,
            ...(p.durationMins != null ? { duration_minutes: p.durationMins } : {}),
          };
          patchCaches(qc, p.id, patch as Partial<Task>);
          await queueWrite(makeOp("tasks", "update", p.id, patch));
          if (navigator.onLine) invokeQuiet("task-mirror", { taskId: p.id });
        }

        // 3 · stamp the week: goal + reviewed (focus/contexts persist live as
        //     they're toggled, so they're already on the row)
        const rowPatch = { goal, reviewed_at: new Date().toISOString() };
        qc.setQueryData<Sprint | null>(["sprint", weekStart], (old) => (old ? { ...old, ...rowPatch } : old));
        await queueWrite(makeOp("sprints", "update", weekStart, rowPatch));

        invalidateWhenSafe(qc, "tasks", ["tasks"]);
        invalidateWhenSafe(qc, "sprints", ["sprint"]);
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
  }, [data, ready, qc, weekStart, domainsQ.data, tasksQ.data, recordUndo]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useVertical(): VerticalStore {
  const v = useContext(Ctx);
  if (!v) throw new Error("useVertical must be used within <VerticalProvider>");
  return v;
}
