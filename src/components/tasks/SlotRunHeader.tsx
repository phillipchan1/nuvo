// A slot, as the head of the tasks inside it — rail and phone, one component.
//
// The list of the day says WHEN things happen by order alone, so a slot's tasks
// (which all share the slot's start) read as separate commitments. This is the
// line that says "these belong to one block of time": the block's name, its
// clock span, and how much of it is spoken for. Tapping the line opens the
// slot (its popover on a desk, its sheet on a phone — the caller decides which);
// the ring at the left picks every task inside it for the bulk bar, which is the
// only way to act on a whole slot's work at once from a list.
//
// It dissolves rather than frames (design-language): a hairline row on the
// paper with a slot-coloured spine, not a card. Open/unclaimed time wears
// `--slot`, the token that means exactly that.

import { fmtMins } from "../../lib/now";
import type { Coverage } from "../../lib/selection";
import { slotState, type SlotRun, type SlotState } from "../../lib/slotRuns";
import { span } from "../mobile/dayPlan";

/**
 * The words on a slot's header, from the run — so the rail and the phone say the
 * same thing in the same spelling. `title` is the caller's (`slotTitle` names an
 * untitled slot from what's inside it, and that lives with the vertical).
 */
export function slotRunFace(run: SlotRun, title: string) {
  const start = new Date(run.slot.start_time);
  const end = new Date(start.getTime() + run.slot.duration_minutes * 60_000);
  const state = slotState(run);
  const capacity = fmtMins(run.slot.duration_minutes);
  const note =
    state === "empty"
      ? `open · ${capacity}`
      : state === "done"
        ? `all done · ${run.doneCount}`
        : run.askMinutes > 0
          ? `${run.open.length} left · ${fmtMins(run.askMinutes)} of ${capacity}`
          : `${run.open.length} left · ${capacity}`;
  return {
    title: title || "Slot",
    when: span(start, end),
    note,
    state,
    // A slot with a hue (a domain's) wears it; open, unclaimed time wears `--slot`.
    color: run.slot.color ?? "var(--slot)",
  };
}

const RING_COL = "tap fast flex w-[2.65rem] shrink-0 items-center justify-start pl-4";

export interface SlotRunHeaderProps {
  slotId: string;
  title: string;
  /** `6–8am` — from `span()`, the one way a time is spelled. */
  when: string;
  /** The second line: what the slot holds, as a fact. */
  note: string;
  /** The slot's hue (a domain's, or `--slot` for open time). */
  color: string;
  state: SlotState;
  coverage: Coverage;
  /** The ring is offered only when there is something inside to pick. */
  selectable: boolean;
  onOpen: (anchor: DOMRect) => void;
  onToggleSelect: () => void;
}

export default function SlotRunHeader({
  slotId,
  title,
  when,
  note,
  color,
  state,
  coverage,
  selectable,
  onOpen,
  onToggleSelect,
}: SlotRunHeaderProps) {
  const quiet = state !== "open";
  return (
    <div
      data-slot-run={slotId}
      // The header is not a task row: it is not draggable, and it opts out of
      // the rail's window-drag region like the rows do.
      data-tauri-drag-region="false"
      className="group flex items-stretch border-b border-line"
      style={{ boxShadow: `inset 3px 0 0 ${color}` }}
    >
      {selectable ? (
        <button
          type="button"
          onClick={onToggleSelect}
          aria-label={
            coverage === "all" ? `Unselect everything in ${title}` : `Select everything in ${title}`
          }
          aria-pressed={coverage === "all"}
          // The ring sits over the rows' checkbox column and the name over their
          // titles, so the list keeps one left edge. 44px wide on a phone (`.tap`).
          className={RING_COL}
        >
          <span
            aria-hidden
            className="flex h-4 w-4 items-center justify-center rounded-full border"
            style={{
              borderColor: coverage === "none" ? "var(--line-strong)" : "var(--accent)",
              background: coverage === "all" ? "var(--accent)" : "transparent",
            }}
          >
            {coverage === "some" && <span className="h-0.5 w-2 rounded-full bg-accent" />}
            {coverage === "all" && (
              <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="var(--surface)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3.5 8.5l3 3 6-7" />
              </svg>
            )}
          </span>
        </button>
      ) : (
        // Same column as the ring, so a header with nothing to pick still lines up.
        <span aria-hidden className={RING_COL} />
      )}
      <button
        type="button"
        onClick={(e) => {
          // The row's rule: a modifier is a pick, never a request to read.
          if (e.shiftKey || e.metaKey || e.ctrlKey) {
            if (selectable) onToggleSelect();
            return;
          }
          onOpen(e.currentTarget.getBoundingClientRect());
        }}
        className="tap-h fast row-hover flex min-w-0 flex-1 items-center gap-2 py-2 pr-3.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-body font-medium ${quiet ? "text-muted" : "text-ink"}`}>{title}</span>
          <span className="block truncate text-meta text-muted" style={state === "empty" ? { color: "var(--slot)" } : undefined}>
            {note}
          </span>
        </span>
        <span className="mono shrink-0 text-meta text-muted">{when}</span>
      </button>
    </div>
  );
}
