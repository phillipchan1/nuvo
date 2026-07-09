import { useMemo } from "react";
import type { Task } from "../lib/types";
import type { useTaskMutations } from "../hooks/useTasks";
import { useVertical } from "../hooks/useVertical";
import { fmtDuration, tomorrowISO } from "../lib/dates";
import { Btn, Modal } from "./ui";

type Mutations = ReturnType<typeof useTaskMutations>;

/** Evening shutdown (Sundown): the gain first, then triage the leftovers.
 *  Rollover runs regardless. */
export function EveningShutdown({
  todayTasks,
  taskAccent,
  mutations,
  onClose,
}: {
  todayTasks: Task[];
  taskAccent: (t: Task) => string | null;
  mutations: Mutations;
  onClose: () => void;
}) {
  const { data: vertical } = useVertical();
  const remaining = useMemo(
    () => todayTasks.filter((t) => t.status !== "done"),
    [todayTasks],
  );

  // today's gain, measured: blocks completed, hours logged, split by domain
  const gain = useMemo(() => {
    const done = todayTasks.filter((t) => t.status === "done");
    const mins = done.reduce((s, t) => s + (t.duration_minutes ?? 30), 0);
    const byColor = new Map<string, number>();
    for (const t of done) {
      const c = taskAccent(t) ?? "var(--muted)";
      byColor.set(c, (byColor.get(c) ?? 0) + (t.duration_minutes ?? 30));
    }
    return { count: done.length, mins, byColor: [...byColor.entries()] };
  }, [todayTasks, taskAccent]);

  return (
    <Modal onClose={onClose} width="max-w-md">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="text-lead masthead">Evening shutdown</div>
        <div className="flex items-center gap-2.5">
          {remaining.length > 0 && (
            <button
              onClick={() => remaining.forEach((t) => mutations.planFor(t, tomorrowISO()))}
              className="fast mono text-meta text-muted hover:text-accent"
              title="Send everything still open to tomorrow"
            >
              roll all → tomorrow
            </button>
          )}
          <span className="mono text-caption text-muted">{remaining.length} open</span>
        </div>
      </div>

      {/* the gain, before the gap */}
      <div className="border-b border-line px-4 py-3">
        {gain.count > 0 ? (
          <>
            <div className="text-body font-medium">
              Today's gain: {gain.count} done · {fmtDuration(gain.mins)} logged.
            </div>
            {gain.byColor.length > 0 && gain.mins > 0 && (
              <div className="grow-x mt-2 flex h-2 overflow-hidden rounded-full bg-bg">
                {gain.byColor.map(([color, mins]) => (
                  <div key={color} style={{ width: `${(mins / gain.mins) * 100}%`, background: color }} />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="text-caption text-muted">Nothing checked off today — tomorrow is a fresh pull.</div>
        )}
      </div>

      <div className="max-h-[55vh] overflow-y-auto p-3">
        {remaining.length === 0 && (
          <div className="px-1 py-4 text-center text-body text-muted">
            Clean slate. See you tomorrow.
          </div>
        )}
        {remaining.map((t) => (
          <div key={t.id} className="flex items-center gap-2 border-b border-line px-1 py-2">
            <span className="min-w-0 flex-1 truncate text-body">{t.title}</span>
            <Btn onClick={() => mutations.complete(t)}>Done</Btn>
            <Btn onClick={() => mutations.planFor(t, tomorrowISO())}>Tomorrow</Btn>
            {/* only for THIS week's commitments — a stale sprint_id must not
                offer a pool the rail no longer shows */}
            {t.sprint_id && t.sprint_id === vertical.sprint?.id && (
              <Btn onClick={() => mutations.backToWeek(t)} title="Drop the date, keep the week commitment">
                ↩ week
              </Btn>
            )}
            <input
              type="date"
              title="Reschedule"
              className="mono w-[120px] border border-line bg-bg px-1 py-1 text-label"
              onChange={(e) => e.target.value && mutations.planFor(t, e.target.value)}
            />
            <Btn kind="signal" onClick={() => mutations.trash(t)}>
              Trash
            </Btn>
          </div>
        ))}
      </div>
      <div className="border-t border-line p-3 text-label text-muted">
        ↩ week keeps the commitment without a date. Anything left rolls to tomorrow at midnight (↻ badge).
      </div>
    </Modal>
  );
}
