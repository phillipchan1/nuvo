// The rail's width — ONE number for every planner page, and the width of the
// page bar's breadcrumb slot on every page (D-208).
//
// You set it by dragging the Schedule's rail; the decks' rails wear it too, so
// switching rungs never moves the edge between the pool and the grid. It is
// painted as `--rail-w` on <html>, and the PageBar's breadcrumb holds exactly
// that width, so every page's tabs start at the same x — over the grid's edge
// where there is a rail, at the same place where there isn't.

export const RAIL_WIDTH_KEY = "nuvo-rail-width";
export const DEFAULT_RAIL_WIDTH = 360;
export const MIN_RAIL_WIDTH = 240;
export const MAX_RAIL_WIDTH = 560;

/** The width you chose (not the squeezed one). */
export function readRailWidth(): number {
  try {
    const v = Number(localStorage.getItem(RAIL_WIDTH_KEY));
    if (Number.isFinite(v) && v >= MIN_RAIL_WIDTH && v <= MAX_RAIL_WIDTH) return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_RAIL_WIDTH;
}

export function writeRailWidth(width: number) {
  try {
    localStorage.setItem(RAIL_WIDTH_KEY, String(width));
  } catch {
    /* ignore */
  }
}

/** Paint the width the rail is drawn at — the decks' rails and every page
 *  bar's breadcrumb slot read it as `var(--rail-w)`. */
export function paintRailWidth(width: number) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--rail-w", `${width}px`);
}

/** CSS for a rail's width: the painted width, falling back to the stored one. */
export const RAIL_WIDTH_CSS = () => `var(--rail-w, ${readRailWidth()}px)`;

// First paint: before any rail mounts, so the first bar is already right.
paintRailWidth(readRailWidth());
