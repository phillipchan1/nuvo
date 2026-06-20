// renderEmblem(spec, state) — the load-bearing piece. A PURE, deterministic
// SVG of the week, celestial metaphor. See src/lib/weekEmblem.ts for the spec
// and the doctrine. No hooks, no data, no randomness beyond the seeded scatter.
//
// Warm-Paper tokens only: domain colors come from the spec (already semantic);
// neutral structure uses --line / --muted / --ink. Nothing hardcoded that won't
// flip with the theme.

import { useId } from "react";
import type { EmblemSpec, EmblemState } from "../../lib/weekEmblem";

// mulberry32 lives privately in the lib; re-derive a tiny copy here so the
// renderer stays self-contained and pure.
function rng32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const C = 100; // center (viewBox is 0 0 200 200)

/** Point on a circle; angle 0 = top (12 o'clock), clockwise, in degrees. */
function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/** SVG arc path from the top, sweeping `fraction` of the circle clockwise. */
function arcPath(r: number, fraction: number): string {
  const frac = Math.max(0, Math.min(0.9999, fraction));
  if (frac <= 0) return "";
  const endDeg = frac * 360;
  const [sx, sy] = polar(C, C, r, 0);
  const [ex, ey] = polar(C, C, r, endDeg);
  const large = endDeg > 180 ? 1 : 0;
  return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
}

export interface WeekEmblemProps {
  spec: EmblemSpec;
  state?: EmblemState;
  /** rendered pixel size (square). Default 200. */
  size?: number;
  className?: string;
  /** hide the seeded ambient dots (e.g. the tiny toolbar glyph). */
  hideAmbient?: boolean;
}

/**
 * The emblem. Forming = ghost rings + partial arcs + dim lights + no sun glow;
 * sealed = solid sweeps + resolved satellites + the sun lit.
 */
export default function WeekEmblem({ spec, state = "sealed", size = 200, className, hideAmbient }: WeekEmblemProps) {
  const uid = useId().replace(/:/g, "");
  const sealed = state === "sealed";
  const baseRot = (spec.seed % 24) - 12; // ±12° seeded whole-emblem rotation

  // Ring radii: outermost first so domain 0 sits outside. Leave room for the
  // satellite orbit beyond the outermost ring.
  const ringCount = Math.max(spec.rings.length, 1);
  const RING_OUTER = 70;
  const RING_STEP = ringCount > 1 ? 13 : 0;
  const ringR = (i: number) => RING_OUTER - i * RING_STEP;
  const orbitR = RING_OUTER + 14;

  // Sun radius scales gently with its share of the week's hours.
  const sunR = 9 + spec.sun.intensity * 9;
  const sunOpacity = sealed ? 1 : 0.45;

  // ── Ambient done-dots: seeded scatter on a faint outer band ──────────────
  const dots: { x: number; y: number; r: number }[] = [];
  if (!hideAmbient) {
    const n = Math.min(spec.ambient, 40);
    const rand = rng32(spec.seed ^ 0x51ed2701);
    for (let i = 0; i < n; i++) {
      const deg = rand() * 360;
      const rr = orbitR + 10 + rand() * 14;
      const [x, y] = polar(C, C, rr, deg);
      dots.push({ x, y, r: 0.7 + rand() * 0.8 });
    }
  }

  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="The week's emblem"
      style={{ overflow: "visible" }}
    >
      <defs>
        <radialGradient id={`sun-${uid}`}>
          <stop offset="0%" stopColor={spec.sun.color} stopOpacity={sealed ? 0.95 : 0.5} />
          <stop offset="60%" stopColor={spec.sun.color} stopOpacity={sealed ? 0.7 : 0.3} />
          <stop offset="100%" stopColor={spec.sun.color} stopOpacity="0" />
        </radialGradient>
      </defs>

      <g transform={`rotate(${baseRot} ${C} ${C})`}>
        {/* faint ambient done-dots */}
        {dots.map((d, i) => (
          <circle key={`d${i}`} cx={d.x} cy={d.y} r={d.r} fill="var(--muted)" opacity={sealed ? 0.4 : 0.22} />
        ))}

        {/* domain rings: a faint target track + the bright hours arc */}
        {spec.rings.map((ring, i) => {
          const r = ringR(i);
          const emberOp = ring.ember ? (sealed ? 0.16 : 0.1) : sealed ? 0.85 : 0.5;
          return (
            <g key={`r${i}`}>
              {/* the full-circle line at the domain's altitude (structure) */}
              <circle cx={C} cy={C} r={r} fill="none" stroke="var(--line)" strokeWidth={1} opacity={0.5} />
              {/* the target track — how full the week *could* be for this domain */}
              {ring.targetSweep > 0 && !ring.ember && (
                <path
                  d={arcPath(r, ring.targetSweep)}
                  fill="none"
                  stroke={ring.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  opacity={0.18}
                />
              )}
              {/* the hours actually invested */}
              {ring.sweep > 0 && (
                <path
                  d={arcPath(r, ring.sweep)}
                  fill="none"
                  stroke={ring.color}
                  strokeWidth={3}
                  strokeLinecap="round"
                  opacity={emberOp}
                />
              )}
            </g>
          );
        })}

        {/* the sun — the dominant bet */}
        <circle cx={C} cy={C} r={sunR + 12} fill={`url(#sun-${uid})`} />
        <circle cx={C} cy={C} r={sunR} fill={spec.sun.color} opacity={sunOpacity} />

        {/* priorities — satellites on the outer orbit */}
        {spec.satellites.map((sat, i) => {
          const [x, y] = polar(C, C, orbitR, sat.angle);
          const litOp = sealed ? 1 : 0.7;
          if (sat.state === "landed") {
            return <circle key={`s${i}`} cx={x} cy={y} r={4} fill="var(--ink)" opacity={litOp} />;
          }
          if (sat.state === "carried") {
            // half-moon: a disc with a half clipped to the orbit-facing side
            return (
              <g key={`s${i}`} opacity={litOp}>
                <circle cx={x} cy={y} r={4} fill="none" stroke="var(--ink)" strokeWidth={1.2} />
                <path d={`M ${x} ${(y - 4).toFixed(2)} A 4 4 0 0 1 ${x} ${(y + 4).toFixed(2)} Z`} fill="var(--ink)" />
              </g>
            );
          }
          // open ring — a priority not yet landed
          return (
            <circle
              key={`s${i}`}
              cx={x}
              cy={y}
              r={3.4}
              fill="none"
              stroke="var(--muted)"
              strokeWidth={1.2}
              strokeDasharray={sealed ? undefined : "2 2"}
              opacity={sealed ? 0.8 : 0.55}
            />
          );
        })}
      </g>
    </svg>
  );
}

// re-export so callers can import the spec type from the component too
export type { EmblemSpec, EmblemState };
