// @vitest-environment jsdom
/**
 * A calendar write costs one small render, not the whole app.
 *
 * Measured on the local dummy account before this was fixed, checking one block
 * off took 18 React commits and 835 component renders: the shell re-rendered
 * eleven times — five for the outbox status ticking pending → syncing → idle
 * under a hook that only wanted the parked count, once more per hook of the
 * shell that read every task, once per vertical rebuild — and every one of them
 * re-rendered every screen below it, the hidden floors included. After: 5
 * commits, 70 renders, none of them above the Planner.
 *
 * None of that is visible in a screenshot or a typecheck, and each piece
 * reverts with one innocent edit (a `useVertical()` added to the shell for one
 * field, a mutation bag returned bare). So the mechanisms are driven here and
 * the wiring is read from source. `npm run perf` measures the result.
 */
import { act, render, renderHook } from "@testing-library/react";
import { memo, useState, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useStableActions } from "../src/hooks/useStableActions";
import {
  VerticalFreeze,
  VerticalStoreProvider,
  useVertical,
  useVerticalActions,
  useVerticalDirectory,
  useVerticalSelector,
  type VerticalStore,
} from "../src/hooks/useVertical";
import { gridLookups, sameDirectory } from "../src/lib/verticalDirectory";
import type { VerticalData } from "../src/lib/vertical";

const SRC = join(__dirname, "..", "src");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

function data(over: Partial<VerticalData> = {}): VerticalData {
  return {
    domains: [{ id: "d1", name: "Work", color: "#111" }],
    initiatives: [{ id: "i1", name: "Ship", domainId: "d1", status: "active" }],
    projects: [{ id: "p1", name: "Billing", domainId: "d1", initiativeId: "i1", status: "active", progress: 0 }],
    tasks: [],
    sprint: null,
    focusInitiativeIds: [],
    bigRocks: [],
    lastActivityByProject: {},
    ...over,
  } as unknown as VerticalData;
}

function storeOf(d: VerticalData, act: () => void = () => {}): VerticalStore {
  return { data: d, ready: true, toggleTask: act } as unknown as VerticalStore;
}

/** Renders `children` once and lets the test swap the store underneath. */
function Harness({ initial, children }: { initial: VerticalStore; children: ReactNode }) {
  const [store, setStore] = useState(initial);
  swap = setStore;
  return <VerticalStoreProvider value={store}>{children}</VerticalStoreProvider>;
}
let swap: (s: VerticalStore) => void = () => {};

describe("useStableActions", () => {
  it("keeps one identity and always calls the latest render's action", () => {
    const { result, rerender } = renderHook(({ n }) => useStableActions({ get: () => n }), {
      initialProps: { n: 1 },
    });
    const first = result.current;
    rerender({ n: 2 });
    expect(result.current).toBe(first);
    expect(first.get()).toBe(2);
  });
});

describe("the vertical store's three faces", () => {
  it("a slice reader renders only when its slice moves", () => {
    let renders = 0;
    const Names = memo(function Names() {
      renders++;
      const name = useVerticalSelector((s) => s.data.projects[0]?.name ?? null);
      return <span>{name}</span>;
    });
    const view = render(
      <Harness initial={storeOf(data())}>
        <Names />
      </Harness>,
    );
    expect(renders).toBe(1);

    // A task write: a new snapshot, the same name.
    act(() => swap(storeOf(data({ tasks: [{ id: "t1" }] as unknown as VerticalData["tasks"] }))));
    expect(renders).toBe(1);

    act(() => swap(storeOf(data({ projects: [{ id: "p1", name: "Billing v2", domainId: "d1" }] as unknown as VerticalData["projects"] }))));
    expect(renders).toBe(2);
    expect(view.container.textContent).toBe("Billing v2");
  });

  it("actions keep their identity across a new snapshot, and getData reads the newest", () => {
    const seen: ReturnType<typeof useVerticalActions>[] = [];
    const Probe = memo(function Probe() {
      seen.push(useVerticalActions());
      return null;
    });
    render(
      <Harness initial={storeOf(data())}>
        <Probe />
      </Harness>,
    );
    const next = data({ tasks: [{ id: "t9" }] as unknown as VerticalData["tasks"] });
    act(() => swap(storeOf(next)));
    expect(seen).toHaveLength(1);
    expect(seen[0].getData()).toBe(next);
  });

  it("a frozen subtree holds its snapshot and catches up when it thaws", () => {
    let renders = 0;
    const Floor = memo(function Floor() {
      renders++;
      const { data: d } = useVertical();
      return <span>{d.tasks.length}</span>;
    });
    let thaw: (v: boolean) => void = () => {};
    function Frozen({ children }: { children: ReactNode }) {
      const [frozen, setFrozen] = useState(true);
      thaw = (v) => setFrozen(!v);
      return <VerticalFreeze frozen={frozen}>{children}</VerticalFreeze>;
    }
    const view = render(
      <Harness initial={storeOf(data())}>
        <Frozen>
          <Floor />
        </Frozen>
      </Harness>,
    );
    expect(renders).toBe(1);
    act(() => swap(storeOf(data({ tasks: [{ id: "a" }, { id: "b" }] as unknown as VerticalData["tasks"] }))));
    expect(renders).toBe(1);
    expect(view.container.textContent).toBe("0");

    act(() => thaw(true));
    expect(view.container.textContent).toBe("2");
  });

  it("the directory ignores task writes and follows a rename", () => {
    const a = data();
    const b = data({ tasks: [{ id: "x" }] as unknown as VerticalData["tasks"] });
    const c = data({ domains: [{ id: "d1", name: "Work", color: "#222" }] as unknown as VerticalData["domains"] });
    expect(sameDirectory(a, b)).toBe(true);
    expect(sameDirectory(a, c)).toBe(false);

    let renders = 0;
    const Grid = memo(function Grid() {
      renders++;
      useVerticalDirectory();
      return null;
    });
    render(
      <Harness initial={storeOf(a)}>
        <Grid />
      </Harness>,
    );
    act(() => swap(storeOf(b)));
    expect(renders).toBe(1);
    act(() => swap(storeOf(c)));
    expect(renders).toBe(2);
  });

  it("grid lookups resolve a parented task through its project, not its stale copy", () => {
    const g = gridLookups(data());
    // The row's own domain_id is the stale denormalized copy (D-088).
    expect(g.taskColor({ domain_id: "gone", project_id: "p1", initiative_id: null })).toBe("#111");
    expect(g.taskProject({ project_id: "p1" })).toBe("Billing");
    expect(g.slotProject({ project_id: "p1" })).toEqual({ name: "Billing", color: "#111" });
    expect(g.taskColor({ domain_id: null, project_id: null, initiative_id: null })).toBeNull();
  });
});

/** The body of a top-level component, from its declaration to the next one. */
function bodyOf(src: string, name: string): string {
  const start = src.search(new RegExp(`(function|const) ${name}\\b`));
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const rest = src.slice(start + 1);
  const next = rest.search(/\n(export )?(default )?(function|const) [A-Z]\w* ?[=(]/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("the shell does not subscribe to what a write changes", () => {
  const SHELL = read("components/AppShell.tsx");

  it("ResponsiveShell and AppShellInner read the vertical as a slice or as actions", () => {
    for (const name of ["ResponsiveShell", "AppShellInner"]) {
      expect(bodyOf(SHELL, name), `${name} must not call useVertical() — it re-renders the app on every write`).not.toMatch(/useVertical\(\)/);
    }
  });

  it("the shell's background hooks live in a leaf, not in the shell", () => {
    const shell = bodyOf(SHELL, "ResponsiveShell");
    for (const hook of ["useReminderDelivery", "useParkedAlert", "useEventRouter", "useOutbox"]) {
      expect(shell, `${hook} in ResponsiveShell re-renders every screen when it changes`).not.toContain(`${hook}(`);
    }
    expect(bodyOf(SHELL, "ShellEffects")).toMatch(/\n  return null;\n}\n/);
  });

  it("AppShell and AppShellInner are memo'd, so the shell above them can't cascade", () => {
    expect(SHELL).toMatch(/const AppShell = memo\(function AppShell\(/);
    expect(SHELL).toMatch(/const AppShellInner = memo\(function AppShellInner\(/);
  });

  it("the parked alert subscribes to the parked count alone", () => {
    expect(bodyOf(read("components/SyncPanel.tsx"), "useParkedAlert")).toContain("useOutboxParked()");
  });

  it("a session re-read that changes nothing keeps the session's identity", () => {
    const auth = read("hooks/useAuth.ts");
    expect(auth).toMatch(/setSession\(\(prev\) => \(sameSession\(prev, next\) \? prev : next\)\)/);
    // The auth lock's own key ends in `-auth-token` too; matching it re-hydrated
    // every other tab on every write.
    expect(auth).toMatch(/const onStorage = \(e: StorageEvent\) => \{\s*if \(e\.key !== sessionKey\) return;/);
  });
});

describe("the Planner hands the rail and the grid stable props", () => {
  const PLANNER = read("components/Planner.tsx");

  /** A JSX element's attribute block. */
  function propsOf(tag: string): string {
    const start = PLANNER.indexOf(`<${tag}\n`);
    expect(start, `<${tag}> not found`).toBeGreaterThan(-1);
    return PLANNER.slice(start, PLANNER.indexOf("/>", start));
  }

  it("no inline arrow or object literal reaches <LeftRail> or <CalendarPane>", () => {
    for (const tag of ["LeftRail", "CalendarPane"]) {
      const attrs = propsOf(tag);
      const inline = [...attrs.matchAll(/\s(\w+)=\{\s*(\(|\{|async\s*\()/g)].map((m) => m[1]);
      expect(inline, `<${tag}> props built inline re-render it on every Planner render`).toEqual([]);
    }
  });

  it("the mutation bags are stable", () => {
    expect(read("hooks/useTasks.ts")).toMatch(/export function useTaskMutations[\s\S]*?return useStableActions\(\{/);
    expect(read("hooks/useSlots.ts")).toMatch(/return useStableActions\(\{ createSlot/);
    expect(read("hooks/useCalendar.ts")).toMatch(/export function useExternalEventMutations[\s\S]*?return useStableActions\(\{/);
    expect(read("hooks/useRecurrence.ts")).toMatch(/return useMemo\(\s*\(\) => \(\{\s*materializeSeries/);
  });

  it("the rail labels its rows from the directory, so a write elsewhere doesn't redraw it", () => {
    expect(read("components/LeftRail.tsx")).not.toMatch(/useVertical\(\)/);
    expect(read("hooks/useTaskFilter.ts")).not.toMatch(/useVertical\(\)/);
  });

  it("the grid's colours and names come from the directory, not the whole vertical", () => {
    expect(PLANNER).toMatch(/const grid = useMemo\(\(\) => gridLookups\(directory\), \[directory\]\)/);
    expect(PLANNER).not.toMatch(/\[[^\]]*\bvertical\b[^\]]*\]\s*,?\s*\)/);
  });
});

describe("cache notifications reach React on a microtask", () => {
  // A/B'd with the rig: on setTimeout(0) a write took two more commits, and one
  // of them re-ran the grid reconcile.
  it("App sets the TanStack scheduler before the client exists", () => {
    const app = read("App.tsx");
    const at = app.indexOf("notifyManager.setScheduler(queueMicrotask)");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(app.indexOf("const queryClient = new QueryClient("));
  });
});

describe("the Year, kept mounted under the grid, sits out writes", () => {
  it("is memo'd and handed stable props", () => {
    expect(read("components/CalendarYear.tsx")).toMatch(/export default memo\(function CalendarYear\(/);
    const pane = read("components/CalendarPane.tsx");
    const year = pane.slice(pane.indexOf("<CalendarYear"), pane.indexOf("/>", pane.indexOf("<CalendarYear")));
    expect(year).not.toMatch(/=\{\s*\(/);
    expect(year).not.toMatch(/now=\{now\}/);
  });
});

describe("the grid's blocks don't rebuild on the clock", () => {
  it("fcEvents depends on the overdue set, not on the 30s tick", () => {
    const pane = read("components/CalendarPane.tsx");
    const start = pane.indexOf("const fcEvents = useMemo(");
    const end = pane.indexOf("]);", start);
    const deps = pane.slice(pane.lastIndexOf("[", end), end + 1);
    expect(deps).toContain("overdueIds");
    expect(deps).not.toMatch(/\b(fcNow|now)\b/);
  });
});
