import type { CSSProperties } from "react";

// A project's mark: an ARC, never a checkbox (WeekPanel's law 3). It fills with
// the work that's done and goes solid with a ✓ only when the row is finished or
// earned. One drawing, wherever a project wears it — the week crown at 14px, and
// the finish ladder's plates (D-225) at hero size, where the same ring CLOSES:
// the arc runs from where it was to whole, then the disc lands with its check.
//
// The geometry is the crown's, scaled by the viewBox, so a 64px ring is the 14px
// one you tick all week — not a new mark that means the same thing.

const R = 5.25;
const CIRC = 2 * Math.PI * R;

export function ProgressRing({
  pct,
  color,
  filled,
  size = 14,
  closing = false,
  style,
  className,
}: {
  /** 0..100 — the work done */
  pct: number;
  color: string;
  /** finished or earned: the solid disc with its check */
  filled: boolean;
  size?: number;
  /** play the close: arc from `pct` to whole, then the disc lands (moment.css) */
  closing?: boolean;
  style?: CSSProperties;
  className?: string;
}) {
  if (closing) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 14 14"
        aria-hidden
        className={`mo-ring-close ${className ?? ""}`}
        style={{ ...style, "--off": 1 - Math.max(0, Math.min(1, pct / 100)) } as CSSProperties}
      >
        <circle cx="7" cy="7" r={R} fill="none" stroke={color} strokeOpacity={0.28} strokeWidth="2.5" />
        <circle
          className="mo-ring-arc"
          cx="7"
          cy="7"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          pathLength={1}
          transform="rotate(-90 7 7)"
        />
        <g className="mo-ring-seal">
          <circle cx="7" cy="7" r="7" fill={color} />
          <path d="M4.3 7.2l1.8 1.8 3.6-3.9" fill="none" stroke="var(--on-accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
    );
  }
  if (filled) {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden className={className} style={style}>
        <circle cx="7" cy="7" r="7" fill={color} />
        <path d="M4.3 7.2l1.8 1.8 3.6-3.9" fill="none" stroke="var(--on-accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden className={className} style={style}>
      <circle cx="7" cy="7" r={R} fill="none" stroke={color} strokeOpacity={0.28} strokeWidth="2.5" />
      {pct > 0 && (
        <circle
          cx="7"
          cy="7"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeDasharray={`${(pct / 100) * CIRC} ${CIRC}`}
          transform="rotate(-90 7 7)"
        />
      )}
    </svg>
  );
}
