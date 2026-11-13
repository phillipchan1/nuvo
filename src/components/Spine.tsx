import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { LADDER, type Rung } from "./AppShell";
import { getUiScale, useUiScale } from "../hooks/useUiScale";
import { useVerticalSelector } from "../hooks/useVertical";
import { readSpine, type SpineState } from "../lib/readiness";
import { toneColor } from "./floors/ReadinessBanner";
import { useWeekCrown } from "../hooks/useWeekCrown";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { Dot, Kbd, NuvoMark } from "./kit";
import { AltitudeIcon, ChevronIcon, SettingsIcon } from "./icons";
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
export type FlowName = "sunday" | "sunday-walk" | "summit" | "tending" | "capacity";

// The spine reads like a table of contents for your life. Two zones:
// Execute (Schedule — where the day actually gets done) and Build (Project ·
// Initiative · Domain — structure). The seam between them is the Week, the only
// gate from the vertical to the calendar. Every rung carries a gauge: a hairline
// meter ("ready for the floor below") + a gentle cue for the one thing slipping
// — the funnel made visible in the chrome.
const EXECUTE = RUNGS.slice(0, 1);
const BUILD = RUNGS.slice(1);

// Two widths, one spine. Railed, the icons carry the whole table of contents —
// the glyphs are the altitude, so the labels are what's spent, not the meaning.
// (Focus mode is a third state above both: it slides the spine shut entirely.)
const FULL_W = 228;
const RAIL_W = 52;

const RAIL_KEY = "nuvo-spine-rail";
function readRail(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === "1";
  } catch {
    return false;
  }
}
function writeRail(v: boolean) {
  try {
    localStorage.setItem(RAIL_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

// The rung glyphs are the shared altitude family (`components/icons.tsx`) — the
// same set the phone's bottom bar and the command palette draw from, so the
// chrome and the surfaces never disagree about what a project looks like.

// `READY` (the meter's ripe-green fill) and `toneColor` (cue tone → token) are
// shared with the floor-level ReadinessBanner, so the gauge reads the same in
// the chrome and inside the views.

interface SpineProps {
  rung: Rung;
  setRung: (r: Rung) => void;
  openSettings: () => void;
  openShortcuts: () => void;
  /** Focus mode: slide the whole spine closed (the calendar takes the room). */
  collapsed?: boolean;
  /**
   * Squeeze mode: render railed because the workspace has no room for the wide
   * spine — the chat is open on a narrow window. Distinct from the user's own
   * railed *preference*, which this deliberately does not touch or persist: the
   * spine springs back to whatever they chose the moment the squeeze lifts.
   */
  forceRail?: boolean;
  /** A full-screen flow covers the window: the traffic lights go back to rest
   *  instead of sitting in a page bar nobody can see. */
  overlaid?: boolean;
}

/** SpineState is small pure data, so a JSON signature is an honest identity. */
const sameSpine = (a: SpineState | null, b: SpineState | null) =>
  a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));

// The thin half: subscribes to the spine reading — not the whole vertical — and
// hands the body a signature-stable value. The Spine is mounted on every
// desktop surface and was the top self-time component on 18 of 24 measured
// interactions — because every vertical rebuild re-rendered its whole DOM even
// when the reading it displays hadn't changed. As a selection it doesn't even
// re-render: a write that leaves every meter where it was costs one `readSpine`.
export default function Spine(props: SpineProps) {
  // Reads from the same cached vertical snapshot the floors use — no extra
  // fetch. Until it's loaded the rail stays a plain table of contents (no
  // half-empty meters flashing during the first paint).
  const spine = useVerticalSelector((s) => (s.ready ? readSpine(s.data) : null), sameSpine);
  return <SpineBody spine={spine} {...props} />;
}

const SpineBody = memo(function SpineBody({
  spine,
  rung,
  setRung,
  openSettings,
  openShortcuts,
  collapsed = false,
  forceRail = false,
  overlaid = false,
}: SpineProps & { spine: SpineState | null }) {
  // The macOS traffic lights are drawn by AppKit, outside the zoomed document,
  // so they can't left-align themselves to the wordmark — nothing native knows
  // where it is. Measure it here and hand Rust the answer in WINDOW POINTS
  // (css × --ui-scale). Re-runs when the spine rails, focus mode closes it, or
  // the zoom changes, i.e. every time the mark actually moves.
  const wordmarkRef = useRef<HTMLButtonElement>(null);
  const spineRef = useRef<HTMLDivElement>(null);
  // Kept in CSS px, not points: on a zoom change the layout is unchanged, so
  // the same measurement just gets re-scaled rather than re-measured.
  const wordmarkCssLeft = useRef<number | null>(null);
  const { scale: uiScale } = useUiScale();
  // `railedPref` is what the user chose and what gets persisted; `railed` is
  // what actually renders. They differ only while the workspace is squeezed.
  const [railedPref, setRailed] = useState(readRail);
  const railed = railedPref || forceRail;
  const toggleRail = () =>
    setRailed((v) => {
      writeRail(!v);
      return !v;
    });

  // ⌘\ — the standard "narrow the sidebar" gesture, live from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "\\") return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      e.preventDefault();
      toggleRail();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Everything that positions itself against the spine (the Getting-started
  // popover today) reads `--spine-width`, so the width lives in the token and
  // the two states stay in sync by construction.
  useEffect(() => {
    document.documentElement.style.setProperty("--spine-width", `${railed ? RAIL_W : FULL_W}px`);
  }, [railed]);

  // Tell the native titlebar where the traffic lights go. AppKit draws them in
  // unzoomed window points, so every css measurement is × uiScale.
  //
  //   Sidebar open — they share the wordmark's left edge, in the titlebar band
  //   the spine reserves above it.
  //   Sidebar railed or hidden — a 52px rail can't hold the cluster (it ends
  //   at 76pt), so they move into the panel's top-left corner, centred on its
  //   48px top row, and whatever holds that corner — the page bar, or on the
  //   Schedule the rail's crown — starts after them (frame.css, --lights-room).
  //   That is where Finder and Safari carry them when their sidebar is shut.
  //   A full-screen flow on top, or the spine unmounting (signed out) — back
  //   to rest, so they never land on something that didn't make room.
  //
  // They move the moment the sidebar does, to where things END: the corner is
  // computed from the rail's target width, never measured mid-slide. A timer
  // waiting out the transition raced it — and a window behind others runs
  // neither timers nor transitions on time, so it put the lights in the
  // middle of an open sidebar.
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in globalThis)) return;
    const send = (x: number, centerY: number | null) => {
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("align_traffic_lights", { x: x * uiScale, centerY: centerY == null ? null : centerY * uiScale }))
        .catch(() => { /* non-macOS, or the command isn't there — keep the default */ });
    };

    if (overlaid || (!collapsed && !railed)) {
      // At rest, on the wordmark's left edge — the glyphs, not the full-width
      // button. It doesn't move with the rail's width, so it reads true now.
      // Before it was ever measured (a cold start railed), rest is AppKit's
      // own 16pt.
      const el = wordmarkRef.current;
      if (el && !overlaid) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const left = range.getBoundingClientRect().left;
        range.detach();
        if (left) wordmarkCssLeft.current = left;
      }
      send(wordmarkCssLeft.current ?? 16 / uiScale, null);
      return;
    }

    // Railed or hidden: into the panel's corner. Its top row is 48px; the
    // lights start 16px in, like the row's own content. The panel's left is
    // where it will be once the rail reaches its target width — its margin
    // has already switched, only the rail's width is still sliding.
    const panel = document.querySelector<HTMLElement>(".app-panel");
    const rail = spineRef.current;
    if (!panel || !rail) return;
    const p = panel.getBoundingClientRect();
    const slide = (collapsed ? 0 : RAIL_W) - rail.getBoundingClientRect().width;
    send(p.left + slide + 16, p.top + 24);
  }, [railed, collapsed, overlaid, uiScale]);

  // Signing out unmounts the spine; the lights go back to rest with it.
  useEffect(
    () => () => {
      if (!("__TAURI_INTERNALS__" in globalThis)) return;
      const x = wordmarkCssLeft.current == null ? 16 : wordmarkCssLeft.current * getUiScale();
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("align_traffic_lights", { x, centerY: null }))
        .catch(() => {});
    },
    [],
  );

  const width = railed ? RAIL_W : FULL_W;

  // One row shape for everything in the sidebar — a rung, the week's projects,
  // the footer. Railed, the label is spent and the native tooltip (lib/tooltips)
  // hands it back with the shortcut.
  const renderRung = (r: { id: Rung; label: string }) => {
    const on = r.id === rung;
    const n = LADDER.indexOf(r.id) + 1;
    const fs = spine?.floors[r.id] ?? null;
    const cue = fs && !fs.calm ? fs.cue : null;
    const cueColor = cue ? toneColor(cue.tone) : null;
    const tip = `${r.label} (⌘${n})${cue ? ` · ${cue.label}` : ""}`;
    return (
      <button
        key={r.id}
        data-teach={`rung-${r.id}`}
        onClick={() => setRung(r.id)}
        aria-current={on}
        aria-label={`${r.label} (⌘${n})`}
        title={railed ? tip : cue ? cue.label : undefined}
        className="sb-item"
      >
        <span className="sb-icon">
          <AltitudeIcon kind={r.id} size={16} />
        </span>
        <span className="sb-label">{r.label}</span>
        <span className="sb-trail">
          {/* the floor's one cue, in its tone — a calm floor shows its key */}
          {cue ? (
            <span className="truncate" style={{ color: cueColor ?? undefined, maxWidth: 84 }}>
              {cue.label}
            </span>
          ) : (
            <Kbd keys={["⌘", String(n)]} />
          )}
        </span>
        {railed && cueColor && <span aria-hidden className="sb-cue-rail" style={{ background: cueColor }} />}
      </button>
    );
  };

  const utility = (opts: { icon: ReactNode; label: string; hint: string; onClick: () => void }) => (
    <button
      onClick={opts.onClick}
      title={`${opts.label} (${opts.hint})`}
      aria-label={`${opts.label} (${opts.hint})`}
      className="sb-item"
    >
      <span className="sb-icon">{opts.icon}</span>
      <span className="sb-label">{opts.label}</span>
    </button>
  );

  return (
    <div
      ref={spineRef}
      className="spine relative z-40 shrink-0 overflow-hidden"
      data-rail={railed || undefined}
      data-collapsed={collapsed || undefined}
      style={{
        width: collapsed ? 0 : width,
        transition: "width var(--d-slow) var(--ease-out)",
      }}
    >
      {/* Inner holds its natural width so the content never reflows while the
          outer clips it shut. */}
      <div
        className="sb-inner"
        style={{
          width,
          opacity: collapsed ? 0 : 1,
          transition: "opacity var(--d-base) var(--ease-out), width var(--d-slow) var(--ease-out)",
        }}
      >
        {/* Pure drag region — clears the macOS traffic lights. */}
        <div data-tauri-drag-region className="spine-top w-full shrink-0" />

        {/* The workspace: the mark and the name. A tap goes home to the Schedule,
            the surface the day actually runs on. */}
        <button ref={wordmarkRef} onClick={() => setRung("day")} title="Schedule (⌘1)" className="sb-ws">
          <NuvoMark size={20} />
          {!railed && <span className="truncate">Nuvo</span>}
        </button>

        <nav className="flex w-full flex-col gap-px" aria-label="Floors">
          {EXECUTE.map(renderRung)}
          <div className="sb-group">{!railed && <span className="sb-grow">Build</span>}</div>
          {BUILD.map(renderRung)}
        </nav>

        <SidebarWeek railed={railed} />

        <div className="sb-foot">
          {/* First-run reward spine — derived 5-milestone tracker; retires itself
              for established users, always dismissible. */}
          <GettingStarted compact={railed} />
          {utility({ icon: <SettingsIcon size={16} />, label: "Settings", hint: "⌘,", onClick: openSettings })}
          {utility({
            icon: <span className="text-caption leading-none">?</span>,
            label: "Shortcuts",
            hint: "?",
            onClick: openShortcuts,
          })}
          {/* The width is a control, so it sits with the other chrome — never a
              hover-only affordance. Not offered while the rail is forced (the
              chat is open on a narrow window): an Expand that cannot expand is
              worse than none. */}
          {!forceRail &&
            utility({
              icon: <ChevronIcon dir={railed ? "right" : "left"} size={14} />,
              label: railed ? "Expand" : "Collapse",
              hint: "⌘\\",
              onClick: toggleRail,
            })}
        </div>
      </div>
    </div>
  );
});

// The week's committed projects, on every page (D-190): the answer to "what am
// I carrying" no longer lives only on the Schedule. A read of `useWeekCrown`
// (never re-derived here) in its own component, so only this list — not the
// sidebar — re-renders when the vertical changes.
const SidebarWeek = memo(function SidebarWeek({ railed }: { railed: boolean }) {
  const crown = useWeekCrown();
  const { openRecord } = useAppNavigation();
  const rows = crown?.rows ?? [];
  if (rows.length === 0) return null;
  const landed = rows.filter((r) => r.state === "landed" || r.state === "shipped").length;
  return (
    <div className="sb-week">
      <div className="sb-group">
        {!railed && (
          <>
            <span className="sb-grow">This week</span>
            <span className="sb-count">
              {landed}/{rows.length}
            </span>
          </>
        )}
      </div>
      {rows.map((r) => {
        const done = r.state === "landed" || r.state === "shipped";
        const count = r.work.total > 0 ? `${r.work.done}/${r.work.total}` : "";
        return (
          <button
            key={r.projectId}
            className="sb-item"
            data-landed={done || undefined}
            onClick={() => openRecord("project", r.projectId)}
            title={railed ? `${r.title}${count ? ` · ${count}` : ""}` : undefined}
            aria-label={r.title}
          >
            <span className="sb-icon">
              <Dot color={r.color} shape={done ? "round" : "square"} />
            </span>
            <span className="sb-label">{r.title}</span>
            <span className="sb-trail">{count}</span>
          </button>
        );
      })}
    </div>
  );
});
