import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { GuestsInput } from "./GuestsInput";
import ReactMarkdown from "react-markdown";
import { createPortal } from "react-dom";
import { Draggable } from "@fullcalendar/interaction";
import { format } from "date-fns";
import type { AttendeeStatus, CalendarAccount, ExternalEvent, GoogleAttendee, Label, Recurrence, Slot, Task } from "../lib/types";
import { DEFAULT_DURATION_MINUTES, DURATION_PRESETS, ruleOf } from "../lib/types";
import { providerLabel, writableCalendarTargets, type MoveTargetGroup } from "../lib/calendarWrite";
import type { useTaskMutations } from "../hooks/useTasks";
import type { useExternalEventMutations } from "../hooks/useCalendar";
import type { useSlotMutations } from "../hooks/useSlots";
import type { useRecurrenceMutations, SeriesTemplate } from "../hooks/useRecurrence";
import { useEventDetails, useHiddenEvents } from "../hooks/useCalendar";
import { eventSeriesKey } from "../lib/now";
import { useQueryClient } from "@tanstack/react-query";
import { useVertical } from "../hooks/useVertical";
import { domainById, initiativeById, isProjectComplete, projectById } from "../lib/vertical";
import { fmtDuration, todayISO } from "../lib/dates";
import { deriveSlotTitle } from "../lib/slots";
import { rulesEqual, type RecurrenceRule } from "../lib/recurrence";
import { ASSISTANT_NAME } from "../lib/assistant";
import { supabase } from "../lib/supabase";
import { RecurrenceDeleteButton, RepeatControl, SlotDeleteButton, type SlotDeleteScope } from "./RecurrencePicker";
import { Btn, RollBadge } from "./ui";

/** Minutes after local midnight for an ISO instant (for series templates). */
function localMinutes(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Quiet overflow for rare transforms (→ Inbox, → Event, …). Keeps the popover
 * footer to one primary + one secondary so Trash never spills the 380px card.
 */
function PopoverMoreMenu({
  items,
}: {
  items: { label: string; title?: string; onClick: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="More actions"
        aria-expanded={open}
        title="More actions"
        className="fast flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted hover:border-line-strong hover:bg-surface-2 hover:text-ink"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
          <circle cx="3" cy="7" r="1.25" />
          <circle cx="7" cy="7" r="1.25" />
          <circle cx="11" cy="7" r="1.25" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full right-0 z-[61] mb-1 w-44 overflow-hidden rounded-md border border-line bg-surface elev-3">
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                title={item.title}
                onClick={() => {
                  item.onClick();
                  setOpen(false);
                }}
                className="fast block w-full px-3 py-2 text-left text-caption text-text hover:bg-bg"
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function TaskPopover({
  task,
  anchor,
  labels,
  mutations,
  recurrence,
  recurrenceMutations,
  onClose,
  onConvertToEvent,
  variant = "anchored",
}: {
  task: Task;
  anchor: DOMRect;
  labels: Label[];
  mutations: ReturnType<typeof useTaskMutations>;
  /** The series this task belongs to (if any) — drives the repeat chip. */
  recurrence: Recurrence | null;
  recurrenceMutations: ReturnType<typeof useRecurrenceMutations>;
  onClose: () => void;
  onConvertToEvent?: () => void;
  /** "anchored" (default) floats beside a calendar block with an arrow; "centered"
   *  renders the same card as a scrim-backed modal, summonable from ⌘K on any rung. */
  variant?: "anchored" | "centered";
}) {
  const centered = variant === "centered";
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
    if (centered) return; // centered modal positions via CSS, not the anchor
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

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
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
    for (const p of vertical.projects.filter((p) => !isProjectComplete(p.status))) {
      const n = p.name.toLowerCase();
      if (lower.includes(n) || n.split(/\W+/).filter((w) => w.length > 2).some((w) => words.includes(w)))
        return domainById(vertical, p.domainId) ?? null;
    }
    return null;
  })();

  return createPortal(
    // Centered variant: a flex scrim that dims the page and centers the card
    // (no transform on the card, so the `.moment` spring doesn't fight it).
    // Anchored variant: `contents` makes the wrapper layout-transparent so the
    // fixed popover positions exactly as before.
    <div className={centered ? "fixed inset-0 z-40 flex items-center justify-center bg-black/20 p-4" : "contents"}>
      {/* Popover card */}
      <div
        ref={popRef}
        className={`moment z-50 flex flex-col rounded-[var(--radius-lg)] border border-line bg-surface ${centered ? "relative" : "fixed"}`}
        style={{
          ...(centered ? {} : { top: pos.top, left: pos.left }),
          width: TASK_POP_W,
          maxHeight: "min(620px, calc(100vh - 24px))",
          boxShadow: "var(--shadow-3)",
        }}
      >
        {/* Arrow connector — anchored variant only (the modal has no anchor). */}
        {!centered && (
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
        )}

        {/* ── Title + close ── */}
        <div className="flex shrink-0 items-start gap-2 px-4 pt-4 pb-2">
          <div className="min-w-0 flex-1">
            {(domain || initiative || project) && (
              <div className="mono mb-1.5 flex items-center gap-1 text-meta">
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
              className="w-full border-0 bg-transparent text-head font-semibold leading-snug outline-none placeholder:text-muted"
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
            className="relative inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-label font-medium hover:bg-bg"
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

          <span className="text-meta text-muted">›</span>

          {/* Project chip */}
          <label className="relative inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-label text-muted hover:bg-bg hover:text-ink">
            <span>{project?.name ?? "+ project"}</span>
            <select
              value={task.project_id ?? ""}
              onChange={(e) => setProject(e.target.value)}
              className="absolute inset-0 w-full cursor-pointer opacity-0"
            >
              <option value="">— none —</option>
              {vertical.projects
                .filter((p) => !isProjectComplete(p.status) || p.id === task.project_id)
                .map((p) => {
                  const d = domainById(vertical, p.domainId);
                  return <option key={p.id} value={p.id}>{d ? `${d.name} · ` : ""}{p.name}</option>;
                })}
            </select>
          </label>

          {task.status === "inbox" && (task.project_id || task.initiative_id || task.domain_id) && (
            <button
              onClick={() => mutations.fileToProject(task)}
              className="fast rounded-full border border-accent/30 px-2 py-0.5 text-label text-accent hover:bg-accent-soft"
            >
              File to project
            </button>
          )}

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
          <label className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-bg px-2.5 py-1 text-label hover:brightness-95 dark:hover:brightness-110">
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
          <label className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-bg px-2.5 py-1 text-label hover:brightness-95 dark:hover:brightness-110">
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
          <label className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-bg px-2.5 py-1 text-label hover:brightness-95 dark:hover:brightness-110">
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className="shrink-0 text-muted/70">
              <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M6 4v2.5h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <span className="text-ink">{fmtDuration(task.duration_minutes ?? 30)}</span>
            <svg width="7" height="7" viewBox="0 0 8 8" fill="none" className="text-muted/50">
              <path d="M1 3l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <select
              value={task.duration_minutes ?? DEFAULT_DURATION_MINUTES}
              onChange={(e) => mutations.patchTask(task.id, { duration_minutes: Number(e.target.value) })}
              className="absolute inset-0 w-full cursor-pointer opacity-0"
            >
              {DURATION_PRESETS.map((m) => (
                <option key={m} value={m}>{fmtDuration(m)}</option>
              ))}
            </select>
          </label>

          {/* Deadline chip */}
          <label className={`relative inline-flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 text-label hover:bg-signal-soft ${task.deadline ? "text-signal" : "text-muted hover:text-signal"}`}>
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
            className={`fast text-head leading-none ${inWeek ? "text-signal" : "text-muted hover:text-ink"}`}
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
              className="w-full resize-none border-0 bg-transparent text-body leading-relaxed text-text outline-none placeholder:text-muted/50"
              placeholder="Notes…"
            />
          </div>

          {/* ✦ Nuvo agentic section */}
          <div className="space-y-2 border-t border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="mono text-micro font-semibold tracking-widest text-accent">✦ NUVO</span>
              <div className="h-px flex-1 bg-line" />
            </div>

            {/* Auto-domain suggestion */}
            {suggestedDomain && (
              <div className="flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2">
                <span className="flex-1 text-label text-muted">Assign to</span>
                <button
                  onClick={() => setDomain(suggestedDomain.id)}
                  className="fast flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-label font-medium"
                  style={{
                    borderColor: suggestedDomain.color + "50",
                    color: suggestedDomain.color,
                    background: suggestedDomain.color + "15",
                  }}
                >
                  {suggestedDomain.icon && <span>{suggestedDomain.icon}</span>}
                  {suggestedDomain.name}
                </button>
                <span className="text-label text-muted">?</span>
              </div>
            )}

            {/* Pre-work */}
            {task.prework && task.prework_at ? (
              <div className="rounded-lg bg-bg px-3 py-2.5">
                <div className="max-h-[160px] overflow-y-auto text-caption leading-relaxed text-text [&_h1]:mb-1 [&_h1]:text-body [&_h1]:font-semibold [&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-caption [&_h2]:font-semibold [&_h3]:mb-0.5 [&_h3]:mt-1.5 [&_h3]:text-label [&_h3]:font-semibold [&_li]:ml-3 [&_ol]:my-1 [&_ol]:list-decimal [&_p]:mb-1 [&_strong]:font-semibold [&_ul]:my-1 [&_ul]:list-disc">
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
                className="fast w-full rounded-lg border border-dashed border-line px-3 py-2.5 text-left text-caption text-muted hover:border-accent/50 hover:text-accent disabled:opacity-50"
              >
                {preparing
                  ? "✦ preparing — approach, drafts, pitfalls…"
                  : `✦ delegate pre-work to ${ASSISTANT_NAME}`}
              </button>
            )}
            {prepError && <div className="text-label text-signal">{prepError}</div>}
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
                    className="fast rounded-full border px-2 py-0.5 text-label"
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
          <div className="mono border-t border-line px-4 py-2.5 text-meta text-muted">
            created {format(new Date(task.created_at), "MMM d yyyy")}
            {task.completed_at && (
              <span className="ml-3">completed {format(new Date(task.completed_at), "MMM d yyyy")}</span>
            )}
            {task.roll_count > 0 && <span className="ml-3">rolled {task.roll_count}×</span>}
          </div>
        </div>

        {/* ── Footer ──
            Hierarchy: Done is the only primary. Unblock stays as a peer secondary
            when the task is blocked. Rare transforms (→ Inbox, → Event) live in
            ⋯ so they don't compete — and so Trash stays inside the card. */}
        <div className="flex min-w-0 shrink-0 items-center gap-1.5 border-t border-line px-3 py-2.5">
          {task.status === "done" ? (
            <Btn onClick={() => mutations.uncomplete(task)}>Reopen</Btn>
          ) : (
            <Btn kind="primary" onClick={() => { mutations.complete(task); onClose(); }}>
              Done
            </Btn>
          )}
          {task.start_time && <Btn onClick={() => mutations.unblock(task)}>Unblock</Btn>}
          <div className="min-w-0 flex-1" />
          <PopoverMoreMenu
            items={[
              ...(task.status !== "inbox" && task.status !== "done"
                ? [{
                    label: "→ Inbox",
                    title: "Move back to inbox",
                    onClick: () => { mutations.backToInbox(task); onClose(); },
                  }]
                : []),
              ...(onConvertToEvent && task.start_time
                ? [{
                    label: "→ Event",
                    title: "Convert to a calendar event and remove the task",
                    onClick: () => { onConvertToEvent(); onClose(); },
                  }]
                : []),
            ]}
          />
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
    </div>,
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
      <span className={`mono w-3 shrink-0 text-center text-label font-bold ${cls}`}>{icon}</span>
      <span className="min-w-0 truncate text-caption text-text">
        {a.displayName ?? a.email}
        {a.organizer && <span className="ml-1 text-meta text-muted">(organizer)</span>}
        {a.optional && <span className="ml-1 text-meta text-muted">(optional)</span>}
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
    <div className="space-y-1.5 text-caption leading-relaxed text-text [&_p]:mb-1 [&_ul]:my-1 [&_ol]:my-1">
      {nodes}
    </div>
  );
}

/** Flatten an event description (Google can store HTML) to editable plain text. */
function plainTextFromHtml(s: string): string {
  if (!s) return "";
  if (!/[<&]/.test(s)) return s; // already plain
  const doc = new DOMParser().parseFromString(
    s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div)>/gi, "\n"),
    "text/html",
  );
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

// ── CalendarPicker — the calendar/account field + grouped move menu ──────
// A real button (big hit target) that opens a menu grouped by account, each
// with its writable calendars. Same-account picks move natively; cross-account
// picks copy-then-delete, so when that's lossy (repeats / guests) we confirm.
function CalendarPicker({
  groups,
  currentAccountId,
  currentCalendarId,
  currentLabel,
  currentColor,
  accountEmail,
  lossyWarn,
  onPick,
}: {
  groups: MoveTargetGroup[];
  currentAccountId: string;
  currentCalendarId?: string;
  currentLabel?: string;
  currentColor?: string | null;
  accountEmail?: string;
  lossyWarn: boolean;
  onPick: (accountId: string, calendarId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<{ accountId: string; calendarId: string; name: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setPending(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const choose = (accountId: string, calendarId: string, name: string) => {
    if (accountId === currentAccountId && calendarId === currentCalendarId) {
      setOpen(false);
      return;
    }
    if (accountId !== currentAccountId && lossyWarn) {
      setPending({ accountId, calendarId, name });
      return;
    }
    onPick(accountId, calendarId);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Move to another calendar or account"
        className="fast -ml-1 flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-bg"
      >
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: currentColor ?? "var(--muted)" }} />
        <span className="min-w-0 flex-1 truncate text-body text-ink">{currentLabel ?? "Calendar"}</span>
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" className="shrink-0 text-muted">
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {accountEmail && !open && (
        <div className="truncate pl-[18px] text-meta text-muted/60">{accountEmail}</div>
      )}
      {open && (
        <div
          className="pop-in absolute left-0 right-0 top-full z-10 mt-1 max-h-[280px] overflow-y-auto rounded-[var(--radius)] border border-line bg-surface py-1"
          style={{ boxShadow: "var(--shadow-3)" }}
        >
          {pending ? (
            <div className="px-3 py-2.5">
              <p className="text-caption text-ink">
                Move a copy to <span className="font-medium">{pending.name}</span>?
              </p>
              <p className="mt-0.5 text-meta text-muted">Repeats and guests won't carry over.</p>
              <div className="mt-2.5 flex gap-1.5">
                <button
                  onClick={() => {
                    onPick(pending.accountId, pending.calendarId);
                    setPending(null);
                    setOpen(false);
                  }}
                  className="fast flex-1 rounded-[var(--radius-sm)] bg-accent px-2 py-1 text-caption font-medium text-white hover:opacity-90"
                >
                  Move
                </button>
                <button
                  onClick={() => setPending(null)}
                  className="fast flex-1 rounded-[var(--radius-sm)] border border-line px-2 py-1 text-caption text-muted hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.accountId} className="py-0.5">
                <div className="truncate px-3 pb-0.5 pt-1 text-micro uppercase tracking-wide text-muted/70">
                  {g.accountLabel} · {providerLabel(g.provider)}
                </div>
                {g.calendars.map((c) => {
                  const active = g.accountId === currentAccountId && c.id === currentCalendarId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => choose(g.accountId, c.id, c.summary)}
                      className="fast flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-bg"
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color ?? "var(--muted)" }} />
                      <span className="min-w-0 flex-1 truncate text-caption text-ink">{c.summary}</span>
                      {active && (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0 text-accent">
                          <path d="M2.5 6.5L4.8 8.8L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
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
  calendarId,
  calendarName,
  calendarColor,
  accounts,
  accountEmail,
  eventMutations,
  onClose,
  onConvertToTask,
}: {
  event: ExternalEvent;
  anchor: DOMRect;
  editable: boolean;
  calendarId?: string;
  calendarName?: string;
  calendarColor?: string | null;
  /** All connected accounts — grouped into the calendar/account move picker. */
  accounts?: CalendarAccount[];
  accountEmail?: string;
  eventMutations: ReturnType<typeof useExternalEventMutations>;
  onClose: () => void;
  onConvertToTask?: () => void;
}) {
  const [title, setTitle] = useState(event.title);
  const [startAt, setStartAt] = useState(event.start_at);
  const [endAt, setEndAt] = useState(event.end_at);
  const [location, setLocation] = useState(event.location ?? "");
  const [notes, setNotes] = useState("");
  const [notify, setNotify] = useState(true);
  const [pendingRsvp, setPendingRsvp] = useState<AttendeeStatus | null>(null);
  const [rsvpError, setRsvpError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [hideMode, setHideMode] = useState(false);
  const [addingGuests, setAddingGuests] = useState(false);
  const [newGuests, setNewGuests] = useState<string[]>([]);
  const [inviting, setInviting] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  // Writable move targets grouped by account (the event's current calendar is
  // always kept so the picker shows the right value even on a read-only feed).
  const moveGroups = useMemo(
    () => writableCalendarTargets(accounts ?? [], calendarId),
    [accounts, calendarId],
  );
  const moveTargetCount = useMemo(
    () => moveGroups.reduce((n, g) => n + g.calendars.length, 0),
    [moveGroups],
  );

  const { data: raw, isLoading: detailsLoading } = useEventDetails(event.id);
  // Google marks instances with recurringEventId in raw; iCloud (CalDAV)
  // occurrences carry a `uid::<recurrence-id>` provider id.
  const recurring =
    Boolean((raw as { recurringEventId?: string } | null)?.recurringEventId) ||
    event.provider_event_id.includes("::");

  useEffect(() => {
    setTitle(event.title);
    setStartAt(event.start_at);
    setEndAt(event.end_at);
    setLocation(event.location ?? "");
    setPendingRsvp(null);
    setConfirmDelete(false);
    setHideMode(false);
  }, [event.id, event.title, event.start_at, event.end_at, event.location]);

  // Seed the notes field once the raw payload (with the description) arrives.
  // Notes edit as plain text — matching Apple Calendar / Fantastical — so a
  // Google HTML description is flattened to text for editing.
  useEffect(() => {
    setNotes(plainTextFromHtml(raw?.description ?? ""));
  }, [event.id, raw?.description]);

  const { isHidden, hiddenKeyFor, hide, unhide } = useHiddenEvents();
  const hiddenNow = isHidden(event);
  const canHideSeries = Boolean(eventSeriesKey(event));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
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

  const handleRsvp = async (status: AttendeeStatus) => {
    setPendingRsvp(status);
    setRsvpError(null);
    try {
      await eventMutations.rsvpEvent({ id: event.id, responseStatus: status, sendNotifications: notify });
    } catch (e) {
      setRsvpError(e instanceof Error ? e.message : "RSVP failed");
      setPendingRsvp(null);
    }
  };

  const joinEntry = raw?.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === "video");

  const rsvpOptions: { status: AttendeeStatus; label: string }[] = [
    { status: "accepted", label: "Yes" },
    { status: "tentative", label: "Maybe" },
    { status: "declined", label: "No" },
  ];

  const hasAttendees = (raw?.attendees?.length ?? 0) > 0;

  const toTimeInput = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const applyTime = (iso: string, hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    const d = new Date(iso);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  const toDateInput = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  // Move the event to a new day, preserving time-of-day and duration (shift both
  // ends by the same delta). Commits on change — a date input has no natural blur.
  const commitDate = (ymd: string) => {
    const [y, mo, d] = ymd.split("-").map(Number);
    if (!y || !mo || !d) return;
    const ns = new Date(startAt);
    ns.setFullYear(y, mo - 1, d);
    const deltaMs = ns.getTime() - new Date(startAt).getTime();
    if (!deltaMs) return;
    const newStart = ns.toISOString();
    const newEnd = new Date(new Date(endAt).getTime() + deltaMs).toISOString();
    setStartAt(newStart);
    setEndAt(newEnd);
    eventMutations.updateEvent({ id: event.id, patch: { start_at: newStart, end_at: newEnd } });
  };

  return createPortal(
    <>
      {/* Popover card */}
      <div
        ref={popRef}
        className="pop-in fixed z-50 flex flex-col rounded-[var(--radius-lg)] border border-line bg-surface"
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
                className="w-full border-0 border-b border-transparent bg-transparent text-head font-semibold leading-snug outline-none placeholder:text-muted transition-colors hover:border-line focus:border-ink"
              />
            ) : (
              <div className="text-head font-semibold leading-snug">{event.title}</div>
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

            {/* When — the primary edit. Date + time carry ink weight (this is
                what the popover is most often opened to change). */}
            <div className="flex items-center gap-2.5">
              <span className="flex w-3.5 shrink-0 justify-center text-muted/70">
                <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
                  <rect x="1" y="2" width="10" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M1 5h10" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M4 1v2M8 1v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
              </span>
              {editable ? (
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1 text-body text-ink">
                  <input
                    type="date"
                    value={toDateInput(startAt)}
                    onChange={(e) => commitDate(e.target.value)}
                    className="fast rounded-md px-1 py-0.5 outline-none hover:bg-bg focus:bg-bg"
                  />
                  <input
                    type="time"
                    value={toTimeInput(startAt)}
                    onChange={(e) => setStartAt(applyTime(startAt, e.target.value))}
                    onBlur={() => startAt !== event.start_at && eventMutations.updateEvent({ id: event.id, patch: { start_at: startAt } })}
                    className="fast mono rounded-md px-1 py-0.5 outline-none hover:bg-bg focus:bg-bg"
                  />
                  <span className="text-muted">–</span>
                  <input
                    type="time"
                    value={toTimeInput(endAt)}
                    onChange={(e) => setEndAt(applyTime(endAt, e.target.value))}
                    onBlur={() => endAt !== event.end_at && eventMutations.updateEvent({ id: event.id, patch: { end_at: endAt } })}
                    className="fast mono rounded-md px-1 py-0.5 outline-none hover:bg-bg focus:bg-bg"
                  />
                </div>
              ) : (
                <span className="text-body text-ink">
                  {format(new Date(event.start_at), "EEE MMM d · h:mm a")}
                  {" – "}
                  {format(new Date(event.end_at), "h:mm a")}
                </span>
              )}
            </div>

            {/* Calendar / account — one field. The picker moves the event to any
                writable calendar in any account (native within an account, a
                confirmed copy across). Static label for read-only / single-target. */}
            {(calendarName || moveTargetCount > 0) && (
              <div className="flex items-start gap-2.5">
                {editable && moveTargetCount > 1 ? (
                  <CalendarPicker
                    groups={moveGroups}
                    currentAccountId={event.account_id}
                    currentCalendarId={calendarId}
                    currentLabel={calendarName}
                    currentColor={calendarColor}
                    accountEmail={accountEmail}
                    lossyWarn={recurring || hasAttendees}
                    onPick={(accountId, cid) =>
                      eventMutations.moveEventToCalendar({
                        id: event.id,
                        targetAccountId: accountId,
                        targetCalendarId: cid,
                      })
                    }
                  />
                ) : (
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: calendarColor ?? "var(--muted)" }}
                      />
                      <span className="truncate text-body text-ink">{calendarName ?? "Calendar"}</span>
                    </div>
                    {accountEmail && (
                      <div className="truncate pl-[18px] text-meta text-muted/60">{accountEmail}</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Location */}
            {editable ? (
              <div className="flex items-center gap-2.5">
                <span className="flex w-3.5 shrink-0 justify-center text-muted/70">
                  <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
                    <path d="M6 1C4.067 1 2.5 2.567 2.5 4.5c0 2.917 3.5 6.5 3.5 6.5s3.5-3.583 3.5-6.5C9.5 2.567 7.933 1 6 1z" stroke="currentColor" strokeWidth="1.2"/>
                    <circle cx="6" cy="4.5" r="1.2" stroke="currentColor" strokeWidth="1.1"/>
                  </svg>
                </span>
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  onBlur={() => {
                    const next = location.trim();
                    if (next !== (event.location ?? "")) {
                      eventMutations.updateEvent({ id: event.id, patch: { location: next || null } });
                    }
                  }}
                  placeholder="Add location"
                  className="fast -mx-1 min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 text-body text-ink outline-none transition-colors placeholder:text-body placeholder:text-muted/50 hover:bg-bg focus:bg-bg"
                />
              </div>
            ) : event.location ? (
              <div className="flex items-start gap-2.5 text-body text-ink">
                <span className="mt-[3px] flex w-3.5 shrink-0 justify-center text-muted/70">
                  <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
                    <path d="M6 1C4.067 1 2.5 2.567 2.5 4.5c0 2.917 3.5 6.5 3.5 6.5s3.5-3.583 3.5-6.5C9.5 2.567 7.933 1 6 1z" stroke="currentColor" strokeWidth="1.2"/>
                    <circle cx="6" cy="4.5" r="1.2" stroke="currentColor" strokeWidth="1.1"/>
                  </svg>
                </span>
                <span className="leading-snug">{event.location}</span>
              </div>
            ) : null}

            {/* Join meeting */}
            {joinEntry && (
              <a
                href={joinEntry.uri}
                target="_blank"
                rel="noopener noreferrer"
                className="fast inline-flex items-center gap-2 rounded-md border border-accent/30 bg-accent-soft px-3 py-1.5 text-caption font-medium text-accent hover:bg-accent hover:text-white"
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
                        className={`fast flex flex-1 items-center justify-center gap-1 rounded-md border py-2.5 text-body font-medium ${
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
                <label className="flex cursor-pointer items-center gap-2 text-label text-muted">
                  <input
                    type="checkbox"
                    checked={notify}
                    onChange={(e) => setNotify(e.target.checked)}
                    className="accent-[var(--accent)]"
                  />
                  Notify organizer
                </label>
                {rsvpError && (
                  <p className="text-meta text-signal">{rsvpError}</p>
                )}
              </div>
            )}

            {/* Organizer + Guests */}
            {(raw?.organizer || hasAttendees || editable) && (
              <div className="space-y-3 border-t border-line pt-3">
                {raw?.organizer && (
                  <div className="space-y-0.5">
                    <div className="section-label">Organizer</div>
                    <span className="text-body text-text">
                      {raw.organizer.displayName ?? raw.organizer.email}
                    </span>
                  </div>
                )}
                {hasAttendees && (
                  <div className="space-y-0.5">
                    <div className="section-label mb-1">
                      Guests ({raw!.attendees!.length})
                    </div>
                    {/* Filter out the organizer — they're already shown above */}
                    {raw!.attendees!.filter((a) => !a.organizer).map((a) => (
                      <AttendeeRow key={a.email} a={a} />
                    ))}
                    {(() => {
                      const list = raw!.attendees!;
                      const yes = list.filter((a) => a.responseStatus === "accepted").length;
                      const no = list.filter((a) => a.responseStatus === "declined").length;
                      const maybe = list.filter((a) => a.responseStatus === "tentative").length;
                      const waiting = list.filter((a) => a.responseStatus === "needsAction").length;
                      return (
                        <div className="mono mt-1.5 flex gap-3 text-meta text-muted">
                          {yes > 0 && <span className="text-green-600 dark:text-green-400">✓ {yes}</span>}
                          {maybe > 0 && <span className="text-yellow-600">? {maybe}</span>}
                          {no > 0 && <span className="text-signal">✗ {no}</span>}
                          {waiting > 0 && <span>· {waiting} awaiting</span>}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Add guest (editable Google events only) */}
                {editable && (
                  <div>
                    {!addingGuests ? (
                      <button
                        type="button"
                        onClick={() => setAddingGuests(true)}
                        className="fast flex items-center gap-1.5 text-meta text-accent hover:opacity-80"
                      >
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                          <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        </svg>
                        Add guest
                      </button>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <GuestsInput
                          value={newGuests}
                          onChange={setNewGuests}
                          placeholder="Name or email…"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={newGuests.length === 0 || inviting}
                            onClick={async () => {
                              if (!newGuests.length) return;
                              setInviting(true);
                              try {
                                await eventMutations.inviteToEvent({ id: event.id, attendees: newGuests });
                                setNewGuests([]);
                                setAddingGuests(false);
                              } finally {
                                setInviting(false);
                              }
                            }}
                            className="fast rounded-[var(--radius-sm)] bg-accent px-3 py-1 text-caption font-medium text-white hover:opacity-90 disabled:opacity-40"
                          >
                            {inviting ? "Sending…" : "Send invite"}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setAddingGuests(false); setNewGuests([]); }}
                            className="fast text-caption text-muted hover:text-ink"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Notes / description */}
            {editable ? (
              <div className="space-y-1.5 border-t border-line pt-3">
                <div className="section-label !p-0">Notes</div>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  onBlur={() => {
                    const original = plainTextFromHtml(raw?.description ?? "");
                    if (notes !== original) {
                      eventMutations.updateEvent({ id: event.id, patch: { description: notes } });
                    }
                  }}
                  placeholder="Add notes"
                  rows={notes ? Math.min(6, notes.split("\n").length + 1) : 2}
                  className="w-full resize-none rounded-md border border-line bg-transparent px-2 py-1.5 text-caption leading-relaxed text-text outline-none transition-colors placeholder:text-muted/50 focus:border-ink"
                />
              </div>
            ) : raw?.description ? (
              <div className="space-y-1.5 border-t border-line pt-3">
                <div className="section-label !p-0">Description</div>
                <DescriptionHtml html={raw.description} />
              </div>
            ) : null}

            {detailsLoading && (
              <div className="shimmer text-label pt-1">Loading details…</div>
            )}

          </div>
        </div>

        {/* Footer — open in Google / hide / delete.
            → Task is a quiet text action (not a peer Btn) so convert never reads
            as the primary CTA beside Hide / Delete. */}
        {(
          <div className="flex min-w-0 shrink-0 items-center gap-1.5 border-t border-line px-3 py-2.5">
            {hideMode && !hiddenNow ? (
              <>
                <span className="text-label text-muted">Hide…</span>
                <div className="min-w-0 flex-1" />
                <Btn onClick={() => setHideMode(false)}>Cancel</Btn>
                <Btn onClick={() => { hide(event, "THIS"); onClose(); }}>This event</Btn>
                <Btn onClick={() => { hide(event, "ALL"); onClose(); }}>All events</Btn>
              </>
            ) : (
            <>
            {raw?.htmlLink && (
              <a
                href={raw.htmlLink}
                target="_blank"
                rel="noopener noreferrer"
                className="fast shrink-0 text-label text-muted hover:text-ink"
                title="Open in Google Calendar"
              >
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="inline-block align-middle">
                  <path d="M5 2H2a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1V8M8 1h4m0 0v4m0-4L5.5 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="ml-1 align-middle">Google Cal</span>
              </a>
            )}
            {/* Hide / show — available for every event (keeps read-only calendars
                out of your way too); hiding never touches the server. */}
            {!confirmDelete && (
              hiddenNow ? (
                <Btn onClick={() => { const k = hiddenKeyFor(event); if (k) unhide(k); onClose(); }} title="Bring this event back onto the board">
                  Show
                </Btn>
              ) : (
                <Btn
                  onClick={() => { if (canHideSeries) setHideMode(true); else { hide(event, "THIS"); onClose(); } }}
                  title="Hide from the board and time-blocking — it stays on the server"
                >
                  Hide
                </Btn>
              )
            )}
            {onConvertToTask && !confirmDelete && (
              <button
                type="button"
                onClick={() => { onConvertToTask(); onClose(); }}
                title="Create a task from this event and hide the event"
                className="fast shrink-0 px-1.5 py-1 text-label text-muted hover:text-ink"
              >
                → Task
              </button>
            )}
            {editable && (
              !confirmDelete ? (
                <>
                  <div className="min-w-0 flex-1" />
                  <Btn kind="signal" onClick={() => setConfirmDelete(true)}>Delete</Btn>
                </>
              ) : recurring ? (
                <>
                  <span className="text-label text-muted">Delete…</span>
                  <div className="min-w-0 flex-1" />
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
                  <span className="text-label text-muted">Delete this event?</span>
                  <div className="min-w-0 flex-1" />
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
              )
            )}
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
  // Live reorder state: { id: dragged, index: target insertion slot }.
  const [reorder, setReorder] = useState<{ id: string; index: number } | null>(null);
  const { data: vertical } = useVertical();

  // Slot children are draggable OUT onto the calendar (or rail → inbox), reusing
  // FullCalendar's drop geometry. The reorder handle sits outside [data-task-drag]
  // so grabbing it never starts an FC drag — only the row body drags out.
  useEffect(() => {
    if (!popRef.current) return;
    const d = new Draggable(popRef.current, {
      itemSelector: "[data-task-drag]",
      minDistance: 6,
      eventData: (el) => ({
        title: el.getAttribute("data-task-title") ?? "task",
        duration: { minutes: Number(el.getAttribute("data-task-duration")) || 30 },
        create: true,
      }),
    });
    return () => d.destroy();
  }, []);

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

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
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

  // sorted for display: open first, completed at the bottom, then by sort_order.
  // Sorting by sort_order (not just array position) means an optimistic reorder
  // re-sorts instantly — no glitch waiting for the refetch to return new order.
  const ordered = [...childTasks].sort(
    (a, b) =>
      Number(a.status === "done") - Number(b.status === "done") || a.sort_order - b.sort_order,
  );
  const doneCount = ordered.filter((t) => t.status === "done").length;
  const totalMins = ordered.reduce((sum, t) => sum + (t.duration_minutes ?? 30), 0);

  // While the grip is dragged, show the list with the dragged row lifted out and
  // re-inserted at the target slot, so the reorder previews live.
  const displayOrder = (() => {
    if (!reorder) return ordered;
    const moved = ordered.find((t) => t.id === reorder.id);
    if (!moved) return ordered;
    const rest = ordered.filter((t) => t.id !== reorder.id);
    const idx = Math.max(0, Math.min(reorder.index, rest.length));
    rest.splice(idx, 0, moved);
    return rest;
  })();

  // The grip is the universal handle: drag within the list to reorder, or out of
  // the popover onto the rail (→ Inbox) or a calendar day (→ planned, un-slotted).
  const startReorder = (id: string, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const task = childTasks.find((t) => t.id === id);
    if (!task) return;
    // Capture each row's vertical midpoint ONCE. Computing the insert index from
    // these fixed positions (not the live, re-ordering DOM) keeps it stable — no
    // feedback loop where moving the row changes what's under the cursor.
    const mids = ordered.map((t) => {
      const r = popRef.current
        ?.querySelector(`[data-slot-row="${t.id}"]`)
        ?.getBoundingClientRect();
      return r ? r.top + r.height / 2 : Number.POSITIVE_INFINITY;
    });
    let index = ordered.findIndex((t) => t.id === id);
    let out: null | { kind: "inbox" } | { kind: "day"; date: string } = null;
    const railEl = () => document.querySelector<HTMLElement>("[data-rail-drop]");
    setReorder({ id, index });
    const onMove = (ev: PointerEvent) => {
      const pop = popRef.current?.getBoundingClientRect();
      const inside =
        !!pop &&
        ev.clientX >= pop.left && ev.clientX <= pop.right &&
        ev.clientY >= pop.top && ev.clientY <= pop.bottom;
      if (inside) {
        // Reorder mode — insert index = how many *other* rows start above the
        // cursor, measured against the captured (fixed) midpoints.
        out = null;
        railEl()?.classList.remove("rail-drop-active");
        let i = 0;
        ordered.forEach((t, k) => {
          if (t.id !== id && mids[k] < ev.clientY) i++;
        });
        if (i !== index) {
          index = i;
          setReorder({ id, index });
        }
      } else {
        // Drag-out mode — figure out the destination under the pointer.
        setReorder(null);
        const under = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
        if (under?.closest("[data-rail-drop]")) {
          out = { kind: "inbox" };
          railEl()?.classList.add("rail-drop-active");
        } else {
          railEl()?.classList.remove("rail-drop-active");
          const date = under?.closest("[data-date]")?.getAttribute("data-date");
          out = date ? { kind: "day", date } : null;
        }
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setReorder(null);
      railEl()?.classList.remove("rail-drop-active");
      if (out?.kind === "inbox") return void taskMutations.backToInbox(task);
      if (out?.kind === "day") return void taskMutations.planFor(task, out.date);
      // Otherwise: reorder within the slot, committing fresh sort_order.
      const rest = ordered.filter((t) => t.id !== id);
      const idx = Math.max(0, Math.min(index, rest.length));
      rest.splice(idx, 0, task);
      rest.forEach((t, i) => {
        if (t.sort_order !== i) taskMutations.patchTask(t.id, { sort_order: i });
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

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

  // A standing "domain slot": tag the block to a domain directly (no project
  // needed). With Repeat set, the weekly plan routes this domain's work here —
  // see docs/standing-slots.md. Clears any project so the affinity reads clean.
  const setDomain = (domainId: string) => {
    const d = domainById(vertical, domainId || null);
    slotMutations.updateSlot({
      id: slot.id,
      patch: {
        domain_id: d?.id ?? null,
        project_id: null,
        color: d?.color ?? slot.color,
      },
    });
  };

  return createPortal(
    <>
      <div
        ref={popRef}
        className="pop-in fixed z-50 flex flex-col rounded-[var(--radius-lg)] border border-line bg-surface"
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
            <div className="mono mb-1 text-micro font-semibold uppercase tracking-widest text-muted">
              🗂 Time slot
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => e.key === "Enter" && commitTitle()}
              className="w-full border-0 bg-transparent text-head font-semibold leading-snug outline-none placeholder:text-muted/70"
              placeholder={derivedTitle}
            />
            {!slot.title.trim() && (
              <div className="mono mt-0.5 text-meta text-muted/70">✦ auto-named — type to override</div>
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
          <label className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-bg px-2.5 py-1 text-label hover:brightness-95 dark:hover:brightness-110">
            <span className="text-ink">{format(new Date(slot.do_date + "T12:00:00"), "MMM d")}</span>
            <input
              type="date"
              value={slot.do_date}
              onChange={(e) => setDate(e.target.value)}
              className="absolute inset-0 w-full cursor-pointer opacity-0"
            />
          </label>
          <label className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-bg px-2.5 py-1 text-label hover:brightness-95 dark:hover:brightness-110">
            <span className="text-ink">{format(startDate, "h:mm a")}</span>
            <input
              type="time"
              step={900}
              value={startHHMM}
              onChange={(e) => setTime(e.target.value)}
              className="absolute inset-0 w-full cursor-pointer opacity-0"
            />
          </label>
          <label className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-bg px-2.5 py-1 text-label hover:brightness-95 dark:hover:brightness-110">
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
            className="relative inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-label font-medium hover:bg-bg"
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
                .filter((p) => !isProjectComplete(p.status) || p.id === slot.project_id)
                .map((p) => {
                  const d = domainById(vertical, p.domainId);
                  return <option key={p.id} value={p.id}>{d ? `${d.name} · ` : ""}{p.name}</option>;
                })}
            </select>
          </label>

          {/* Domain chip — a standing "domain slot": with Repeat set, the weekly
              plan routes this domain's work into it (docs/standing-slots.md).
              Shown only when no project drives the domain, so it reads as one
              affinity, not two. */}
          {!slot.project_id && (
            <label
              className="relative inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-label font-medium hover:bg-bg"
              style={{ color: domain?.color ?? "var(--muted)" }}
            >
              <span>{slot.domain_id ? (domain?.name ?? "domain") : "+ domain"}</span>
              <select
                value={slot.domain_id ?? ""}
                onChange={(e) => setDomain(e.target.value)}
                className="absolute inset-0 w-full cursor-pointer opacity-0"
              >
                <option value="">— none —</option>
                {vertical.domains.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </label>
          )}

          {/* Repeat */}
          <RepeatControl
            anchorISO={slot.do_date}
            value={recurrence ? ruleOf(recurrence) : null}
            onChange={applyRepeat}
          />
        </div>

        {/* Progress */}
        <div className="mono flex shrink-0 items-center gap-2 border-t border-line px-4 py-2 text-meta text-muted">
          <span>{doneCount}/{ordered.length} done</span>
          {totalMins > 0 && <span>· {fmtDuration(totalMins)} of tasks</span>}
        </div>

        {/* Child tasks — grip to reorder, body drags out (calendar / inbox) */}
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
          {displayOrder.map((t) => {
            const done = t.status === "done";
            const dragging = reorder?.id === t.id;
            return (
              <div
                key={t.id}
                data-slot-row={t.id}
                className={`group flex items-center gap-0.5 rounded-md pr-1 hover:bg-bg ${
                  dragging
                    ? "pointer-events-none bg-accent-soft text-accent shadow-[inset_0_3px_0_0_var(--accent)]"
                    : ""
                }`}
              >
                <button
                  aria-label="Drag to reorder, or out to the inbox or a day"
                  title="Drag to reorder · drag out to the rail (inbox) or a calendar day"
                  onPointerDown={(e) => startReorder(t.id, e)}
                  className="fast flex h-8 w-4 shrink-0 cursor-grab touch-none items-center justify-center text-muted/40 opacity-0 group-hover:opacity-100 hover:text-muted"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                    <circle cx="3" cy="2" r="1" /><circle cx="7" cy="2" r="1" />
                    <circle cx="3" cy="5" r="1" /><circle cx="7" cy="5" r="1" />
                    <circle cx="3" cy="8" r="1" /><circle cx="7" cy="8" r="1" />
                  </svg>
                </button>
                <div
                  data-task-drag={t.id}
                  data-task-title={t.title}
                  data-task-duration={t.duration_minutes ?? ""}
                  className="flex min-w-0 flex-1 cursor-grab items-center gap-2 py-1.5"
                  title="Drag onto the calendar, or the rail to send to Inbox"
                >
                  <button
                    aria-label="toggle done"
                    onClick={() => (done ? taskMutations.uncomplete(t) : taskMutations.complete(t))}
                    onPointerDown={(e) => e.stopPropagation()}
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
                    className={`min-w-0 flex-1 truncate text-left text-caption ${
                      done ? "text-muted line-through" : "text-text"
                    }`}
                  >
                    {t.title}
                  </button>
                </div>
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
          {displayOrder.length === 0 && (
            <div className="px-2 py-3 text-caption italic text-muted/70">No tasks yet — add one below.</div>
          )}
        </div>

        {/* Add task */}
        <div className="shrink-0 border-t border-line px-3 py-2.5">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTask()}
            placeholder="+ Add task to slot…"
            className="w-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-caption outline-none focus:border-accent"
          />
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-3">
          <div className="flex-1" />
          <SlotDeleteButton
            recurring={Boolean(slot.recurrence_id && recurrence)}
            taskCount={ordered.length}
            dayLabel={format(new Date(slot.do_date + "T12:00:00"), "MMM d")}
            onDelete={(scope: SlotDeleteScope, deleteTasks: boolean) => {
              // Keep (default): children fall back onto the day, un-slotted (the
              // FK sets slot_id null). Delete: trash them with the slot.
              if (deleteTasks) ordered.forEach((t) => taskMutations.trash(t));
              if (scope === "series") {
                if (recurrence) recurrenceMutations.deleteSeries(recurrence);
              } else if (scope === "following") {
                if (recurrence) recurrenceMutations.deleteFollowing(recurrence, slot.do_date);
              } else {
                // "simple" (non-recurring) or "this" occurrence
                if (scope === "this" && recurrence && slot.recurrence_date)
                  recurrenceMutations.skipOccurrence(recurrence, slot.recurrence_date);
                slotMutations.removeSlot(slot);
              }
              onClose();
            }}
          />
        </div>
      </div>
    </>,
    document.body,
  );
}
