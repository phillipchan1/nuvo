// `?rail=plan` — Plan the week's rail over seeded work, no account, no network.
// Two runs of loose work (calls, replies) and a few strays, so the group's
// per-task acts (tick · open · Move…) can be driven at the rail's real width
// (D-253). Mounted by RailHarness; it brings its own providers.

import { Suspense, lazy, useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { VerticalStoreProvider, type VerticalStore } from "../../hooks/useVertical";
import { AppNavigationProvider } from "../../hooks/useAppNavigation";
import type { Sprint, Task } from "../../lib/types";
import type { VTask, VerticalData } from "../../lib/vertical";
import { planningWeekStartISO } from "../../lib/dates";

const PlanRail = lazy(() => import("./PlanRail"));

const WEEK = planningWeekStartISO();
const TITLES: [string, number][] = [
  ["Call Sam about the quote", 15],
  ["Call Ann about the lease", 30],
  ["Call the dentist to move Thursday", 15],
  ["Reply to Bo about the invoice", 15],
  ["Reply to Cy — Friday still on?", 15],
  ["Renew car registration", 30],
  ["Mail Tech CU solar reply packet", 30],
];

const rows: Task[] = TITLES.map(
  ([title, mins], i) =>
    ({
      id: `h${i}`, title, status: "ready", project_id: null, initiative_id: null, domain_id: null, do_date: null, start_time: null,
      sprint_id: "sp", slot_id: null, recurrence_id: null, duration_minutes: mins, deadline: null, sort_order: i, completed_at: null, energy: null,
    }) as unknown as Task,
);
const vtasks = rows.map(
  (t) =>
    ({ id: t.id, title: t.title, projectId: null, durationMins: t.duration_minutes, status: "ready", sprint: true, initiativeId: null, domainId: null, keyResultId: null, bigRockId: null, energy: null, deadlineDaysAway: null, doDate: null }) as unknown as VTask,
);
const data = {
  domains: [], initiatives: [], projects: [], tasks: vtasks,
  sprint: { id: "sp", week_start: WEEK, reviewed_at: null, big_rocks: [] } as unknown as Sprint,
  focusInitiativeIds: [], bigRocks: [], lastActivityByProject: {},
} as unknown as VerticalData;

export default function PlanRailHarness() {
  const qc = useMemo(() => {
    const c = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false } } });
    c.setQueryData(["tasks", "all"], rows);
    c.setQueryData(["settings"], { user_id: "harness", theme: "light", work_start_minutes: 480, work_end_minutes: 990 });
    return c;
  }, []);
  // Anything the draft writes goes nowhere: a harness is looking, not editing.
  const store = useMemo(() => new Proxy({ data, ready: true, togglePushLanded: () => {} } as Record<string, unknown>, { get: (t, k) => (k in t ? t[k as string] : async () => {}) }) as unknown as VerticalStore, []);
  return (
    <QueryClientProvider client={qc}>
      <VerticalStoreProvider value={store}>
        <AppNavigationProvider>
          <div className="flex h-screen bg-[var(--ground)]">
            <div className="app-panel flex h-full w-[360px] flex-col overflow-hidden">
              <Suspense fallback={null}>
                <PlanRail onOverlay={() => {}} onClose={() => {}} onOpenTask={(t) => console.log("open", t.title)} />
              </Suspense>
            </div>
          </div>
        </AppNavigationProvider>
      </VerticalStoreProvider>
    </QueryClientProvider>
  );
}
