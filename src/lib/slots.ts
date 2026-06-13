// Intelligent slot titles. A time slot is a container; making the user name
// every one is friction. So `slot.title` is treated as an optional *override*:
// when it's blank we derive a display title from what the slot actually holds —
// its project, its children's shared domain, or just the hour of day.

import type { Slot, Task } from "./types";
import { domainById, projectById, type VerticalData } from "./vertical";

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
    const ids = open.map((c) => c.domain_id ?? null);
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
