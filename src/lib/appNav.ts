import type { CalView } from "../components/CalendarPane";
import type { Rung, Focus } from "../components/AppShell";
import type { FlowName } from "../components/Spine";
import type { ProjectView, DetailView } from "../components/FloorPane";
import type { RailTab } from "../components/LeftRail";
import { readAgentOpen } from "../components/AgentSidebar";

export const NAV_HISTORY_KEY = "nuvo-nav";
export const NAV_STACK_INDEX_KEY = "nuvo-nav-idx";

export type OverlayKind =
  | "none"
  | "cmd"
  | "settings"
  | "shortcuts"
  | "morning"
  | "evening"
  | "task"
  | "event"
  | "slot"
  // Record command center — a project / initiative opened as a full modal.
  // The record id rides in `overlayId`; no anchor (it's centered, not a popover).
  | "project-record"
  | "initiative-record"
  // A task opened as a centered modal (from ⌘K search) — the same TaskPopover
  // UI, rung-agnostic, no anchor. Distinct from the on-Schedule anchored "task".
  | "task-record";

export type SettingsSection = "appearance" | "schedule" | "connections" | "integrations" | "labels" | "account";

export type NowMoment = "choose" | "focus" | "done";

export type FloorModal = null | "new-initiative" | "new-project";

/** When a flow is opened pointed at one item (e.g. groom THIS project), the
 *  target rides here so the flow can skip its overview and open it directly.
 *  `lens` pins the grooming lens to open (a gap chip / to-groom row tap);
 *  `pass` starts the guided pass over a whole altitude instead of one item —
 *  `"project"` deals the demand-ordered On Deck queue (launched from the On Deck
 *  floor's "Groom the N" button); `"initiative"` deals the Initiatives floor,
 *  which has no On Deck hub (docs/grooming-lenses.md §8). Both are hubless — the
 *  pass finish closes straight back to the floor it was dealt from. */
export type FlowFocus = {
  kind?: "project" | "initiative";
  id?: string;
  lens?: "brief" | "path" | "okr";
  pass?: "initiative" | "project";
};

export interface AppNavState {
  v: 1;
  rung: Rung;
  projectView: ProjectView;
  initiativeView: DetailView;
  focus: Focus;
  flow: FlowName | null;
  flowStep: number;
  flowFocus: FlowFocus | null;
  tab: RailTab;
  calView: CalView;
  overlay: OverlayKind;
  overlayId: string | null;
  settingsSection: SettingsSection;
  agentOpen: boolean;
  nowMoment: NowMoment;
  nowTaskId: string | null;
  floorModal: FloorModal;
}

export const DEFAULT_NAV: AppNavState = {
  v: 1,
  rung: "day",
  projectView: "ondeck",
  initiativeView: "ondeck",
  focus: { domainId: "", initiativeId: "", projectId: "" },
  flow: null,
  flowStep: 0,
  flowFocus: null,
  tab: "today",
  calView: typeof window !== "undefined" && window.innerWidth < 1100 ? "timeGridDay" : "timeGridWeek",
  overlay: "none",
  overlayId: null,
  settingsSection: "appearance",
  agentOpen: readAgentOpen(),
  nowMoment: "choose",
  nowTaskId: null,
  floorModal: null,
};

/** Fallback anchor when a panel is restored from history (no live DOM target). */
export function fallbackPanelAnchor(): DOMRect {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  return new DOMRect(cx - 20, cy - 20, 40, 40);
}

export function mergeNav(prev: AppNavState, patch: Partial<AppNavState>): AppNavState {
  const next: AppNavState = { ...prev, ...patch };
  if (patch.overlay !== undefined && patch.overlay !== prev.overlay) {
    if (patch.overlay === "none") next.overlayId = null;
    else if (patch.overlayId === undefined) next.overlayId = prev.overlayId;
  }
  if (patch.flow !== undefined && patch.flow !== prev.flow && patch.flow === null) {
    next.flowStep = 0;
    next.flowFocus = null; // leaving a flow drops its focused target
  }
  return next;
}

export function navEqual(a: AppNavState, b: AppNavState): boolean {
  return (
    a.rung === b.rung &&
    a.projectView === b.projectView &&
    a.initiativeView === b.initiativeView &&
    a.focus.domainId === b.focus.domainId &&
    a.focus.initiativeId === b.focus.initiativeId &&
    a.focus.projectId === b.focus.projectId &&
    a.flow === b.flow &&
    a.flowStep === b.flowStep &&
    a.flowFocus?.kind === b.flowFocus?.kind &&
    a.flowFocus?.id === b.flowFocus?.id &&
    a.flowFocus?.lens === b.flowFocus?.lens &&
    a.flowFocus?.pass === b.flowFocus?.pass &&
    a.tab === b.tab &&
    a.calView === b.calView &&
    a.overlay === b.overlay &&
    a.overlayId === b.overlayId &&
    a.settingsSection === b.settingsSection &&
    a.agentOpen === b.agentOpen &&
    a.nowMoment === b.nowMoment &&
    a.nowTaskId === b.nowTaskId &&
    a.floorModal === b.floorModal
  );
}

export function readNavState(raw: unknown): AppNavState | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<AppNavState>;
  if (s.v !== 1) return null;
  if (!s.rung || !s.tab || !s.calView) return null;
  return {
    ...DEFAULT_NAV,
    ...s,
    // The Week rail tab was retired (the board replaced it) — heal stale state.
    tab: s.tab === "inbox" ? "inbox" : "today",
    // Heal retired project views ("portfolio"/"detail" full page, "sprint" This
    // Week) → On Deck, the front door.
    projectView: (["ondeck", "groom", "all"] as ProjectView[]).includes(s.projectView as ProjectView) ? (s.projectView as ProjectView) : "ondeck",
    // Heal the retired "portfolio" front door → On Deck, the new one; keep detail.
    initiativeView: (["ondeck", "groom", "all", "detail"] as DetailView[]).includes(s.initiativeView as DetailView)
      ? (s.initiativeView as DetailView)
      : "ondeck",
    focus: { ...DEFAULT_NAV.focus, ...(s.focus ?? {}) },
  };
}
