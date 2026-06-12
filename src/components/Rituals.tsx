import { useMemo, useState } from "react";
import type { Task } from "../lib/types";
import type { useTaskMutations } from "../hooks/useTasks";
import { useVertical } from "../hooks/useVertical";
import { fmtDuration, nextWeekISO, todayISO, tomorrowISO } from "../lib/dates";
import { Btn, Modal } from "./ui";

type Mutations = ReturnType<typeof useTaskMutations>;

/** Morning plan (Sunrise): assemble today FROM the week, then inbox to zero,
 *  then go drag blocks. The day is built out of what Sunday committed. */
export function MorningPlan({
  inbox,
  weekPool,
  prepared,
  todayCount,
  mutations,
  onClose,
}: {
  inbox: Task[];
  /** Committed-this-week tasks not yet placed on a day. */
  weekPool: Task[];
  /** Open tasks the assistant prepared overnight (prework waiting). */
  prepared: Task[];
  todayCount: number;
  mutations: Mutations;
  onClose: () => void;
}) {
  // Snapshot the starting count so "Inbox 7 → 0" stays stable while we work.
  const [startCount] = useState(inbox.length);
  const current = inbox[0] ?? null;
  const [datePick, setDatePick] = useState(false);
  const [pulled, setPulled] = useState<Set<string>>(new Set());

  return (
    <Modal onClose={onClose} width="max-w-md">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="text-[14px] font-semibold">Morning plan</div>
        <div className="mono text-[12px] text-muted">
          Inbox {startCount} → {inbox.length}
        </div>
      </div>

      {/* what came back prepared — the lowest-friction starts of the day */}
      {prepared.length > 0 && (
        <div className="border-b border-line px-4 py-2.5">
          <div className="text-[11px]" style={{ color: "var(--accent)" }}>
            ✦ {prepared.length} task{prepared.length === 1 ? "" : "s"} came back prepared:
          </div>
          <div className="mono mt-0.5 truncate text-[11px] text-muted">
            {prepared.map((t) => t.title).join(" · ")}
          </div>
        </div>
      )}

      {/* the week pool first — you already decided this matters */}
      {weekPool.length > 0 && (
        <div className="border-b border-line p-4">
          <div className="mb-1.5 text-[11px] text-muted">
            From your week — {weekPool.length} committed, not yet placed. Pull today's:
          </div>
          <div className="max-h-[30vh] space-y-1 overflow-y-auto">
            {weekPool.map((t) => {
              const isPulled = pulled.has(t.id);
              return (
                <div key={t.id} className="flex items-center gap-2 text-[13px]">
                  <button
                    onClick={() => {
                      if (isPulled) return;
                      mutations.planFor(t, todayISO());
                      setPulled((p) => new Set(p).add(t.id));
                    }}
                    className={`fast mono shrink-0 border px-1.5 py-0.5 text-[10px] ${
                      isPulled
                        ? "border-accent text-accent"
                        : "border-line text-muted hover:border-accent hover:text-accent"
                    }`}
                  >
                    {isPulled ? "✓ today" : "▸ today"}
                  </button>
                  <span className={`min-w-0 flex-1 truncate ${isPulled ? "text-muted" : ""}`}>{t.title}</span>
                  <span className="mono shrink-0 text-[10px] text-muted">{fmtDuration(t.duration_minutes)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {current ? (
        <div className="p-4">
          <div className="mb-1 text-[11px] text-muted">Inbox — decide, one at a time:</div>
          <div className="mb-4 border border-line bg-bg px-3 py-2.5 text-[14px] font-medium">
            {current.title}
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn kind="primary" onClick={() => mutations.planFor(current, todayISO())}>
              Today
            </Btn>
            <Btn onClick={() => mutations.planFor(current, tomorrowISO())}>Tomorrow</Btn>
            <Btn onClick={() => mutations.planFor(current, nextWeekISO())}>Next week</Btn>
            <Btn onClick={() => setDatePick(!datePick)}>Pick date…</Btn>
            <Btn kind="signal" onClick={() => mutations.trash(current)}>
              Trash
            </Btn>
          </div>
          {datePick && (
            <input
              type="date"
              className="mono mt-3 border border-line bg-bg px-2 py-1 text-[12px]"
              onChange={(e) => {
                if (e.target.value) {
                  mutations.planFor(current, e.target.value);
                  setDatePick(false);
                }
              }}
            />
          )}
        </div>
      ) : (
        <div className="p-4">
          <div className="mb-2 text-[14px] font-medium">Inbox zero.</div>
          <div className="mb-4 text-[13px] text-muted">
            {todayCount} task{todayCount === 1 ? "" : "s"} on Today. Drag them onto the calendar to
            block time.
          </div>
          <Btn kind="primary" onClick={onClose}>
            Go plan the day
          </Btn>
        </div>
      )}
    </Modal>
  );
}

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
        <div className="text-[14px] font-semibold">Evening shutdown</div>
        <div className="mono text-[12px] text-muted">{remaining.length} open</div>
      </div>

      {/* the gain, before the gap */}
      <div className="border-b border-line px-4 py-3">
        {gain.count > 0 ? (
          <>
            <div className="text-[13px] font-medium">
              Today's gain: {gain.count} done · {fmtDuration(gain.mins)} logged.
            </div>
            {gain.byColor.length > 0 && gain.mins > 0 && (
              <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-bg">
                {gain.byColor.map(([color, mins]) => (
                  <div key={color} style={{ width: `${(mins / gain.mins) * 100}%`, background: color }} />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="text-[12px] text-muted">Nothing checked off today — tomorrow is a fresh pull.</div>
        )}
      </div>

      <div className="max-h-[55vh] overflow-y-auto p-3">
        {remaining.length === 0 && (
          <div className="px-1 py-4 text-center text-[13px] text-muted">
            Clean slate. See you tomorrow.
          </div>
        )}
        {remaining.map((t) => (
          <div key={t.id} className="flex items-center gap-2 border-b border-line px-1 py-2">
            <span className="min-w-0 flex-1 truncate text-[13px]">{t.title}</span>
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
              className="mono w-[120px] border border-line bg-bg px-1 py-1 text-[11px]"
              onChange={(e) => e.target.value && mutations.planFor(t, e.target.value)}
            />
            <Btn kind="signal" onClick={() => mutations.trash(t)}>
              Trash
            </Btn>
          </div>
        ))}
      </div>
      <div className="border-t border-line p-3 text-[11px] text-muted">
        ↩ week keeps the commitment without a date. Anything left rolls to tomorrow at midnight (↻ badge).
      </div>
    </Modal>
  );
}
