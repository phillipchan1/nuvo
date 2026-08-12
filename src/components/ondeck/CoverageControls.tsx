// The coverage strip's toolbar: a collapse toggle (the deck is the primary surface,
// so coverage folds to a one-line summary) and a domain filter (which domains the
// strip watches — hide the ones you don't need to balance). Persist via usePlannerPrefs;
// the filter stores the HIDDEN set so a new domain is watched by default.

import type { Domain } from "../../lib/vertical";
import { Icon } from "../Icon";
import { useEscape } from "../../hooks/useEscape";

export default function CoverageControls({
  collapsed,
  setCollapsed,
  covered,
  tracked,
  domains,
  hidden,
  toggleHidden,
  open,
  setOpen,
}: {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  /** domains with work in the window / total tracked — the collapsed summary. */
  covered: number;
  tracked: number;
  domains: Domain[];
  hidden: Set<string>;
  toggleHidden: (id: string) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const shown = domains.length - domains.filter((d) => hidden.has(d.id)).length;
  useEscape(open, () => setOpen(false));

  return (
    <div className="flex items-center justify-between gap-3">
      {/* collapse toggle — the deck is the primary surface; fold coverage away */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="fast tap flex items-center gap-1.5 text-left"
        title={collapsed ? "Show coverage" : "Hide coverage"}
        aria-expanded={!collapsed}
      >
        <span className="text-micro text-muted transition-transform" style={{ transform: collapsed ? "rotate(0deg)" : "rotate(90deg)" }}>▸</span>
        <span className="section-label !p-0">Coverage</span>
        {collapsed && (
          <span className="text-micro text-muted">· {covered}/{tracked} tracked</span>
        )}
      </button>

      {/* domain filter — which domains the coverage strip watches */}
      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="fast tap flex items-center gap-1.5 px-1 py-1 text-caption text-muted hover:text-ink"
          title="Choose which domains coverage tracks"
        >
          Domains
          <span className="mono text-micro">{shown}/{domains.length}</span>
          <span className="text-micro">▾</span>
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="glass-card absolute right-0 z-50 mt-1 w-56 rounded-xl border border-line p-1.5" style={{ boxShadow: "var(--shadow-lift)" }}>
              <div className="section-label px-1.5 pb-1">Track in coverage</div>
              {domains.map((d) => {
                const on = !hidden.has(d.id);
                return (
                  <button
                    key={d.id}
                    onClick={() => toggleHidden(d.id)}
                    className="tap fast flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-surface-2"
                  >
                    <span
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded border"
                      style={on ? { background: d.color, borderColor: d.color } : { borderColor: "var(--line-strong)" }}
                    >
                      {on && (
                        <Icon name="check" size={9} style={{ color: "#fff" }} />
                      )}
                    </span>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: d.color }} />
                    <span className="truncate text-caption" style={{ color: on ? "var(--ink)" : "var(--muted)" }}>{d.name}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
