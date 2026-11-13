import { useMemo } from "react";
import type { Task } from "../lib/types";
import type { useTaskMutations } from "../hooks/useTasks";
import { useVertical } from "../hooks/useVertical";
import { fmtDuration, tomorrowISO } from "../lib/dates";
import { Button, Dialog, EmptyState, IconButton, Input } from "./kit";
import { Icon } from "./Icon";
import { FlowMeter } from "./rituals/FlowShell";

type Mutations = ReturnType<typeof useTaskMutations>;

/** Evening shutdown (Sundown): the gain first, then triage the leftovers.
 *  Rollover runs regardless. A kit Dialog (D-190) — a bottom Sheet on a phone. */
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
    <Dialog
      title="Evening shutdown"
      onClose={onClose}
      width={520}
      footer={
        <>
          <span className="f-sum">Anything left rolls to tomorrow at midnight.</span>
          {remaining.length > 0 && (
            <Button
              onClick={() => remaining.forEach((t) => mutations.planFor(t, tomorrowISO()))}
              title="Send everything still open to tomorrow"
              icon={<Icon name="arrow-right" size={14} />}
            >
              Roll all to tomorrow
            </Button>
          )}
        </>
      }
    >
      {/* the gain, before the gap */}
      <div className="grid gap-2 pb-4">
        <div className="f-fact">
          {gain.count > 0 ? (
            <>
              <b>{gain.count}</b> done · <b>{fmtDuration(gain.mins)}</b> logged · <b>{remaining.length}</b> open
            </>
          ) : (
            <>
              Nothing checked off today · <b>{remaining.length}</b> open
            </>
          )}
        </div>
        {gain.byColor.length > 0 && gain.mins > 0 && (
          <FlowMeter
            total={gain.mins}
            segments={gain.byColor.map(([color, mins]) => ({ key: color, value: mins, color }))}
            label={`${gain.count} done, ${fmtDuration(gain.mins)} logged`}
          />
        )}
      </div>

      <div className="max-h-[55vh] overflow-y-auto" style={{ boxShadow: "inset 0 1px 0 var(--line-1)" }}>
        {remaining.length === 0 && <EmptyState icon={<Icon name="check" size={20} />}>Clean slate</EmptyState>}
        {remaining.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-1.5 py-2" style={{ boxShadow: "inset 0 -1px 0 var(--line-1)" }}>
            <span className="min-w-[140px] flex-1 truncate text-body">{t.title}</span>
            <Button size="xs" icon={<Icon name="check" size={12} />} onClick={() => mutations.complete(t)}>
              Done
            </Button>
            <Button size="xs" onClick={() => mutations.planFor(t, tomorrowISO())}>
              Tomorrow
            </Button>
            {/* only for THIS week's commitments — a stale sprint_id must not
                offer a pool the rail no longer shows */}
            {t.sprint_id && t.sprint_id === vertical.sprint?.id && (
              <Button size="xs" kind="ghost" onClick={() => mutations.backToWeek(t)} title="Drop the date, keep the week commitment">
                ↩ Week
              </Button>
            )}
            <Input
              type="date"
              size="sm"
              title="Reschedule"
              aria-label={`Reschedule ${t.title}`}
              frameClassName="w-[136px]"
              onChange={(e) => e.target.value && mutations.planFor(t, e.target.value)}
            />
            <IconButton size="xs" label="Trash" icon={<Icon name="trash" size={12} />} className="f-danger" onClick={() => mutations.trash(t)} />
          </div>
        ))}
      </div>
    </Dialog>
  );
}
