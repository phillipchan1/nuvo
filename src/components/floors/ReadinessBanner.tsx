// The "now what" header — a glass card that answers, the moment you arrive at a
// view: how ready is this, and what's the one next turn? It's the floor-level
// echo of the spine gauge, reused across surfaces (mobile Now / Plan today, the
// desktop floors next). Held-not-missing meter + the single cue + a tap into the
// action. See docs/readiness-model.md §4–§6.

import type { FloorCue } from "../../lib/readiness";
import { PROJECT_STATUS_COLORS } from "./parts";

// The meter's "ready/ripe" fill — the same green the RipenessPip ramps toward,
// so "ready" reads consistently across the spine, the floors, and here.
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
      onClick={onAction}
      disabled={!onAction}
      className="glass-card fast block w-full rounded-xl border border-line p-3.5 text-left active:scale-[.99] disabled:cursor-default disabled:active:scale-100"
      style={{ boxShadow: "var(--shadow-2)" }}
    >
      <div className="flex items-baseline justify-between">
        <span className="section-label !p-0">{eyebrow}</span>
        <span className="mono text-meta" style={{ color: calm ? READY : "var(--muted)" }}>
          {calm ? "ready" : `${pct}%`}
        </span>
      </div>

      {/* held, not missing — the secured share on a --line track */}
      <div className="relative mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
        <div
          className="fast absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${pct}%`, background: READY }}
        />
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        {cue ? (
          <>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: toneColor(cue.tone) }} />
            <span className="min-w-0 flex-1 truncate text-body text-ink">{cue.label}</span>
            {actionLabel && onAction && (
              <span className="mono shrink-0 text-caption" style={{ color: "var(--accent)" }}>
                {actionLabel} ›
              </span>
            )}
          </>
        ) : (
          <>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: READY }} />
            <span className="flex-1 text-body text-muted">All at rest — nothing slipping.</span>
          </>
        )}
      </div>
    </button>
  );
}
