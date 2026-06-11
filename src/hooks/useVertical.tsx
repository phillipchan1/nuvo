// The vertical store. Holds domains/initiatives/projects/tasks in React state,
// persisted to localStorage, and exposes full CRUD. This is the single seam
// between the views and the data: to go live, replace the reducer body with
// Supabase mutations + react-query — the action surface stays identical.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  SEED,
  emptyDomain,
  emptyInitiative,
  emptyKeyResult,
  emptyProject,
  type Domain,
  type Initiative,
  type KeyResult,
  type Project,
  type VerticalData,
  type VTask,
} from "../lib/vertical";

const STORAGE_KEY = "nuvo.vertical.v1";

function load(): VerticalData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(SEED);
    const parsed = JSON.parse(raw) as VerticalData;
    // Shallow shape guard — if an older/partial blob is found, fall back to seed.
    if (!parsed.domains || !parsed.initiatives || !parsed.projects || !parsed.tasks)
      return structuredClone(SEED);
    return parsed;
  } catch {
    return structuredClone(SEED);
  }
}

function save(d: VerticalData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  } catch {
    /* storage full / unavailable — stay in-memory */
  }
}

export interface VerticalStore {
  data: VerticalData;

  // domains
  addDomain: () => Domain;
  updateDomain: (id: string, patch: Partial<Domain>) => void;
  deleteDomain: (id: string) => void;

  // initiatives
  addInitiative: (domainId: string) => Initiative;
  updateInitiative: (id: string, patch: Partial<Initiative>) => void;
  deleteInitiative: (id: string) => void;
  reparentInitiative: (id: string, domainId: string) => void;

  // key results
  addKeyResult: (initiativeId: string) => void;
  updateKeyResult: (initiativeId: string, krId: string, patch: Partial<KeyResult>) => void;
  deleteKeyResult: (initiativeId: string, krId: string) => void;

  // projects
  addProject: (domainId: string, initiativeId: string | null) => Project;
  updateProject: (id: string, patch: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  reparentProject: (id: string, initiativeId: string | null) => void;

  // tasks
  addTask: (t: VTask) => void;
  updateTask: (id: string, patch: Partial<VTask>) => void;
  deleteTask: (id: string) => void;
  toggleTask: (id: string) => void;

  // sprint funnel
  toggleTaskSprint: (id: string) => void;
  addProjectReadyToSprint: (projectId: string) => void;
  clearSprint: () => void;
  setSprintGoal: (goal: string) => void;

  resetToSeed: () => void;
}

const Ctx = createContext<VerticalStore | null>(null);

export function VerticalProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<VerticalData>(load);

  // every mutation funnels through here so persistence is automatic
  const commit = useCallback((fn: (d: VerticalData) => VerticalData) => {
    setData((prev) => {
      const next = fn(prev);
      save(next);
      return next;
    });
  }, []);

  const store = useMemo<VerticalStore>(() => {
    const findInit = (d: VerticalData, id: string) => d.initiatives.find((i) => i.id === id);

    return {
      data,

      // ── domains ──────────────────────────────────────────────────────────
      addDomain: () => {
        const dom = emptyDomain(data.domains.length);
        commit((d) => ({ ...d, domains: [...d.domains, dom] }));
        return dom;
      },
      updateDomain: (id, patch) =>
        commit((d) => ({
          ...d,
          domains: d.domains.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        })),
      deleteDomain: (id) =>
        commit((d) => {
          // orphan, don't cascade-destroy: detach children so nothing is lost
          const initIds = d.initiatives.filter((i) => i.domainId === id).map((i) => i.id);
          return {
            ...d,
            domains: d.domains.filter((x) => x.id !== id),
            initiatives: d.initiatives.filter((i) => i.domainId !== id),
            projects: d.projects.filter((p) => p.domainId !== id),
            tasks: d.tasks.filter((t) => t.domainId !== id && !(t.initiativeId && initIds.includes(t.initiativeId))),
          };
        }),

      // ── initiatives ──────────────────────────────────────────────────────
      addInitiative: (domainId) => {
        const init = emptyInitiative(domainId);
        commit((d) => ({ ...d, initiatives: [...d.initiatives, init] }));
        return init;
      },
      updateInitiative: (id, patch) =>
        commit((d) => ({
          ...d,
          initiatives: d.initiatives.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        })),
      deleteInitiative: (id) =>
        commit((d) => ({
          ...d,
          initiatives: d.initiatives.filter((x) => x.id !== id),
          // detach projects up to the domain rather than destroying them
          projects: d.projects.map((p) => (p.initiativeId === id ? { ...p, initiativeId: null } : p)),
          tasks: d.tasks.map((t) => (t.initiativeId === id ? { ...t, initiativeId: null } : t)),
        })),
      reparentInitiative: (id, domainId) =>
        commit((d) => ({
          ...d,
          initiatives: d.initiatives.map((x) => (x.id === id ? { ...x, domainId } : x)),
        })),

      // ── key results ──────────────────────────────────────────────────────
      addKeyResult: (initiativeId) =>
        commit((d) => ({
          ...d,
          initiatives: d.initiatives.map((i) =>
            i.id === initiativeId ? { ...i, keyResults: [...i.keyResults, emptyKeyResult()] } : i,
          ),
        })),
      updateKeyResult: (initiativeId, krId, patch) =>
        commit((d) => ({
          ...d,
          initiatives: d.initiatives.map((i) =>
            i.id === initiativeId
              ? { ...i, keyResults: i.keyResults.map((k) => (k.id === krId ? { ...k, ...patch } : k)) }
              : i,
          ),
        })),
      deleteKeyResult: (initiativeId, krId) =>
        commit((d) => ({
          ...d,
          initiatives: d.initiatives.map((i) =>
            i.id === initiativeId ? { ...i, keyResults: i.keyResults.filter((k) => k.id !== krId) } : i,
          ),
        })),

      // ── projects ─────────────────────────────────────────────────────────
      addProject: (domainId, initiativeId) => {
        const proj = emptyProject(domainId, initiativeId);
        commit((d) => ({ ...d, projects: [...d.projects, proj] }));
        return proj;
      },
      updateProject: (id, patch) =>
        commit((d) => ({
          ...d,
          projects: d.projects.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        })),
      deleteProject: (id) =>
        commit((d) => ({
          ...d,
          projects: d.projects.filter((x) => x.id !== id),
          // tasks lose their project but keep their initiative/domain anchor
          tasks: d.tasks.map((t) => (t.projectId === id ? { ...t, projectId: null, loose: true } : t)),
        })),
      reparentProject: (id, initiativeId) =>
        commit((d) => {
          const init = initiativeId ? findInit(d, initiativeId) : null;
          return {
            ...d,
            projects: d.projects.map((p) =>
              p.id === id
                ? { ...p, initiativeId, domainId: init?.domainId ?? p.domainId }
                : p,
            ),
          };
        }),

      // ── tasks ────────────────────────────────────────────────────────────
      addTask: (t) => commit((d) => ({ ...d, tasks: [...d.tasks, t] })),
      updateTask: (id, patch) =>
        commit((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
      deleteTask: (id) => commit((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id) })),
      toggleTask: (id) =>
        commit((d) => ({
          ...d,
          tasks: d.tasks.map((t) =>
            t.id === id ? { ...t, status: t.status === "done" ? "ready" : "done" } : t,
          ),
        })),

      // ── sprint funnel ────────────────────────────────────────────────────
      toggleTaskSprint: (id) =>
        commit((d) => ({
          ...d,
          tasks: d.tasks.map((t) => (t.id === id ? { ...t, sprint: !t.sprint } : t)),
        })),
      addProjectReadyToSprint: (projectId) =>
        commit((d) => ({
          ...d,
          tasks: d.tasks.map((t) =>
            t.projectId === projectId && t.status !== "done" ? { ...t, sprint: true } : t,
          ),
        })),
      clearSprint: () =>
        commit((d) => ({ ...d, tasks: d.tasks.map((t) => (t.sprint ? { ...t, sprint: false } : t)) })),
      setSprintGoal: (goal) => commit((d) => ({ ...d, sprintGoal: goal })),

      resetToSeed: () => commit(() => structuredClone(SEED)),
    };
  }, [data, commit]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useVertical(): VerticalStore {
  const v = useContext(Ctx);
  if (!v) throw new Error("useVertical must be used within <VerticalProvider>");
  return v;
}
