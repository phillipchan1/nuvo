import type { CSSProperties } from "react";
import { LADDER, type Rung } from "./AppShell";

// Top-to-bottom: Now (immediate) → Domain (widest). ⌘1 at top, ⌘5 at bottom.
const RUNGS: { id: Rung; label: string }[] = [
  { id: "now", label: "Today" },
  { id: "day", label: "Schedule" },
  { id: "project", label: "Project" },
  { id: "initiative", label: "Initiative" },
  { id: "domain", label: "Domain" },
];

export type FlowName = "sunday" | "summit" | "blueprint";

// A flow is the *act* of deciding at an altitude. Floors are for looking;
// flows are for deciding — so each ritual lives on the rung it operates on.
const RUNG_FLOW: Partial<Record<Rung, { flow: FlowName; label: string; sub: string }>> = {
  day: { flow: "sunday", label: "Sunday", sub: "compose the week" },
  initiative: { flow: "blueprint", label: "Blueprint", sub: "shape a new bet" },
  domain: { flow: "summit", label: "Summit", sub: "decide the quarter" },
};

// The spine reads like a table of contents for your life. Two zones:
// Execute (Today · Schedule — time horizons) and Build (Project · Initiative ·
// Domain — structure). The seam between them is the Week, the only gate from
// the vertical to the calendar.
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
  const renderRung = (r: { id: Rung; label: string }) => {
    const on = r.id === rung;
    const rf = RUNG_FLOW[r.id];
    const n = LADDER.indexOf(r.id) + 1;
    return (
      <div key={r.id} className="group relative">
        <button
          onClick={() => setRung(r.id)}
          title={`${r.label} (⌘${n})`}
          className="fast relative flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-left"
          style={on ? activePill : undefined}
        >
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
            className="text-caption leading-none"
            style={{ color: on ? "var(--text)" : "var(--muted)", fontWeight: on ? 600 : 400 }}
          >
            {r.label}
          </span>
          {rf && (
            <span
              aria-hidden
              className="fast ml-auto text-meta leading-none group-hover:opacity-0"
              style={{ color: on ? "var(--accent)" : "var(--muted)" }}
            >
              ◇
            </span>
          )}
        </button>

        {/* Hover reveals the ritual that lives at this altitude — a card that
            floats clear of the rail, out over the floor. */}
        {rf && (
          <button
            onClick={() => openFlow(rf.flow)}
            title={`${rf.label} — ${rf.sub}`}
            className="elev-3 fast invisible absolute top-1/2 z-40 flex -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-lg border border-line bg-surface py-1.5 pl-2.5 pr-3 text-left opacity-0 group-hover:visible group-hover:opacity-100"
            style={{ left: "calc(100% - 8px)" }}
          >
            <span className="text-caption" style={{ color: "var(--accent)" }}>◇</span>
            <span>
              <span className="block text-label font-medium leading-tight text-ink">{rf.label}</span>
              <span className="mono block text-micro leading-tight text-muted">{rf.sub}</span>
            </span>
            <span className="text-label text-muted">▸</span>
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      className="spine relative z-40 flex w-[var(--spine-width,140px)] shrink-0 flex-col"
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
