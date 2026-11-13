// The "now what" read — a kit panel that answers, the moment you arrive at a
// view: how ready is this, and what's the one next turn? The floor-level echo
// of the sidebar's readiness, used by the phone's Now / Plan today. Held-not-
// missing meter (3px) + the single cue + a tap into the action. See
// docs/readiness-model.md §4–§6.

import type { FloorCue } from "../../lib/readiness";
import { PROJECT_STATUS_COLORS } from "./statusColors";

// The meter's "ready/ripe" fill — the same green the readiness pie fills
// with, so "ready" reads consistently across the sidebar, the floors, and here.
export const READY = PROJECT_STATUS_COLORS.complete;

// A cue's tone → a semantic token (never a raw hue): an invitation is the app's
// intent, needs-readying is the status caution amber, drift is quiet.
export function toneColor(tone: FloorCue["tone"]): string {
  if (tone === "invite") return "var(--accent)";
  if (tone === "attention") return PROJECT_STATUS_COLORS.waiting;
  return "var(--muted)";
}

export function ReadinessBanner({
  eyebrow,
  readiness,
  cue,
  actionLabel,
  onAction,
}: {
  eyebrow: string;
  /** 0..1 — the meter fill. */
  readiness: number;
  /** the single thing slipping, or null when this view is calm. */
  cue: FloorCue | null;
  /** the verb for the next turn, e.g. "Plan with Nuvo", "Groom". */
  actionLabel?: string;
  onAction?: () => void;
}) {
  const pct = Math.round(readiness * 100);
  const calm = !cue;
  return (
    <button
      type="button"
      onClick={onAction}
      disabled={!onAction}
      className="fl-panel tap-h w-full border-0"
    >
      <span className="fl-panel-head">
        <span>{eyebrow}</span>
        <span className="k-grow" />
        <span className="tabular-nums" style={{ color: calm ? READY : "var(--muted)", fontWeight: 500 }}>
          {calm ? "Ready" : `${pct}%`}
        </span>
      </span>

      {/* held, not missing — the secured share on the track */}
      <span className="fl-meter block" aria-hidden>
        <i style={{ width: `${pct}%` }} />
      </span>

      <span className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: cue ? toneColor(cue.tone) : READY }} />
        <span className={`min-w-0 flex-1 truncate text-body ${cue ? "text-ink" : "text-muted"}`}>
          {cue ? cue.label : "All at rest"}
        </span>
        {cue && actionLabel && onAction && (
          <span className="shrink-0 text-caption font-medium" style={{ color: "var(--accent-ink)" }}>
            {actionLabel} ›
          </span>
        )}
      </span>
    </button>
  );
}
