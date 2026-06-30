// Feature registry — the single source of truth for everything Nuvo can SURFACE:
// what the agent can point at (chat) AND what the ⌘K palette can run (Spotlight).
// This is the file that makes both grow with the app: to make a new destination
// reachable, add ONE entry here (and, for an in-surface spotlight, tag the
// element with `data-marquee="<key>"`). Nothing else changes — not the edge
// function, not the agent prompt, not the command list.
//
//   • `describe` is sent to the agent on every request (see `marqueeManifest`),
//     so Nuvo's `point_at` vocabulary is always current.
//   • `command`, when set, makes the same entry a ⌘K Spotlight command (see
//     `registryCommands`) whose action is the entry's `nav`.
//
// So a single entry surfaces a feature in BOTH chat and Spotlight. See the
// "Capability registry" rule in CLAUDE.md — adding the entry is the standard
// last step of shipping any new navigable surface/flow/feature.
//
// A target's `nav` descriptor tells the controller how to bring it forward
// (a floor, a surface, a record, a flow…). `entity: true` targets are
// *parameterised* — the agent passes the item's id as `ref` (it has ids in its
// context). A target with a `spotlight` key also gets a warm orb on that element.

import type { Focus, Rung } from "../components/AppShell";
import type { FlowName } from "../components/Spine";
import type { RailTab } from "../components/LeftRail";
import type { CalView } from "../components/CalendarPane";
import type { AppNavState, OverlayKind, SettingsSection } from "./appNav";
import { requestMarqueeSurface } from "./marquee";

/** How to bring a destination forward — interpreted by the controller against
 *  useAppNavigation. Discriminated by `kind`. */
export type MarqueeNav =
  | { kind: "rung"; rung: Rung }
  | { kind: "surface"; surface: string; rung: Rung } // a local surface on a rung (e.g. Week's Plan)
  | { kind: "tab"; tab: RailTab; rung: Rung }         // a rail tab (lives on the day rung)
  | { kind: "calview"; calView: CalView; rung: Rung } // a calendar view (lives on the day rung)
  | { kind: "flow"; flow: FlowName }                  // a full-screen ritual
  | { kind: "settings"; section?: SettingsSection }   // the settings overlay (+ section)
  | { kind: "record"; entity: "project" | "initiative" } // a record modal — needs `ref` (id)
  | { kind: "domain" }                                // the domain chapel — needs `ref` (domainId)
  | { kind: "task" };                                 // a task record — needs `ref` (task id)

export interface MarqueeTargetDef {
  /** Stable key — the `point_at` enum value, and (when `spotlight`) the
   *  `data-marquee="<key>"` element to orb. */
  key: string;
  /** Agent-facing: what this is, and when to point at it. For entity targets,
   *  tell the agent to pass the id as `ref`. */
  describe: string;
  /** Pill wording: "Nuvo brought you to {label}". */
  label: string;
  /** How to bring it forward. */
  nav: MarqueeNav;
  /** Optional `data-marquee` element to spotlight once there. Omit for
   *  navigation-only targets (the floor/record itself is the show). */
  spotlight?: string;
  /** True when the agent must pass `ref` (an item id) for this target. */
  entity?: boolean;
  /** When set, this destination ALSO appears in the ⌘K Spotlight palette with
   *  this exact title; running it performs the entry's `nav`. Omit for entity
   *  targets (they need a runtime `ref`, so they're searched, not commanded) and
   *  for sub-section spotlights that are only worth an agent orb, not a command. */
  command?: string;
}

export const MARQUEE_TARGETS: MarqueeTargetDef[] = [
  // ── Floors (the altitude ladder) ─────────────────────────────────────────
  {
    key: "today",
    label: "Today",
    nav: { kind: "rung", rung: "now" },
    describe: "The Today floor — the day's execution coach (the Call, the next move, what's slipped, the schedule). Point here when the user asks about today, what to do now, or how their day looks.",
  },
  {
    key: "schedule",
    command: "Go to the schedule",
    label: "Schedule",
    nav: { kind: "rung", rung: "day" },
    describe: "The Schedule / calendar canvas. Point here when the user asks to see their calendar, their time blocks, or their schedule.",
  },
  {
    key: "projects",
    command: "Go to projects",
    label: "Projects",
    nav: { kind: "rung", rung: "project" },
    describe: "The Projects portfolio floor (all projects). Point here when the user asks to see their projects in general (not one specific project — for that use 'project').",
  },
  {
    key: "initiatives",
    command: "Go to initiatives",
    label: "Initiatives",
    nav: { kind: "rung", rung: "initiative" },
    describe: "The Initiatives portfolio floor (all initiatives / bets). Point here for initiatives in general (one specific one → 'initiative').",
  },
  {
    key: "domains",
    command: "Go to domains",
    label: "Domains",
    nav: { kind: "rung", rung: "domain" },
    describe: "The Domains wall (all life areas). Point here for domains in general (one specific one → 'domain').",
  },

  // ── Entity records (parameterised by id) ─────────────────────────────────
  {
    key: "project",
    label: "the project",
    nav: { kind: "record", entity: "project" },
    entity: true,
    describe: "A specific project's record. Pass the project's id as `ref`. Point here when the user asks to see / open / show a particular project by name.",
  },
  {
    key: "initiative",
    label: "the initiative",
    nav: { kind: "record", entity: "initiative" },
    entity: true,
    describe: "A specific initiative's record. Pass the initiative's id as `ref`. Point here when the user asks to see / open a particular initiative or bet.",
  },
  {
    key: "domain",
    label: "the domain",
    nav: { kind: "domain" },
    entity: true,
    describe: "A specific domain's chapel. Pass the domain's id as `ref`. Point here when the user asks to see / open a particular life area (Work, Church, Family, Health…).",
  },
  {
    key: "task",
    label: "the task",
    nav: { kind: "task" },
    entity: true,
    describe: "A specific task's detail. Pass the task's id as `ref`. Point here when the user asks to see / open a particular task.",
  },

  // ── Week's Plan surface + its sections ───────────────────────────────────
  {
    key: "week-plan",
    command: "Open the week's plan",
    label: "Week's Plan",
    nav: { kind: "surface", surface: "week-plan", rung: "day" },
    describe: "The Week's Plan surface (the week's game plan: priorities, hours, highlights). Point here when the user asks to see their week or their plan in general.",
  },
  {
    key: "priorities",
    label: "Week's Plan",
    nav: { kind: "surface", surface: "week-plan", rung: "day" },
    spotlight: "priorities",
    describe: "The week's named priorities (big rocks). Point here when the user asks about their priorities or what they're focused on this week.",
  },
  {
    key: "hours",
    label: "Week's Plan",
    nav: { kind: "surface", surface: "week-plan", rung: "day" },
    spotlight: "hours",
    describe: "Where the week's hours are going (capacity by domain). Point here when the user asks how their time/hours/capacity are spread this week.",
  },
  {
    key: "highlights",
    label: "Week's Plan",
    nav: { kind: "surface", surface: "week-plan", rung: "day" },
    spotlight: "highlights",
    describe: "The week's highlights — the done work that actually moved a domain. Point here when the user asks what they got done or what moved this week.",
  },
  {
    key: "next-week",
    label: "Week's Plan",
    nav: { kind: "surface", surface: "week-plan", rung: "day" },
    spotlight: "next-week",
    describe: "Next week's capture column on the Week's Plan. Point here when the user asks about, or wants to add to, next week.",
  },

  // ── Today floor sections ─────────────────────────────────────────────────
  {
    key: "today-call",
    label: "Today",
    nav: { kind: "rung", rung: "now" },
    spotlight: "today-call",
    describe: "Today's Call — the one-line posture/recommendation for the whole day. Point here when the user asks what the day is about or what they should focus on today.",
  },
  {
    key: "today-move",
    label: "Today",
    nav: { kind: "rung", rung: "now" },
    spotlight: "today-move",
    describe: "Today's primary recommended move (the single most useful next action). Point here when the user asks what to do next right now.",
  },
  {
    key: "today-slipped",
    label: "Today",
    nav: { kind: "rung", rung: "now" },
    spotlight: "today-slipped",
    describe: "What slipped today — overdue items not yet started. Point here when the user asks what they missed or what's overdue today.",
  },

  // ── Rail tabs + calendar views ───────────────────────────────────────────
  {
    key: "inbox",
    command: "Go to inbox",
    label: "Inbox",
    nav: { kind: "tab", tab: "inbox", rung: "day" },
    describe: "The inbox — unscheduled, unprocessed captures. Point here when the user asks to see their inbox or loose captures.",
  },
  {
    key: "spread",
    command: "Go to the week (Spread)",
    label: "the week board",
    nav: { kind: "calview", calView: "board", rung: "day" },
    describe: "The week board (Spread view) — the Mon–Sun grid of tasks and events. Point here when the user asks to see the whole week's board / spread.",
  },

  // ── Flows (rituals) ──────────────────────────────────────────────────────
  {
    key: "sunday",
    command: "Sunday — compose the week",
    label: "Sunday",
    nav: { kind: "flow", flow: "sunday" },
    describe: "The Sunday ritual — compose the week (name priorities, block them in). Point here when the user wants to plan/compose their week.",
  },
  {
    key: "refine",
    command: "Refine — groom your projects toward done",
    label: "Refine",
    nav: { kind: "flow", flow: "refine" },
    describe: "The Refine run — the grooming card-game that sharpens projects toward done. Point here when the user wants to groom, tidy, or refine their projects/backlog.",
  },
  {
    key: "summit",
    command: "Summit — decide the quarter",
    label: "Summit",
    nav: { kind: "flow", flow: "summit" },
    describe: "The Summit ritual — decide the quarter's bets. Point here when the user wants to plan the quarter or set big bets.",
  },
  {
    key: "tending",
    command: "Tending — assess readiness",
    label: "Tending",
    nav: { kind: "flow", flow: "tending" },
    describe: "The Tending flow — the grooming/readiness ritual. Point here when the user wants to tend or assess readiness of their work.",
  },
  {
    key: "capacity",
    command: "Capacity — review the week's hours",
    label: "Capacity",
    nav: { kind: "flow", flow: "capacity" },
    describe: "The Capacity run — review where the week's hours are committed. Point here when the user wants to review capacity or workload.",
  },

  // ── Settings ─────────────────────────────────────────────────────────────
  {
    key: "settings",
    command: "Settings",
    label: "Settings",
    nav: { kind: "settings" },
    describe: "The settings overlay. Point here when the user asks to open settings.",
  },
  {
    key: "connections",
    command: "Connect calendar…",
    label: "Settings",
    nav: { kind: "settings", section: "connections" },
    describe: "Settings → Connections (calendar accounts, OAuth). Point here when the user asks to connect a calendar or manage calendar accounts.",
  },
];

export function targetDef(key: string): MarqueeTargetDef | undefined {
  return MARQUEE_TARGETS.find((t) => t.key === key);
}

/** The vocabulary sent to the agent each request — the live list of what it can
 *  point at. The edge builds `point_at`'s enum + description from this. */
export function marqueeManifest(): { key: string; describe: string }[] {
  return MARQUEE_TARGETS.map((t) => ({ key: t.key, describe: t.describe }));
}

// ── Spotlight (⌘K) side of the registry ─────────────────────────────────────
// The same entries that feed the agent's `point_at` also feed the command
// palette. `registryCommands` turns every entry with a `command` title into a
// runnable ⌘K command; `runRegistryNav` performs the entry's `nav`. So a new
// destination is reachable by chat AND by ⌘K from one registry entry — no edit
// to Planner, no edit to the edge.

/** The slice of useAppNavigation a registry command needs to run its `nav`.
 *  Kept structural (not the hook's full type) so this file stays free of React
 *  imports; Planner passes its live nav functions in. */
export interface RegistryNavApi {
  goRung: (r: Rung) => void;
  setTab: (t: RailTab) => void;
  setCalView: (v: CalView) => void;
  openFlow: (f: FlowName) => void;
  openOverlay: (kind: OverlayKind, id?: string | null) => void;
  setSettingsSection: (s: SettingsSection) => void;
  openRecord: (kind: "project" | "initiative", id: string) => void;
  navigate: (patch: Partial<AppNavState>) => void;
}

/** Perform a registry entry's navigation — the forward action only (no marquee
 *  session / "Nuvo brought you here" pill; that's Marquee.tsx's job when the
 *  AGENT drives). This is what a ⌘K registry command runs. It mirrors the action
 *  half of Marquee's `applyNav`; the two share the registry DATA, which is the
 *  single source of truth that grows with the app. */
export async function runRegistryNav(
  nav: MarqueeNav,
  ref: string | undefined,
  api: RegistryNavApi,
): Promise<void> {
  switch (nav.kind) {
    case "rung":
      api.goRung(nav.rung);
      return;
    case "surface":
      api.goRung(nav.rung);
      await new Promise((r) => setTimeout(r, 60)); // let the surface's listener mount
      requestMarqueeSurface(nav.surface);
      return;
    case "tab":
      api.goRung(nav.rung);
      api.setTab(nav.tab);
      return;
    case "calview":
      api.goRung(nav.rung);
      api.setCalView(nav.calView);
      return;
    case "flow":
      api.openFlow(nav.flow);
      return;
    case "settings":
      api.openOverlay("settings");
      if (nav.section) api.setSettingsSection(nav.section);
      return;
    case "record":
      if (ref) api.openRecord(nav.entity, ref);
      return;
    case "task":
      if (ref) api.openOverlay("task-record", ref);
      return;
    case "domain": {
      if (!ref) return;
      const focus: Focus = { domainId: ref, initiativeId: "", projectId: "" };
      api.navigate({ rung: "domain", focus });
      return;
    }
  }
}

/** Build the ⌘K Spotlight commands from the registry — every entry that carries
 *  a `command` title, wired to run its `nav`. Entity targets are excluded (they
 *  need a runtime `ref`, so they're reached by search, not by a static command).
 *  One registry entry ⇒ one command, so the palette grows with the app exactly
 *  like the agent's vocabulary does. */
export function registryCommands(
  api: RegistryNavApi,
): { id: string; title: string; run: () => void }[] {
  return MARQUEE_TARGETS.filter((t) => t.command && !t.entity).map((t) => ({
    id: `reg:${t.key}`,
    title: t.command!,
    run: () => {
      void runRegistryNav(t.nav, undefined, api);
    },
  }));
}
