import { sameItems, useVerticalSelector } from "../../hooks/useVertical";
import { useSkin } from "../../hooks/useSkin";
import { weekReadiness } from "../../lib/readiness";
import { planningWeekStartISO } from "../../lib/dates";
import { weekName } from "../../lib/week";
import type { VerticalData } from "../../lib/vertical";

// ── The status bar — the terminal skin's bottom strip ───────────────────────
// An editor is recognisable in a thumbnail before you can read a word of it,
// and the status bar does more of that work than anything else on screen: a
// fixed 22px rule across the foot, segments left and right, everything in one
// muted mono voice.
//
// It is not decoration. Nuvo already computes exactly the four numbers a status
// bar wants — `weekReadiness` (planned · priorities · inbox · placed) is the
// week's execution checklist — and this is the most honest place they've ever
// been rendered: always visible, never demanding, readable at a glance without
// opening a panel. The left segment names *where you are* the way a branch name
// does; the right names *what's outstanding*, the way a problems count does.
//
// Terminal-only chrome. Every other material keeps its own footer (or none) —
// this renders null outside the console.
type Bar = readonly [weekStart: string, inbox: number, toPlace: number, planned: boolean, outstanding: number];

/** The facts the bar prints — all it needs from the vertical. */
function readBar(data: VerticalData, ready: boolean): Bar {
  const items = ready ? weekReadiness(data) : [];
  return [
    data?.sprint?.week_start ?? planningWeekStartISO(),
    items.find((i) => i.key === "inbox")?.count ?? 0,
    items.find((i) => i.key === "placed")?.count ?? 0,
    items.find((i) => i.key === "planned")?.done ?? false,
    items.filter((i) => !i.done).length,
  ];
}

export default function StatusBar() {
  const [skin] = useSkin();
  // Mounted on every material and null on all but one, so it selects nothing
  // there — and on the console, re-renders only when a number it prints moves.
  const bar = useVerticalSelector((s) => (skin === "terminal" ? readBar(s.data, s.ready) : null), sameItems);

  if (!bar) return null;

  const [weekStart, inbox, toPlace, planned, outstanding] = bar;

  return (
    <div className="term-status" role="status" aria-label="Week status">
      {/* Left — where you are. The branch segment is the loudest thing on the
          bar (accent on a tinted ground), exactly as an editor treats it. */}
      <span className="term-status-branch">
        <span aria-hidden>⎇</span>
        <span>week/{weekStart}</span>
      </span>
      <span className="term-status-seg">{weekName(weekStart).toLowerCase()}</span>
      <span className="term-status-seg">
        {planned ? "planned" : "unplanned"}
      </span>

      <span className="term-status-gap" />

      {/* Right — what's outstanding. Zero is stated, not hidden: a clean bar is
          the reward, and a bar that empties out is only legible if you've been
          watching the same slots carry numbers. */}
      <span
        className="term-status-seg"
        title={outstanding === 0 ? "The week is fully groomed" : `${outstanding} of 4 checklist items open`}
      >
        <span aria-hidden>{outstanding === 0 ? "✓" : "⚠"}</span>
        <span>{outstanding === 0 ? "clean" : `${outstanding} open`}</span>
      </span>
      <span className="term-status-seg" title="Captures still to sort">
        inbox {inbox}
      </span>
      <span className="term-status-seg" title="Committed this week with no day yet">
        to place {toPlace}
      </span>
      <span className="term-status-seg term-status-key" title="Quick add">
        ⌘K
      </span>
    </div>
  );
}
