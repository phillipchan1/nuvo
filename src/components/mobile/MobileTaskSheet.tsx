import { useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import type { Label, Task } from "../../lib/types";
import type { useTaskMutations } from "../../hooks/useTasks";
import { todayISO, tomorrowISO, nextWeekISO, fmtDuration, parseDateISO } from "../../lib/dates";
import { fmtSlot } from "../../lib/compose";
import { useFindTime } from "../../hooks/useFindTime";
import type { FindTimeResult } from "../../lib/findTime";
import Sheet from "./Sheet";

type Mutations = ReturnType<typeof useTaskMutations>;

// "Find time this week" reuses the Sunday compose engine to fit one midweek
// task into a real slot. Shown for any unscheduled, not-done task.

// Tapping a task on a list opens this — the mobile stand-in for the desktop's
// anchored task popover. The handful of actions a thumb actually needs: rename,
// reschedule, set priority, label, complete, trash.
export default function MobileTaskSheet({
  task,
  labels,
  mutations,
  accent,
  onClose,
}: {
  task: Task;
  labels: Label[];
  mutations: Mutations;
  accent?: string | null;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const done = task.status === "done";
  const currentLabels = new Set((task.task_labels ?? []).map((tl) => tl.label_id));
  const [showDatePick, setShowDatePick] = useState(false);

  const commitTitle = () => {
    const next = title.trim();
    if (next && next !== task.title) mutations.patchTask(task.id, { title: next });
  };

  const planChips: { label: string; run: () => void; active?: boolean }[] = [
    { label: "Today", run: () => mutations.planFor(task, todayISO()), active: task.do_date === todayISO() },
    { label: "Tomorrow", run: () => mutations.planFor(task, tomorrowISO()), active: task.do_date === tomorrowISO() },
    { label: "Next week", run: () => mutations.planFor(task, nextWeekISO()) },
    { label: "Inbox", run: () => mutations.backToInbox(task), active: task.status === "inbox" },
  ];

  const priorities: { value: Task["priority"]; label: string; color: string }[] = [
    { value: "high", label: "High", color: "var(--signal)" },
    { value: "medium", label: "Medium", color: "var(--accent)" },
    { value: "low", label: "Low", color: "var(--muted)" },
    { value: "none", label: "None", color: "var(--line-strong)" },
  ];

  return (
    <Sheet onClose={onClose} title="Task">
      <div className="mobile-scroll max-h-[78vh] overflow-y-auto px-4 pb-4">
        <div className="rounded-xl border border-line bg-surface-2 p-3" style={accent ? { boxShadow: `inset 3px 0 0 0 ${accent}` } : undefined}>
          <textarea
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            rows={1}
            className="w-full resize-none bg-transparent text-head font-medium outline-none"
          />
          {(task.duration_minutes || task.start_time) && (
            <div className="mono mt-1 text-caption text-muted">
              {task.duration_minutes ? fmtDuration(task.duration_minutes) : null}
              {task.start_time ? ` · ${new Date(task.start_time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : null}
            </div>
          )}
        </div>

        <button
          onClick={() => {
            done ? mutations.uncomplete(task) : mutations.complete(task);
            onClose();
          }}
          className={`tap fast mt-3 w-full rounded-xl border py-3 text-head font-semibold active:translate-y-px ${
            done
              ? "border-line text-muted"
              : "border-accent bg-accent text-white"
          }`}
        >
          {done ? "↩ Reopen" : "✓ Mark done"}
        </button>

        <Section label="Plan">
          <div className="flex flex-wrap gap-1.5">
            {planChips.map((c) => (
              <Chip key={c.label} on={c.active} onClick={() => { c.run(); onClose(); }}>
                {c.label}
              </Chip>
            ))}
            <Chip onClick={() => setShowDatePick((v) => !v)} on={showDatePick}>
              Pick date…
            </Chip>
          </div>
          {showDatePick && (
            <DateTimePicker task={task} mutations={mutations} onDone={onClose} />
          )}
        </Section>

        {!done && !task.start_time && (
          <Section label="Find time">
            <FindTimeAction task={task} onPlaced={onClose} />
          </Section>
        )}

        <Section label="Priority">
          <div className="flex flex-wrap gap-1.5">
            {priorities.map((p) => (
              <Chip
                key={p.value}
                on={task.priority === p.value}
                onClick={() => mutations.patchTask(task.id, { priority: p.value })}
              >
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
                  {p.label}
                </span>
              </Chip>
            ))}
          </div>
        </Section>

        {labels.length > 0 && (
          <Section label="Labels">
            <div className="flex flex-wrap gap-1.5">
              {labels.map((l) => {
                const on = currentLabels.has(l.id);
                return (
                  <button
                    key={l.id}
                    onClick={() => {
                      const next = new Set(currentLabels);
                      on ? next.delete(l.id) : next.add(l.id);
                      mutations.setLabels(task.id, [...next]);
                    }}
                    className="tap fast rounded-full border px-3 py-2 text-body font-medium"
                    style={{
                      borderColor: on ? l.color : "var(--line)",
                      background: on ? `color-mix(in srgb, ${l.color} 15%, var(--surface))` : "transparent",
                      color: on ? l.color : "var(--muted)",
                    }}
                  >
                    {l.name}
                  </button>
                );
              })}
            </div>
          </Section>
        )}

        <button
          onClick={() => {
            mutations.trash(task);
            onClose();
          }}
          className="tap fast mt-5 w-full rounded-xl border border-signal/30 py-3 text-head font-medium text-signal active:translate-y-px"
        >
          Trash
        </button>
      </div>
    </Sheet>
  );
}

// The one-task fit: tap to ask the week composer for a slot, then place it.
// Rendered only under FIND_TIME_SPIKE, so useFindTime (and its calendar
// queries) mount lazily and never run in production.
function FindTimeAction({ task, onPlaced }: { task: Task; onPlaced: () => void }) {
  const { findTime, place } = useFindTime();
  const [result, setResult] = useState<FindTimeResult | null>(null);
  const [placing, setPlacing] = useState(false);

  if (!result) {
    return (
      <button
        onClick={() => setResult(findTime(task))}
        className="tap fast w-full rounded-xl border border-accent/40 bg-accent-soft py-3 text-head font-medium text-accent active:translate-y-px"
      >
        ✨ Find time this week
      </button>
    );
  }

  if (!result.ok) {
    return (
      <div className="rounded-xl border border-line bg-surface-2 p-3">
        <div className="text-body text-muted">No room this week — {result.reason}.</div>
        <button
          onClick={() => setResult(null)}
          className="tap fast mt-2 text-caption font-medium text-accent"
        >
          Try again
        </button>
      </div>
    );
  }

  const { placement } = result;
  const dayLabel = format(parseDateISO(placement.dayISO), "EEE");
  const doPlace = async () => {
    setPlacing(true);
    try {
      await place(task, placement);
      toast.success(`Placed — ${dayLabel} ${fmtSlot(placement)}`);
      onPlaced();
    } catch {
      toast.error("Couldn't place it — try again.");
      setPlacing(false);
    }
  };

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <div className="text-head font-medium">
        {dayLabel} · <span className="mono">{fmtSlot(placement)}</span>
      </div>
      {placement.reason && <div className="mt-0.5 text-caption text-muted">{placement.reason}</div>}
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={doPlace}
          disabled={placing}
          className="tap fast flex-1 rounded-lg border border-accent bg-accent py-2.5 text-head font-medium text-white active:translate-y-px disabled:opacity-60"
        >
          {placing ? "Placing…" : "Place it"}
        </button>
        <button
          onClick={() => setResult(null)}
          className="tap fast rounded-lg border border-line px-4 py-2.5 text-head font-medium text-muted active:translate-y-px"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="section-label mb-1.5 !p-0">{label}</div>
      {children}
    </div>
  );
}

function Chip({
  children,
  on,
  onClick,
}: {
  children: React.ReactNode;
  on?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`tap fast rounded-full border px-3.5 py-2 text-body font-medium ${
        on
          ? "border-accent bg-accent text-white"
          : "border-line text-muted hover:border-accent hover:text-accent"
      }`}
    >
      {children}
    </button>
  );
}

function DateTimePicker({
  task,
  mutations,
  onDone,
}: {
  task: Task;
  mutations: Mutations;
  onDone: () => void;
}) {
  const [date, setDate] = useState(task.do_date ?? todayISO());
  const [time, setTime] = useState(task.start_time ? task.start_time.slice(11, 16) : "");

  const apply = () => {
    if (time) {
      const [h, m] = time.split(":").map(Number);
      const [y, mo, d] = date.split("-").map(Number);
      mutations.block(task, new Date(y, mo - 1, d, h, m));
    } else {
      mutations.planFor(task, date);
    }
    onDone();
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="mono rounded-lg border border-line bg-surface px-2.5 py-2 text-head outline-none focus:border-accent"
      />
      <input
        type="time"
        value={time}
        step={900}
        onChange={(e) => setTime(e.target.value)}
        className="mono rounded-lg border border-line bg-surface px-2.5 py-2 text-head outline-none focus:border-accent"
      />
      <button
        onClick={apply}
        className="tap fast rounded-lg border border-accent bg-accent px-4 py-2 text-head font-medium text-white"
      >
        Set
      </button>
    </div>
  );
}
