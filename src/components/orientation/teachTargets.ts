import type { Rung } from "../AppShell";

// Where the "Walk me through it" path points, and how to get there.
//
// Same shape of idea as `src/lib/marqueeRegistry.ts` — a small registry keyed by a
// stable name, so a target is one entry plus a `data-teach` tag on the real
// element, never a raw DOM query written at the call site.
//
// Two rules learned by watching a beginner take it:
//
//  1. **Every step highlights something.** A step that only navigates reads as
//     "nothing happened" — the reader can't tell the app moved. If a step's teach
//     is a whole floor, light the most representative *single* element on it (one
//     domain card, not the wall) — an orb around a whole grid is a rectangle with
//     its edges off-screen, which reads as no highlight at all.
//  2. **A target may need the app opened first.** Talking about the chat while the
//     chat is shut is the same failure. `arm` runs before we go looking for the
//     element, so the thing being described is actually on screen.

export type TeachTargetKey =
  | "capture"
  | "inbox-tab"
  | "day-list"
  | "project-new"
  | "initiative-new"
  | "domain-card"
  | "nuvo"
  | "calendars";

/** A state change to make before hunting for the target element. */
export type TeachArm =
  | "rail-inbox"   // swing the rail to its Inbox tab
  | "rail-today"   // …and back, so the timing step shows the day
  | "open-agent"   // open the Nuvo chat rail
  | "open-calendars"; // Settings, on the Calendars section

export interface TeachTargetDef {
  /** The element to light. A comma list is fine — first match in the DOM wins. */
  selector?: string;
  /** Bring this floor forward first. Omitted = the target is already on screen. */
  rung?: Rung;
  /** Put the app in the state this step is describing (see TeachArm). */
  arm?: TeachArm;
  /**
   * Clear the focused domain before navigating. The Domain floor opens straight
   * into a single open domain when one is focused (and AppShell auto-focuses one),
   * but the teaching point is *all* of the ones they named — so the wall.
   */
  clearFocus?: boolean;
  /** The phone equivalent. Absent = this step falls back to art on a phone. */
  mobileSelector?: string;
  /** The phone's own arm, where the shells differ. */
  mobileArm?: TeachArm;
}

export const TEACH_TARGETS: Record<TeachTargetKey, TeachTargetDef> = {
  // 1 · The front door. ⌘K and the phone's ＋ land in the same place.
  capture: {
    selector: '[data-teach="capture"]',
    rung: "day",
    mobileSelector: '[data-teach="capture"]',
  },

  // 2 · Where the thing they just typed went. We swing the rail to Inbox first so
  // they see their own words sitting in it — the tab alone would be an abstraction.
  "inbox-tab": {
    selector: '[data-teach="inbox-tab"]',
    rung: "day",
    arm: "rail-inbox",
    mobileSelector: '[data-teach="mtab-tasks"]',
  },

  // 3 · Back to the day, where the block gets made.
  "day-list": {
    selector: '[data-teach="day-list"]',
    rung: "day",
    arm: "rail-today",
    mobileSelector: '[data-teach="mtab-tasks"]',
  },

  // 4 · With zero projects the floor is its own empty-state teacher (FloorGuide),
  // so the button to light is that teacher's; once one exists it's the rail's ＋.
  "project-new": {
    selector: '[data-teach="floor-new"], [data-teach="project-new"]',
    rung: "project",
    mobileSelector: '[data-teach="mtab-projects"]',
  },

  // 5 · The Initiatives floor. They won't make one today — but "you won't need
  // this yet" only means something once you've seen where it would go.
  "initiative-new": {
    selector: '[data-teach="floor-new"], [data-teach="initiative-new"]',
    rung: "initiative",
    mobileSelector: '[data-teach="mtab-initiatives"]',
  },

  // 6 · One domain card, not the wall — a named thing they recognize, because
  // they typed the name themselves a minute ago.
  "domain-card": {
    selector: '[data-teach="domain-card"]',
    rung: "domain",
    clearFocus: true,
  },

  // 7 · Open the chat, then light it. Describing the assistant while it's shut
  // was the single most confusing moment in the first pass.
  nuvo: {
    selector: '[data-teach="nuvo-panel"], [data-teach="nuvo"]',
    arm: "open-agent",
    mobileSelector: '[data-teach="nuvo"]',
  },

  // 8 · Settings, already on Calendars, with the pane lit. No phone entry on
  // purpose: MobileShell owns its own settings state rather than the nav overlay,
  // so `open-calendars` would be a no-op there — the step's CTA opens it instead.
  calendars: {
    selector: '[data-teach="calendars"]',
    arm: "open-calendars",
  },
};
