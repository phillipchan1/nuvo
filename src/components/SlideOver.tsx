import { useEffect, useState } from "react";
import { format } from "date-fns";
import type { ExternalEvent, Label, Task } from "../lib/types";
import type { useTaskMutations } from "../hooks/useTasks";
import type { useExternalEventMutations } from "../hooks/useCalendar";
import { useQueryClient } from "@tanstack/react-query";
import { useVertical } from "../hooks/useVertical";
import { domainById, initiativeById, projectById } from "../lib/vertical";
import { fmtDuration } from "../lib/dates";
import { ASSISTANT_NAME } from "../lib/assistant";
import { supabase } from "../lib/supabase";
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
  "w-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[13px] outline-none focus:border-accent";

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
  const [preparing, setPreparing] = useState(false);
  const [prepError, setPrepError] = useState<string | null>(null);
  const qc = useQueryClient();
  const { data: vertical, toggleTaskSprint } = useVertical();

  // delegation: the assistant does the pre-work, execution stays yours
  const prepare = async () => {
    setPreparing(true);
    setPrepError(null);
    try {
      const { error } = await supabase.functions.invoke("agent", {
        body: { prepare: { taskId: task.id } },
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["tasks"] });
    } catch (e) {
      setPrepError(e instanceof Error ? e.message : "prepare failed");
    } finally {
      setPreparing(false);
    }
  };
  useEffect(() => {
    setTitle(task.title);
    setNotes(task.notes);
  }, [task.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // the thread up the vertical
  const project = projectById(vertical, task.project_id);
  const initiative = initiativeById(vertical, task.initiative_id ?? project?.initiativeId ?? null);
  const domain = domainById(
    vertical,
    task.domain_id ?? project?.domainId ?? initiative?.domainId ?? null,
  );
  const inWeek = Boolean(task.sprint_id && task.sprint_id === vertical.sprint?.id);

  const setProject = (projectId: string) => {
    const p = projectById(vertical, projectId || null);
    mutations.patchTask(task.id, {
      project_id: p?.id ?? null,
      initiative_id: p?.initiativeId ?? null,
      domain_id: p?.domainId ?? task.domain_id,
      // filing an inbox capture processes it; un-filing a dateless backlog
      // task with no other parent sends it back to the inbox (never limbo)
      ...(task.status === "inbox" && p ? { status: "backlog" as const } : {}),
      ...(!p && task.status === "backlog" && !task.domain_id && !task.do_date
        ? { status: "inbox" as const }
        : {}),
    });
  };

  const setDomain = (domainId: string) => {
    mutations.patchTask(task.id, { domain_id: domainId || null });
  };

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
    <div className="slide-in-right elev-2 absolute inset-y-0 right-0 z-30 flex w-[400px] flex-col border-l border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="section-label !p-0">Task</div>
        <div className="flex items-center gap-2">
          <RollBadge count={task.roll_count} />
          <button onClick={onClose} className="keycap">esc</button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {/* the thread: why this block matters */}
        {(domain || initiative || project) && (
          <div className="mono flex flex-wrap items-center gap-1 text-[10px] text-muted">
            {domain && <span style={{ color: domain.color }}>{domain.icon} {domain.name}</span>}
            {initiative && <><span>›</span><span>{initiative.name}</span></>}
            {project && <><span>›</span><span>{project.name}</span></>}
          </div>
        )}

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
                  : task.project_id || task.initiative_id || task.domain_id
                    ? mutations.backToWeek(task) // parented: back to backlog/week pool
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

        <div className="grid grid-cols-2 gap-3">
          <Field label="Project">
            <select
              value={task.project_id ?? ""}
              onChange={(e) => setProject(e.target.value)}
              className={`${inputCls}`}
            >
              <option value="">— none —</option>
              {vertical.projects
                .filter((p) => p.status !== "done" || p.id === task.project_id)
                .map((p) => {
                  const d = domainById(vertical, p.domainId);
                  return (
                    <option key={p.id} value={p.id}>
                      {d ? `${d.name} · ` : ""}{p.name}
                    </option>
                  );
                })}
            </select>
          </Field>
          <Field label="Domain">
            <select
              value={task.domain_id ?? ""}
              onChange={(e) => setDomain(e.target.value)}
              className={`${inputCls}`}
            >
              <option value="">— none —</option>
              {vertical.domains.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="This week">
          <button
            onClick={() => toggleTaskSprint(task.id)}
            className={`fast w-full rounded-md border px-2 py-1.5 text-[12px] ${
              inWeek
                ? "border-signal bg-signal-soft text-signal"
                : "border-line text-muted hover:text-ink"
            }`}
          >
            {inWeek ? "★ committed to this week — click to release" : "☆ commit to this week"}
          </button>
        </Field>

        <Field label={`${ASSISTANT_NAME} — pre-work`}>
          {task.prework && task.prework_at ? (
            <div className="rounded-md border border-line bg-surface-2 p-2.5">
              <div className="max-h-[220px] overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed">
                {task.prework}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Btn onClick={() => void prepare()} disabled={preparing}>
                  {preparing ? "✦ preparing…" : "✦ redo"}
                </Btn>
                <Btn onClick={() => mutations.patchTask(task.id, { prework: "", prework_at: null })}>
                  clear
                </Btn>
              </div>
            </div>
          ) : (
            <Btn onClick={() => void prepare()} disabled={preparing} className="w-full">
              {preparing
                ? "✦ preparing — approach, drafts, pitfalls…"
                : `✦ delegate the prep to ${ASSISTANT_NAME}`}
            </Btn>
          )}
          {prepError && <div className="mt-1 text-[11px] text-signal">{prepError}</div>}
        </Field>

        <Field label="Priority">
          <div className="flex gap-1">
            {(["none", "low", "medium", "high"] as const).map((p) => (
              <button
                key={p}
                onClick={() => mutations.patchTask(task.id, { priority: p })}
                className={`fast flex-1 rounded-md border px-2 py-1 text-[12px] ${
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
                  className="fast rounded-full border px-2 py-0.5 text-[11px]"
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
          <div>created {format(new Date(task.created_at), "yyyy-MM-dd h:mm a")}</div>
          {task.completed_at && <div>completed {format(new Date(task.completed_at), "yyyy-MM-dd h:mm a")}</div>}
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
    <div className="slide-in-right elev-2 absolute inset-y-0 right-0 z-30 flex w-[400px] flex-col border-l border-line bg-surface">
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
          {format(new Date(event.start_at), "EEE MMM d, h:mm a")} – {format(new Date(event.end_at), "h:mm a")}
        </div>
        {event.location && <div className="text-[12px] text-muted">{event.location}</div>}
      </div>
    </div>
  );
}
