import { useEffect, useState } from "react";
import { format } from "date-fns";
import type { ExternalEvent, Label, Task } from "../lib/types";
import type { useTaskMutations } from "../hooks/useTasks";
import type { useExternalEventMutations } from "../hooks/useCalendar";
import { fmtDuration } from "../lib/dates";
import { Btn, RollBadge } from "./ui";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="section-label !p-0">{label}</div>
      {children}
    </div>
  );
}

const inputCls =
  "w-full border border-line bg-bg px-2 py-1.5 text-[13px] outline-none focus:border-accent";

export function TaskSlideOver({
  task,
  labels,
  mutations,
  onClose,
}: {
  task: Task;
  labels: Label[];
  mutations: ReturnType<typeof useTaskMutations>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  useEffect(() => {
    setTitle(task.title);
    setNotes(task.notes);
  }, [task.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const commitTitle = () => title.trim() && title !== task.title && mutations.patchTask(task.id, { title: title.trim() });
  const commitNotes = () => notes !== task.notes && mutations.patchTask(task.id, { notes });

  const startHHMM = task.start_time
    ? format(new Date(task.start_time), "HH:mm")
    : "";

  const setStart = (hhmm: string) => {
    if (!hhmm) {
      mutations.unblock(task);
      return;
    }
    const dateISO = task.do_date ?? format(new Date(), "yyyy-MM-dd");
    const [y, m, d] = dateISO.split("-").map(Number);
    const [h, min] = hhmm.split(":").map(Number);
    mutations.block(task, new Date(y, m - 1, d, h, min));
  };

  const labelIds = new Set((task.task_labels ?? []).map((tl) => tl.label_id));

  return (
    <div className="absolute inset-y-0 right-0 z-30 flex w-[400px] flex-col border-l border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="section-label !p-0">Task</div>
        <div className="flex items-center gap-2">
          <RollBadge count={task.roll_count} />
          <button onClick={onClose} className="keycap">esc</button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => e.key === "Enter" && commitTitle()}
          className="w-full border-0 bg-transparent text-[15px] font-medium outline-none"
        />

        <Field label="Notes (markdown)">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={commitNotes}
            rows={5}
            className={`${inputCls} resize-y font-normal`}
            placeholder="Notes…"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Do date">
            <input
              type="date"
              value={task.do_date ?? ""}
              onChange={(e) =>
                e.target.value
                  ? mutations.planFor(task, e.target.value)
                  : mutations.backToInbox(task)
              }
              className={`${inputCls} mono`}
            />
          </Field>
          <Field label="Start time">
            <input
              type="time"
              step={900}
              value={startHHMM}
              onChange={(e) => setStart(e.target.value)}
              className={`${inputCls} mono`}
            />
          </Field>
          <Field label="Duration">
            <select
              value={task.duration_minutes ?? 30}
              onChange={(e) => mutations.patchTask(task.id, { duration_minutes: Number(e.target.value) })}
              className={`${inputCls} mono`}
            >
              {[15, 30, 45, 60, 90, 120, 180, 240].map((m) => (
                <option key={m} value={m}>
                  {fmtDuration(m)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Deadline (hard due date)">
            <input
              type="date"
              value={task.deadline ?? ""}
              onChange={(e) => mutations.patchTask(task.id, { deadline: e.target.value || null })}
              className={`${inputCls} mono !border-signal/40 focus:!border-signal`}
            />
          </Field>
        </div>

        <Field label="Priority">
          <div className="flex gap-1">
            {(["none", "low", "medium", "high"] as const).map((p) => (
              <button
                key={p}
                onClick={() => mutations.patchTask(task.id, { priority: p })}
                className={`fast flex-1 border px-2 py-1 text-[12px] ${
                  task.priority === p
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line text-muted hover:text-ink"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Labels">
          <div className="flex flex-wrap gap-1">
            {labels.map((l) => {
              const on = labelIds.has(l.id);
              return (
                <button
                  key={l.id}
                  onClick={() => {
                    const next = new Set(labelIds);
                    on ? next.delete(l.id) : next.add(l.id);
                    void mutations.setLabels(task.id, [...next]);
                  }}
                  className="fast border px-1.5 py-0.5 text-[11px]"
                  style={{
                    borderColor: on ? l.color : "var(--line)",
                    color: on ? l.color : "var(--muted)",
                  }}
                >
                  {l.name}
                </button>
              );
            })}
            {labels.length === 0 && (
              <span className="text-[12px] text-muted">No labels yet — create them in Settings.</span>
            )}
          </div>
        </Field>

        <div className="mono space-y-0.5 border-t border-line pt-3 text-[11px] text-muted">
          <div>created {format(new Date(task.created_at), "yyyy-MM-dd HH:mm")}</div>
          {task.completed_at && <div>completed {format(new Date(task.completed_at), "yyyy-MM-dd HH:mm")}</div>}
          {task.roll_count > 0 && <div>rolled {task.roll_count}×</div>}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-line p-3">
        {task.status === "done" ? (
          <Btn onClick={() => mutations.uncomplete(task)}>Reopen</Btn>
        ) : (
          <Btn kind="primary" onClick={() => { mutations.complete(task); onClose(); }}>
            Done
          </Btn>
        )}
        {task.start_time && <Btn onClick={() => mutations.unblock(task)}>Unblock</Btn>}
        <div className="flex-1" />
        <Btn kind="signal" onClick={() => { mutations.trash(task); onClose(); }}>
          Trash
        </Btn>
      </div>
    </div>
  );
}

export function EventSlideOver({
  event,
  editable,
  eventMutations,
  onClose,
}: {
  event: ExternalEvent;
  editable: boolean;
  eventMutations: ReturnType<typeof useExternalEventMutations>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(event.title);
  useEffect(() => setTitle(event.title), [event.id, event.title]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="absolute inset-y-0 right-0 z-30 flex w-[400px] flex-col border-l border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="section-label !p-0">{editable ? "Google event" : "Microsoft 365 event (read-only)"}</div>
        <button onClick={onClose} className="keycap">esc</button>
      </div>
      <div className="space-y-4 p-4">
        {editable ? (
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() =>
              title.trim() &&
              title !== event.title &&
              eventMutations.updateEvent({ id: event.id, patch: { title: title.trim() } })
            }
            className="w-full border-0 bg-transparent text-[15px] font-medium outline-none"
          />
        ) : (
          <div className="text-[15px] font-medium">{event.title}</div>
        )}
        <div className="mono text-[12px] text-muted">
          {format(new Date(event.start_at), "EEE MMM d, HH:mm")} – {format(new Date(event.end_at), "HH:mm")}
        </div>
        {event.location && <div className="text-[12px] text-muted">{event.location}</div>}
      </div>
    </div>
  );
}
