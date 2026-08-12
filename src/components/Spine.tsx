import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { LADDER, type Rung } from "./AppShell";
import { useUiScale } from "../hooks/useUiScale";
import { useVertical } from "../hooks/useVertical";
import { readSpine, type SpineState } from "../lib/readiness";
import { READY, toneColor } from "./floors/ReadinessBanner";
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
export type FlowName = "sunday" | "summit" | "tending" | "capacity";

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
const FULL_W = 188;
const RAIL_W = 64;

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

// The one whisper of glass in the app's chrome: the active chapter rises on a
// frosted pane over the atmosphere — present, never stark.
const activePill: CSSProperties = {
  background: "color-mix(in srgb, var(--surface) 72%, transparent)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  boxShadow: "var(--shadow-1)",
  borderColor: "color-mix(in srgb, var(--line) 85%, transparent)",
};

// The rung glyphs are the shared altitude family (`components/icons.tsx`) — the
// same set the phone's bottom bar and the command palette draw from, so the
// chrome and the surfaces never disagree about what a project looks like.

// `READY` (the meter's ripe-green fill) and `toneColor` (cue tone → token) are
// shared with the floor-level ReadinessBanner, so the gauge reads the same in
// the chrome and inside the views.

// Railed, a hovered rung names itself beside the rail: label, its ⌘-number, and
// the one cue the meter is about. Glass on the paper, never a native tooltip —
// it's the label the rail spent, handed back on demand.
type Tip = { top: number; label: string; hint?: string; cue?: string; cueTone?: string } | null;

interface SpineProps {
  rung: Rung;
  setRung: (r: Rung) => void;
  openSettings: () => void;
  openShortcuts: () => void;
  /** Focus mode: slide the whole spine closed (the calendar takes the room). */
  collapsed?: boolean;
}

// The thin half: subscribes to the vertical, derives the spine reading, and
// hands the body a signature-stable value. The Spine is mounted on every
// desktop surface and was the top self-time component on 18 of 24 measured
// interactions — because every vertical rebuild re-rendered its whole DOM even
// when the reading it displays hadn't changed. SpineState is small pure data,
// so a JSON signature is an honest identity for it.
export default function Spine(props: SpineProps) {
  // Reads from the same cached vertical snapshot the floors use — no extra
  // fetch. Until it's loaded the rail stays a plain table of contents (no
  // half-empty meters flashing during the first paint).
  const { data, ready } = useVertical();
  // Memoized on data identity: the Spine re-renders on every rung change
  // (ancestor render), and re-walking the whole vertical for a nav that
  // changed no data was most of its measured self time.
  const fresh = useMemo<SpineState | null>(() => (ready ? readSpine(data) : null), [data, ready]);
  const held = useRef<{ sig: string; value: SpineState | null }>({ sig: "", value: null });
  const sig = useMemo(() => (fresh ? JSON.stringify(fresh) : ""), [fresh]);
  if (sig !== held.current.sig) held.current = { sig, value: fresh };
  return <SpineBody spine={held.current.value} {...props} />;
}

const SpineBody = memo(function SpineBody({
  spine,
  rung,
  setRung,
  openSettings,
  openShortcuts,
  collapsed = false,
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
  const [railed, setRailed] = useState(readRail);
  const [tip, setTip] = useState<Tip>(null);

  const toggleRail = () =>
    setRailed((v) => {
      writeRail(!v);
      setTip(null);
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

  // Hovering a railed control raises its flyout; the expanded spine already
  // speaks in words, so it stays quiet.
  const tipHandlers = (t: Omit<NonNullable<Tip>, "top">) =>
    railed
      ? {
          onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
            const r = e.currentTarget.getBoundingClientRect();
            setTip({ ...t, top: r.top + r.height / 2 });
          },
          onMouseLeave: () => setTip(null),
          onFocus: (e: React.FocusEvent<HTMLElement>) => {
            const r = e.currentTarget.getBoundingClientRect();
            setTip({ ...t, top: r.top + r.height / 2 });
          },
          onBlur: () => setTip(null),
        }
      : {};

  const renderRung = (r: { id: Rung; label: string }) => {
    const on = r.id === rung;
    const n = LADDER.indexOf(r.id) + 1;
    const fs = spine?.floors[r.id] ?? null;
    const cue = fs?.cue ?? null;
    const statusColor = fs?.calm
      ? `color-mix(in srgb, ${READY} 66%, var(--muted))`
      : cue
        ? toneColor(cue.tone)
        : null;

    // ── Railed: the glyph IS the row. Readiness survives the narrowing — a
    // status dot on the shoulder, the meter as a hairline underscore — so the
    // funnel is still legible at 64px.
    if (railed) {
      return (
        <div key={r.id} className="flex justify-center py-0.5" data-teach={`rung-${r.id}`}>
          <button
            onClick={() => setRung(r.id)}
            aria-label={`${r.label} (⌘${n})`}
            aria-current={on}
            className="fast relative flex h-12 w-12 items-center justify-center rounded-xl border border-transparent"
            style={on ? activePill : undefined}
            {...tipHandlers({ label: r.label, hint: `⌘${n}`, cue: cue?.label, cueTone: cue ? toneColor(cue.tone) : undefined })}
          >
            <span
              className="spine-rung-n flex items-center justify-center leading-none"
              data-on={on}
              style={{ color: on ? "var(--accent)" : "var(--muted)" }}
            >
              <AltitudeIcon kind={r.id} />
            </span>
            {statusColor && (
              <span
                aria-hidden
                className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full"
                style={{ background: statusColor }}
              />
            )}
            {fs && !fs.calm && (
              <span
                aria-hidden
                className="absolute bottom-1.5 left-1/2 h-[2px] w-5 -translate-x-1/2 overflow-hidden rounded-full"
                style={{ background: "var(--line)" }}
              >
                <span
                  className="fast absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${Math.round(fs.readiness * 100)}%`, background: READY }}
                />
              </span>
            )}
          </button>
        </div>
      );
    }

    return (
      <div key={r.id} data-teach={`rung-${r.id}`}>
        <button
          onClick={() => setRung(r.id)}
          title={`${r.label} (⌘${n})`}
          aria-current={on}
          className="fast relative flex w-full flex-col gap-1.5 rounded-lg border border-transparent px-2.5 py-2 text-left"
          style={on ? activePill : undefined}
        >
          {/* line 1 — navigation: the altitude glyph, the name, then a status at
              the right. A floor at rest wears a check where an active floor wears
              its cue dot, so the indicator lives in one place and the row
              collapses to a single quiet line. */}
          <span className="flex items-center gap-2.5">
            <span
              // `spine-rung-n` is the terminal skin's hook: the console hides the
              // glyph and swaps in a ▸/▾ disclosure caret so the spine reads as a
              // file tree. Inert on every other material.
              className="spine-rung-n flex w-[19px] shrink-0 items-center justify-center leading-none"
              data-on={on}
              style={{ color: on ? "var(--accent)" : "var(--muted)" }}
            >
              <AltitudeIcon kind={r.id} />
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
            <span className="flex items-center gap-2" style={{ paddingLeft: 29 }}>
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
                  style={{ color: toneColor(cue.tone), maxWidth: 88 }}
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

  // The footer utilities share one shape across both widths: glyph, then a name
  // that the rail simply doesn't spend.
  const utility = (opts: { icon: ReactNode; label: string; hint: string; onClick: () => void }) => (
    <div className={railed ? "flex justify-center py-0.5" : undefined}>
      <button
        onClick={opts.onClick}
        title={railed ? undefined : `${opts.label} (${opts.hint})`}
        aria-label={`${opts.label} (${opts.hint})`}
        className={`fast flex items-center rounded-lg border border-transparent text-muted hover:text-ink ${
          railed ? "h-11 w-11 justify-center" : "w-full gap-2.5 px-2.5 py-2 text-left"
        }`}
        {...tipHandlers({ label: opts.label, hint: opts.hint })}
      >
        <span className="flex w-[19px] shrink-0 items-center justify-center leading-none">{opts.icon}</span>
        {!railed && <span className="text-caption leading-none">{opts.label}</span>}
      </button>
    </div>
  );

  return (
    <div
      className="spine relative z-40 shrink-0 overflow-hidden"
      data-rail={railed || undefined}
      style={{
        width: collapsed ? 0 : width,
        transition: "width var(--d-slow) var(--ease-out)",
        background: "transparent",
      }}
    >
      {/* Inner holds its natural width so the content never reflows while the
          outer clips it shut. */}
      <div
        className="relative flex h-full flex-col"
        style={{
          width,
          opacity: collapsed ? 0 : 1,
          transition: "opacity var(--d-base) var(--ease-out), width var(--d-slow) var(--ease-out)",
        }}
      >
      {/* Right separator — runs the full height when the spine is wide enough to
          clear the macOS traffic lights; railed, it starts below them. */}
      <div className="spine-separator pointer-events-none absolute bottom-0 right-0 w-px bg-line" />

      {/* Pure drag region — clears the macOS traffic lights. */}
      <div data-tauri-drag-region className="spine-top shrink-0 w-full" />

      {/* Wordmark home — brand + a tap back to the Schedule, the surface the
          day actually runs on. Railed, the mark keeps its place as the initial. */}
      <button
        ref={wordmarkRef}
        onClick={() => setRung("day")}
        title="Home"
        className={`fast wordmark select-none py-3 text-[15px] leading-none ${railed ? "text-center" : "px-4 text-left"} ${rung === "day" ? "wordmark-grad" : ""}`}
        style={rung === "day" ? {} : { color: "var(--muted)", opacity: 0.5 }}
      >
        {railed ? "N" : "Nuvo"}
      </button>

      <nav className={`flex flex-1 flex-col pt-3 ${railed ? "px-1.5" : "px-2"}`}>
        {railed ? (
          <div className="mx-auto mb-1.5 h-px w-5 bg-line" />
        ) : (
          <div className="section-label px-2.5 pb-1.5">Execute</div>
        )}
        {EXECUTE.map(renderRung)}

        {railed ? (
          <div className="mx-auto my-2.5 h-px w-5 bg-line" />
        ) : (
          <>
            <div className="mx-2.5 my-3 border-t border-line" />
            <div className="section-label px-2.5 pb-1.5">Build</div>
          </>
        )}
        {BUILD.map(renderRung)}

        {/* The reward state, gently: every floor settled — moving or at rest. */}
        {spine?.allAtRest &&
          (railed ? (
            <div className="rise mt-3 flex justify-center" title="All at rest">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: READY }} />
            </div>
          ) : (
            <div className="rise mt-3 flex items-center gap-1.5 px-2.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: READY }} />
              <span className="section-label" style={{ color: READY }}>all at rest</span>
            </div>
          ))}
      </nav>

      <div className={`mt-auto pb-3 ${railed ? "px-1.5" : "px-2"}`}>
        {/* First-run reward spine — derived 5-milestone tracker. Present on every
            elevation (the Spine is the one persistent chrome), retires itself for
            established users, and is always dismissible. */}
        <GettingStarted compact={railed} />
        {utility({ icon: <SettingsIcon />, label: "Settings", hint: "⌘,", onClick: openSettings })}
        {utility({
          icon: <span className="text-caption leading-none">⌘</span>,
          label: "Shortcuts",
          hint: "?",
          onClick: openShortcuts,
        })}

        {/* The width itself is a control, so it sits with the other chrome —
            always visible, never a hover-only affordance. */}
        {utility({
          icon: <ChevronIcon dir={railed ? "right" : "left"} />,
          label: railed ? "Expand" : "Collapse",
          hint: "⌘\\",
          onClick: toggleRail,
        })}
      </div>
      </div>

      {/* Railed flyout — portalled so the spine can stay clipped for its width
          animation without shearing the label off. */}
      {railed && tip && !collapsed &&
        createPortal(
          <div
            className="glass elev-3 pointer-events-none fixed z-[60] flex items-center gap-2 rounded-lg border border-line py-1.5 pl-2.5 pr-3"
            style={{ left: RAIL_W + 8, top: tip.top, transform: "translateY(-50%)" }}
            role="tooltip"
          >
            <span className="text-caption leading-none text-ink">{tip.label}</span>
            {tip.cue && (
              <span className="mono text-micro leading-none" style={{ color: tip.cueTone }}>
                {tip.cue}
              </span>
            )}
            {tip.hint && (
              <span className="mono text-micro leading-none text-muted opacity-70">{tip.hint}</span>
            )}
          </div>,
          document.body
        )}
    </div>
  );
});
