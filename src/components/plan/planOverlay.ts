// The plan's draft, as the Schedule draws it (docs/plan-the-week-v2.md §4).
//
// Plan the week is an OVERLAY on the real CalendarPane, never a second grid: the
// draft's blocks are one more set of events on the same FullCalendar, painted by
// the same eventContent and reconciled in the same batched sync. This type is
// the whole contract between the plan (which owns what the week IS — useWeekDraft)
// and the pane (which only draws it and reports gestures back).

export interface PlanOverlayBlock {
  /** placementKey — the block's identity in the draft */
  key: string;
  title: string;
  /** ISO instants */
  start: string;
  end: string;
  /** the block's hue (its project/domain colour), or null for the accent */
  color: string | null;
  /** you placed or held it — the composer won't move it */
  held: boolean;
  selected: boolean;
  /** a run: how many tasks ride inside it */
  count?: number;
  /** what's inside a group, by title — so a run says what it holds, not just its name */
  items?: string[];
  /** the walk's current block, when another one is up — drawn quieter */
  quiet?: boolean;
}

export interface PlanOverlayGhost {
  id: string;
  start: string;
  end: string;
  /** what the ghost says — the alternative's number, or the block it previews */
  label: string;
  /** "gap": open time the selected block could go into (click → it goes there) */
  kind?: "alt" | "gap";
}

export interface PlanOverlay {
  blocks: PlanOverlayBlock[];
  /** a selected block's other fits, numbered — click one to move there */
  ghosts: PlanOverlayGhost[];
  onSelect: (key: string | null) => void;
  /** a draft block dragged to a new start */
  onMove: (key: string, start: Date) => void;
  /** a draft block's edge dragged: its new length, kept where it is */
  onResize?: (key: string, start: Date, mins: number) => void;
  onPickGhost: (id: string) => void;
  /** time kept clear (rules you kept + what you painted) — drawn hatched behind */
  clears?: { id: string; start: string; end: string; label: string }[];
  /** a drag across empty grid while planning: "keep this clear?" */
  onPaint?: (start: Date, end: Date) => void;
  /** fade what's already on the calendar so only the net-new reads at a glance */
  dimCalendar?: boolean;
}

export const PLAN_EVENT_PREFIX = "plan:";
export const PLAN_GHOST_PREFIX = "plan-ghost:";
