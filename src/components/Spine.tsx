import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { LADDER, type Rung } from "./AppShell";
import { useUiScale } from "../hooks/useUiScale";
import { useVerticalSelector } from "../hooks/useVertical";
import { readSpine, type SpineState } from "../lib/readiness";
import { toneColor } from "./floors/ReadinessBanner";
import { useWeekCrown } from "../hooks/useWeekCrown";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { Dot, Kbd } from "./kit";
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
}: SpineProps & { spine: SpineState | null }) {
  // The macOS traffic lights are drawn by AppKit, outside the zoomed document,
  // so they can't left-align themselves to the wordmark — nothing native knows
  // where it is. Measure it here and hand Rust the answer in WINDOW POINTS
  // (css × --ui-scale). Re-runs when the spine rails, focus mode closes it, or
  // the zoom changes, i.e. every time the mark actually moves.
  const wordmarkRef = useRef<HTMLButtonElement>(null);
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

  // Tell the native titlebar where the wordmark's glyphs start, so the traffic
  // lights can share its left edge. `getBoundingClientRect()` is post-zoom, and
  // the buttons live in unzoomed window points — hence the × uiScale. Measured
  // after paint so the rail's width transition has settled.
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in globalThis)) return;
    const send = (cssLeft: number) => {
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("align_traffic_lights", { x: cssLeft * uiScale }))
        .catch(() => { /* non-macOS, or the command isn't there — keep the default */ });
    };

    // Measure ONLY in the mark's expanded home. Railed, it centres a single "N"
    // — following that shoves the cluster right, past the 64px rail and over
    // the task list. Focus mode removes the mark entirely. And even where it
    // could be followed, it shouldn't be: window buttons that wander when you
    // collapse a sidebar are something no Mac app does.
    if (!collapsed && !railed && wordmarkRef.current) {
      const el = wordmarkRef.current;
      const t = window.setTimeout(() => {
        // The glyphs, not the button — the button is full-width.
        const range = document.createRange();
        range.selectNodeContents(el);
        const left = range.getBoundingClientRect().left;
        range.detach();
        if (!left) return;
        wordmarkCssLeft.current = left;
        send(left);
      }, 360); // just past --d-slow, the rail's width transition
      return () => window.clearTimeout(t);
    }

    // Railed or in focus mode: hold the last known spot, re-scaled for the
    // current zoom, so the buttons stay exactly where they were.
    if (wordmarkCssLeft.current != null) send(wordmarkCssLeft.current);
  }, [railed, collapsed, uiScale]);

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
          <span className="sb-mark" aria-hidden />
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
