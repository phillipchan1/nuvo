import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import type { AttendeeStatus, ExternalEvent, GoogleAttendee, Label, Recurrence, Slot, Task } from "../lib/types";
import { ruleOf } from "../lib/types";
import type { useTaskMutations } from "../hooks/useTasks";
import type { useExternalEventMutations } from "../hooks/useCalendar";
import type { useSlotMutations } from "../hooks/useSlots";
import type { useRecurrenceMutations, SeriesTemplate } from "../hooks/useRecurrence";
import { useEventDetails } from "../hooks/useCalendar";
import { useQueryClient } from "@tanstack/react-query";
import { useVertical } from "../hooks/useVertical";
import { domainById, initiativeById, projectById } from "../lib/vertical";
import { fmtDuration, todayISO } from "../lib/dates";
import { deriveSlotTitle } from "../lib/slots";
import { rulesEqual, type RecurrenceRule } from "../lib/recurrence";
import { ASSISTANT_NAME } from "../lib/assistant";
import { supabase } from "../lib/supabase";
import { RecurrenceDeleteButton, RepeatControl } from "./RecurrencePicker";
import { Btn, RollBadge } from "./ui";

/** Minutes after local midnight for an ISO instant (for series templates). */
function localMinutes(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

export function TaskPopover({
  task,
  anchor,
  labels,
  mutations,
  recurrence,
  recurrenceMutations,
  onClose,
}: {
  task: Task;
  anchor: DOMRect;
  labels: Label[];
  mutations: ReturnType<typeof useTaskMutations>;
  /** The series this task belongs to (if any) — drives the repeat chip. */
  recurrence: Recurrence | null;
  recurrenceMutations: ReturnType<typeof useRecurrenceMutations>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [preparing, setPreparing] = useState(false);
  const [prepError, setPrepError] = useState<string | null>(null);
  const qc = useQueryClient();
  const { data: vertical, toggleTaskSprint } = useVertical();
  const popRef = useRef<HTMLDivElement>(null);
  const TASK_POP_W = 380;

  const [pos, setPos] = useState<{ top: number; left: number; side: "right" | "left" }>({
    top: anchor.top,
    left: anchor.right + 10,
    side: "right",
  });

  useLayoutEffect(() => {
    const pop = popRef.current;
    if (!pop) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const h = pop.offsetHeight;
    let left = anchor.right + 10;
    let side: "right" | "left" = "right";
    if (left + TASK_POP_W > vw - 8) {
      left = anchor.left - 10 - TASK_POP_W;
      side = "left";
    }
    left = Math.max(8, left);
    let top = anchor.top + anchor.height / 2 - h / 2;
    top = Math.max(8, Math.min(top, vh - h - 8));
    setPos({ top, left, side });
  }, [anchor]);

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

  // Set / change / stop the repeat. A dated task converts to a series anchored
  // at its day; an existing series re-rules in place; clearing it stops here on.
  const applyRepeat = (rule: RecurrenceRule | null) => {
    if (!task.do_date) return;
    if (rulesEqual(recurrence ? ruleOf(recurrence) : null, rule)) return;
    const template: SeriesTemplate = {
      title: task.title,
      duration_minutes: task.duration_minutes ?? 30,
      time_of_day_minutes: task.start_time ? localMinutes(task.start_time) : null,
      project_id: task.project_id,
      domain_id: task.domain_id,
      priority: task.priority,
    };
    if (rule && !recurrence) void recurrenceMutations.convertToSeries("task", task, rule, template);
    else if (rule && recurrence) void recurrenceMutations.updateSeries(recurrence, rule, template);
    else if (!rule && recurrence) void recurrenceMutations.stopSeries(recurrence, task.do_date);
  };

  const labelIds = new Set((task.task_labels ?? []).map((tl) => tl.label_id));

  const doDateLabel = (() => {
    if (!task.do_date) return null;
    const t = format(new Date(), "yyyy-MM-dd");
    const tm = format(new Date(Date.now() + 86400000), "yyyy-MM-dd");
    if (task.do_date === t) return "today";
    if (task.do_date === tm) return "tomorrow";
    return format(new Date(task.do_date + "T12:00:00"), "MMM d");
  })();

  // Keyword-match domain suggestion when task has no parent
  const suggestedDomain = (() => {
    if (task.domain_id || task.project_id) return null;
    const lower = task.title.toLowerCase();
    const stop = new Set(["the", "and", "for", "to", "a", "an", "of", "in", "on", "at"]);
    const words = lower.split(/\W+/).filter((w) => w.length > 2 && !stop.has(w));
    for (const d of vertical.domains) {
      const n = d.name.toLowerCase();
      if (lower.includes(n) || n.split(/\W+/).filter((w) => w.length > 2).some((w) => words.includes(w)))
        return d;
    }
    for (const p of vertical.projects.filter((p) => p.status !== "done")) {
      const n = p.name.toLowerCase();
      if (lower.includes(n) || n.split(/\W+/).filter((w) => w.length > 2).some((w) => words.includes(w)))
        return domainById(vertical, p.domainId) ?? null;
    }
    return null;
  })();

  return createPortal(
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Popover card */}
      <div
        ref={popRef}
        className="moment fixed z-50 flex flex-col rounded-[var(--radius-lg)] border border-line bg-surface"
        style={{
          top: pos.top,
          left: pos.left,
          width: TASK_POP_W,
          maxHeight: "min(620px, calc(100vh - 24px))",
          boxShadow: "var(--shadow-3)",
        }}
      >
        {/* Arrow connector */}
        <div
          className="absolute h-2.5 w-2.5 rotate-45 border border-line bg-surface"
          style={
            pos.side === "right"
              ? {
                  left: -6,
                  top: Math.max(16, Math.min(
                    anchor.top + anchor.height / 2 - pos.top - 5,
                    (popRef.current?.offsetHeight ?? 200) - 16,
                  )),
                  borderRight: "none",
                  borderTop: "none",
                }
              : {
                  right: -6,
                  top: Math.max(16, Math.min(
                    anchor.top + anchor.height / 2 - pos.top - 5,
                    (popRef.current?.offsetHeight ?? 200) - 16,
                  )),
                  borderLeft: "none",
                  borderBottom: "none",
                }
          }
        />

        {/* ── Title + close ── */}
        <div className="flex shrink-0 items-start gap-2 px-4 pt-4 pb-2">
          <div className="min-w-0 flex-1">
            {(domain || initiative || project) && (
              <div className="mono mb-1.5 flex items-center gap-1 text-[10px]">
                {domain && <span style={{ color: domain.color }}>{domain.icon} {domain.name}</span>}
                {initiative && <><span className="text-muted">›</span><span className="text-muted">{initiative.name}</span></>}
                {project && <><span className="text-muted">›</span><span className="text-muted">{project.name}</span></>}
              </div>
            )}
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => e.key === "Enter" && commitTitle()}
              className="w-full border-0 bg-transparent text-[15px] font-semibold leading-snug outline-none placeholder:text-muted"
              placeholder="Task title…"
            />
          </div>
          <button
            onClick={onClose}
            className="fast mt-0.5 shrink-0 rounded p-0.5 text-muted hover:bg-bg hover:text-ink"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* ── Domain › Project  +  priority dots ── */}
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-line px-3 py-2">
          {/* Domain chip wrapping invisible select */}
          <label
            className="relative inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium hover:bg-bg"
            style={{ color: domain?.color ?? "var(--muted)" }}
          >
            {domain ? <><span>{domain.icon}</span><span>{domain.name}</span></> : <span>+ domain</span>}
            <select
              value={task.domain_id ?? ""}
              onChange={(e) => setDomain(e.target.value)}
              className="absolute inset-0 w-full cursor-pointer opacity-0"
            >
              <option value="">— none —</option>
              {vertical.domains.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>

          <span className="text-[10px] text-muted">›</span>

          {/* Project chip */}
          <label className="relative inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-muted hover:bg-bg hover:text-ink">
            <span>{project?.name ?? "+ project"}</span>
            <select
              value={task.project_id ?? ""}
              onChange={(e) => setProject(e.target.value)}
              className="absolute inset-0 w-full cursor-pointer opacity-0"
            >
              <option value="">— none —</option>
              {vertical.projects
                .filter((p) => p.status !== "done" || p.id === task.project_id)
                .map((p) => {
                  const d = domainById(vertical, p.domainId);
                  return <option key={p.id} value={p.id}>{d ? `${d.name} · ` : ""}{p.name}</option>;
                })}
            </select>
          </label>

          <div className="flex-1" />
          <RollBadge count={task.roll_count} />

          {/* Priority dots */}
          <div className="flex items-center gap-1 pl-1">
            {(["high", "medium", "low", "none"] as const).map((p) => (
              <button
                key={p}
                onClick={() => mutations.patchTask(task.id, { priority: p })}
                title={p}
                className={`fast h-[7px] w-[7px] rounded-full ${
                  task.priority === p
                    ? p === "high" ? "bg-signal scale-110"
                      : p === "medium" ? "bg-amber-400 scale-110"
                      : p === "low" ? "bg-accent scale-110"
                      : "bg-muted scale-110"
                    : "bg-line hover:bg-line-strong"
                }`}
              />
            ))}
          </div>
        </div>

        {/* ── Schedule chips ── */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-line px-3 py-2.5">
          {/* Date chip */}
          <label className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-bg px-2.5 py-1 text-[11.5px] hover:brightness-95 dark:hover:brightness-110">
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className="shrink-0 text-muted/70">
              <rect x="1" y="2" width="10" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M1 5h10" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M4 1v2M8 1v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <span className={task.do_date ? "text-ink" : "text-muted"}>{doDateLabel ?? "no date"}</span>
            <input
              type="date"
              value={task.do_date ?? ""}
              onChange={(e) =>
                e.target.value
                  ? mutations.planFor(task, e.target.value)
                  : task.project_id || task.initiative_id || task.domain_id
                    ? mutations.backToWeek(task)
                    : mutations.backToInbox(task)
              }
              className="absolute inset-0 w-full cursor-pointer opacity-0"
            />
          </label>

          {/* Time chip */}
          <label className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-bg px-2.5 py-1 text-[11.5px] hover:brightness-95 dark:hover:brightness-110">
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className="shrink-0 text-muted/70">
              <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M6 3v3l2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <span className={task.start_time ? "text-ink" : "text-muted"}>
              {task.start_time ? format(new Date(task.start_time), "h:mm a") : "no time"}
            </span>
            <input
              type="time"
              step={900}
              value={startHHMM}
              onChange={(e) => setStart(e.target.value)}
              className="absolute inset-0 w-full cursor-pointer opacity-0"
            />
          </label>

          {/* Duration chip */}
          <label className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-bg px-2.5 py-1 text-[11.5px] hover:brightness-95 dark:hover:brightness-110">
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className="shrink-0 text-muted/70">
              <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M6 4v2.5h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <span className="text-ink">{fmtDuration(task.duration_minutes ?? 30)}</span>
            <svg width="7" height="7" viewBox="0 0 8 8" fill="none" className="text-muted/50">
              <path d="M1 3l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <select
              value={task.duration_minutes ?? 30}
              onChange={(e) => mutations.patchTask(task.id, { duration_minutes: Number(e.target.value) })}
              className="absolute inset-0 w-full cursor-pointer opacity-0"
            >
              {[15, 30, 45, 60, 90, 120, 180, 240].map((m) => (
                <option key={m} value={m}>{fmtDuration(m)}</option>
              ))}
            </select>
          </label>

          {/* Deadline chip */}
          <label className={`relative inline-flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] hover:bg-signal-soft ${task.deadline ? "text-signal" : "text-muted hover:text-signal"}`}>
            <span>⚑</span>
            <span>{task.deadline ? task.deadline.slice(5).replace("-", "/") : "deadline"}</span>
            <input
              type="date"
              value={task.deadline ?? ""}
              onChange={(e) => mutations.patchTask(task.id, { deadline: e.target.value || null })}
              className="absolute inset-0 w-full cursor-pointer opacity-0"
            />
          </label>

          {/* Repeat */}
          <RepeatControl
            anchorISO={task.do_date ?? todayISO()}
            value={recurrence ? ruleOf(recurrence) : null}
            onChange={applyRepeat}
            disabled={!task.do_date}
          />

          <div className="flex-1" />

          {/* This week star */}
          <button
            onClick={() => toggleTaskSprint(task.id)}
            title={inWeek ? "In this week's sprint — click to release" : "Commit to this week"}
            className={`fast text-[15px] leading-none ${inWeek ? "text-signal" : "text-muted hover:text-ink"}`}
          >
            {inWeek ? "★" : "☆"}
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Notes — borderless */}
          <div className="border-t border-line px-4 py-3">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={commitNotes}
              rows={3}
              className="w-full resize-none border-0 bg-transparent text-[13px] leading-relaxed text-text outline-none placeholder:text-muted/50"
              placeholder="Notes…"
            />
          </div>

          {/* ✦ Nuvo agentic section */}
          <div className="space-y-2 border-t border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="mono text-[9px] font-semibold tracking-widest text-accent">✦ NUVO</span>
              <div className="h-px flex-1 bg-line" />
            </div>

            {/* Auto-domain suggestion */}
            {suggestedDomain && (
              <div className="flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2">
                <span className="flex-1 text-[11.5px] text-muted">Assign to</span>
                <button
                  onClick={() => setDomain(suggestedDomain.id)}
                  className="fast flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
                  style={{
                    borderColor: suggestedDomain.color + "50",
                    color: suggestedDomain.color,
                    background: suggestedDomain.color + "15",
                  }}
                >
                  {suggestedDomain.icon && <span>{suggestedDomain.icon}</span>}
                  {suggestedDomain.name}
                </button>
                <span className="text-[11px] text-muted">?</span>
              </div>
            )}

            {/* Pre-work */}
            {task.prework && task.prework_at ? (
              <div className="rounded-lg bg-bg px-3 py-2.5">
                <div className="max-h-[160px] overflow-y-auto text-[12px] leading-relaxed text-text [&_h1]:mb-1 [&_h1]:text-[13px] [&_h1]:font-semibold [&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-[12px] [&_h2]:font-semibold [&_h3]:mb-0.5 [&_h3]:mt-1.5 [&_h3]:text-[11.5px] [&_h3]:font-semibold [&_li]:ml-3 [&_ol]:my-1 [&_ol]:list-decimal [&_p]:mb-1 [&_strong]:font-semibold [&_ul]:my-1 [&_ul]:list-disc">
                  <ReactMarkdown>{task.prework ?? ""}</ReactMarkdown>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Btn onClick={() => void prepare()} disabled={preparing}>
                    {preparing ? "✦ thinking…" : "✦ redo"}
                  </Btn>
                  <Btn onClick={() => mutations.patchTask(task.id, { prework: "", prework_at: null })}>
                    clear
                  </Btn>
                </div>
              </div>
            ) : (
              <button
                onClick={() => void prepare()}
                disabled={preparing}
                className="fast w-full rounded-lg border border-dashed border-line px-3 py-2.5 text-left text-[12px] text-muted hover:border-accent/50 hover:text-accent disabled:opacity-50"
              >
                {preparing
                  ? "✦ preparing — approach, drafts, pitfalls…"
                  : `✦ delegate pre-work to ${ASSISTANT_NAME}`}
              </button>
            )}
            {prepError && <div className="text-[11px] text-signal">{prepError}</div>}
          </div>

          {/* Labels */}
          {labels.length > 0 && (
            <div className="flex flex-wrap gap-1 border-t border-line px-4 py-3">
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
                      background: on ? l.color + "15" : "transparent",
                    }}
                  >
                    {l.name}
                  </button>
                );
              })}
            </div>
          )}

          {/* Timestamps */}
          <div className="mono border-t border-line px-4 py-2.5 text-[10.5px] text-muted">
            created {format(new Date(task.created_at), "MMM d yyyy")}
            {task.completed_at && (
              <span className="ml-3">completed {format(new Date(task.completed_at), "MMM d yyyy")}</span>
            )}
            {task.roll_count > 0 && <span className="ml-3">rolled {task.roll_count}×</span>}
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-3">
          {task.status === "done" ? (
            <Btn onClick={() => mutations.uncomplete(task)}>Reopen</Btn>
          ) : (
            <Btn kind="primary" onClick={() => { mutations.complete(task); onClose(); }}>
              Done
            </Btn>
          )}
          {task.start_time && <Btn onClick={() => mutations.unblock(task)}>Unblock</Btn>}
          <div className="flex-1" />
          <RecurrenceDeleteButton
            recurring={Boolean(task.recurrence_id && recurrence)}
            label="Trash"
            onSimple={() => { mutations.trash(task); onClose(); }}
            onThis={() => {
              if (recurrence && task.recurrence_date) recurrenceMutations.skipOccurrence(recurrence, task.recurrence_date);
              mutations.trash(task);
              onClose();
            }}
            onFollowing={() => {
              if (recurrence && task.do_date) recurrenceMutations.deleteFollowing(recurrence, task.do_date);
              onClose();
            }}
            onSeries={() => { if (recurrence) recurrenceMutations.deleteSeries(recurrence); onClose(); }}
          />
        </div>
      </div>
    </>,
    document.body,
  );
}

// ── Attendee status helpers ───────────────────────────────────────────────
function statusIcon(s: AttendeeStatus) {
  if (s === "accepted") return { icon: "✓", cls: "text-green-600 dark:text-green-400" };
  if (s === "declined") return { icon: "✗", cls: "text-signal" };
  if (s === "tentative") return { icon: "?", cls: "text-yellow-600 dark:text-yellow-400" };
  return { icon: "·", cls: "text-muted" };
}

function AttendeeRow({ a }: { a: GoogleAttendee }) {
  const { icon, cls } = statusIcon(a.responseStatus);
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className={`mono w-3 shrink-0 text-center text-[11px] font-bold ${cls}`}>{icon}</span>
      <span className="min-w-0 truncate text-[12px] text-text">
        {a.displayName ?? a.email}
        {a.organizer && <span className="ml-1 text-[10px] text-muted">(organizer)</span>}
        {a.optional && <span className="ml-1 text-[10px] text-muted">(optional)</span>}
      </span>
    </div>
  );
}

// ── Safe HTML description renderer ───────────────────────────────────────
function linkifyText(text: string): React.ReactNode {
  const URL_RE = /https?:\/\/[^\s<>"]+/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <a key={m.index} href={m[0]} target="_blank" rel="noopener noreferrer"
        className="text-accent underline-offset-2 hover:underline">
        {m[0]}
      </a>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

function domToReact(node: Node, key: number): React.ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.textContent ?? "";
    return t ? <React.Fragment key={key}>{linkifyText(t)}</React.Fragment> : null;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const kids = Array.from(el.childNodes).map((n, i) => domToReact(n, i));
  switch (tag) {
    case "a": {
      const href = el.getAttribute("href") ?? "";
      if (/^https?:\/\//.test(href))
        return <a key={key} href={href} target="_blank" rel="noopener noreferrer"
          className="text-accent underline-offset-2 hover:underline">{kids}</a>;
      return <React.Fragment key={key}>{kids}</React.Fragment>;
    }
    case "br": return <br key={key} />;
    case "p": return el.textContent?.trim() ? <p key={key}>{kids}</p> : null;
    case "b": case "strong": return <strong key={key}>{kids}</strong>;
    case "i": case "em": return <em key={key}>{kids}</em>;
    case "ul": return <ul key={key} className="list-disc pl-4 space-y-0.5">{kids}</ul>;
    case "ol": return <ol key={key} className="list-decimal pl-4 space-y-0.5">{kids}</ol>;
    case "li": return <li key={key}>{kids}</li>;
    default: return <React.Fragment key={key}>{kids}</React.Fragment>;
  }
}

function DescriptionHtml({ html }: { html: string }) {
  const nodes = useMemo(() => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return Array.from(doc.body.childNodes).map((n, i) => domToReact(n, i));
  }, [html]);
  return (
    <div className="space-y-1.5 text-[12px] leading-relaxed text-text [&_p]:mb-1 [&_ul]:my-1 [&_ol]:my-1">
      {nodes}
    </div>
  );
}

// ── EventPopover — anchored to the clicked event element ─────────────────
const POP_W = 340;
const POP_GAP = 10;

export function EventPopover({
  event,
  anchor,
  editable,
  eventMutations,
  onClose,
}: {
  event: ExternalEvent;
  anchor: DOMRect;
  editable: boolean;
  eventMutations: ReturnType<typeof useExternalEventMutations>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(event.title);
  const [notify, setNotify] = useState(true);
  const [pendingRsvp, setPendingRsvp] = useState<AttendeeStatus | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  const { data: raw, isLoading: detailsLoading } = useEventDetails(event.id);
  const recurring = Boolean((raw as { recurringEventId?: string } | null)?.recurringEventId);

  useEffect(() => {
    setTitle(event.title);
    setPendingRsvp(null);
    setConfirmDelete(false);
  }, [event.id, event.title]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Compute fixed position: prefer right of event, fall back to left
  const [pos, setPos] = useState<{ top: number; left: number; side: "right" | "left" }>({
    top: anchor.top,
    left: anchor.right + POP_GAP,
    side: "right",
  });

  useLayoutEffect(() => {
    const pop = popRef.current;
    if (!pop) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const h = pop.offsetHeight;

    let left = anchor.right + POP_GAP;
    let side: "right" | "left" = "right";
    if (left + POP_W > vw - 8) {
      left = anchor.left - POP_GAP - POP_W;
      side = "left";
    }
    left = Math.max(8, left);
    let top = anchor.top + anchor.height / 2 - h / 2;
    top = Math.max(8, Math.min(top, vh - h - 8));
    setPos({ top, left, side });
  }, [anchor]);

  const myAttendee = raw?.attendees?.find((a) => a.self);
  const myResponse: AttendeeStatus = pendingRsvp ?? (myAttendee?.responseStatus ?? "needsAction");

  const handleRsvp = (status: AttendeeStatus) => {
    setPendingRsvp(status);
    eventMutations.rsvpEvent({ id: event.id, responseStatus: status, sendNotifications: notify });
  };

  const joinEntry = raw?.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === "video");

  const rsvpOptions: { status: AttendeeStatus; label: string }[] = [
    { status: "accepted", label: "Yes" },
    { status: "tentative", label: "Maybe" },
    { status: "declined", label: "No" },
  ];

  const hasAttendees = (raw?.attendees?.length ?? 0) > 0;

  return createPortal(
    <>
      {/* Backdrop — transparent, just catches outside clicks */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Popover card */}
      <div
        ref={popRef}
        className="moment fixed z-50 flex flex-col rounded-[var(--radius-lg)] border border-line bg-surface"
        style={{
          top: pos.top,
          left: pos.left,
          width: POP_W,
          maxHeight: "min(540px, calc(100vh - 24px))",
          boxShadow: "var(--shadow-3)",
        }}
      >
        {/* Arrow connector */}
        <div
          className="absolute h-2.5 w-2.5 rotate-45 border bg-surface border-line"
          style={
            pos.side === "right"
              ? {
                  left: -6,
                  top: Math.max(16, Math.min(
                    anchor.top + anchor.height / 2 - pos.top - 5,
                    (popRef.current?.offsetHeight ?? 200) - 16
                  )),
                  borderRight: "none",
                  borderTop: "none",
                }
              : {
                  right: -6,
                  top: Math.max(16, Math.min(
                    anchor.top + anchor.height / 2 - pos.top - 5,
                    (popRef.current?.offsetHeight ?? 200) - 16
                  )),
                  borderLeft: "none",
                  borderBottom: "none",
                }
          }
        />

        {/* Header row */}
        <div className="flex shrink-0 items-start justify-between px-4 pt-4 pb-2">
          <div className="min-w-0 flex-1 pr-2">
            {editable ? (
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() =>
                  title.trim() &&
                  title !== event.title &&
                  eventMutations.updateEvent({ id: event.id, patch: { title: title.trim() } })
                }
                className="w-full border-0 bg-transparent text-[14px] font-semibold leading-snug outline-none placeholder:text-muted"
              />
            ) : (
              <div className="text-[14px] font-semibold leading-snug">{event.title}</div>
            )}
          </div>
          <button
            onClick={onClose}
            className="fast mt-0.5 shrink-0 rounded p-0.5 text-muted hover:bg-bg hover:text-ink"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <div className="space-y-3">

            {/* Time */}
            <div className="mono flex items-center gap-2 text-[11.5px] text-muted">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0 text-muted/60">
                <rect x="1" y="2" width="10" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M1 5h10" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M4 1v2M8 1v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              {format(new Date(event.start_at), "EEE MMM d · h:mm a")}
              {" – "}
              {format(new Date(event.end_at), "h:mm a")}
            </div>

            {/* Location */}
            {event.location && (
              <div className="flex items-start gap-2 text-[12px] text-muted">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="mt-[1px] shrink-0">
                  <path d="M6 1C4.067 1 2.5 2.567 2.5 4.5c0 2.917 3.5 6.5 3.5 6.5s3.5-3.583 3.5-6.5C9.5 2.567 7.933 1 6 1z" stroke="currentColor" strokeWidth="1.2"/>
                  <circle cx="6" cy="4.5" r="1.2" stroke="currentColor" strokeWidth="1.1"/>
                </svg>
                <span className="leading-snug">{event.location}</span>
              </div>
            )}

            {/* Join meeting */}
            {joinEntry && (
              <a
                href={joinEntry.uri}
                target="_blank"
                rel="noopener noreferrer"
                className="fast inline-flex items-center gap-2 rounded-md border border-accent/30 bg-accent-soft px-3 py-1.5 text-[12px] font-medium text-accent hover:bg-accent hover:text-white"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0">
                  <path d="M2 6h8M6 2l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Join {raw?.conferenceData?.conferenceSolution?.name ?? "meeting"}
              </a>
            )}

            {/* RSVP */}
            {editable && hasAttendees && (
              <div className="space-y-2 border-t border-line pt-3">
                <div className="section-label !p-0">Your response</div>
                <div className="flex gap-1.5">
                  {rsvpOptions.map(({ status, label }) => {
                    const active = myResponse === status;
                    const { icon, cls } = statusIcon(status);
                    return (
                      <button
                        key={status}
                        onClick={() => handleRsvp(status)}
                        className={`fast flex flex-1 items-center justify-center gap-1 rounded-md border py-1.5 text-[12px] font-medium ${
                          active
                            ? status === "accepted"
                              ? "border-green-500 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                              : status === "declined"
                                ? "border-signal bg-signal-soft text-signal"
                                : "border-yellow-500 bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400"
                            : "border-line text-muted hover:border-line-strong hover:text-ink"
                        }`}
                      >
                        <span className={`font-bold ${active ? "" : cls}`}>{icon}</span>
                        {label}
                      </button>
                    );
                  })}
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-[11px] text-muted">
                  <input
                    type="checkbox"
                    checked={notify}
                    onChange={(e) => setNotify(e.target.checked)}
                    className="accent-[var(--accent)]"
                  />
                  Notify organizer
                </label>
              </div>
            )}

            {/* Organizer + Guests */}
            {(raw?.organizer || hasAttendees) && (
              <div className="space-y-2 border-t border-line pt-3">
                {raw?.organizer && (
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className="shrink-0 text-[10px] text-muted uppercase tracking-wider font-semibold w-14">Organizer</span>
                    <span className="text-text">{raw.organizer.displayName ?? raw.organizer.email}</span>
                  </div>
                )}
                {hasAttendees && (
                  <div className="space-y-0.5">
                    <div className="section-label !p-0 mb-1">
                      Guests ({raw!.attendees!.length})
                    </div>
                    {raw!.attendees!.map((a) => (
                      <AttendeeRow key={a.email} a={a} />
                    ))}
                    {(() => {
                      const list = raw!.attendees!;
                      const yes = list.filter((a) => a.responseStatus === "accepted").length;
                      const no = list.filter((a) => a.responseStatus === "declined").length;
                      const maybe = list.filter((a) => a.responseStatus === "tentative").length;
                      const waiting = list.filter((a) => a.responseStatus === "needsAction").length;
                      return (
                        <div className="mono mt-1.5 flex gap-3 text-[10px] text-muted">
                          {yes > 0 && <span className="text-green-600 dark:text-green-400">✓ {yes}</span>}
                          {maybe > 0 && <span className="text-yellow-600">? {maybe}</span>}
                          {no > 0 && <span className="text-signal">✗ {no}</span>}
                          {waiting > 0 && <span>· {waiting} awaiting</span>}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* Description */}
            {raw?.description && (
              <div className="space-y-1.5 border-t border-line pt-3">
                <div className="section-label !p-0">Description</div>
                <DescriptionHtml html={raw.description} />
              </div>
            )}

            {detailsLoading && (
              <div className="shimmer text-[11px] pt-1">Loading details…</div>
            )}

          </div>
        </div>

        {/* Footer — delete (with this/series choice for recurring events) */}
        {editable && (
          <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-3">
            {!confirmDelete ? (
              <>
                <div className="flex-1" />
                <Btn kind="signal" onClick={() => setConfirmDelete(true)}>Delete</Btn>
              </>
            ) : recurring ? (
              <>
                <span className="text-[11.5px] text-muted">Delete…</span>
                <div className="flex-1" />
                <Btn onClick={() => setConfirmDelete(false)}>Cancel</Btn>
                <Btn
                  onClick={() => {
                    eventMutations.deleteEvent({ id: event.id, scope: "THIS" });
                    onClose();
                  }}
                >
                  This event
                </Btn>
                <Btn
                  kind="signal"
                  onClick={() => {
                    eventMutations.deleteEvent({ id: event.id, scope: "ALL" });
                    onClose();
                  }}
                >
                  All events
                </Btn>
              </>
            ) : (
              <>
                <span className="text-[11.5px] text-muted">Delete this event?</span>
                <div className="flex-1" />
                <Btn onClick={() => setConfirmDelete(false)}>Cancel</Btn>
                <Btn
                  kind="signal"
                  onClick={() => {
                    eventMutations.deleteEvent({ id: event.id, scope: "THIS" });
                    onClose();
                  }}
                >
                  Delete
                </Btn>
              </>
            )}
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}

// ── SlotPopover — a time slot and the tasks it holds ─────────────────────
const SLOT_POP_W = 340;

export function SlotPopover({
  slot,
  anchor,
  childTasks,
  taskMutations,
  slotMutations,
  recurrence,
  recurrenceMutations,
  onOpenTask,
  onClose,
}: {
  slot: Slot;
  anchor: DOMRect;
  childTasks: Task[];
  taskMutations: ReturnType<typeof useTaskMutations>;
  slotMutations: ReturnType<typeof useSlotMutations>;
  recurrence: Recurrence | null;
  recurrenceMutations: ReturnType<typeof useRecurrenceMutations>;
  onOpenTask: (t: Task) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(slot.title);
  const [newTitle, setNewTitle] = useState("");
  const popRef = useRef<HTMLDivElement>(null);
  const { data: vertical } = useVertical();

  // What the slot shows when unnamed — derived from its contents.
  const derivedTitle = deriveSlotTitle(slot, childTasks, vertical);

  const applyRepeat = (rule: RecurrenceRule | null) => {
    if (rulesEqual(recurrence ? ruleOf(recurrence) : null, rule)) return;
    const template: SeriesTemplate = {
      title: slot.title,
      duration_minutes: slot.duration_minutes,
      time_of_day_minutes: localMinutes(slot.start_time),
      project_id: slot.project_id,
      domain_id: slot.domain_id,
      color: slot.color,
    };
    if (rule && !recurrence) void recurrenceMutations.convertToSeries("slot", slot, rule, template);
    else if (rule && recurrence) void recurrenceMutations.updateSeries(recurrence, rule, template);
    else if (!rule && recurrence) void recurrenceMutations.stopSeries(recurrence, slot.do_date);
  };

  useEffect(() => setTitle(slot.title), [slot.id, slot.title]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [pos, setPos] = useState<{ top: number; left: number; side: "right" | "left" }>({
    top: anchor.top,
    left: anchor.right + 10,
    side: "right",
  });

  useLayoutEffect(() => {
    const pop = popRef.current;
    if (!pop) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const h = pop.offsetHeight;
    let left = anchor.right + 10;
    let side: "right" | "left" = "right";
    if (left + SLOT_POP_W > vw - 8) {
      left = anchor.left - 10 - SLOT_POP_W;
      side = "left";
    }
    left = Math.max(8, left);
    let top = anchor.top + anchor.height / 2 - h / 2;
    top = Math.max(8, Math.min(top, vh - h - 8));
    setPos({ top, left, side });
  }, [anchor]);

  const commitTitle = () =>
    title.trim() !== slot.title &&
    slotMutations.updateSlot({ id: slot.id, patch: { title: title.trim() } });

  // sorted for display: open tasks first, completed sink to the bottom
  const ordered = [...childTasks].sort(
    (a, b) => Number(a.status === "done") - Number(b.status === "done"),
  );
  const doneCount = ordered.filter((t) => t.status === "done").length;
  const totalMins = ordered.reduce((sum, t) => sum + (t.duration_minutes ?? 30), 0);

  const startDate = new Date(slot.start_time);
  const startHHMM = format(startDate, "HH:mm");
  const setTime = (hhmm: string) => {
    if (!hhmm) return;
    const [y, m, d] = slot.do_date.split("-").map(Number);
    const [h, min] = hhmm.split(":").map(Number);
    const nd = new Date(y, m - 1, d, h, min);
    slotMutations.updateSlot({
      id: slot.id,
      patch: { start_time: nd.toISOString(), do_date: slot.do_date },
    });
  };
  const setDate = (dateISO: string) => {
    if (!dateISO) return;
    const [y, m, d] = dateISO.split("-").map(Number);
    const nd = new Date(y, m - 1, d, startDate.getHours(), startDate.getMinutes());
    slotMutations.updateSlot({
      id: slot.id,
      patch: { start_time: nd.toISOString(), do_date: dateISO },
    });
  };

  const addTask = () => {
    if (!newTitle.trim()) return;
    void taskMutations.createInSlot(slot, newTitle.trim());
    setNewTitle("");
  };

  const project = projectById(vertical, slot.project_id);
  const domain = domainById(vertical, slot.domain_id ?? project?.domainId ?? null);

  const setProject = (projectId: string) => {
    const p = projectById(vertical, projectId || null);
    const d = domainById(vertical, p?.domainId ?? null);
    slotMutations.updateSlot({
      id: slot.id,
      patch: {
        project_id: p?.id ?? null,
        domain_id: p?.domainId ?? null,
        color: d?.color ?? slot.color,
      },
    });
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        ref={popRef}
        className="moment fixed z-50 flex flex-col rounded-[var(--radius-lg)] border border-line bg-surface"
        style={{
          top: pos.top,
          left: pos.left,
          width: SLOT_POP_W,
          maxHeight: "min(560px, calc(100vh - 24px))",
          boxShadow: "var(--shadow-3)",
        }}
      >
        {/* Arrow */}
        <div
          className="absolute h-2.5 w-2.5 rotate-45 border border-line bg-surface"
          style={
            pos.side === "right"
              ? { left: -6, top: 24, borderRight: "none", borderTop: "none" }
              : { right: -6, top: 24, borderLeft: "none", borderBottom: "none" }
          }
        />

        {/* Header */}
        <div className="flex shrink-0 items-start gap-2 px-4 pt-4 pb-2">
          <div className="min-w-0 flex-1">
            <div className="mono mb-1 text-[9px] font-semibold uppercase tracking-widest text-muted">
              🗂 Time slot
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => e.key === "Enter" && commitTitle()}
              className="w-full border-0 bg-transparent text-[15px] font-semibold leading-snug outline-none placeholder:text-muted/70"
              placeholder={derivedTitle}
            />
            {!slot.title.trim() && (
              <div className="mono mt-0.5 text-[10px] text-muted/70">✦ auto-named — type to override</div>
            )}
          </div>
          <button
            onClick={onClose}
            className="fast mt-0.5 shrink-0 rounded p-0.5 text-muted hover:bg-bg hover:text-ink"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Schedule chips */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-line px-3 py-2.5">
          <label className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-bg px-2.5 py-1 text-[11.5px] hover:brightness-95 dark:hover:brightness-110">
            <span className="text-ink">{format(new Date(slot.do_date + "T12:00:00"), "MMM d")}</span>
            <input
              type="date"
              value={slot.do_date}
              onChange={(e) => setDate(e.target.value)}
              className="absolute inset-0 w-full cursor-pointer opacity-0"
            />
          </label>
          <label className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-bg px-2.5 py-1 text-[11.5px] hover:brightness-95 dark:hover:brightness-110">
            <span className="text-ink">{format(startDate, "h:mm a")}</span>
            <input
              type="time"
              step={900}
              value={startHHMM}
              onChange={(e) => setTime(e.target.value)}
              className="absolute inset-0 w-full cursor-pointer opacity-0"
            />
          </label>
          <label className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-bg px-2.5 py-1 text-[11.5px] hover:brightness-95 dark:hover:brightness-110">
            <span className="text-ink">{fmtDuration(slot.duration_minutes)}</span>
            <select
              value={slot.duration_minutes}
              onChange={(e) =>
                slotMutations.updateSlot({
                  id: slot.id,
                  patch: { duration_minutes: Number(e.target.value) },
                })
              }
              className="absolute inset-0 w-full cursor-pointer opacity-0"
            >
              {[30, 45, 60, 90, 120, 180, 240, 360, 480].map((m) => (
                <option key={m} value={m}>{fmtDuration(m)}</option>
              ))}
            </select>
          </label>

          {/* Project chip — drives color/inheritance */}
          <label
            className="relative inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium hover:bg-bg"
            style={{ color: domain?.color ?? "var(--muted)" }}
          >
            <span>{project?.name ?? "+ project"}</span>
            <select
              value={slot.project_id ?? ""}
              onChange={(e) => setProject(e.target.value)}
              className="absolute inset-0 w-full cursor-pointer opacity-0"
            >
              <option value="">— none —</option>
              {vertical.projects
                .filter((p) => p.status !== "done" || p.id === slot.project_id)
                .map((p) => {
                  const d = domainById(vertical, p.domainId);
                  return <option key={p.id} value={p.id}>{d ? `${d.name} · ` : ""}{p.name}</option>;
                })}
            </select>
          </label>

          {/* Repeat */}
          <RepeatControl
            anchorISO={slot.do_date}
            value={recurrence ? ruleOf(recurrence) : null}
            onChange={applyRepeat}
          />
        </div>

        {/* Progress */}
        <div className="mono flex shrink-0 items-center gap-2 border-t border-line px-4 py-2 text-[10.5px] text-muted">
          <span>{doneCount}/{ordered.length} done</span>
          {totalMins > 0 && <span>· {fmtDuration(totalMins)} of tasks</span>}
        </div>

        {/* Child tasks */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
          {ordered.map((t) => {
            const done = t.status === "done";
            return (
              <div
                key={t.id}
                className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-bg"
              >
                <button
                  aria-label="toggle done"
                  onClick={() => (done ? taskMutations.uncomplete(t) : taskMutations.complete(t))}
                  className={`fast flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] border ${
                    done ? "border-accent bg-accent text-white" : "border-line-strong bg-surface"
                  }`}
                >
                  {done && (
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                      <path d="M1.5 5.5L4 8L8.5 2" stroke="currentColor" strokeWidth="1.8" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={() => onOpenTask(t)}
                  className={`min-w-0 flex-1 truncate text-left text-[12.5px] ${
                    done ? "text-muted line-through" : "text-text"
                  }`}
                >
                  {t.title}
                </button>
                <button
                  aria-label="remove from slot"
                  title="Remove from slot"
                  onClick={() => taskMutations.removeFromSlot(t)}
                  className="fast shrink-0 rounded p-0.5 text-muted opacity-0 group-hover:opacity-100 hover:bg-surface-2 hover:text-ink"
                >
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                    <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            );
          })}
          {ordered.length === 0 && (
            <div className="px-2 py-3 text-[12px] italic text-muted/70">No tasks yet — add one below.</div>
          )}
        </div>

        {/* Add task */}
        <div className="shrink-0 border-t border-line px-3 py-2.5">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTask()}
            placeholder="+ Add task to slot…"
            className="w-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent"
          />
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-3">
          <div className="flex-1" />
          <RecurrenceDeleteButton
            recurring={Boolean(slot.recurrence_id && recurrence)}
            label="Delete slot"
            onSimple={() => { slotMutations.removeSlot(slot); onClose(); }}
            onThis={() => {
              if (recurrence && slot.recurrence_date) recurrenceMutations.skipOccurrence(recurrence, slot.recurrence_date);
              slotMutations.removeSlot(slot);
              onClose();
            }}
            onFollowing={() => {
              if (recurrence) recurrenceMutations.deleteFollowing(recurrence, slot.do_date);
              onClose();
            }}
            onSeries={() => { if (recurrence) recurrenceMutations.deleteSeries(recurrence); onClose(); }}
          />
        </div>
      </div>
    </>,
    document.body,
  );
}
