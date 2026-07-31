import { useMemo, useState } from "react";
import type { Label, Task } from "../../lib/types";
import { ruleOf } from "../../lib/types";
import type { useTaskMutations } from "../../hooks/useTasks";
import { useRecurrenceMutations, useRecurrences } from "../../hooks/useRecurrence";
import { todayISO, tomorrowISO, nextWeekISO, fmtDuration } from "../../lib/dates";
import type { RecurrenceRule } from "../../lib/recurrence";
import { RepeatControl } from "../RecurrencePicker";
import Sheet from "./Sheet";

type Mutations = ReturnType<typeof useTaskMutations>;

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
  const { data: recurrences = [] } = useRecurrences();
  const recurrenceMutations = useRecurrenceMutations();
  const recurrence = useMemo(
    () => (task.recurrence_id ? recurrences.find((r) => r.id === task.recurrence_id) ?? null : null),
    [recurrences, task.recurrence_id],
  );
  const anchorISO = task.do_date ?? todayISO();
  const repeatRule: RecurrenceRule | null = recurrence ? ruleOf(recurrence) : null;

  const onRepeatChange = async (rule: RecurrenceRule | null) => {
    const template = {
      title: task.title,
      duration_minutes: task.duration_minutes ?? 30,
      time_of_day_minutes: task.start_time
        ? new Date(task.start_time).getHours() * 60 + new Date(task.start_time).getMinutes()
        : null,
      project_id: task.project_id,
      domain_id: task.domain_id,
      priority: task.priority,
    };
    if (!rule) {
      if (recurrence) await recurrenceMutations.stopSeries(recurrence, anchorISO);
      return;
    }
    if (recurrence) {
      await recurrenceMutations.updateSeries(recurrence, rule, template);
    } else {
      await recurrenceMutations.convertToSeries("task", task, rule, template);
    }
  };

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

        <Section label="Repeat">
          <RepeatControl
            anchorISO={anchorISO}
            value={repeatRule}
            onChange={(r) => void onRepeatChange(r)}
            variant="block"
          />
        </Section>

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
