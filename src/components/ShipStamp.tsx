// The mark a finished project/initiative wears — a wax-seal stamp: a tinted
// disc, a double SOLID ring (never dashed — index.css's own house rule: a
// dashed line "reads as noise, not as open time"), an arced "SHIPPED" band,
// and a check. Replaces ShipSeal (a flat tinted circle + <Icon name="check">)
// with something that reads as a mark being PRESSED, not a palette swap — and
// it now animates BOTH ways: stamping down when work ships, lifting away when
// it's reopened. That's the first bidirectional check/uncheck animation in
// the app — TaskRow's `completing` bloom (the only prior "check" animation)
// only ever animates the done direction; reopening a task is instant.
//
// Always mounted while rendered; decides its own steady/transient look purely
// from `shipped` via a ref of the previous value. Callers don't drive
// animation state, they just flip the boolean — but they still decide
// whether it's in the DOM at all, same as ShipSeal before it:
//   · passive display (DeckCard, ShippedWall, mobile RecordHead): keep
//     guarding with `{shipped && <ShipStamp shipped size={..} />}` — nothing
//     renders while unshipped, so the ghost resting look below never shows
//     there, and no animation plays (unchanged from ShipSeal's behavior).
//   · the two live toggles (RecordModal's project/initiative checkboxes):
//     mount unconditionally (no guard) so the hollow "not shipped yet" ghost
//     ring shows at rest, and both the stamp-down and lift-off animations
//     play in place, since the button itself never unmounts.
//
// All ink is `PROJECT_STATUS_COLORS.complete` (== var(--ok)) via
// `currentColor` — every skin's own color rules (including e-ink's grayscale
// --ok AND its page-wide duotone overlay) repaint it for free. Only
// opacity/geometry are bespoke here; only MOTION references skin tokens
// directly (index.css), so Terminal stamps fast+mechanical, Blueprint draws
// linear, and e-ink collapses to its "no smooth motion" identity for free.
import { useEffect, useId, useRef, useState } from "react";
import { PROJECT_STATUS_COLORS } from "./floors/statusColors";

const INK = PROJECT_STATUS_COLORS.complete; // var(--ok)

// Ceiling above the slowest skin's --d-moment (paper: 540ms) — long enough
// that the CSS animation (whatever the active skin's real duration is, down
// to e-ink's 1ms) has always finished painting before this fires and swaps
// to the steady on/off class. The same hand-synced convention TaskRow's
// COMPLETE_MS / --d-task-complete pairing already uses. Harmless if a skin's
// real animation finishes earlier, since the keyframes' final frame already
// equals the steady on/off look (animation-fill-mode: both).
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
  const rawId = useId().replace(/:/g, "");
  const arcId = `ship-arc-${rawId}`;
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

  // Below ~24px the arced lettering is sub-pixel (DeckCard's compact
  // 18/22px badges) — it reads as noise, not as fine engraved texture, so
  // it's dropped rather than rendered illegibly. Rings + check still carry
  // the mark at that size. Above it (the record checkboxes, the Shipped
  // wall, an initiative's heavier mark), it shows — an emergent echo of
  // "scope reads as mass" rather than a special case per altitude.
  const showText = size >= 24;

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
      {showText && (
        <defs>
          {/* Upper-arc ONLY (left point, over the top, to the right point) —
              never a full-circle path starting at the leftmost point, which
              sweeps the bottom half too and renders that half of the text
              upside down. Sits in the band BETWEEN the two rings, not
              through the center where it would collide with the check. */}
          <path id={arcId} d="M 12 50 A 38 38 0 0 1 88 50" fill="none" />
        </defs>
      )}
      <circle className="ship-tint" cx="50" cy="50" r="36" fill="currentColor" />
      <circle className="ship-ring-outer" cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <circle className="ship-ring-inner" cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="3.5" />
      {showText && (
        <text className="ship-text" fill="currentColor" fontFamily="var(--font-sans)" fontWeight={750} fontSize="9" letterSpacing="0.12em">
          <textPath href={`#${arcId}`} startOffset="50%" textAnchor="middle">
            SHIPPED
          </textPath>
        </text>
      )}
      <path
        className="ship-check"
        d="M34 53 L45.5 63.5 L68 38"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
