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
  | "morning"
  | "evening"
  | "task"
  | "event"
  | "slot"
  // Record command center — a project / initiative opened as a full modal.
  // The record id rides in `overlayId`; no anchor (it's centered, not a popover).
  | "project-record"
  | "initiative-record";

export type SettingsSection = "appearance" | "schedule" | "connections" | "labels" | "account";

export type NowMoment = "choose" | "focus" | "done";

export type FloorModal = null | "new-initiative" | "new-project";

export interface AppNavState {
  v: 1;
  rung: Rung;
  projectView: ProjectView;
  initiativeView: DetailView;
  focus: Focus;
  flow: FlowName | null;
  flowStep: number;
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
  projectView: "portfolio",
  initiativeView: "portfolio",
  focus: { domainId: "", initiativeId: "", projectId: "" },
  flow: null,
  flowStep: 0,
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
    focus: { ...DEFAULT_NAV.focus, ...(s.focus ?? {}) },
  };
}
