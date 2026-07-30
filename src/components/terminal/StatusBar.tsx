import { useVertical } from "../../hooks/useVertical";
import { useSkin } from "../../hooks/useSkin";
import { weekReadiness } from "../../lib/readiness";
import { planningWeekStartISO } from "../../lib/dates";
import { weekName } from "../../lib/week";

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
export default function StatusBar() {
  const [skin] = useSkin();
  const { data, ready } = useVertical();

  if (skin !== "terminal") return null;

  const weekStart = data?.sprint?.week_start ?? planningWeekStartISO();
  const items = ready ? weekReadiness(data) : [];
  const inbox = items.find((i) => i.key === "inbox")?.count ?? 0;
  const toPlace = items.find((i) => i.key === "placed")?.count ?? 0;
  const planned = items.find((i) => i.key === "planned")?.done ?? false;
  const outstanding = items.filter((i) => !i.done).length;

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
      <span className="term-status-seg term-status-key" title="Command palette">
        ⌘K
      </span>
    </div>
  );
}
