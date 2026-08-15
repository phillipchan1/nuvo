import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { GuestsInput } from "./GuestsInput";
import { Icon } from "./Icon";
import ReactMarkdown from "react-markdown";
import { createPortal } from "react-dom";
import { Draggable } from "@fullcalendar/interaction";
import { format } from "date-fns";
import type { AttendeeStatus, CalendarAccount, ExternalEvent, GoogleAttendee, Label, Recurrence, Slot, Task } from "../lib/types";
import { DEFAULT_DURATION_MINUTES, DURATION_PRESETS, ruleOf } from "../lib/types";
import { CALENDAR_OFFLINE_NOTE, providerLabel, writableCalendarTargets, type MoveTargetGroup } from "../lib/calendarWrite";
import { conferenceName, joinUrl } from "../../supabase/functions/_shared/conferencing.ts";
import type { useTaskMutations } from "../hooks/useTasks";
import type { useExternalEventMutations } from "../hooks/useCalendar";
import type { useSlotMutations } from "../hooks/useSlots";
import type { useRecurrenceMutations, SeriesTemplate } from "../hooks/useRecurrence";
import { useEventDetails, useEventSeriesRule, useHiddenEvents } from "../hooks/useCalendar";
import { eventKey, eventSeriesKey } from "../lib/now";
import ReminderSelect from "./ReminderSelect";
import TaskSteps from "./TaskSteps";
import { plainTextFromHtml } from "../lib/text";
import { useQueryClient } from "@tanstack/react-query";
import { useVertical } from "../hooks/useVertical";
import { domainById, initiativeById, isProjectComplete, projectById, taskDomainId, taskInitiativeId } from "../lib/vertical";
import { allDayInclusiveEnd, allDayRangeFromStart, defaultTimedRange, fmtDuration, parseDateISO, toDateISO, todayISO } from "../lib/dates";
import { deriveSlotTitle } from "../lib/slots";
import { rulesEqual, describeRule, fromGoogleRRULE, toGoogleRRULE, type RecurrenceRule } from "../lib/recurrence";
import {
  POP_INPUT_CLS,
  POP_W_NARROW,
  POP_W_WIDE,
  PopBody,
  PopCol,
  PopField,
  PopFootAct,
  PopFooter,
  PopLabel,
  PopMast,
  PopMetaDot,
  PopPrimary,
  PopSection,
  PopSegmented,
  PopSkeleton,
  PopStack,
  PopStrip,
} from "./PopoverParts";
import { ASSISTANT_NAME } from "../lib/assistant";
import { supabase } from "../lib/supabase";
import { toast } from "sonner";
import { markCalendarClickHandled } from "../lib/calendarDismissGuard";
import { anchoredTop } from "../lib/anchoredTop";
import { RecurrenceDeleteButton, RepeatControl, SlotDeleteButton, type SlotDeleteScope } from "./RecurrencePicker";
import { Btn } from "./ui";
import { isTypingIn } from "./floors/TaskList";

/**
 * Priority as tokens, not raw Tailwind — `bg-amber-400` for "medium" was one
 * of two colours on the Schedule no skin could answer for. High is the same
 * `--signal` the now-line uses; medium is the "waiting on something" warn.
 */
const PRIORITY_TOKEN: Record<"high" | "medium" | "low" | "none", string> = {
  high: "var(--signal)",
  medium: "var(--warn)",
  low: "var(--accent)",
  none: "var(--muted)",
};

/** Minutes after local midnight for an ISO instant (for series templates). */
function localMinutes(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Positions an anchored popover beside its trigger, and keeps it glued there.
 * The trigger's `DOMRect` is only a snapshot from click time — if `anchorEl`
 * (the live trigger element) is given, its position is re-measured on scroll
 * and resize, so the popover follows a calendar block instead of freezing
 * mid-air when the grid scrolls underneath it. `onDismiss` fires if the
 * anchor element is later removed from the DOM (e.g. a view switch).
 */
function useAnchoredPosition({
  anchorEl,
  anchorRect,
  popRef,
  width,
  gap,
  disabled,
  onDismiss,
  align = "center",
  holdHeight,
}: {
  anchorEl: HTMLElement | null | undefined;
  anchorRect: DOMRect;
  popRef: React.RefObject<HTMLDivElement>;
  width: number;
  gap: number;
  disabled?: boolean;
  onDismiss?: () => void;
  /** "center" aligns the popover to the anchor's middle; "top" hugs its top. */
  align?: "center" | "top";
  /** Keep using the last measured height when deciding how far to lift the
   *  popover off the viewport bottom. Set while a panel that can outgrow the
   *  popover is open (the slot's task slide-out) so its extra height scrolls
   *  inside the card instead of sliding the whole card upward. */
  holdHeight?: boolean;
}) {
  const [state, setState] = useState(() => ({
    top: anchorRect.top,
    left: anchorRect.right + gap,
    side: "right" as "right" | "left",
    anchorTop: anchorRect.top,
    anchorHeight: anchorRect.height,
    /** Room left between `top` and the viewport bottom. */
    maxHeight: 0,
    viewportWidth: typeof window === "undefined" ? 0 : window.innerWidth,
  }));

  const frozenRef = useRef<{
    el: HTMLElement | null;
    rect: DOMRect;
    vw: number;
    width: number;
    left: number;
    side: "right" | "left";
    /** Where the card was put for this anchor, and where the anchor was then —
     *  the pair that lets a later placement FOLLOW the anchor without ever
     *  re-deriving the card's position from its own (changing) height. */
    top: number;
    anchorTop: number;
  } | null>(null);
  const heldHeightRef = useRef(0);

  const place = useCallback(() => {
    if (anchorEl && !anchorEl.isConnected) {
      onDismiss?.();
      return;
    }
    const rect = anchorEl ? anchorEl.getBoundingClientRect() : anchorRect;
    const pop = popRef.current;
    if (!pop) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const h = pop.offsetHeight;
    // Horizontal placement is decided ONCE per (anchor, viewport) and then held.
    // The anchor is a live calendar block whose *width* changes underneath us:
    // CalendarPane expands the clicked block to the full column (`.evt-focused`)
    // and drops that the moment you press anywhere that isn't a block — including
    // a task row inside this very popover. Re-deriving `left` from each fresh
    // measurement made the popover chase that ~280px reflow sideways every time
    // you opened a task. Vertical still tracks live, so the popover keeps
    // following its block when the grid scrolls.
    const frozen = frozenRef.current;
    const sameAnchor =
      frozen && frozen.el === (anchorEl ?? null) && (anchorEl ? true : frozen.rect === anchorRect);
    let left: number;
    let side: "right" | "left";
    if (sameAnchor && frozen.vw === vw && frozen.width === width) {
      ({ left, side } = frozen);
    } else {
      left = rect.right + gap;
      side = "right";
      if (left + width > vw - 8) {
        left = rect.left - gap - width;
        side = "left";
      }
      left = Math.max(8, left);
    }
    // Vertical DOES track the anchor live (the popover has to follow its block
    // when the time grid scrolls), but the height it budgets for itself is held
    // while `holdHeight` is set — otherwise the slide-out's taller content
    // re-runs the "lift it off the bottom edge" clamp and walks the whole card
    // up the screen as it opens.
    if (!holdHeight || !heldHeightRef.current) heldHeightRef.current = h;
    const budget = heldHeightRef.current;
    // Centre on the anchor ONCE, when this anchor is first placed. After that the
    // card follows the anchor's own movement (scrolling the grid) and is only
    // ever nudged to stay on screen. Re-centring on every placement meant every
    // height change re-derived the position — so a detail popover visibly jumped
    // the moment its async details landed and the card grew. A card that has
    // been put somewhere stays there; growth extends it downward.
    const top = anchoredTop({
      align,
      anchorTop: rect.top,
      anchorHeight: rect.height,
      height: budget,
      viewportHeight: vh,
      previous: sameAnchor && frozen ? { top: frozen.top, anchorTop: frozen.anchorTop } : undefined,
    });
    frozenRef.current = {
      el: anchorEl ?? null,
      rect: anchorRect,
      vw,
      width,
      left,
      side,
      top,
      anchorTop: rect.top,
    };
    setState((prev) =>
      prev.top === top &&
      prev.left === left &&
      prev.side === side &&
      prev.anchorTop === rect.top &&
      prev.anchorHeight === rect.height &&
      prev.maxHeight === vh - top - 8 &&
      prev.viewportWidth === vw
        ? prev
        : {
            top,
            left,
            side,
            anchorTop: rect.top,
            anchorHeight: rect.height,
            maxHeight: vh - top - 8,
            viewportWidth: vw,
          },
    );
  }, [anchorEl, anchorRect, popRef, width, gap, onDismiss, align, holdHeight]);

  useLayoutEffect(() => {
    if (!disabled) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, place]);

  // The card's own height changes under it — details arrive, a guest list fills,
  // a confirm row opens. Re-place on that too, so a card that grew past the
  // bottom edge lifts by exactly the overflow instead of hanging off-screen
  // until the next scroll. With the "placed once, then followed" rule above,
  // a height change that still fits moves the card by nothing at all.
  useEffect(() => {
    if (disabled) return;
    const el = popRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => place());
    ro.observe(el);
    return () => ro.disconnect();
  }, [disabled, place, popRef]);

  useEffect(() => {
    if (disabled) return;
    window.addEventListener("resize", place);
    // Capture phase: scroll events on an inner scrollable ancestor (the
    // calendar's own time-grid scroller) don't bubble to window.
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [disabled, place]);

  return state;
}

export function TaskPopover({
  task,
  anchor,
  anchorEl,
  labels,
  mutations,
  recurrence,
  recurrenceMutations,
  onClose,
  onConvertToEvent,
  onBack,
  backLabel,
  variant = "anchored",
}: {
  task: Task;
  anchor: DOMRect;
  /** Live trigger element (e.g. the clicked calendar block) — when given, the
   *  popover follows it on scroll/resize instead of freezing at `anchor`. */
  anchorEl?: HTMLElement | null;
  labels: Label[];
  mutations: ReturnType<typeof useTaskMutations>;
  /** The series this task belongs to (if any) — drives the repeat chip. */
  recurrence: Recurrence | null;
  recurrenceMutations: ReturnType<typeof useRecurrenceMutations>;
  onClose: () => void;
  onConvertToEvent?: () => void;
  /** When opened from a slot popover — back returns to the slot (history.back). */
  onBack?: () => void;
  backLabel?: string;
  /** "anchored" (default) floats beside a calendar block with an arrow; "centered"
   *  renders the same card as a scrim-backed modal, summonable from ⌘K on any rung.
   *  "slideout" fills a pane inside SlotPopover — no portal or positioning. */
  variant?: "anchored" | "centered" | "slideout";
}) {
  const centered = variant === "centered";
  const slideout = variant === "slideout";
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [preparing, setPreparing] = useState(false);
  const [prepError, setPrepError] = useState<string | null>(null);
  const qc = useQueryClient();
  const { data: vertical, toggleTaskSprint } = useVertical();
  const popRef = useRef<HTMLDivElement>(null);
  // Two columns wherever the card floats on its own. Inside the slot popover
  // the card IS the second column already, so it stays single there.
  const twoCol = !slideout;
  const TASK_POP_W = twoCol ? POP_W_WIDE : POP_W_NARROW;

  const pos = useAnchoredPosition({
    anchorEl,
    anchorRect: anchor,
    popRef,
    width: TASK_POP_W,
    gap: 10,
    disabled: centered || slideout,
    onDismiss: onClose,
  });

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
  const initiative = initiativeById(vertical, taskInitiativeId(vertical, task));
  const domain = domainById(vertical, taskDomainId(vertical, task));
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (onBack) onBack();
        else onClose();
      }
    };
    if (slideout) return;
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onBack, slideout]);

  useEffect(() => {
    if (slideout) return;
    const onDown = (e: MouseEvent) => {
      // Use composedPath() (frozen at dispatch time), not contains(e.target):
      // a row inside the popover can remove itself from the DOM synchronously
      // in its own mousedown handler (e.g. GuestsInput's "add guest" — see
      // GuestsInput.tsx), which would make e.target read as already-detached
      // and falsely look like an outside click by the time this listener runs.
      if (!popRef.current || e.composedPath().includes(popRef.current)) return;
      // This click dismisses the popover only — mark it so the calendar
      // grid's own click-to-create handling (a separate system reacting to
      // the same physical click) skips opening a second, unwanted draft.
      markCalendarClickHandled();
      // Force any pending blur-to-commit edit (title/notes…) through before the
      // calendar grid's own mousedown handling (which calls preventDefault to
      // support click-drag) can suppress the native blur and drop it silently.
      if (popRef.current.contains(document.activeElement)) {
        (document.activeElement as HTMLElement | null)?.blur();
      }
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose, slideout]);

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

  const dismiss = onBack ?? onClose;

  // The masthead's one line — the same read the chips below let you change.
  const whenSummary = task.do_date
    ? `${doDateLabel}${task.start_time ? ` · ${format(new Date(task.start_time), "h:mm a")}` : ""} · ${fmtDuration(task.duration_minutes ?? 30)}`
    : task.status === "inbox"
      ? "in the inbox — no date yet"
      : "no date";
  const repeatLabel = recurrence
    ? describeRule(ruleOf(recurrence), task.do_date ?? todayISO())
    : null;

  // Delegation and the record's stamps read the same in both layouts — they
  // move column, they never disappear (the slide-out lost them once).
  const prework = (
    <>
      {task.prework && task.prework_at ? (
        <div className="rounded-lg bg-bg px-3 py-2.5">
          <div className="max-h-[200px] overflow-y-auto text-caption leading-relaxed text-text [&_h1]:mb-1 [&_h1]:text-body [&_h1]:font-semibold [&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-caption [&_h2]:font-semibold [&_h3]:mb-0.5 [&_h3]:mt-1.5 [&_h3]:text-label [&_h3]:font-semibold [&_li]:ml-3 [&_ol]:my-1 [&_ol]:list-decimal [&_p]:mb-1 [&_strong]:font-semibold [&_ul]:my-1 [&_ul]:list-disc">
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
    </>
  );
  const stamps = (
    <>
      created {format(new Date(task.created_at), "MMM d yyyy")}
      {task.completed_at && (
        <span className="ml-2.5">completed {format(new Date(task.completed_at), "MMM d yyyy")}</span>
      )}
    </>
  );

  const card = (
      <div
        ref={slideout ? undefined : popRef}
        data-block-popover=""
        className={`${centered ? "moment" : slideout ? "" : "pop-in"} ${slideout ? "h-full" : centered ? "relative" : "fixed"} ${slideout ? "" : onBack ? "z-[55]" : "z-50"} flex flex-col ${slideout ? "" : "rounded-[var(--radius-lg)] border border-line bg-surface"}`}
        style={{
          ...(centered || slideout ? {} : { top: pos.top, left: pos.left }),
          ...(slideout ? {} : { width: TASK_POP_W, maxHeight: "min(620px, calc(100vh - 24px))", boxShadow: "var(--shadow-3)" }),
        }}
      >
        {/* Arrow connector — anchored variant only (the modal has no anchor). */}
        {!centered && !slideout && (
        <div
          className="absolute h-2.5 w-2.5 rotate-45 border border-line bg-surface"
          style={
            pos.side === "right"
              ? {
                  left: -6,
                  top: Math.max(16, Math.min(
                    pos.anchorTop + pos.anchorHeight / 2 - pos.top - 5,
                    (popRef.current?.offsetHeight ?? 200) - 16,
                  )),
                  borderRight: "none",
                  borderTop: "none",
                }
              : {
                  right: -6,
                  top: Math.max(16, Math.min(
                    pos.anchorTop + pos.anchorHeight / 2 - pos.top - 5,
                    (popRef.current?.offsetHeight ?? 200) - 16,
                  )),
                  borderLeft: "none",
                  borderBottom: "none",
                }
          }
        />
        )}

        {/* Masthead — the thread up the vertical, the name, then ONE line of
            when. The chips below edit it; this line is the read. */}
        <PopMast
          dot={domain?.color ?? undefined}
          onClose={onClose}
          eyebrow={
            <>
              {onBack && backLabel && (
                <button
                  type="button"
                  onClick={onBack}
                  className="fast mono mb-1 flex max-w-full items-center gap-1 truncate text-meta text-muted hover:text-ink"
                >
                  <span aria-hidden>←</span>
                  <span className="truncate">{backLabel}</span>
                </button>
              )}
              {(domain || initiative || project) && (
                <div className="mono mb-1 flex items-center gap-1 truncate text-meta">
                  {domain && <span style={{ color: domain.color }}>{domain.icon} {domain.name}</span>}
                  {initiative && <><span className="text-muted">›</span><span className="truncate text-muted">{initiative.name}</span></>}
                  {project && <><span className="text-muted">›</span><span className="truncate text-muted">{project.name}</span></>}
                </div>
              )}
            </>
          }
          meta={
            <>
              <span className="mono">{whenSummary}</span>
              {repeatLabel && (
                <>
                  <PopMetaDot />
                  <span title="Repeats">↻ {repeatLabel}</span>
                </>
              )}
              {task.deadline && (
                <>
                  <PopMetaDot />
                  <span className="text-signal">⚑ due {format(new Date(task.deadline + "T12:00:00"), "MMM d")}</span>
                </>
              )}
              {task.roll_count > 0 && (
                <>
                  <PopMetaDot />
                  <span>rolled {task.roll_count}×</span>
                </>
              )}
            </>
          }
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => e.key === "Enter" && commitTitle()}
            className="w-full border-0 bg-transparent text-head font-semibold leading-snug outline-none placeholder:text-muted"
            placeholder="Task title…"
            aria-label="Task title"
          />
        </PopMast>

        {/* Action strip — the acts you opened it for: finish it, or claim it
            for this week. Everything else is a field. */}
        <PopStrip>
          {task.status === "done" ? (
            <button
              type="button"
              onClick={() => mutations.uncomplete(task)}
              className="fast tap inline-flex shrink-0 items-center gap-2 rounded-[var(--radius-sm)] border border-line bg-surface px-3 py-1.5 text-label font-medium text-muted hover:border-line-strong hover:text-ink"
            >
              Reopen
            </button>
          ) : (
            <PopPrimary onClick={() => { mutations.complete(task); dismiss(); }} icon={<Icon name="check" size={11} />}>
              Done
            </PopPrimary>
          )}
          {task.start_time && (
            <button
              type="button"
              onClick={() => mutations.unblock(task)}
              title="Take it off the clock — it stays planned for the day"
              className="fast tap inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-line bg-surface px-3 py-1.5 text-label font-medium text-muted hover:border-line-strong hover:text-ink"
            >
              Unblock
            </button>
          )}
          <button
            type="button"
            onClick={() => toggleTaskSprint(task.id)}
            aria-pressed={inWeek}
            title={inWeek ? "In this week — click to release" : "Commit to this week"}
            className={`fast tap ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-1.5 text-label font-medium ${
              inWeek
                ? "border-signal/35 bg-signal-soft text-signal"
                : "border-line text-muted hover:border-line-strong hover:text-ink"
            }`}
          >
            <span aria-hidden>{inWeek ? "★" : "☆"}</span>
            This week
          </button>
        </PopStrip>

        {/* Left = the task's facts · right = its words and Nuvo's pre-work. */}
        <PopBody>
          <PopCol side={twoCol ? "left" : "only"}>
            <PopStack>
              <PopField label="When">
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* Date chip */}
                  <label className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-bg px-2.5 py-1 text-label hover:brightness-95 dark:hover:brightness-110">
                    <Icon name="calendar" size={10} className="shrink-0 text-muted/70" />
                    <span className={task.do_date ? "text-ink" : "text-muted"}>{doDateLabel ?? "no date"}</span>
                    <input
                      type="date"
                      aria-label="Do date"
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
                    <Icon name="clock" size={10} className="shrink-0 text-muted/70" />
                    <span className={task.start_time ? "text-ink" : "text-muted"}>
                      {task.start_time ? format(new Date(task.start_time), "h:mm a") : "no time"}
                    </span>
                    <input
                      type="time"
                      step={900}
                      aria-label="Start time"
                      value={startHHMM}
                      onChange={(e) => setStart(e.target.value)}
                      className="absolute inset-0 w-full cursor-pointer opacity-0"
                    />
                  </label>

                  {/* Duration chip */}
                  <label className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-bg px-2.5 py-1 text-label hover:brightness-95 dark:hover:brightness-110">
                    <Icon name="duration" size={10} className="shrink-0 text-muted/70" />
                    <span className="text-ink">{fmtDuration(task.duration_minutes ?? 30)}</span>
                    <Icon name="chevron-down" size={7} className="text-muted/50" />
                    <select
                      aria-label="Duration"
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
                    <span aria-hidden>⚑</span>
                    <span>{task.deadline ? task.deadline.slice(5).replace("-", "/") : "deadline"}</span>
                    <input
                      type="date"
                      aria-label="Deadline"
                      value={task.deadline ?? ""}
                      onChange={(e) => mutations.patchTask(task.id, { deadline: e.target.value || null })}
                      className="absolute inset-0 w-full cursor-pointer opacity-0"
                    />
                  </label>

                  <RepeatControl
                    anchorISO={task.do_date ?? todayISO()}
                    value={recurrence ? ruleOf(recurrence) : null}
                    onChange={applyRepeat}
                    disabled={!task.do_date}
                  />
                </div>
              </PopField>

              <PopField label="Filed under">
                <div className="flex flex-wrap items-center gap-1">
                  {/* Domain chip wrapping invisible select */}
                  <label
                    className="relative inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-label font-medium hover:bg-bg"
                    style={{ color: domain?.color ?? "var(--muted)" }}
                  >
                    {domain ? <><span>{domain.icon}</span><span>{domain.name}</span></> : <span>+ domain</span>}
                    <select
                      aria-label="Domain"
                      value={domain?.id ?? ""}
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
                      aria-label="Project"
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
                </div>
                {/* Auto-domain suggestion — Nuvo's guess sits with the filing it
                    would change, not in a panel three fields away. */}
                {suggestedDomain && (
                  <div className="mt-1 flex items-center gap-2 text-label text-muted">
                    <span>✦ looks like</span>
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
                  </div>
                )}
              </PopField>

              {/* Remind — only offered once the task has a moment to be early
                  for. A task with neither a block nor a deadline has nothing to
                  remind about, and an empty control there would be a lie. */}
              {(task.start_time || task.deadline) && (
                <PopField label="Remind">
                  <div className="flex flex-col gap-1">
                    {task.start_time && (
                      <ReminderSelect block target={{ targetKind: "task", targetId: task.id, anchor: "start" }} />
                    )}
                    {task.deadline && (
                      <div className="flex items-baseline gap-2">
                        <ReminderSelect block target={{ targetKind: "task", targetId: task.id, anchor: "deadline" }} />
                        <span className="shrink-0 text-micro text-muted/70">deadline</span>
                      </div>
                    )}
                  </div>
                </PopField>
              )}

              <PopField label="Priority">
                <div className="flex items-center gap-1.5">
                  {(["high", "medium", "low", "none"] as const).map((p) => {
                    const on = task.priority === p;
                    return (
                      <button
                        key={p}
                        onClick={() => mutations.patchTask(task.id, { priority: p })}
                        aria-pressed={on}
                        className={`fast inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-label capitalize ${
                          on ? "border-transparent font-medium text-ink" : "border-line text-muted hover:border-line-strong hover:text-ink"
                        }`}
                        style={
                          on
                            ? {
                                borderColor: `color-mix(in srgb, ${PRIORITY_TOKEN[p]} 45%, transparent)`,
                                background: `color-mix(in srgb, ${PRIORITY_TOKEN[p]} 12%, transparent)`,
                              }
                            : undefined
                        }
                      >
                        {/* The token is the mark, never the label — `--warn` on
                            light paper is a legible dot and illegible 11px text. */}
                        <span
                          className="h-[6px] w-[6px] rounded-full"
                          style={{ backgroundColor: on ? PRIORITY_TOKEN[p] : "var(--line-strong)" }}
                          aria-hidden
                        />
                        {p}
                      </button>
                    );
                  })}
                </div>
              </PopField>

              {labels.length > 0 && (
                <PopField label="Labels">
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
                          aria-pressed={on}
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
                </PopField>
              )}

              {/* One column (inside the slot's slide-out) — the words and the
                  pre-work still have to be reachable, just stacked. */}
              {!twoCol && (
                <>
                  <PopField label="Steps">
                    <TaskSteps task={task} mutations={mutations} />
                  </PopField>

                  <PopField label="Notes">
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      onBlur={commitNotes}
                      rows={3}
                      aria-label="Notes"
                      className="w-full resize-none rounded-md border border-transparent bg-transparent px-1.5 py-1 text-caption leading-relaxed text-text outline-none transition-colors placeholder:text-muted/55 hover:border-line hover:bg-bg focus:border-line-strong focus:bg-bg"
                      placeholder="Notes…"
                    />
                  </PopField>
                  <PopField label={`✦ ${ASSISTANT_NAME}`}>{prework}</PopField>
                  <div className="mono text-micro text-muted/70">{stamps}</div>
                </>
              )}
            </PopStack>
          </PopCol>

          {twoCol && (
            <PopCol side="right">
              {/* Steps above Notes: the checklist IS the work, notes are
                  commentary on it. A step is not a task — see TaskSteps. */}
              <PopSection label="Steps">
                <TaskSteps task={task} mutations={mutations} />
              </PopSection>

              <PopSection label="Notes" divider>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  onBlur={commitNotes}
                  rows={notes ? Math.min(8, notes.split("\n").length + 1) : 3}
                  aria-label="Notes"
                  className="w-full resize-none rounded-md border border-transparent bg-transparent px-1.5 py-1 text-caption leading-relaxed text-text outline-none transition-colors placeholder:text-muted/55 hover:border-line hover:bg-bg focus:border-line-strong focus:bg-bg"
                  placeholder="Notes…"
                />
              </PopSection>

              <PopSection label={`✦ ${ASSISTANT_NAME}`} divider className="flex-1">
                {prework}
              </PopSection>

              <div className="mono mt-auto px-4 pb-3 pt-1 text-micro text-muted/70">{stamps}</div>
            </PopCol>
          )}
        </PopBody>

        {/* Footer — the rare transforms read as text; Trash is quiet until it
            asks which occurrences you meant. */}
        <PopFooter>
          {task.status !== "inbox" && task.status !== "done" && (
            <PopFootAct
              title="Move back to inbox"
              onClick={() => { mutations.backToInbox(task, { undo: "toast" }); dismiss(); }}
            >
              → Inbox
            </PopFootAct>
          )}
          {onConvertToEvent && task.start_time && (
            <PopFootAct
              title="Convert to a calendar event and remove the task"
              onClick={() => { onConvertToEvent(); dismiss(); }}
            >
              → Event
            </PopFootAct>
          )}
          <div className="min-w-0 flex-1" />
          <RecurrenceDeleteButton
            quiet
            recurring={Boolean(task.recurrence_id && recurrence)}
            label="Trash"
            onSimple={() => { mutations.trash(task); dismiss(); }}
            onThis={() => {
              if (recurrence && task.recurrence_date) recurrenceMutations.skipOccurrence(recurrence, task.recurrence_date);
              mutations.trash(task);
              dismiss();
            }}
            onFollowing={() => {
              if (recurrence && task.do_date) recurrenceMutations.deleteFollowing(recurrence, task.do_date);
              dismiss();
            }}
            onSeries={() => { if (recurrence) recurrenceMutations.deleteSeries(recurrence); dismiss(); }}
          />
        </PopFooter>
      </div>
  );

  if (slideout) return card;

  return createPortal(
    <div className={centered ? "fixed inset-0 z-40 flex items-center justify-center bg-black/20 p-4" : "contents"}>
      {card}
    </div>,
    document.body,
  );
}

// ── Attendee status helpers ───────────────────────────────────────────────
/** The verdict tokens, not raw Tailwind green/amber — an RSVP reads the same
 *  in e-ink and terminal as it does on paper. */
function statusIcon(s: AttendeeStatus) {
  if (s === "accepted") return { icon: "✓", token: "var(--ok)" };
  if (s === "declined") return { icon: "✗", token: "var(--signal)" };
  if (s === "tentative") return { icon: "?", token: "var(--warn)" };
  return { icon: "·", token: "var(--line-strong)" };
}

/**
 * A guest reads name-first with its response as a leading dot — a column of
 * raw email addresses was the least scannable thing in the card, and the
 * ✓/✗/? glyphs repeated what the summary already counts.
 */
function AttendeeRow({ a }: { a: GoogleAttendee }) {
  const { token } = statusIcon(a.responseStatus);
  const name = a.displayName ?? a.email.split("@")[0];
  return (
    <div className="flex items-center gap-2 py-[1px]" title={a.email}>
      <span
        className="h-[7px] w-[7px] shrink-0 rounded-full"
        style={{ backgroundColor: token }}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-caption text-text">{name}</span>
      {a.organizer && <span className="shrink-0 text-micro text-muted/80">organizer</span>}
      {a.optional && <span className="shrink-0 text-micro text-muted/80">optional</span>}
    </div>
  );
}

/** Guests past this fold behind a "+N more" — a 20-person invite shouldn't
 *  own the column before you've read the notes. */
const GUESTS_FOLD = 6;

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
        <Icon name="chevron-down" size={9} className="shrink-0 text-muted" />
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
                  className="fast flex-1 rounded-[var(--radius-sm)] bg-accent px-2 py-1 text-caption font-medium text-on-accent hover:opacity-90"
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
                        <Icon name="check" size={12} className="shrink-0 text-accent" />
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
const POP_GAP = 10;

export function EventPopover({
  event,
  anchor,
  anchorEl,
  editable,
  offlineOnly = false,
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
  /** Live trigger element (e.g. the clicked calendar block) — when given, the
   *  popover follows it on scroll/resize instead of freezing at `anchor`. */
  anchorEl?: HTMLElement | null;
  editable: boolean;
  /** Writable in principle, but the device is offline. Calendar rows belong to
   *  Google/Apple and are deliberately absent from SYNC_TABLES, so this is the
   *  one edit Nuvo genuinely cannot hold for later — see lib/calendarWrite.ts.
   *  Saying so beats letting the user type and then failing the save. */
  offlineOnly?: boolean;
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
  const [allDay, setAllDay] = useState(event.all_day);
  const [location, setLocation] = useState(event.location ?? "");
  const [notes, setNotes] = useState("");
  const [notify, setNotify] = useState(true);
  const [pendingRsvp, setPendingRsvp] = useState<AttendeeStatus | null>(null);
  const [rsvpError, setRsvpError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [hideMode, setHideMode] = useState(false);
  const [addingMeet, setAddingMeet] = useState(false);
  const [meetError, setMeetError] = useState<string | null>(null);
  const [addingGuests, setAddingGuests] = useState(false);
  const [newGuests, setNewGuests] = useState<string[]>([]);
  const [inviting, setInviting] = useState(false);
  const [allGuests, setAllGuests] = useState(false);
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

  const ownerAccount = (accounts ?? []).find((a) => a.id === event.account_id);
  const { data: raw, isLoading: detailsLoading } = useEventDetails(event.id, ownerAccount?.email);
  // Google marks instances with recurringEventId in raw; iCloud (CalDAV)
  // occurrences carry a `uid::<recurrence-id>` provider id.
  const recurring =
    Boolean((raw as { recurringEventId?: string } | null)?.recurringEventId) ||
    event.provider_event_id.includes("::");
  const inlineRule = useMemo(
    () => fromGoogleRRULE((raw as { recurrence?: string[] } | null)?.recurrence),
    [raw],
  );
  const { data: seriesRule } = useEventSeriesRule(event.id, recurring);
  const repeatRule = inlineRule ?? seriesRule ?? null;

  // Two columns are earned by having people or prose to put in the right one —
  // but the card must decide that ONCE, before it is on screen, and then hold
  // it. Guests and the description arrive a round-trip after the popover opens
  // (`raw` is the table's biggest column and the grid query never selects it),
  // so deriving the width from them meant a read-only feed's event opened as a
  // 380px card and became a 560px one mid-look.
  //
  // So: an editable event is always wide (the guest list and the notes editor
  // both live there, and that is known synchronously). Anything else reserves
  // the wide card unless the details are ALREADY in hand at open — which, with
  // the hover prefetch in CalendarPane, is the common case. A bare feed event
  // opened cold therefore shows one empty column instead of moving; opened
  // warm it is correctly narrow.
  const wideRef = useRef<{ id: string; wide: boolean } | null>(null);
  if (wideRef.current?.id !== event.id) {
    const known = detailsLoading ? null : raw;
    wideRef.current = {
      id: event.id,
      wide: editable || !known || (known.attendees?.length ?? 0) > 0 || Boolean(known.description),
    };
  }
  const wide = wideRef.current.wide;
  const popW = wide ? POP_W_WIDE : POP_W_NARROW;

  useEffect(() => {
    setTitle(event.title);
    setStartAt(event.start_at);
    setEndAt(event.end_at);
    setAllDay(event.all_day);
    setLocation(event.location ?? "");
    setPendingRsvp(null);
    setConfirmDelete(false);
    setHideMode(false);
    setMeetError(null);
    setAllGuests(false);
  }, [event.id, event.title, event.start_at, event.end_at, event.all_day, event.location]);

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
      // Use composedPath() (frozen at dispatch time), not contains(e.target):
      // a row inside the popover can remove itself from the DOM synchronously
      // in its own mousedown handler (e.g. GuestsInput's "add guest" — see
      // GuestsInput.tsx), which would make e.target read as already-detached
      // and falsely look like an outside click by the time this listener runs.
      if (!popRef.current || e.composedPath().includes(popRef.current)) return;
      // This click dismisses the popover only — mark it so the calendar
      // grid's own click-to-create handling (a separate system reacting to
      // the same physical click) skips opening a second, unwanted draft.
      markCalendarClickHandled();
      // The calendar grid's own click/drag-select handling calls
      // preventDefault() on mousedown (it supports click-drag), which
      // suppresses the browser's native focus-loss blur. Without this, an
      // edit that commits on blur (title, notes, location…) is silently
      // dropped whenever the popover is dismissed by clicking the grid —
      // force it through before closing.
      if (popRef.current.contains(document.activeElement)) {
        (document.activeElement as HTMLElement | null)?.blur();
      }
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  // Compute fixed position: prefer right of event, fall back to left
  const pos = useAnchoredPosition({
    anchorEl,
    anchorRect: anchor,
    popRef,
    width: popW,
    gap: POP_GAP,
    onDismiss: onClose,
  });

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

  // Where to join, read through the shared reader so `hangoutLink`-only events
  // (older ones, and ones other clients made) show a Join button too.
  const joinLink = joinUrl(raw);
  // Only Google can mint a Meet link; iCloud write-back can't, and offering the
  // button on an event we'd fail to add one to is worse than not offering it.
  const isGoogleEvent = ownerAccount?.provider === "google";
  const canAddMeet = editable && isGoogleEvent && !joinLink && !detailsLoading;

  const rsvpOptions = [
    { value: "accepted" as AttendeeStatus, label: "Yes", glyph: "✓", tone: "ok" as const },
    { value: "tentative" as AttendeeStatus, label: "Maybe", glyph: "?", tone: "warn" as const },
    { value: "declined" as AttendeeStatus, label: "No", glyph: "✕", tone: "signal" as const },
  ];

  const hasAttendees = (raw?.attendees?.length ?? 0) > 0;
  // Guests other than you. Deleting an event you organize cancels it for these
  // people whatever we do, so the delete confirmation has to say so rather than
  // reading like it only affects your own calendar.
  const otherGuests = (raw?.attendees ?? []).filter((a) => !a.self);
  const iOrganize = raw?.organizer?.self === true;
  const cancelNotifies = iOrganize && otherGuests.length > 0;

  // The masthead's one line. Reads off the live edit state, so it stays true
  // while you're changing the time rather than lagging a round-trip behind.
  const whenSummary = allDay
    ? `${format(new Date(startAt), "EEE MMM d")}${
        toDateISO(new Date(startAt)) !== toDateISO(allDayInclusiveEnd(endAt))
          ? ` – ${format(allDayInclusiveEnd(endAt), "EEE MMM d")}`
          : ""
      } · All day`
    : `${format(new Date(startAt), "EEE MMM d · h:mm a")} – ${format(new Date(endAt), "h:mm a")}`;
  // "Repeats weekly" is a fact about the event, so it reads in the masthead
  // whether or not you can edit it. Recurring with no rule in hand yet (the
  // series master is still being fetched) still says so, plainly.
  const repeatLabel = repeatRule
    ? describeRule(repeatRule, toDateISO(new Date(startAt)))
    : recurring
      ? "Repeats"
      : null;

  const guests = raw?.attendees ?? [];
  const shownGuests = allGuests ? guests : guests.slice(0, GUESTS_FOLD);
  const hiddenGuestCount = guests.length - shownGuests.length;
  // The counts live on the section label — the old free-standing tally row
  // repeated what the dots beside each name already say.
  const guestSummary = (() => {
    if (!guests.length) return null;
    const n = (s: AttendeeStatus) => guests.filter((a) => a.responseStatus === s).length;
    const parts = [
      n("accepted") > 0 ? `${n("accepted")} yes` : null,
      n("tentative") > 0 ? `${n("tentative")} maybe` : null,
      n("declined") > 0 ? `${n("declined")} no` : null,
      n("needsAction") > 0 ? `${n("needsAction")} awaiting` : null,
    ].filter(Boolean);
    return `${guests.length} · ${parts.join(" · ")}`;
  })();

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
  const commitSchedule = (patch: { all_day?: boolean; start_at: string; end_at: string }) => {
    setStartAt(patch.start_at);
    setEndAt(patch.end_at);
    if (patch.all_day !== undefined) setAllDay(patch.all_day);
    eventMutations.updateEvent({
      id: event.id,
      patch: {
        all_day: patch.all_day ?? allDay,
        start_at: patch.start_at,
        end_at: patch.end_at,
      },
    });
  };
  // Move the event to a new day, preserving time-of-day and duration (shift both
  // ends by the same delta). Commits on change — a date input has no natural blur.
  const commitDate = (ymd: string) => {
    const [y, mo, d] = ymd.split("-").map(Number);
    if (!y || !mo || !d) return;
    if (allDay) {
      const startDay = parseDateISO(ymd);
      const inclusiveEnd = allDayInclusiveEnd(endAt);
      const range = allDayRangeFromStart(startDay, inclusiveEnd >= startDay ? inclusiveEnd : startDay);
      commitSchedule({ start_at: range.start_at, end_at: range.end_at });
      return;
    }
    const ns = new Date(startAt);
    ns.setFullYear(y, mo - 1, d);
    const deltaMs = ns.getTime() - new Date(startAt).getTime();
    if (!deltaMs) return;
    commitSchedule({ start_at: ns.toISOString(), end_at: new Date(new Date(endAt).getTime() + deltaMs).toISOString() });
  };
  const commitAllDayEnd = (ymd: string) => {
    const startDay = parseDateISO(toDateInput(startAt));
    const endDay = parseDateISO(ymd);
    const range = allDayRangeFromStart(startDay, endDay >= startDay ? endDay : startDay);
    commitSchedule({ start_at: range.start_at, end_at: range.end_at });
  };
  const toggleAllDay = (next: boolean) => {
    if (next === allDay) return;
    if (next) {
      const range = allDayRangeFromStart(parseDateISO(toDateInput(startAt)));
      commitSchedule({ all_day: true, ...range });
      return;
    }
    commitSchedule({ all_day: false, ...defaultTimedRange(parseDateISO(toDateInput(startAt))) });
  };

  const applyRepeat = (rule: RecurrenceRule | null) => {
    if (rulesEqual(repeatRule, rule)) return;
    if (rule && !recurring) {
      eventMutations.updateEvent({ id: event.id, patch: { recurrence: toGoogleRRULE(rule) } });
    } else if (rule && recurring) {
      eventMutations.updateEvent({ id: event.id, patch: { recurrence: toGoogleRRULE(rule) }, scope: "ALL" });
    } else if (!rule && recurring) {
      eventMutations.updateEvent({ id: event.id, patch: { recurrence: null }, scope: "ALL" });
    }
  };

  return createPortal(
    <>
      {/* Popover card */}
      <div
        ref={popRef}
        data-block-popover=""
        className="pop-in fixed z-50 flex flex-col rounded-[var(--radius-lg)] border border-line bg-surface"
        style={{
          top: pos.top,
          left: pos.left,
          width: popW,
          maxHeight: "min(560px, calc(100vh - 24px))",
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
                    pos.anchorTop + pos.anchorHeight / 2 - pos.top - 5,
                    (popRef.current?.offsetHeight ?? 200) - 16
                  )),
                  borderRight: "none",
                  borderTop: "none",
                }
              : {
                  right: -6,
                  top: Math.max(16, Math.min(
                    pos.anchorTop + pos.anchorHeight / 2 - pos.top - 5,
                    (popRef.current?.offsetHeight ?? 200) - 16
                  )),
                  borderLeft: "none",
                  borderBottom: "none",
                }
          }
        />

        {/* Masthead — title, then ONE muted line answering when + whether it
            repeats. The repeat reads here even on a read-only feed: the card
            has always known (Delete branches on it) and never said so. */}
        <PopMast
          dot={calendarColor ?? undefined}
          onClose={onClose}
          meta={
            <>
              <span className="mono">{whenSummary}</span>
              {repeatLabel && (
                <>
                  <PopMetaDot />
                  <span title="Repeats">↻ {repeatLabel}</span>
                </>
              )}
              {hiddenNow && (
                <>
                  <PopMetaDot />
                  <span>Hidden from the board</span>
                </>
              )}
            </>
          }
        >
          {editable ? (
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() =>
                title.trim() &&
                title !== event.title &&
                eventMutations.updateEvent({ id: event.id, patch: { title: title.trim() } })
              }
              aria-label="Event title"
              className="w-full border-0 border-b border-transparent bg-transparent text-head font-semibold leading-snug outline-none placeholder:text-muted transition-colors hover:border-line focus:border-ink"
            />
          ) : (
            <div className="text-head font-semibold leading-snug">{event.title}</div>
          )}
        </PopMast>

        {/* The one edit Nuvo can't hold for later, said before it's attempted.
            Shown only where the event WOULD be editable — a read-only feed has
            its own reason and shouldn't be handed two. */}
        {offlineOnly && (
          <div className="border-b border-line px-3 py-2 text-caption text-muted">
            {CALENDAR_OFFLINE_NOTE}
          </div>
        )}

        {/* Action strip — the two things you open a meeting for. It is drawn
            while the details are still in flight too (as a placeholder), so a
            meeting's Join button lands *in* the strip instead of pushing one
            into existence under the masthead. */}
        {detailsLoading ? (
          <PopStrip>
            <span className="pop-skeleton block h-[26px] w-[132px] rounded-[var(--radius-sm)]" aria-hidden />
            <span className="sr-only">Loading event details…</span>
          </PopStrip>
        ) : (joinLink || canAddMeet || (editable && hasAttendees)) && (
          <PopStrip>
            {joinLink && (
              <PopPrimary href={joinLink} icon={<Icon name="video" size={12} className="shrink-0" />}>
                Join {conferenceName(raw)}
              </PopPrimary>
            )}
            {canAddMeet && (
              <button
                onClick={async () => {
                  setMeetError(null);
                  setAddingMeet(true);
                  try {
                    const res = await eventMutations.addMeetToEvent({ id: event.id });
                    // Google can accept the request and still be minting the
                    // link. Say that rather than showing a button that looks
                    // like it did nothing.
                    if (!res?.meetUrl) setMeetError("Google is still creating the link — give it a moment.");
                  } catch (e) {
                    setMeetError(e instanceof Error ? e.message : "Couldn't add a Meet link");
                  } finally {
                    setAddingMeet(false);
                  }
                }}
                disabled={addingMeet}
                className="fast tap inline-flex shrink-0 items-center gap-2 rounded-[var(--radius-sm)] border border-line bg-surface px-3 py-1.5 text-label font-medium text-muted hover:border-line-strong hover:text-ink disabled:opacity-50"
              >
                <Icon name="video" size={12} className="shrink-0" />
                {addingMeet ? "Adding…" : "Add Google Meet"}
              </button>
            )}
            {editable && hasAttendees && (
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <PopLabel>Going?</PopLabel>
                <PopSegmented
                  segments={rsvpOptions}
                  value={myResponse === "needsAction" ? null : myResponse}
                  onPick={handleRsvp}
                  ariaLabel="Your response"
                />
              </div>
            )}
            {editable && hasAttendees && otherGuests.length > 0 && (
              <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-micro text-muted">
                <input
                  type="checkbox"
                  checked={notify}
                  onChange={(e) => setNotify(e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                Notify the organizer
              </label>
            )}
            {canAddMeet && otherGuests.length > 0 && !addingMeet && (
              <span className="w-full text-micro text-muted">Guests get an update with the link.</span>
            )}
            {(meetError || rsvpError) && (
              <span className="w-full text-meta text-signal">{meetError ?? rsvpError}</span>
            )}
          </PopStrip>
        )}

        {/* Left = the event's facts · right = its people and words. Each column
            scrolls on its own, so a long guest list can never bury the notes. */}
        <PopBody>
          <PopCol side={wide ? "left" : "only"}>
            <PopStack>
              <PopField label="When">
                {editable ? (
                  <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 text-body text-ink">
                    <input
                      type="date"
                      value={toDateInput(startAt)}
                      onChange={(e) => commitDate(e.target.value)}
                      aria-label="Date"
                      className="fast mono rounded-md px-1 py-0.5 outline-none hover:bg-bg focus:bg-bg"
                    />
                    {allDay ? (
                      <>
                        <span className="text-muted">–</span>
                        <input
                          type="date"
                          value={toDateInput(allDayInclusiveEnd(endAt).toISOString())}
                          onChange={(e) => commitAllDayEnd(e.target.value)}
                          aria-label="End date"
                          className="fast mono rounded-md px-1 py-0.5 outline-none hover:bg-bg focus:bg-bg"
                        />
                      </>
                    ) : (
                      <>
                        <input
                          type="time"
                          value={toTimeInput(startAt)}
                          onChange={(e) => setStartAt(applyTime(startAt, e.target.value))}
                          onBlur={() =>
                            (startAt !== event.start_at || allDay !== event.all_day) &&
                            eventMutations.updateEvent({ id: event.id, patch: { start_at: startAt, all_day: false } })
                          }
                          aria-label="Start time"
                          className="fast mono rounded-md px-1 py-0.5 outline-none hover:bg-bg focus:bg-bg"
                        />
                        <span className="text-muted">–</span>
                        <input
                          type="time"
                          value={toTimeInput(endAt)}
                          onChange={(e) => setEndAt(applyTime(endAt, e.target.value))}
                          onBlur={() =>
                            (endAt !== event.end_at || allDay !== event.all_day) &&
                            eventMutations.updateEvent({ id: event.id, patch: { end_at: endAt, all_day: false } })
                          }
                          aria-label="End time"
                          className="fast mono rounded-md px-1 py-0.5 outline-none hover:bg-bg focus:bg-bg"
                        />
                      </>
                    )}
                    {/* All-day is a switch you touch twice a year — it rides the
                        time row as a chip instead of owning a full-width block
                        louder than the meeting's own join button. */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={allDay}
                      onClick={() => toggleAllDay(!allDay)}
                      className={`fast ml-0.5 rounded-full border px-2 py-[3px] text-label ${
                        allDay
                          ? "border-accent/40 bg-accent-soft font-medium text-accent"
                          : "border-line text-muted hover:border-line-strong hover:text-ink"
                      }`}
                    >
                      All day
                    </button>
                  </div>
                ) : (
                  <span className="mono text-body text-ink">{whenSummary}</span>
                )}
                {editable && (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <RepeatControl
                      anchorISO={toDateISO(new Date(startAt))}
                      value={repeatRule}
                      onChange={applyRepeat}
                    />
                    {recurring && (
                      <span className="text-micro text-muted/80">changes the whole series</span>
                    )}
                  </div>
                )}
              </PopField>

              {/* Calendar / account — one field. The picker moves the event to any
                  writable calendar in any account (native within an account, a
                  confirmed copy across). Static label for read-only / single-target. */}
              {(calendarName || moveTargetCount > 0) && (
                <PopField label="Calendar">
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
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: calendarColor ?? "var(--muted)" }}
                        />
                        <span className="truncate text-body text-ink">{calendarName ?? "Calendar"}</span>
                      </div>
                      {accountEmail && (
                        <div className="truncate pl-[18px] text-meta text-muted/70">{accountEmail}</div>
                      )}
                    </div>
                  )}
                </PopField>
              )}

              {/* Remind — the only thing on this card that makes the app speak
                  first. It sits with the facts, not in the strip: it is a
                  property of the meeting, not the act you opened the card for. */}
              <PopField label="Remind">
                <ReminderSelect
                  block
                  target={{ targetKind: "event", eventKey: eventKey(event) }}
                />
              </PopField>

              {(editable || event.location) && (
                <PopField label="Where">
                  {editable ? (
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
                      aria-label="Location"
                      className={`${POP_INPUT_CLS} w-full`}
                    />
                  ) : (
                    <span className="text-body leading-snug text-ink">{event.location}</span>
                  )}
                </PopField>
              )}

              {/* Organizer is a fact about the event, not a guest — it sits with
                  the facts, and never repeats inside the guest list. */}
              {raw?.organizer && !iOrganize && (
                <PopField label="Organizer">
                  <span className="truncate text-body text-ink">
                    {raw.organizer.displayName ?? raw.organizer.email}
                  </span>
                </PopField>
              )}

              {/* A one-column card has no right side to put prose in. */}
              {!wide && raw?.description && (
                <PopField label="Description">
                  <DescriptionHtml html={raw.description} />
                </PopField>
              )}
            </PopStack>
          </PopCol>

          {wide && (
            <PopCol side="right">
              {(hasAttendees || editable || detailsLoading) && (
                <PopSection label="Guests" aside={guestSummary}>
                  {detailsLoading && <PopSkeleton lines={4} />}
                  {!detailsLoading && !hasAttendees && !editable && (
                    <span className="text-caption text-muted/60">No guests</span>
                  )}
                  {shownGuests.map((a) => (
                    <AttendeeRow key={a.email} a={a} />
                  ))}
                  {hiddenGuestCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setAllGuests(true)}
                      className="fast mt-0.5 pl-[15px] text-left text-meta text-muted hover:text-ink"
                    >
                      +{hiddenGuestCount} more
                    </button>
                  )}
                  {editable && (
                    <div className="mt-1">
                      {!addingGuests ? (
                        <button
                          type="button"
                          onClick={() => setAddingGuests(true)}
                          className="fast flex items-center gap-1.5 text-meta text-accent hover:opacity-80"
                        >
                          <Icon name="plus" size={11} />
                          Add guest
                        </button>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <GuestsInput
                            value={newGuests}
                            onChange={setNewGuests}
                            placeholder="Name or email…"
                          />
                          {/* Both outcomes are spelled out rather than hiding the
                              quiet one behind a checkbox: adding a guest to an
                              existing meeting is a mail-out either way, and which
                              one you meant should take one tap. */}
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={newGuests.length === 0 || inviting}
                              onClick={async () => {
                                if (!newGuests.length) return;
                                setInviting(true);
                                try {
                                  await eventMutations.inviteToEvent({ id: event.id, attendees: newGuests, notifyGuests: true });
                                  setNewGuests([]);
                                  setAddingGuests(false);
                                } finally {
                                  setInviting(false);
                                }
                              }}
                              className="fast tap rounded-[var(--radius-sm)] bg-accent px-3 py-1 text-label font-medium text-on-accent hover:opacity-90 disabled:bg-surface-2 disabled:text-muted disabled:shadow-none"
                            >
                              {inviting
                                ? "Sending…"
                                : newGuests.length > 1
                                ? `Email ${newGuests.length} invites`
                                : "Email invite"}
                            </button>
                            <button
                              type="button"
                              disabled={newGuests.length === 0 || inviting}
                              onClick={async () => {
                                if (!newGuests.length) return;
                                setInviting(true);
                                try {
                                  await eventMutations.inviteToEvent({ id: event.id, attendees: newGuests, notifyGuests: false });
                                  setNewGuests([]);
                                  setAddingGuests(false);
                                } finally {
                                  setInviting(false);
                                }
                              }}
                              title="Add them to the event without sending an email"
                              className="fast tap rounded-[var(--radius-sm)] border border-line px-3 py-1 text-label font-medium text-ink hover:bg-bg disabled:opacity-40"
                            >
                              Add quietly
                            </button>
                            <button
                              type="button"
                              onClick={() => { setAddingGuests(false); setNewGuests([]); }}
                              className="fast tap text-label text-muted hover:text-ink"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </PopSection>
              )}

              <PopSection
                label={editable ? "Notes" : "Description"}
                divider={hasAttendees || editable || detailsLoading}
                className="flex-1"
              >
                {editable && detailsLoading ? (
                  <PopSkeleton lines={5} />
                ) : editable ? (
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
                    aria-label="Notes"
                    rows={notes ? Math.min(8, notes.split("\n").length + 1) : 3}
                    className="w-full resize-none rounded-md border border-transparent bg-transparent px-1.5 py-1 text-caption leading-relaxed text-text outline-none transition-colors placeholder:text-muted/55 hover:border-line hover:bg-bg focus:border-line-strong focus:bg-bg"
                  />
                ) : raw?.description ? (
                  <DescriptionHtml html={raw.description} />
                ) : detailsLoading ? (
                  <PopSkeleton lines={5} />
                ) : (
                  <span className="text-caption text-muted/60">No description</span>
                )}
              </PopSection>
            </PopCol>
          )}
        </PopBody>
        {/* Footer — quiet navigation left, the destructive act right. Delete is
            plain text until it asks to confirm: a permanently-red button was
            the loudest pixel in a card whose real primary is "Join". */}
        {(
          <PopFooter>
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
              <PopFootAct
                href={raw.htmlLink}
                title={ownerAccount?.provider === "m365" ? "Open in Outlook" : "Open in Google Calendar"}
              >
                <svg width="12" height="12" viewBox="0 0 13 13" fill="none" className="inline-block align-middle">
                  <path d="M5 2H2a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1V8M8 1h4m0 0v4m0-4L5.5 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="ml-1 align-middle">
                  {ownerAccount?.provider === "m365" ? "Outlook" : "Google Cal"}
                </span>
              </PopFootAct>
            )}
            {/* Hide / show — available for every event (keeps read-only calendars
                out of your way too); hiding never touches the server. */}
            {!confirmDelete && (
              hiddenNow ? (
                <PopFootAct onClick={() => { const k = hiddenKeyFor(event); if (k) unhide(k); onClose(); }} title="Bring this event back onto the board">
                  Show
                </PopFootAct>
              ) : (
                <PopFootAct
                  onClick={() => { if (canHideSeries) setHideMode(true); else { hide(event, "THIS"); onClose(); } }}
                  title="Hide from the board and time-blocking — it stays on the server"
                >
                  Hide
                </PopFootAct>
              )
            )}
            {onConvertToTask && !confirmDelete && (
              <PopFootAct
                onClick={() => { onConvertToTask(); onClose(); }}
                title="Create a task from this event and hide the event"
              >
                → Task
              </PopFootAct>
            )}
            {editable && (
              !confirmDelete ? (
                <>
                  <div className="min-w-0 flex-1" />
                  <PopFootAct
                    danger
                    title="Delete this event"
                    onClick={() => {
                      if (recurring || cancelNotifies) setConfirmDelete(true);
                      else {
                        eventMutations.deleteEvent({ id: event.id, scope: "THIS" });
                        onClose();
                      }
                    }}
                  >
                    Delete
                  </PopFootAct>
                </>
              ) : recurring ? (
                <>
                  <span className="text-label text-muted">
                    {cancelNotifies
                      ? `Cancel — ${otherGuests.length} ${otherGuests.length === 1 ? "guest is" : "guests are"} told…`
                      : "Delete…"}
                  </span>
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
                  {/* When you host the meeting, deleting it removes it from
                      everyone's calendar — say that instead of "delete this
                      event?", which reads like it is only yours. */}
                  <span className="text-label text-muted">
                    {cancelNotifies
                      ? `Cancel for ${otherGuests.length} ${otherGuests.length === 1 ? "guest" : "guests"}?`
                      : "Delete this event?"}
                  </span>
                  <div className="min-w-0 flex-1" />
                  <Btn onClick={() => setConfirmDelete(false)}>Cancel</Btn>
                  {cancelNotifies && (
                    <Btn
                      onClick={() => {
                        eventMutations.deleteEvent({ id: event.id, scope: "THIS", notifyGuests: false });
                        onClose();
                      }}
                      title="Remove the meeting without emailing the guests"
                    >
                      Cancel quietly
                    </Btn>
                  )}
                  <Btn
                    kind="signal"
                    onClick={() => {
                      eventMutations.deleteEvent({ id: event.id, scope: "THIS" });
                      onClose();
                    }}
                  >
                    {cancelNotifies ? "Cancel & notify" : "Delete"}
                  </Btn>
                </>
              )
            )}
            </>
            )}
          </PopFooter>
        )}
      </div>
    </>,
    document.body,
  );
}

// ── SlotPopover — a time slot and the tasks it holds ─────────────────────
/** Same two-column card as the task and event popovers — left the block's
 *  facts, right the work inside it (which is why the block exists). */
export const SLOT_POP_W = POP_W_WIDE;
const TASK_SLIDE_W = 380;
/** Floor for the slide-out on a narrow window — below this it stops giving way
 *  and simply overhangs, rather than shrinking into an unreadable strip. */
const TASK_SLIDE_MIN_W = 300;

export function SlotPopover({
  slot,
  anchor,
  anchorEl,
  childTasks,
  taskMutations,
  slotMutations,
  recurrence,
  recurrenceMutations,
  labels,
  openTask = null,
  taskRecurrence = null,
  onOpenTask,
  onCloseTask,
  onConvertTaskToEvent,
  focusTitle = false,
  onClose,
}: {
  slot: Slot;
  anchor: DOMRect;
  anchorEl?: HTMLElement | null;
  focusTitle?: boolean;
  childTasks: Task[];
  taskMutations: ReturnType<typeof useTaskMutations>;
  slotMutations: ReturnType<typeof useSlotMutations>;
  recurrence: Recurrence | null;
  recurrenceMutations: ReturnType<typeof useRecurrenceMutations>;
  labels: Label[];
  /** Task detail slide-out — stays inside this shell so position never jumps. */
  openTask?: Task | null;
  taskRecurrence?: Recurrence | null;
  onOpenTask: (t: Task) => void;
  onCloseTask: () => void;
  onConvertTaskToEvent?: (t: Task) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(slot.title);
  const [newTitle, setNewTitle] = useState("");
  const [naming, setNaming] = useState(false);
  const [sel, setSel] = useState(-1);
  const titleRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const slotColRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Live reorder state: { id: dragged, index: target insertion slot }.
  const [reorder, setReorder] = useState<{ id: string; index: number } | null>(null);
  const [reorderLineTop, setReorderLineTop] = useState<number | null>(null);
  const { data: vertical } = useVertical();

  // Slot children are draggable OUT onto the calendar (or rail → inbox), reusing
  // FullCalendar's drop geometry. The reorder handle sits outside [data-task-drag]
  // so grabbing it never starts an FC drag — only the row body drags out.
  useEffect(() => {
    if (!slotColRef.current) return;
    const d = new Draggable(slotColRef.current, {
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

  // A block that was just made opens on its name. Selected, not just focused —
  // the derived name is a placeholder, so typing should replace it outright.
  useEffect(() => {
    if (!focusTitle) return;
    const el = titleRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [focusTitle, slot.id]);

  /**
   * Ask Nuvo for the through-line of what's inside.
   *
   * The suggestion lands in the INPUT, not the row — nothing AI-written reaches
   * the calendar until you accept it (P3). The block already has a name before
   * this is ever tapped, so a failure here costs nothing.
   */
  const suggestName = async () => {
    if (naming || childTasks.length === 0) return;
    setNaming(true);
    try {
      const { data, error } = await supabase.functions.invoke("agent", {
        body: { nameSlot: { taskIds: childTasks.map((t) => t.id) } },
      });
      if (error) throw error;
      const name = String(data?.name ?? "").trim();
      if (!name) throw new Error("Nothing came back");
      setTitle(name);
      titleRef.current?.focus();
      titleRef.current?.select();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't think of a name");
    } finally {
      setNaming(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (openTask) onCloseTask();
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onCloseTask, openTask]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!shellRef.current || e.composedPath().includes(shellRef.current)) return;
      // This click dismisses the popover only — mark it so the calendar
      // grid's own click-to-create handling (a separate system reacting to
      // the same physical click) skips opening a second, unwanted draft.
      markCalendarClickHandled();
      // Force any pending blur-to-commit edit (title/notes…) through before the
      // calendar grid's own mousedown handling (which calls preventDefault to
      // support click-drag) can suppress the native blur and drop it silently.
      if (shellRef.current.contains(document.activeElement)) {
        (document.activeElement as HTMLElement | null)?.blur();
      }
      if (openTask) onCloseTask();
      else onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose, onCloseTask, openTask]);

  // Placement is computed for the slot column *alone* — the task slide-out is
  // never part of the flip math. So opening a task can't change where the slot
  // sits, and closing it can't change it back.
  const pos = useAnchoredPosition({
    anchorEl,
    anchorRect: anchor,
    popRef: shellRef,
    width: SLOT_POP_W,
    gap: 10,
    align: "top",
    holdHeight: Boolean(openTask),
    onDismiss: onClose,
  });

  // The slide-out unfolds on whichever side of the column has more room, and
  // the shell is pinned by the column's *own* edge (`left` when it grows right,
  // `right` when it grows left). Width then changes without moving the column
  // one pixel — the earlier version pinned `left` always, so on a left-flipped
  // popover the whole panel lurched sideways as the pane opened.
  const colLeft = pos.left;
  const colRight = pos.left + SLOT_POP_W;
  const roomRight = pos.viewportWidth - 8 - colRight;
  const roomLeft = colLeft - 8;
  const paneSide: "right" | "left" = roomRight >= roomLeft ? "right" : "left";
  const paneW = openTask
    ? Math.round(
        Math.min(TASK_SLIDE_W, Math.max(TASK_SLIDE_MIN_W, paneSide === "right" ? roomRight : roomLeft)),
      )
    : 0;

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

  const insertLineTop = (dragId: string, clientY: number) => {
    const list = listRef.current;
    if (!list) return null;
    const others = [...list.querySelectorAll<HTMLElement>("[data-slot-row]")].filter(
      (r) => r.getAttribute("data-slot-row") !== dragId,
    );
    let k = 0;
    for (const r of others) {
      const b = r.getBoundingClientRect();
      if (clientY > b.top + b.height / 2) k++;
    }
    const contTop = list.getBoundingClientRect().top;
    if (!others.length) return 0;
    if (k < others.length) return others[k].getBoundingClientRect().top - contTop;
    return others[others.length - 1].getBoundingClientRect().bottom - contTop;
  };

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
      const r = slotColRef.current
        ?.querySelector(`[data-slot-row="${t.id}"]`)
        ?.getBoundingClientRect();
      return r ? r.top + r.height / 2 : Number.POSITIVE_INFINITY;
    });
    let index = ordered.findIndex((t) => t.id === id);
    let out: null | { kind: "inbox" } | { kind: "day"; date: string } = null;
    const railEl = () => document.querySelector<HTMLElement>("[data-rail-drop]");
    setReorder({ id, index });
    setReorderLineTop(insertLineTop(id, e.clientY));
    const onMove = (ev: PointerEvent) => {
      const pop = slotColRef.current?.getBoundingClientRect();
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
          setReorder({ id, index: i });
        }
        setReorderLineTop(insertLineTop(id, ev.clientY));
      } else {
        // Drag-out mode — figure out the destination under the pointer.
        setReorder(null);
        setReorderLineTop(null);
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
      setReorderLineTop(null);
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
    addRef.current?.focus();
  };

  // ↑↓/jk select · ↵ open · space toggle · x remove · t focus add
  useEffect(() => {
    if (openTask) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingIn(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowDown" || e.key === "j") {
        if (!ordered.length) return;
        e.preventDefault();
        setSel((i) => {
          const next = i + 1;
          return Math.max(0, Math.min(ordered.length - 1, next < 0 ? 0 : next));
        });
        return;
      }
      if (e.key === "ArrowUp" || e.key === "k") {
        if (!ordered.length) return;
        e.preventDefault();
        setSel((i) => {
          const next = i - 1;
          return Math.max(0, Math.min(ordered.length - 1, next < 0 ? 0 : next));
        });
        return;
      }
      if (e.key === "t") {
        e.preventDefault();
        addRef.current?.focus();
        return;
      }
      if (sel < 0 || sel >= ordered.length) return;
      const t = ordered[sel];
      if (e.key === "Enter") {
        e.preventDefault();
        onOpenTask(t);
      } else if (e.key === " ") {
        e.preventDefault();
        t.status === "done" ? taskMutations.uncomplete(t) : taskMutations.complete(t);
      } else if (e.key === "x" || e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        taskMutations.removeFromSlot(t);
        setSel((i) => Math.min(i, ordered.length - 2));
      } else if (e.key === "Escape") {
        e.preventDefault();
        setSel(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (sel >= ordered.length) setSel(ordered.length - 1);
  }, [ordered.length, sel]);

  // Scroll the keyboard selection into view.
  useEffect(() => {
    if (sel < 0 || !listRef.current) return;
    const row = listRef.current.querySelector<HTMLElement>(`[data-slot-row="${ordered[sel]?.id}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [sel, ordered]);

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

  // The masthead's one line — same read the chips below let you change.
  const whenSummary = `${format(new Date(slot.do_date + "T12:00:00"), "EEE MMM d")} · ${format(
    startDate,
    "h:mm a",
  )} · ${fmtDuration(slot.duration_minutes)}`;
  const repeatLabel = recurrence ? describeRule(ruleOf(recurrence), slot.do_date) : null;

  return createPortal(
    <>
      {/* Arrow — a portal sibling, not a shell child: the shell has to clip
          (`overflow-hidden`) so the slide-out can unfold from zero width, and
          that clipping ate the arrow's negative offset. The arrow sits on the
          column edge facing the anchor, so the pane covers it exactly when it
          unfolds toward the anchor — i.e. when `paneSide` is the opposite of
          the side the popover took. */}
      {!(openTask && paneSide !== pos.side) && (
        <div
          className="fixed z-[51] h-2.5 w-2.5 rotate-45 border border-line bg-surface"
          style={{
            top: pos.top + 24,
            ...(pos.side === "right"
              ? { left: colLeft - 6, borderRight: "none", borderTop: "none" }
              : { left: colRight - 6, borderLeft: "none", borderBottom: "none" }),
          }}
        />
      )}
      <div
        ref={shellRef}
        data-block-popover=""
        className={`pop-in fixed z-50 flex ${
          paneSide === "left" ? "flex-row-reverse" : ""
        } overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface`}
        style={{
          top: pos.top,
          // Pin the edge the column sits on, so `width` grows away from it.
          ...(paneSide === "right"
            ? { left: colLeft }
            : { right: Math.max(0, pos.viewportWidth - colRight) }),
          width: SLOT_POP_W + paneW,
          maxHeight: Math.min(560, pos.maxHeight),
          boxShadow: "var(--shadow-3)",
        }}
      >
        {/* Slot column — fixed width; position is owned by the shell, not this pane */}
        <div
          ref={slotColRef}
          className="flex min-h-0 shrink-0 flex-col"
          style={{ width: SLOT_POP_W }}
        >

        {/* Masthead — the block's name, then ONE line of when + how full. */}
        <PopMast
          dot={domain?.color ?? slot.color ?? undefined}
          onClose={onClose}
          eyebrow={
            <div className="mono mb-1 text-micro font-semibold uppercase tracking-widest text-muted">
              Time slot
            </div>
          }
          meta={
            <>
              <span className="mono">{whenSummary}</span>
              {repeatLabel && (
                <>
                  <PopMetaDot />
                  <span title="Repeats">↻ {repeatLabel}</span>
                </>
              )}
              {ordered.length > 0 && (
                <>
                  <PopMetaDot />
                  <span className="mono">{doneCount}/{ordered.length} done</span>
                </>
              )}
            </>
          }
        >
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => e.key === "Enter" && commitTitle()}
            className="w-full border-0 bg-transparent text-head font-semibold leading-snug outline-none placeholder:text-muted/70"
            placeholder={derivedTitle}
            aria-label="Slot name"
          />
          {!slot.title.trim() && (
            <div className="mono mt-0.5 flex items-center gap-2 text-meta text-muted/70">
              <span>✦ auto-named — type to override</span>
              {childTasks.length > 0 && (
                <button
                  onClick={suggestName}
                  disabled={naming}
                  className="fast rounded text-meta text-accent underline decoration-dotted underline-offset-2 hover:text-ink disabled:opacity-50"
                  title="Ask Nuvo for the through-line of what's inside"
                >
                  {naming ? "thinking…" : "suggest a name"}
                </button>
              )}
            </div>
          )}
        </PopMast>

        {/* Left = when the block is and what it belongs to · right = the work
            inside it, which is the reason the block exists. */}
        <PopBody>
          <PopCol side="left" width="42%">
            <PopStack>
              <PopField label="When">
                <div className="flex flex-wrap items-center gap-1.5">
                  <label className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-bg px-2.5 py-1 text-label hover:brightness-95 dark:hover:brightness-110">
                    <Icon name="calendar" size={10} className="shrink-0 text-muted/70" />
                    <span className="text-ink">{format(new Date(slot.do_date + "T12:00:00"), "MMM d")}</span>
                    <input
                      type="date"
                      aria-label="Date"
                      value={slot.do_date}
                      onChange={(e) => setDate(e.target.value)}
                      className="absolute inset-0 w-full cursor-pointer opacity-0"
                    />
                  </label>
                  <label className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-bg px-2.5 py-1 text-label hover:brightness-95 dark:hover:brightness-110">
                    <Icon name="clock" size={10} className="shrink-0 text-muted/70" />
                    <span className="text-ink">{format(startDate, "h:mm a")}</span>
                    <input
                      type="time"
                      step={900}
                      aria-label="Start time"
                      value={startHHMM}
                      onChange={(e) => setTime(e.target.value)}
                      className="absolute inset-0 w-full cursor-pointer opacity-0"
                    />
                  </label>
                  <label className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-bg px-2.5 py-1 text-label hover:brightness-95 dark:hover:brightness-110">
                    <Icon name="duration" size={10} className="shrink-0 text-muted/70" />
                    <span className="text-ink">{fmtDuration(slot.duration_minutes)}</span>
                    <Icon name="chevron-down" size={7} className="text-muted/50" />
                    <select
                      aria-label="Duration"
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
                  <RepeatControl
                    anchorISO={slot.do_date}
                    value={recurrence ? ruleOf(recurrence) : null}
                    onChange={applyRepeat}
                  />
                </div>
              </PopField>

              {/* Project drives the colour and the inheritance; a bare domain
                  makes this a standing slot the weekly plan routes work into
                  (docs/standing-slots.md). Only ever one affinity, never two. */}
              <PopField label="For">
                <div className="flex flex-wrap items-center gap-1">
                  <label
                    className="relative inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-label font-medium hover:bg-bg"
                    style={{ color: domain?.color ?? "var(--muted)" }}
                  >
                    <span>{project?.name ?? "+ project"}</span>
                    <select
                      aria-label="Project"
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

                  {!slot.project_id && (
                    <label
                      className="relative inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-label font-medium hover:bg-bg"
                      style={{ color: domain?.color ?? "var(--muted)" }}
                    >
                      <span>{slot.domain_id ? (domain?.name ?? "domain") : "+ domain"}</span>
                      <select
                        aria-label="Domain"
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
                </div>
                {slot.domain_id && !slot.project_id && recurrence && (
                  <div className="text-micro text-muted/80">
                    A standing slot — the weekly plan routes this domain's work here.
                  </div>
                )}
              </PopField>

              <PopField label="Remind">
                <ReminderSelect block target={{ targetKind: "slot", targetId: slot.id }} />
              </PopField>
            </PopStack>
          </PopCol>

          <PopCol side="right" width="58%">
            <PopSection
              label="Inside"
              aside={totalMins > 0 ? `${fmtDuration(totalMins)} of tasks` : undefined}
              className="min-h-0 flex-1"
            >
              <input
                ref={addRef}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addTask();
                  if (e.key === "Escape") { e.stopPropagation(); setNewTitle(""); e.currentTarget.blur(); }
                }}
                placeholder="+ Add task to slot…"
                aria-label="Add task to slot"
                className="w-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-caption outline-none focus:border-accent"
              />

              {/* Child tasks — grip to reorder, body drags out (calendar / inbox) */}
              <div ref={listRef} className="relative -mx-1.5 mt-1 min-h-0 flex-1 overflow-y-auto px-1.5">
                {reorderLineTop != null && (
                  <div className="reorder-insert-line" style={{ top: reorderLineTop }} aria-hidden />
                )}
                {ordered.length === 0 && (
                  <div className="px-1 py-2 text-caption italic text-muted/70">No tasks yet — type above.</div>
                )}
                {ordered.map((t, i) => {
                  const done = t.status === "done";
                  const dragging = reorder?.id === t.id;
                  const selected = i === sel;
                  return (
                    <div
                      key={t.id}
                      data-slot-row={t.id}
                      className={`group flex items-center gap-0.5 rounded-md pr-1 hover:bg-bg ${
                        dragging
                          ? "pointer-events-none bg-accent-soft text-accent shadow-[inset_0_3px_0_0_var(--accent)]"
                          : selected
                            ? "bg-accent-soft/60 ring-1 ring-inset ring-accent/30"
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
                            done ? "border-accent bg-accent text-on-accent" : "border-line-strong bg-surface"
                          }`}
                        >
                          {done && (
                            <Icon name="check" size={9} />
                          )}
                        </button>
                        <button
                          onClick={() => onOpenTask(t)}
                          onMouseDown={() => setSel(i)}
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
                        <Icon name="close" size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </PopSection>
          </PopCol>
        </PopBody>

        {/* Footer */}
        <PopFooter>
          <span className="mono text-micro text-muted/70">↑↓ select · ↵ open · space done</span>
          <div className="min-w-0 flex-1" />
          <SlotDeleteButton
            quiet
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
        </PopFooter>
        </div>

        {/* Task slide-out — same shell, slides open to the right */}
        <div
          // No transition: this is a click-to-open inspector, and on the
          // Schedule those land instantly (same rule as the block lift and
          // `pop-in`). An eased unfold made every drill-in wait ~200ms.
          className={`flex min-h-0 shrink-0 flex-col overflow-hidden bg-surface ${
            openTask ? `${paneSide === "right" ? "border-l" : "border-r"} border-line` : ""
          }`}
          style={{ width: paneW }}
        >
          {openTask && (
            <TaskPopover
              variant="slideout"
              task={openTask}
              anchor={anchor}
              labels={labels}
              mutations={taskMutations}
              recurrence={taskRecurrence}
              recurrenceMutations={recurrenceMutations}
              onClose={onCloseTask}
              onBack={onCloseTask}
              backLabel={slot.title.trim() || derivedTitle}
              onConvertToEvent={
                onConvertTaskToEvent ? () => onConvertTaskToEvent(openTask) : undefined
              }
            />
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
