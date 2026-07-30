import type { Rung } from "../AppShell";

// Where the "Walk me through it" path points, and how to get there.
//
// Same shape of idea as `src/lib/marqueeRegistry.ts` — a small registry keyed by a
// stable name, so a target is one entry plus a `data-teach` tag on the real
// element, never a raw DOM query written at the call site. Two differences:
//
//  • The nav here is deliberately thinner than Marquee's. A walkthrough only ever
//    needs to bring a *floor* forward; it never opens a record or a flow.
//  • `mobileSelector` is separate, and its absence is meaningful: the phone shell
//    has no Projects/Initiatives/Domain floors (see CLAUDE.md — they're desktop
//    only), so a step with no phone target degrades to read-only art instead of
//    pointing at something that isn't there.

export type TeachTargetKey = "capture" | "day-list" | "project-new" | "domain-wall" | "nuvo";

export interface TeachTargetDef {
  /**
   * The element to light. A comma list is fine — first match in the DOM wins.
   * Omit when the *floor itself* is the point: an orb drawn around a whole wall
   * is a rectangle with its edges off-screen, which reads as no spotlight at all.
   * Navigation alone carries those steps.
   */
  selector?: string;
  /** Bring this floor forward first. Omitted = the target is already on screen. */
  rung?: Rung;
  /**
   * Clear the focused domain before navigating. The Domain floor opens straight
   * into a single open domain when one is focused (and AppShell auto-focuses one),
   * but the teaching point is *all* of the ones they just named — so the wall.
   */
  clearFocus?: boolean;
  /** The phone equivalent. Absent = this step is read-only on a phone. */
  mobileSelector?: string;
}

export const TEACH_TARGETS: Record<TeachTargetKey, TeachTargetDef> = {
  // The rail's capture form — the front door (⌘K and the phone's ＋ land here too).
  capture: {
    selector: '[data-teach="capture"]',
    rung: "day",
    mobileSelector: '[data-teach="capture"]',
  },
  // The rail list holding the thing they just captured — the drag starts here.
  // On a phone there's no drag-to-calendar, so we point at the Tasks tab and the
  // act happens in the task sheet.
  "day-list": {
    selector: '[data-teach="day-list"]',
    rung: "day",
    mobileSelector: '[data-teach="mtab-tasks"]',
  },
  // With zero projects the floor is its own empty-state teacher (FloorGuide), so
  // the button to light is that teacher's; once one exists it's the rail's ＋ foot.
  "project-new": {
    selector: '[data-teach="floor-new"], [data-teach="project-new"]',
    rung: "project",
    mobileSelector: '[data-teach="mtab-projects"]',
  },
  // Navigation-only: the wall of domains they named IS the whole point, so the
  // floor arriving is the teach — there's no single element to single out.
  "domain-wall": {
    rung: "domain",
    clearFocus: true,
  },
  // The agent rail (collapsed or open) / the phone's ✦ launcher.
  nuvo: {
    selector: '[data-teach="nuvo"]',
    mobileSelector: '[data-teach="nuvo"]',
  },
};
