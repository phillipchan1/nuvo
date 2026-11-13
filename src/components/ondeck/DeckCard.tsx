// The deck card — the one card both planner decks wear, on both shells. A
// project on a week column and an initiative on a quarter column are the same
// act at two clock speeds, so they are the same object: a kit Card
// (styles/decks.css) with
//
//   [readiness]  The name — the hero, 13/600, two lines at most
//                [mark] area · weight                     status word
//
//   1. THE NAME IS THE HERO. It's the only thing you actually read while
//      scanning a wall of them, so it gets the ink and the width.
//   2. THE READINESS PIE LEADS IT (kit Readiness: raw · 1 · 2 · ready). It is
//      the deck's question — "is this shaped enough to be placed?" — drawn as a
//      glyph rather than a meter, so it never reads as progress (D-023, P6).
//   3. ONE META LINE carries the rest: which world it's in (by name — colour
//      alone fails anyone who hasn't memorised the palette, P16), how heavy it
//      is, and — only when there's something to say — the one thing that's
//      wrong. Quiet by default (P9).
//
// ── The altitude tell: ONE property ─────────────────────────────────────────
// A project and a bet are the same object, so they differ only in weight, by as
// little as will register (D-048):
//
//   · PROJECT ("marked") — its domain hue is a MARK on the card: the Dot that
//     leads the area name.
//   · INITIATIVE ("bounded") — the same hue becomes the card's EDGE: a 2px inset
//     down its left side. The mark becomes the boundary; scope reads as mass.
//
// Everything else — surface, ring, corner, type ramp, meta line — is identical.

import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { pressable } from "../../lib/a11y";
import { Card, Dot, Readiness, type ReadinessStep } from "../kit";

/** The voice a status word speaks in. `danger` = something is wrong (a passed
 *  date, a bet at risk), `caution` = needs shaping, `ready` = affirmation,
 *  `muted` = settled / parked, `landed` = shipped — the intent made true, in the
 *  intent's own colour (D-187), so "shipped" never shares a voice with "ready".
 *  `signal` is the old name for `danger`: Instrument spends --signal on NOW
 *  only (D-189), so it draws as danger. */
export type DeckTone = "danger" | "signal" | "caution" | "ready" | "landed" | "muted";

export const TONE_COLOR: Record<DeckTone, string> = {
  danger: "var(--danger)",
  signal: "var(--danger)",
  caution: "var(--warn)",
  ready: "var(--ok)",
  landed: "var(--landed, var(--accent))",
  muted: "var(--muted)",
};

/** How heavy the card's domain identity is — see the altitude note above. */
export type DeckVariant = "marked" | "bounded";

/** Readiness axes met → the kit pie's step. Three axes map 1:1; two axes (a
 *  bet) land on the nearer third, and the tooltip says the real count. */
function readiness(pips: boolean[] | undefined, shipped: boolean | undefined): { step: ReadinessStep; title: string } | null {
  if (shipped) return { step: "shipped", title: "Shipped" };
  if (!pips || pips.length === 0) return null;
  const met = pips.filter(Boolean).length;
  if (met === pips.length) return { step: 3, title: "Ready" };
  if (met === 0) return { step: 0, title: "Raw" };
  const step = Math.min(2, Math.max(1, Math.round((met / pips.length) * 3))) as 1 | 2;
  return { step, title: `Grooming · ${met} of ${pips.length}` };
}

export default function DeckCard({
  variant = "marked",
  size = "deck",
  spine,
  eyebrow,
  title,
  weight,
  status,
  pips,
  pipTone: _pipTone,
  dim,
  shipped,
  mark = true,
  selected,
  lifted,
  beyond,
  footer,
  className = "",
  style,
  dragAttr,
  onContextMenu,
  onPointerDown,
  onClick,
  children,
}: {
  variant?: DeckVariant;
  /** `phone` = the same card, sized for a thumb. One card serves both shells —
   *  the grammar must not fork per device. */
  size?: "deck" | "phone";
  /** domain colour — identity, never status (colour is semantic). */
  spine: string;
  /** the area this belongs to, named. */
  eyebrow: string;
  title: string;
  /** remaining effort / size, already formatted. null = we don't know, so we don't say. */
  weight?: string | null;
  /** the single most important thing wrong (or settled). null = the card is quiet. */
  status?: { label: string; tone: DeckTone } | null;
  /** readiness axes, met/unmet — three for a project, two for a bet. Drawn as
   *  the kit's readiness pie leading the name. */
  pips?: boolean[];
  /** @deprecated the pie's colour is the step's own (raw · grooming · ready);
   *  kept so callers on both shells needn't change. */
  pipTone?: DeckTone;
  /** parked / settled — the card recedes without disappearing. */
  dim?: boolean;
  /** finished — the landed seal leads the name, the name ends on a full stop
   *  ("Ship onboarding." — the way every hero ends, D-191), and "shipped" is
   *  said in the landed voice. */
  shipped?: boolean;
  /** draw the domain Dot before the area (a marked card). Off where the surface
   *  already names the domain — a lane By domain (D-122: don't write what's drawn). */
  mark?: boolean;
  /** selected — an accent ring and a lift. */
  selected?: boolean;
  /** held — a placed bar following the pointer: lifted onto --sh-pop. */
  lifted?: boolean;
  /** a bar that runs past the deck's horizon — its right end cut square. */
  beyond?: boolean;
  /** card-specific extras (the initiative's auto-link chip). */
  footer?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** the deck's pointer-drag hook — `data-project-drag` / `data-init-drag`. */
  dragAttr?: Record<string, string>;
  onContextMenu?: (e: React.MouseEvent) => void;
  onPointerDown?: (e: ReactPointerEvent) => void;
  /** Fires for a click *and* for Enter/Space, so the event is either kind. */
  onClick?: (e: React.MouseEvent | React.KeyboardEvent) => void;
  /** absolutely-positioned siblings (the project deck's resize handles). */
  children?: ReactNode;
}) {
  const bounded = variant === "bounded";
  const pie = readiness(pips, shipped);
  const showMark = mark && !bounded;
  const hasMeta = !!eyebrow || !!weight || !!status;
  return (
    <Card
      {...dragAttr}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      onClick={onClick}
      // The card is a div because it hosts the deck's press-and-hold placement
      // gesture and absolutely-positioned resize handles. Enter/Space still has
      // to open it — only when there is something to open.
      {...(onClick ? pressable(onClick, { label: title }) : {})}
      interactive={!!onClick || !!dragAttr}
      selected={selected}
      className={`group/card deck-card ${className}`}
      data-variant={variant}
      data-size={size === "deck" ? undefined : size}
      data-dim={dim && !shipped ? "" : undefined}
      data-shipped={shipped ? "" : undefined}
      data-lifted={lifted ? "" : undefined}
      data-beyond={beyond ? "" : undefined}
      data-bare={pie ? undefined : ""}
      style={{ ["--h" as string]: spine, ...style }}
    >
      <div className="deck-card-head">
        {pie && <Readiness step={pie.step} title={pie.title} />}
        <div className="deck-card-title">
          {title}
          {shipped && !/[.!?…]$/.test(title.trim()) && <span className="deck-card-stop" aria-hidden="true">.</span>}
        </div>
      </div>

      {hasMeta && (
        <div className="deck-card-meta">
          <span className="deck-card-area">
            {showMark && eyebrow && <Dot color={spine} />}
            <span>
              {eyebrow}
              {weight ? <span className="deck-card-weight">{eyebrow ? " · " : ""}{weight}</span> : null}
            </span>
          </span>
          {status && (
            <span className="deck-card-status" style={{ color: TONE_COLOR[status.tone] }} title={status.label}>
              {status.label}
            </span>
          )}
        </div>
      )}

      {footer && (
        <div className="deck-card-foot">
          {footer}
        </div>
      )}
      {children}
    </Card>
  );
}
