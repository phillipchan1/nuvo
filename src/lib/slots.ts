// Intelligent slot titles. A time slot is a container; making the user name
// every one is friction. So `slot.title` is treated as an optional *override*:
// when it's blank we derive a display title from what the slot actually holds —
// its project, its children's shared domain, or just the hour of day.

import type { Slot, Task } from "./types";
import { domainById, projectById, taskDomainId, type VerticalData } from "./vertical";

/** Morning / Midday / Afternoon / Evening from a start instant. */
export function partOfDay(start: Date): string {
  const h = start.getHours();
  if (h < 11) return "Morning";
  if (h < 14) return "Midday";
  if (h < 18) return "Afternoon";
  return "Evening";
}

/**
 * The best title for a slot, in priority order:
 *   1. an explicit override the user typed
 *   2. the slot's project name
 *   3. a domain shared by all its children (+ "block")
 *   4. the single child's title, or a time-of-day label with a task count
 *   5. a plain time-of-day label
 * Pure + synchronous so the calendar render and the popover agree.
 */
export function deriveSlotTitle(
  slot: Pick<Slot, "title" | "start_time" | "project_id" | "domain_id">,
  children: Task[],
  vertical: VerticalData,
): string {
  const override = slot.title?.trim();
  if (override) return override;

  const project = projectById(vertical, slot.project_id);
  if (project) return project.name;

  const open = children.filter((c) => c.status !== "trashed");
  const part = partOfDay(new Date(slot.start_time));

  // A domain the slot (or all its children) clearly belongs to.
  const slotDomain = domainById(vertical, slot.domain_id);
  if (slotDomain) return `${slotDomain.name} block`;
  if (open.length > 0) {
    // `taskDomainId`, never the row's own `domain_id` — that column is a
    // denormalized copy of the parent's domain and goes stale the moment a
    // project is re-homed (D-088). A slot full of one project's tasks would
    // otherwise take its name from whichever domain the copy last remembered.
    const ids = open.map((c) => taskDomainId(vertical, c));
    const first = ids[0];
    if (first && ids.every((d) => d === first)) {
      const dom = domainById(vertical, first);
      if (dom) return `${dom.name} block`;
    }
  }

  if (open.length === 1) return open[0].title;
  if (open.length > 1) return `${part} · ${open.length} tasks`;
  return `${part} block`;
}

/** True when the slot has no user-typed title — i.e. the display is derived. */
export function slotTitleIsDerived(slot: Pick<Slot, "title">): boolean {
  return !slot.title?.trim();
}

/** What a block IS — the designation, not its name. */
export interface BlockDesignation {
  /** project sitting · a plain slot · a single piece of work */
  kind: "project" | "slot" | "task";
  /** one sitting of a run that was split across days */
  part?: { part: number; parts: number } | null;
  /** how many pieces it holds — omitted where the surface already counts them */
  holds?: number | null;
  /** what the pieces are called at this altitude */
  unit?: "task" | "capture";
  /** the project behind it, when the block's own title doesn't already say it */
  name?: string | null;
}

/**
 * **The words a block wears** — `Project · 3 tasks`, `Slot · 2 captures`, `Task`.
 *
 * Plan the week says this over every block it places; the Schedule said it with
 * a `▸`, which asks you to learn a glyph before you can read your own calendar.
 * One spelling now, so protected project time reads the same in the ritual that
 * proposes it, on the grid that holds it, and on the phone that shows it.
 *
 * A surface passes only the facts it has room for: the ritual's grid carries the
 * count (it has no progress badge), the Schedule leaves it to the `2/3` badge and
 * passes the project name instead — but only when its own title isn't already
 * the project's, since a block that says `Frontier Site` twice says it once.
 */
export function blockDesignation(d: BlockDesignation): string {
  const kind = d.kind === "project" ? "Project" : d.kind === "slot" ? "Slot" : "Task";
  if (d.part && d.part.parts > 1) return `${kind} · part ${d.part.part} of ${d.part.parts}`;
  if (d.holds != null && d.holds > 0) {
    const unit = d.unit ?? "task";
    return `${kind} · ${d.holds} ${unit}${d.holds === 1 ? "" : "s"}`;
  }
  const name = d.name?.trim();
  if (name) return `${kind} · ${name}`;
  return kind;
}
