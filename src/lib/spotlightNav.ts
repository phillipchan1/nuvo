import type { Focus } from "../components/AppShell";
import type { AppNavState, OverlayKind } from "./appNav";
import { revealOnCalendar } from "./calendarReveal";
import {
  domainById,
  initiativesOf,
  projectById,
  projectsOf,
  type VerticalData,
} from "./vertical";

// A record the spotlight can "pull up" — built once from the vertical store, with
// a *serializable* navigation intent (`nav`) instead of a closure, so the same
// hit can be acted on in-window (⌘K) or fired across the Tauri window boundary
// (the global ⌥Space panel → the main window). The two surfaces share one builder
// and one applier, so quick-capture and quick-pullup stay genuinely identical.
export type SpotlightNav =
  | { kind: "task"; taskId: string }
  | { kind: "project"; focus: Focus }
  | { kind: "initiative"; focus: Focus }
  | { kind: "domain"; focus: Focus }
  // A calendar event: land on its day and open it. Carries the DATE as well as
  // the id because the grid has to travel there before the row is even loaded —
  // the event query is windowed to what's on screen.
  | { kind: "event"; eventId: string; dateISO: string };

export interface SearchHitData {
  id: string;
  kind: "task" | "project" | "initiative" | "domain" | "event";
  title: string;
  subtitle?: string;
  nav: SpotlightNav;
}

/** Every task / project / initiative / domain, as a searchable hit. Mirrors the
 *  subtitle + focus resolution both spotlight surfaces used to do inline. */
export function buildSearchHits(data: VerticalData): SearchHitData[] {
  const hits: SearchHitData[] = [];
  for (const t of data.tasks) {
    const title = t.title?.trim();
    if (!title) continue; // raw/empty inbox captures aren't findable by name
    const proj = projectById(data, t.projectId);
    const dom = domainById(data, t.domainId ?? proj?.domainId ?? null);
    hits.push({
      id: `task:${t.id}`,
      kind: "task",
      title,
      subtitle: proj?.name ?? dom?.name ?? undefined,
      nav: { kind: "task", taskId: t.id },
    });
  }
  for (const p of data.projects) {
    hits.push({
      id: `project:${p.id}`,
      kind: "project",
      title: p.name,
      subtitle: domainById(data, p.domainId)?.name,
      nav: { kind: "project", focus: { domainId: p.domainId, initiativeId: p.initiativeId ?? "", projectId: p.id } },
    });
  }
  for (const i of data.initiatives) {
    hits.push({
      id: `initiative:${i.id}`,
      kind: "initiative",
      title: i.name,
      subtitle: domainById(data, i.domainId)?.name,
      nav: { kind: "initiative", focus: { domainId: i.domainId, initiativeId: i.id, projectId: projectsOf(data, i.id)[0]?.id ?? "" } },
    });
  }
  for (const d of data.domains) {
    const firstInit = initiativesOf(data, d.id)[0];
    const firstProj = firstInit ? projectsOf(data, firstInit.id)[0] : null;
    hits.push({
      id: `domain:${d.id}`,
      kind: "domain",
      title: d.name,
      nav: { kind: "domain", focus: { domainId: d.id, initiativeId: firstInit?.id ?? "", projectId: firstProj?.id ?? "" } },
    });
  }
  return hits;
}

// The slice of the navigation API a spotlight hit needs to land on a record.
export interface SpotlightNavApi {
  openOverlay: (kind: OverlayKind, id?: string | null) => void;
  openProject: (focus: Focus) => void;
  openInitiative: (focus: Focus) => void;
  navigate: (patch: Partial<AppNavState>) => void;
}

/** Replay a serialized nav intent against the live navigation API. One place,
 *  used by ⌘K directly and by the main window's listener for the ⌥Space panel. */
export function applySpotlightNav(target: SpotlightNav, api: SpotlightNavApi) {
  switch (target.kind) {
    case "task":
      api.openOverlay("task-record", target.taskId);
      break;
    case "project":
      api.openProject(target.focus);
      break;
    case "initiative":
      api.openInitiative(target.focus);
      break;
    case "domain":
      api.navigate({ focus: target.focus, rung: "domain", overlay: "none", overlayId: null });
      break;
    case "event":
      // Two halves: the grid travels (through the reveal bus, since the date is
      // the grid's own state), and the popover is asked for. The popover renders
      // as soon as the newly-loaded range contains the row.
      revealOnCalendar({ dateISO: target.dateISO, eventId: target.eventId });
      api.navigate({ rung: "day", overlay: "event", overlayId: target.eventId });
      break;
  }
}

/** The Tauri event the ⌥Space panel emits and the main window listens for. */
export const SPOTLIGHT_NAVIGATE_EVENT = "spotlight-navigate";
