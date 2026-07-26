import type { CSSProperties } from "react";
import { LADDER, type Rung } from "./AppShell";
import { useVertical } from "../hooks/useVertical";
import { readSpine, type SpineState } from "../lib/readiness";
import { READY, toneColor } from "./floors/ReadinessBanner";
import GettingStarted from "./orientation/GettingStarted";

// Top-to-bottom: Schedule (immediate) → Domain (widest). ⌘1 at top, ⌘4 at bottom.
const RUNGS: { id: Rung; label: string }[] = [
  { id: "day", label: "Schedule" },
  { id: "project", label: "Projects" },
  { id: "initiative", label: "Initiatives" },
  { id: "domain", label: "Domains" },
];

// The shared vocabulary for the rituals (Planner command palette,
// useAppNavigation). The spine no longer launches them — it's navigation + the
// readiness gauge. Flows open from the work surfaces instead: the floor "now
// what" banners, Today's Plan, the Sunday nudge, and the command palette.
export type FlowName = "sunday" | "summit" | "tending" | "capacity";

// The spine reads like a table of contents for your life. Two zones:
// Execute (Schedule — where the day actually gets done) and Build (Project ·
// Initiative · Domain — structure). The seam between them is the Week, the only
// gate from the vertical to the calendar. Every rung carries a gauge: a hairline
// meter ("ready for the floor below") + a gentle cue for the one thing slipping
// — the funnel made visible in the chrome.
const EXECUTE = RUNGS.slice(0, 1);
const BUILD = RUNGS.slice(1);

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
  openSettings,
  openShortcuts,
  collapsed = false,
}: {
  rung: Rung;
  setRung: (r: Rung) => void;
  openSettings: () => void;
  openShortcuts: () => void;
  /** Focus mode: slide the whole spine closed (the calendar takes the room). */
  collapsed?: boolean;
}) {
  // Reads from the same cached vertical snapshot the floors use — no extra
  // fetch. Until it's loaded the rail stays a plain table of contents (no
  // half-empty meters flashing during the first paint).
  const { data, ready } = useVertical();
  const spine: SpineState | null = ready ? readSpine(data) : null;

  const renderRung = (r: { id: Rung; label: string }) => {
    const on = r.id === rung;
    const n = LADDER.indexOf(r.id) + 1;
    const fs = spine?.floors[r.id] ?? null;
    const cue = fs?.cue ?? null;

    return (
      <div key={r.id}>
        <button
          onClick={() => setRung(r.id)}
          title={`${r.label} (⌘${n})`}
          className="fast relative flex w-full flex-col gap-1.5 rounded-lg border border-transparent px-2.5 py-2 text-left"
          style={on ? activePill : undefined}
        >
          {/* line 1 — navigation: the altitude, then a status at the right. A
              floor at rest wears a check where an active floor wears its cue dot,
              so the indicator lives in one place and the row collapses to a
              single quiet line. */}
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
            {fs?.calm ? (
              <span
                aria-hidden
                className="flex shrink-0 items-center leading-none"
                style={{ color: `color-mix(in srgb, ${READY} 66%, var(--muted))` }}
                title="At rest — nothing here needs you"
              >
                <svg
                  viewBox="0 0 12 12"
                  width="12"
                  height="12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M2.5 6.5 5 9l4.5-5.5" />
                </svg>
              </span>
            ) : cue ? (
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: toneColor(cue.tone) }}
              />
            ) : null}
          </span>

          {/* line 2 — readiness. Only when there's still ground to cover: the
              meter (a track begging to be filled) and the one cue. A calm floor
              has neither — its check on line 1 says all it needs to. */}
          {fs && !fs.calm && (
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
      </div>
    );
  };

  return (
    <div
      className="spine relative z-40 shrink-0 overflow-hidden"
      style={{
        width: collapsed ? 0 : "var(--spine-width,188px)",
        transition: "width var(--d-slow) var(--ease-out)",
        background: "transparent",
      }}
    >
      {/* Inner holds its natural width so the content never reflows while the
          outer clips it shut. */}
      <div
        className="relative flex h-full flex-col"
        style={{
          width: "var(--spine-width,188px)",
          opacity: collapsed ? 0 : 1,
          transition: "opacity var(--d-base) var(--ease-out)",
        }}
      >
      {/* Right separator — runs the full height (spine is wide enough to clear
          the macOS traffic lights). */}
      <div className="spine-separator pointer-events-none absolute bottom-0 right-0 w-px bg-line" />

      {/* Pure drag region — clears the macOS traffic lights. */}
      <div data-tauri-drag-region className="spine-top shrink-0 w-full" />

      {/* Wordmark home — brand + a tap back to the Schedule, the surface the
          day actually runs on. */}
      <button
        onClick={() => setRung("day")}
        title="Home"
        className={`fast wordmark select-none px-4 py-3 text-left text-[15px] leading-none ${rung === "day" ? "wordmark-grad" : ""}`}
        style={rung === "day" ? {} : { color: "var(--muted)", opacity: 0.5 }}
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
        {/* First-run reward spine — derived 5-milestone tracker. Present on every
            elevation (the Spine is the one persistent chrome), retires itself for
            established users, and is always dismissible. */}
        <GettingStarted />
        <button
          onClick={openSettings}
          title="Settings (⌘,)"
          className="fast flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-left text-muted hover:text-ink"
        >
          <span className="w-3.5 shrink-0 text-center text-caption leading-none">⚙</span>
          <span className="text-caption leading-none">Settings</span>
        </button>
        <button
          onClick={openShortcuts}
          title="Keyboard shortcuts (?)"
          className="fast flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-left text-muted hover:text-ink"
        >
          <span className="w-3.5 shrink-0 text-center text-caption leading-none">⌘</span>
          <span className="text-caption leading-none">Shortcuts</span>
        </button>
      </div>
      </div>
    </div>
  );
}
