// Marquee registry — the single source of truth for everything Nuvo can point
// at. This is the file that makes Marquee grow with the app: to make a new
// destination spotlightable, add ONE entry here (and, for an in-surface
// spotlight, tag the element with `data-marquee="<key>"`). Nothing else changes
// — not the edge function, not the agent prompt. The vocabulary below is sent to
// the agent on every request (see `marqueeManifest`), so the agent's `point_at`
// options are always current.
//
// A target's `nav` descriptor tells the controller how to bring it forward
// (a floor, a surface, a record, a flow…). `entity: true` targets are
// *parameterised* — the agent passes the item's id as `ref` (it has ids in its
// context). A target with a `spotlight` key also gets a warm orb on that element.

import type { Rung } from "../components/AppShell";
import type { FlowName } from "../components/Spine";
import type { RailTab } from "../components/LeftRail";
import type { CalView } from "../components/CalendarPane";
import type { SettingsSection } from "./appNav";

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
  | { kind: "domain" }                                // the open domain — needs `ref` (domainId)
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
}

export const MARQUEE_TARGETS: MarqueeTargetDef[] = [
  // ── Floors (the altitude ladder) ─────────────────────────────────────────
  {
    key: "schedule",
    label: "Schedule",
    nav: { kind: "rung", rung: "day" },
    describe: "The Schedule / calendar canvas — the surface the day is actually run on. Point here when the user asks to see their calendar, their time blocks, their schedule, how today looks, or what's on right now.",
  },
  {
    key: "projects",
    label: "Projects",
    nav: { kind: "rung", rung: "project" },
    describe: "The Projects portfolio floor (all projects). Point here when the user asks to see their projects in general (not one specific project — for that use 'project').",
  },
  {
    key: "initiatives",
    label: "Initiatives",
    nav: { kind: "rung", rung: "initiative" },
    describe: "The Initiatives On Deck floor (all initiatives / bets, grouped by quarter). Point here for initiatives in general (one specific one → 'initiative').",
  },
  {
    key: "domains",
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
    describe: "A specific domain, opened. Pass the domain's id as `ref`. Point here when the user asks to see / open a particular life area (Work, Church, Family, Health…).",
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
    key: "find",
    label: "Week's Plan",
    nav: { kind: "surface", surface: "week-plan", rung: "day" },
    spotlight: "find",
    describe: "The Find — one evidence-backed discovery about the week (hidden bet, comeback, plan/reality mismatch, etc.). Point here when the user asks what Nuvo noticed or what stood out.",
  },
  {
    key: "next-week",
    label: "Week's Plan",
    nav: { kind: "surface", surface: "week-plan", rung: "day" },
    spotlight: "next-week",
    describe: "Next week's capture column on the Week's Plan. Point here when the user asks about, or wants to add to, next week.",
  },

  // ── Rail tabs + calendar views ───────────────────────────────────────────
  {
    key: "inbox",
    label: "Inbox",
    nav: { kind: "tab", tab: "inbox", rung: "day" },
    describe: "The inbox — unscheduled, unprocessed captures. Point here when the user asks to see their inbox or loose captures.",
  },
  {
    key: "spread",
    label: "the week board",
    nav: { kind: "calview", calView: "board", rung: "day" },
    describe: "The week board (Spread view) — the Mon–Sun grid of tasks and events. Point here when the user asks to see the whole week's board / spread.",
  },

  // ── Flows (rituals) ──────────────────────────────────────────────────────
  {
    key: "sunday",
    label: "Sunday",
    nav: { kind: "flow", flow: "sunday" },
    describe: "The Sunday ritual — compose the week (name priorities, block them in). Point here when the user wants to plan/compose their week.",
  },
  {
    key: "groom-projects",
    label: "Groom",
    nav: { kind: "rung", rung: "project" },
    describe: "The Build rung, where projects and bets are groomed toward done (the Groom deck is a tab there). Point here when the user wants to groom, shape, or refine their projects/backlog.",
  },
  {
    key: "summit",
    label: "Summit",
    nav: { kind: "flow", flow: "summit" },
    describe: "The Summit ritual — decide the quarter's bets. Point here when the user wants to plan the quarter or set big bets.",
  },
  {
    key: "capacity",
    label: "Capacity",
    nav: { kind: "flow", flow: "capacity" },
    describe: "The Capacity run — review where the week's hours are committed. Point here when the user wants to review capacity or workload.",
  },

  // ── Settings ─────────────────────────────────────────────────────────────
  {
    key: "settings",
    label: "Settings",
    nav: { kind: "settings" },
    describe: "The settings overlay. Point here when the user asks to open settings.",
  },
  {
    key: "connections",
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
