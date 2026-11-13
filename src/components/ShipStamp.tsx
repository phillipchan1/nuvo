// The mark a finished project/initiative wears — Instrument's "shipped"
// (D-190): a solid --ok disc with the check knocked out of it, the kit's
// readiness pie at its last step, drawn at stamp size. The wax seal it
// replaces (double rings, an arced "SHIPPED", a pressed rotation) was the
// old ornamental register. It still animates BOTH ways: it LANDS when work
// ships (the kit's land-stamp spring, D-187) and lets go when it's reopened.
//
// Always mounted while rendered; decides its own steady/transient look purely
// from `shipped` via a ref of the previous value. Callers don't drive
// animation state, they just flip the boolean — but they still decide
// whether it's in the DOM at all:
//   · passive display (DeckCard, ShippedWall, mobile RecordHead): keep
//     guarding with `{shipped && <ShipStamp shipped size={..} />}` — nothing
//     renders while unshipped, and no animation plays.
//   · the two live toggles (RecordModal's project/initiative checkboxes):
//     mount unconditionally (no guard) so the hollow "not shipped yet" ring
//     shows at rest, and both the land and the let-go play in place, since
//     the button itself never unmounts.
//
// All ink is `PROJECT_STATUS_COLORS.complete` (== var(--ok)) via
// `currentColor`; the check is knocked out in the panel's colour, so it reads
// on either theme. The motion lives in index.css (`.ship-stamp--*`).
import { useEffect, useRef, useState } from "react";
import { PROJECT_STATUS_COLORS } from "./floors/statusColors";

const INK = PROJECT_STATUS_COLORS.complete; // var(--ok)

// A ceiling above the land (--d-land, ~350ms) — long enough that the CSS
// animation has always finished painting before this fires and swaps to the
// steady on/off class. The same hand-synced convention TaskRow's COMPLETE_MS /
// --d-task-complete pairing uses; harmless if the animation finishes earlier,
// since its final frame already equals the steady look (fill-mode: both).
const SETTLE_MS = 620;

type Phase = "on" | "off" | "stamping" | "lifting";

export function ShipStamp({
  shipped,
  size = 22,
  className,
}: {
  shipped: boolean;
  /** Rendered px, both axes — the stamp is always circular. */
  size?: number;
  className?: string;
}) {
  const prevShipped = useRef(shipped);
  const [phase, setPhase] = useState<Phase>(shipped ? "on" : "off");
  const settleTimer = useRef<number | null>(null);

  useEffect(() => {
    if (prevShipped.current === shipped) return;
    prevShipped.current = shipped;
    setPhase(shipped ? "stamping" : "lifting");
    if (settleTimer.current) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;
      setPhase(shipped ? "on" : "off");
    }, SETTLE_MS);
  }, [shipped]);

  useEffect(() => () => {
    if (settleTimer.current) window.clearTimeout(settleTimer.current);
  }, []);

  // Instrument's mark (D-190): a solid --ok disc with the check knocked out of
  // it — the kit's "shipped" readiness, at stamp size. Not shipped is the same
  // ring, hollow and quiet, so a live toggle has something to press.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      focusable="false"
      aria-hidden
      style={{ color: INK }}
      className={`ship-stamp ship-stamp--${phase} ${className ?? ""}`}
    >
      <circle className="ship-ring" cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeWidth="8" />
      <circle className="ship-tint" cx="50" cy="50" r="48" fill="currentColor" />
      <path
        className="ship-check"
        d="M31 52 L44 64.5 L69 37"
        fill="none"
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
