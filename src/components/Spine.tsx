import type { CSSProperties } from "react";
import { LADDER, type Rung } from "./AppShell";
import { useVertical } from "../hooks/useVertical";
import { readSpine, type SpineState } from "../lib/readiness";
import { READY, toneColor } from "./floors/ReadinessBanner";

// Top-to-bottom: Now (immediate) → Domain (widest). ⌘1 at top, ⌘5 at bottom.
const RUNGS: { id: Rung; label: string }[] = [
  { id: "now", label: "Today" },
  { id: "day", label: "Schedule" },
  { id: "project", label: "Project" },
  { id: "initiative", label: "Initiative" },
  { id: "domain", label: "Domain" },
];

export type FlowName = "sunday" | "summit" | "tending";

// A flow is the *act* of deciding at an altitude. Floors are for looking;
// flows are for deciding — so each ritual lives on the rung it operates on.
// Tending spans both Build rungs (projects AND initiatives), so it hangs off
// each — it surfaces whatever is ripest across the two.
const RUNG_FLOW: Partial<Record<Rung, { flow: FlowName; label: string; sub: string }>> = {
  day: { flow: "sunday", label: "Sunday", sub: "compose the week" },
  project: { flow: "tending", label: "Tending", sub: "ripen what's ready" },
  initiative: { flow: "tending", label: "Tending", sub: "ripen what's ready" },
  domain: { flow: "summit", label: "Summit", sub: "decide the quarter" },
};

// The spine reads like a table of contents for your life. Two zones:
// Execute (Today · Schedule — time horizons) and Build (Project · Initiative ·
// Domain — structure). The seam between them is the Week, the only gate from
// the vertical to the calendar. Each rung now also carries a readiness gauge:
// a hairline meter ("ready for the floor below") + a gentle cue for the one
// thing slipping — the funnel made visible, in the chrome itself.
const EXECUTE = RUNGS.slice(0, 2);
const BUILD = RUNGS.slice(2);

// The one whisper of glass in the app's chrome: the active chapter rises on a
// frosted pane over the atmosphere — present, never stark.
const activePill: CSSProperties = {
  background: "color-mix(in srgb, var(--surface) 72%, transparent)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  boxShadow: "var(--shadow-1)",
  borderColor: "color-mix(in srgb, var(--line) 85%, transparent)",
};

// `READY` (the meter's ripe-green fill) and `toneColor` (cue tone → token) are
// shared with the floor-level ReadinessBanner, so the gauge reads the same in
// the chrome and inside the views.

export default function Spine({
  rung,
  setRung,
  openFlow,
  openSettings,
}: {
  rung: Rung;
  setRung: (r: Rung) => void;
  openFlow: (f: FlowName) => void;
  openSettings: () => void;
}) {
  // Reads from the same cached vertical snapshot the floors use — no extra
  // fetch. Until it's loaded the rail stays a plain table of contents (no
  // half-empty meters flashing during the first paint).
  const { data, ready } = useVertical();
  const spine: SpineState | null = ready ? readSpine(data) : null;

  const renderRung = (r: { id: Rung; label: string }) => {
    const on = r.id === rung;
    const rf = RUNG_FLOW[r.id];
    const n = LADDER.indexOf(r.id) + 1;
    const fs = spine?.floors[r.id] ?? null;
    const cue = fs?.cue ?? null;

    return (
      <div key={r.id} className="group relative">
        <button
          onClick={() => setRung(r.id)}
          title={`${r.label} (⌘${n})`}
          className="fast relative flex w-full flex-col gap-1.5 rounded-lg border border-transparent px-2.5 py-2 text-left"
          style={on ? activePill : undefined}
        >
          {/* line 1 — navigation: the altitude, with the cue dot at the right */}
          <span className="flex items-center gap-2.5">
            <span
              className="w-3.5 shrink-0 text-center leading-none"
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "14px",
                fontWeight: on ? 500 : 400,
                color: on ? "var(--accent)" : "var(--muted)",
              }}
            >
              {n}
            </span>
            <span
              className="flex-1 text-caption leading-none"
              style={{ color: on ? "var(--text)" : "var(--muted)", fontWeight: on ? 600 : 400 }}
            >
              {r.label}
            </span>
            {cue && (
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: toneColor(cue.tone) }}
              />
            )}
          </span>

          {/* line 2 — readiness: the meter (held, not missing) + the one cue.
              Calm floors show only the quiet meter; the rail stays serene. */}
          {fs && (
            <span className="flex items-center gap-2" style={{ paddingLeft: 24 }}>
              <span
                className="relative h-1 min-w-0 flex-1 overflow-hidden rounded-full"
                style={{ background: "var(--line)" }}
              >
                <span
                  className="fast absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${Math.round(fs.readiness * 100)}%`, background: READY }}
                />
              </span>
              {cue && (
                <span
                  className="mono shrink-0 truncate text-micro leading-none"
                  style={{ color: toneColor(cue.tone), maxWidth: 96 }}
                  title={cue.label}
                >
                  {cue.label}
                </span>
              )}
            </span>
          )}
        </button>

        {/* Hover lifts the ceremony entry — a glass card floating clear of the
            rail, carrying the live cue (or the ritual's standing invitation when
            the floor is calm). Always reachable; the demand below is never
            hover-gated, only this express shortcut into the flow is. */}
        {rf && (
          <button
            onClick={() => openFlow(rf.flow)}
            title={`${rf.label} — ${rf.sub}`}
            className="glass-card elev-2 fast invisible absolute top-1/2 z-40 flex -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-lg border border-line py-1.5 pl-2.5 pr-3 text-left opacity-0 group-hover:visible group-hover:opacity-100"
            style={{ left: "calc(100% - 8px)" }}
          >
            <span className="text-caption" style={{ color: "var(--accent)" }}>✦</span>
            <span>
              <span className="block text-label font-medium leading-tight text-ink">{rf.label}</span>
              <span
                className="mono block text-micro leading-tight"
                style={{ color: cue ? toneColor(cue.tone) : "var(--muted)" }}
              >
                {cue ? cue.label : rf.sub}
              </span>
            </span>
            <span className="text-label text-muted">▸</span>
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      className="spine relative z-40 flex w-[var(--spine-width,188px)] shrink-0 flex-col"
      style={{ background: "transparent" }}
    >
      {/* Right separator — runs the full height (spine is wide enough to clear
          the macOS traffic lights). */}
      <div className="spine-separator pointer-events-none absolute bottom-0 right-0 w-px bg-line" />

      {/* Pure drag region — clears the macOS traffic lights. */}
      <div data-tauri-drag-region className="spine-top shrink-0 w-full" />

      {/* Wordmark home — brand + a tap back to Today. */}
      <button
        onClick={() => setRung("now")}
        title="Home"
        className={`fast wordmark select-none px-4 py-3 text-left text-[15px] leading-none ${rung === "now" ? "wordmark-grad" : ""}`}
        style={rung === "now" ? {} : { color: "var(--muted)", opacity: 0.5 }}
      >
        Nuvo
      </button>

      <nav className="flex flex-1 flex-col px-2 pt-3">
        <div className="section-label px-2.5 pb-1.5">Execute</div>
        {EXECUTE.map(renderRung)}

        <div className="mx-2.5 my-3 border-t border-line" />

        <div className="section-label px-2.5 pb-1.5">Build</div>
        {BUILD.map(renderRung)}

        {/* The reward state, gently: every floor settled — moving or at rest. */}
        {spine?.allAtRest && (
          <div className="rise mt-3 flex items-center gap-1.5 px-2.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: READY }} />
            <span className="section-label" style={{ color: READY }}>all at rest</span>
          </div>
        )}
      </nav>

      <div className="mt-auto px-2 pb-3">
        <button
          onClick={openSettings}
          title="Settings (⌘,)"
          className="fast flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-left text-muted hover:text-ink"
        >
          <span className="w-3.5 shrink-0 text-center text-caption leading-none">⚙</span>
          <span className="text-caption leading-none">Settings</span>
        </button>
        <div className="mono px-2.5 pt-2 text-micro leading-tight text-muted">⌘1–5 · ⌘↓↑</div>
      </div>
    </div>
  );
}
