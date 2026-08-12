import type { ProjectStatus } from "../../lib/vertical";

// Lives apart from parts.tsx on purpose: the Spine (entry chunk, via
// ReadinessBanner) and ShipStamp need only these colors, and importing them
// from parts dragged that whole 32 KB grab-bag into the boot bundle. parts.tsx
// re-exports it, so the twenty lazy-floor importers are unaffected.
export const PROJECT_STATUS_COLORS: Record<ProjectStatus, string> = {
  backlog: "var(--muted)",
  in_progress: "var(--accent)",
  waiting: "var(--warn)",
  cancelled: "var(--signal)",
  complete: "var(--ok)",
};
