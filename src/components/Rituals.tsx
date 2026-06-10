import { useMemo, useState } from "react";
import type { Task } from "../lib/types";
import type { useTaskMutations } from "../hooks/useTasks";
import { nextWeekISO, todayISO, tomorrowISO } from "../lib/dates";
import { Btn, Modal } from "./ui";

type Mutations = ReturnType<typeof useTaskMutations>;

/** Morning plan: step the inbox to zero, then go drag blocks. */
export function MorningPlan({
  inbox,
  todayCount,
  mutations,
  onClose,
}: {
  inbox: Task[];
  todayCount: number;
  mutations: Mutations;
  onClose: () => void;
}) {
  // Snapshot the starting count so "Inbox 7 → 0" stays stable while we work.
  const [startCount] = useState(inbox.length);
  const current = inbox[0] ?? null;
  const [datePick, setDatePick] = useState(false);

  return (
    <Modal onClose={onClose} width="max-w-md">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="text-[14px] font-semibold">Morning plan</div>
        <div className="mono text-[12px] text-muted">
          Inbox {startCount} → {inbox.length}
        </div>
      </div>

      {current ? (
        <div className="p-4">
          <div className="mb-1 text-[11px] text-muted">Decide, one at a time:</div>
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

/** Evening shutdown: triage today's leftovers. Rollover runs regardless. */
export function EveningShutdown({
  todayTasks,
  mutations,
  onClose,
}: {
  todayTasks: Task[];
  mutations: Mutations;
  onClose: () => void;
}) {
  const remaining = useMemo(
    () => todayTasks.filter((t) => t.status !== "done"),
    [todayTasks],
  );

  return (
    <Modal onClose={onClose} width="max-w-md">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="text-[14px] font-semibold">Evening shutdown</div>
        <div className="mono text-[12px] text-muted">{remaining.length} open</div>
      </div>
      <div className="max-h-[60vh] overflow-y-auto p-3">
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
        Anything left rolls to tomorrow automatically at midnight (and gets a ↻ badge).
      </div>
    </Modal>
  );
}
