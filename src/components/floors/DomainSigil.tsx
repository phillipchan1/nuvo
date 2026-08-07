// DomainSigil — the load-bearing piece. A PURE, deterministic SVG of a domain's
// presence, in one of four generative forms. See src/lib/domainSigil.ts for
// the spec and the doctrine. No data, no hooks (bar useId for a gradient id), no
// randomness beyond the seeded jitter.
//
// Warm-Paper tokens only: the domain color comes from the spec (already
// semantic); neutral structure uses --line / --muted. Nothing hardcoded that
// won't flip with the theme.

import { useId, type CSSProperties, type ReactNode } from "react";
import type { SigilSpec } from "../../lib/domainSigil";

const C = 100; // center (viewBox 0 0 200 200)
const EMBER = "var(--muted)"; // a quiet domain's cold light

// mulberry32 — the same seeded PRNG the week emblem uses; a stored spec redraws
// identically forever.
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

/** Point on the center circle; angle 0 = top (12 o'clock), clockwise, degrees. */
function polar(r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(rad), C + r * Math.sin(rad)];
}

/** SVG arc from the top, sweeping `fraction` of the circle clockwise. */
function arcPath(r: number, fraction: number): string {
  const frac = Math.max(0, Math.min(0.9999, fraction));
  if (frac <= 0) return "";
  const end = frac * 360;
  const [sx, sy] = polar(r, 0);
  const [ex, ey] = polar(r, end);
  const large = end > 180 ? 1 : 0;
  return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
}

export interface DomainSigilProps {
  spec: SigilSpec;
  /** rendered pixel size (square). Default 100. */
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export default function DomainSigil({ spec, size = 100, className, style }: DomainSigilProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { form, color, weeks, target, lit, seed } = spec;
  const rand = rng32(seed);
  const maxH = Math.max(target, ...weeks, 1);
  const total = weeks.reduce((a, b) => a + b, 0);
  const rot = (seed % 24) - 12; // ±12° seeded whole-mark rotation
  const coreR = lit ? 8 + Math.min(1, total / (maxH * 13)) * 7 : 6;

  // a soft radial bloom behind the lit core (never on a quiet ember)
  const glow: ReactNode = lit ? (
    <>
      <defs>
        <radialGradient id={`sg${uid}`}>
          <stop offset="0%" stopColor={color} stopOpacity={0.9} />
          <stop offset="55%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={C} cy={C} r={coreR + 16} fill={`url(#sg${uid})`} />
    </>
  ) : null;

  // a cold ember with a thread of smoke — the quiet-domain core, shared by the
  // forms that carry one.
  const ember: ReactNode = (
    <>
      <circle cx={C} cy={C} r={6} fill="none" stroke={EMBER} strokeWidth={1.4} opacity={0.55} />
      <path d="M100 90 q4 5 0 9 q-4 4 0 8" fill="none" stroke={EMBER} strokeWidth={1.3} strokeLinecap="round" opacity={0.5} />
    </>
  );

  let body: ReactNode;

  if (form === "orbit") {
    const orbit = 74;
    const fullness = Math.min(1, total / Math.max(1, target * 13));
    const ticks = weeks.map((h, i) => {
      const deg = (i * 360) / 13 + rand() * 4;
      const v = Math.min(1.2, h / maxH);
      const [x, y] = polar(orbit, deg);
      const on = h > 0.05;
      return (
        <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r={(1 + v * 4.2).toFixed(1)}
          fill={on ? color : EMBER} opacity={on ? (lit ? 0.35 + v * 0.6 : 0.28) : 0.16} />
      );
    });
    body = (
      <>
        <circle cx={C} cy={C} r={52} fill="none" stroke="var(--line)" strokeWidth={1} opacity={0.55} />
        <circle cx={C} cy={C} r={orbit} fill="none" stroke="var(--line)" strokeWidth={1} opacity={0.4} />
        <path d={arcPath(52, fullness)} fill="none" stroke={lit ? color : EMBER} strokeWidth={3.4} strokeLinecap="round" opacity={lit ? 0.85 : 0.3} />
        {ticks}
        {glow}
        {lit ? <circle cx={C} cy={C} r={coreR} fill={color} opacity={0.92} /> : ember}
      </>
    );
  } else if (form === "bloom") {
    const petals = weeks.map((h, i) => {
      const deg = (i * 360) / 13;
      const v = Math.min(1.25, h / maxH);
      const len = 14 + v * 58;
      const [x, y] = polar(len, deg);
      const recent = i / 12;
      const on = h > 0.05;
      return (
        <line key={i} x1={C} y1={C} x2={x.toFixed(1)} y2={y.toFixed(1)}
          stroke={on ? color : EMBER} strokeWidth={(2.4 + v * 2).toFixed(1)} strokeLinecap="round"
          opacity={on ? (lit ? 0.35 + recent * 0.55 : 0.22) : 0.12} />
      );
    });
    body = (
      <>
        <circle cx={C} cy={C} r={72} fill="none" stroke="var(--line)" strokeWidth={1} opacity={0.4} />
        {petals}
        {glow}
        <circle cx={C} cy={C} r={lit ? coreR : 6} fill={lit ? color : "none"} stroke={lit ? "none" : EMBER} strokeWidth={1.4} opacity={lit ? 0.92 : 0.55} />
      </>
    );
  } else if (form === "strata") {
    const n = 13;
    const topY = 34;
    const bh = 132 / n;
    const bands = Array.from({ length: n }, (_, i) => {
      const wk = weeks[n - 1 - i]; // newest layer on top
      const v = Math.min(1.15, wk / maxH);
      const halfW = 8 + v * 68;
      const y = topY + i * bh;
      const recent = (n - 1 - i) / 12;
      const on = wk > 0.05;
      return (
        <rect key={i} x={(100 - halfW).toFixed(1)} y={y.toFixed(1)} width={(halfW * 2).toFixed(1)}
          height={(bh * 0.66).toFixed(1)} rx={(bh * 0.33).toFixed(1)}
          fill={on ? color : EMBER} opacity={on ? (lit ? 0.3 + recent * 0.55 : 0.2) : 0.1} />
      );
    });
    body = (
      <>
        <line x1={C} y1={28} x2={C} y2={172} stroke="var(--line)" strokeWidth={1} opacity={0.4} />
        {bands}
      </>
    );
  } else {
    // thread — a constellation of showing-up, lit nodes strung in week order
    const nodes = weeks.map((h) => {
      const deg = rand() * 360;
      const rr = 30 + rand() * 46;
      const [x, y] = polar(rr, deg);
      return { x, y, on: h > 0.05, v: Math.min(1.2, h / maxH) };
    });
    const path = nodes
      .filter((nd) => nd.on)
      .map((nd, k) => `${k ? "L" : "M"} ${nd.x.toFixed(1)} ${nd.y.toFixed(1)}`)
      .join(" ");
    body = (
      <>
        <circle cx={C} cy={C} r={76} fill="none" stroke="var(--line)" strokeWidth={1} opacity={0.35} />
        <path d={path} fill="none" stroke={lit ? color : EMBER} strokeWidth={1.4} opacity={lit ? 0.4 : 0.2} strokeLinecap="round" strokeLinejoin="round" />
        {glow}
        {nodes.map((nd, i) =>
          nd.on ? (
            <circle key={i} cx={nd.x.toFixed(1)} cy={nd.y.toFixed(1)} r={(2 + nd.v * 3.5).toFixed(1)} fill={color} opacity={lit ? 0.45 + nd.v * 0.5 : 0.3} />
          ) : (
            <circle key={i} cx={nd.x.toFixed(1)} cy={nd.y.toFixed(1)} r={1.6} fill={EMBER} opacity={0.18} />
          ),
        )}
      </>
    );
  }

  return (
    <svg viewBox="0 0 200 200" width={size} height={size} className={className} role="img" aria-label="Domain sigil" style={{ overflow: "visible", ...style }}>
      <g transform={`rotate(${rot} ${C} ${C})`}>{body}</g>
    </svg>
  );
}
