// The overworld — how much of the whole portfolio is groomed, as one number you
// watch climb. Doubles as the "where do I start" map: every bet and project as a
// readiness bar, sorted so the least-ready surface first. Returning from a sealed
// run, the gain cascades — the project bar fills, its initiative ring climbs, the
// portfolio meter counts up. (docs/refine-run.md §5.)

import { useEffect, useRef, useState } from "react";
import {
  domainById,
  isOpenStatus,
  projectsOf,
  looseProjectsOf,
  type VerticalData,
} from "../../lib/vertical";
import { portfolioReadiness, tendedScore } from "../../lib/tending";

export interface ReadinessSnapshot {
  portfolio: number;
  items: Record<string, number>;
}

export function snapshotReadiness(d: VerticalData): ReadinessSnapshot {
  const items: Record<string, number> = {};
  for (const p of d.projects) if (isOpenStatus(p.status)) items[p.id] = Math.round(tendedScore(d, "project", p.id) * 100);
  for (const i of d.initiatives) if (isOpenStatus(i.status)) items[i.id] = Math.round(tendedScore(d, "initiative", i.id) * 100);
  return { portfolio: portfolioReadiness(d), items };
}

const barColor = (v: number) => (v >= 100 ? "var(--accent)" : v >= 50 ? "#D97706" : "var(--line-strong)");

export default function RefinePortfolio({
  data, from, onStart,
}: {
  data: VerticalData;
  from: ReadinessSnapshot | null;
  onStart: (item: { kind: "project" | "initiative"; id: string } | undefined) => void;
}) {
  const live = portfolioReadiness(data);
  // animate from the pre-run baseline to live (the cascade), once on mount
  const [animated, setAnimated] = useState(from == null);
  useEffect(() => {
    if (from == null) return;
    const t = requestAnimationFrame(() => requestAnimationFrame(() => setAnimated(true)));
    return () => cancelAnimationFrame(t);
  }, [from]);
  const at = (id: string, liveVal: number) => (animated || !from ? liveVal : from.items[id] ?? liveVal);
  const portfolioShown = animated || !from ? live : from.portfolio;
  const gained = from != null && live > from.portfolio ? live - from.portfolio : 0;

  const initiatives = data.initiatives.filter((i) => isOpenStatus(i.status));
  const groupedProjectIds = new Set(initiatives.flatMap((i) => projectsOf(data, i.id).map((p) => p.id)));
  const looseByDomain = data.domains
    .map((dom) => ({ dom, projects: looseProjectsOf(data, dom.id).filter((p) => isOpenStatus(p.status) && !groupedProjectIds.has(p.id)) }))
    .filter((g) => g.projects.length > 0);

  return (
    <div className="pt-3 pb-28">
      {/* hero — the portfolio meter */}
      <div className="flex items-end justify-between">
        <div className="section-label">Portfolio readiness</div>
        <div className="relative">
          <CountUp to={portfolioShown} className="text-display masthead leading-none" />
          <span className="text-head text-muted">%</span>
          {gained > 0 && <FloatGain value={gained} />}
        </div>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
        <div className="h-full rounded-full" style={{ width: `${portfolioShown}%`, background: "var(--accent)", transition: "width 1s var(--ease-out)" }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-micro text-muted">
        <span className="mono">{initiatives.length} bets · {Object.keys(snapshotReadiness(data).items).length} items</span>
        <button onClick={() => onStart(undefined)} className="fast font-medium" style={{ color: "var(--accent)" }}>Refine next →</button>
      </div>

      {/* the bets, each a ring + its projects */}
      <div className="mt-6 space-y-2.5">
        {initiatives.map((i) => {
          const accent = domainById(data, i.domainId)?.color ?? "var(--accent)";
          const kids = projectsOf(data, i.id).filter((p) => isOpenStatus(p.status));
          const sealed = kids.filter((p) => (snapshotReadiness(data).items[p.id] ?? 0) >= 100).length;
          const ring = at(i.id, Math.round(tendedScore(data, "initiative", i.id) * 100));
          return (
            <div key={i.id} className="rounded-xl border border-line glass-card px-3.5 py-3">
              <button onClick={() => onStart({ kind: "initiative", id: i.id })} className="tap fast flex w-full items-center gap-3 text-left">
                <MiniRing pct={ring} accent={accent} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body font-medium">{i.name}</div>
                  <div className="text-micro text-muted">{kids.length ? `${sealed} of ${kids.length} sealed` : "no projects yet"}</div>
                </div>
                <span className="text-muted">→</span>
              </button>
              {kids.length > 0 && (
                <div className="mt-2.5 space-y-1.5 border-t border-line pt-2.5">
                  {kids.map((p) => <ProjectBar key={p.id} name={p.name} pct={at(p.id, Math.round(tendedScore(data, "project", p.id) * 100))} onTap={() => onStart({ kind: "project", id: p.id })} />)}
                </div>
              )}
            </div>
          );
        })}

        {looseByDomain.map(({ dom, projects }) => (
          <div key={dom.id} className="rounded-xl border border-line glass-card px-3.5 py-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: dom.color }} />
              <span className="section-label">{dom.name} · direct projects</span>
            </div>
            <div className="space-y-1.5">
              {projects.map((p) => <ProjectBar key={p.id} name={p.name} pct={at(p.id, Math.round(tendedScore(data, "project", p.id) * 100))} onTap={() => onStart({ kind: "project", id: p.id })} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectBar({ name, pct, onTap }: { name: string; pct: number; onTap: () => void }) {
  return (
    <button onClick={onTap} className="tap fast block w-full text-left">
      <div className="flex items-center justify-between text-caption">
        <span className="min-w-0 truncate pr-2 text-muted">{name}</span>
        <span className="mono shrink-0 text-micro" style={{ color: pct >= 100 ? "var(--accent)" : "var(--muted)" }}>{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor(pct), transition: "width .9s var(--ease-out), background .4s" }} />
      </div>
    </button>
  );
}

function MiniRing({ pct, accent }: { pct: number; accent: string }) {
  const R = 16, C = 2 * Math.PI * R;
  return (
    <div className="relative h-10 w-10 shrink-0">
      <svg viewBox="0 0 40 40" className="h-10 w-10">
        <circle cx="20" cy="20" r={R} fill="none" stroke="var(--line)" strokeWidth="3.5" />
        <circle cx="20" cy="20" r={R} fill="none" stroke={accent} strokeWidth="3.5" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} transform="rotate(-90 20 20)"
          style={{ transition: "stroke-dashoffset 1s var(--ease-out)" }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-micro font-medium">{pct}</div>
    </div>
  );
}

function CountUp({ to, className }: { to: number; className?: string }) {
  const [n, setN] = useState(to);
  const fromRef = useRef(to);
  useEffect(() => {
    const start = fromRef.current;
    if (start === to) { setN(to); return; }
    let raf = 0; const t0 = performance.now(); const dur = 900;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      setN(Math.round(start + (to - start) * k));
      if (k < 1) raf = requestAnimationFrame(step);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <span className={className}>{n}</span>;
}

function FloatGain({ value }: { value: number }) {
  const [up, setUp] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setUp(true)); return () => cancelAnimationFrame(t); }, []);
  return (
    <span className="mono absolute -right-1 -top-3 text-label font-medium"
      style={{ color: "var(--accent)", opacity: up ? 0 : 1, transform: up ? "translateY(-18px)" : "translateY(0)", transition: "all 1.3s var(--ease-out)" }}>
      +{value}
    </span>
  );
}
