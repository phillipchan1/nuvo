// The deck card — the one card both planner decks wear. A project on a sprint
// column and an initiative on a quarter column are the same act at two clock
// speeds, so they are the same object: identity · NAME · one meta line.
//
// The hierarchy is deliberate, and it's the fix for what the old card got wrong:
//
//   1. THE NAME IS THE HERO. It's the only thing you actually read while scanning
//      a wall of them, so it gets the ink (text-body) and the full width — no
//      control, no dot, nothing to its left.
//   2. ONE META LINE carries everything else: which world it's in, how heavy it
//      is, and — only when there's something to say — what's wrong.
//   3. READINESS IS SUBORDINATE (D-023: *the timeline decides, the deck does*).
//      It rides as 4px pips at the right margin, not as full-width bars. The old
//      bars were the loudest thing on the card and read like *progress* when
//      they're actually a grooming checklist — a claim the data doesn't support
//      (Principle 6), on a surface whose question is "when does this land and what
//      collides" (Principle 8).
//
// Quiet by default (Principle 9): a healthy card says only its name, its area and
// its weight. Colour appears when — and only when — something is off.
//
// ── The altitude tell: ONE property, three steps ─────────────────────────────
// A project and a bet are the *same object* — a thing you pick up and drop on a
// column of time. Functionally they differ only in scope, so they must differ
// only in **weight**, and by as little as will register.
//
// Two earlier answers were both wrong in the same direction — they made altitude
// a *difference in kind*:
//   · a **serif** name — altitude as a font choice, an arbitrary signal a reader
//     can't decode;
//   · an **enclosed** card (tinted border + wash) — a different silhouette, so a
//     bet read as a different species rather than a bigger sibling.
//
// The tell is now the **spine**, and nothing else. The card is identical in every
// other respect — same glass, same hairline, same type ramp, same meta line:
//
//   · PROJECT — a 3px rounded spine, inset from the card's ends. A *mark on* the
//     card, exactly the bar it occupies on the grid.
//   · INITIATIVE — the same colour at 5px, square, running the card's **full
//     height** as its actual left edge. The mark becomes the boundary: it's the
//     thing projects sit inside, and it simply carries more weight.
//
// Scope reads as mass. That's all it should ever take.

import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { READY } from "../floors/ReadinessBanner";
import { PROJECT_STATUS_COLORS, ShipSeal } from "../floors/parts";

const CAUTION = PROJECT_STATUS_COLORS.waiting;

/** The voice a status word speaks in. `signal` = now/urgent (overdue, behind),
 *  `caution` = needs shaping, `ready` = affirmation, `muted` = settled/parked. */
export type DeckTone = "signal" | "caution" | "ready" | "muted";

export const TONE_COLOR: Record<DeckTone, string> = {
  signal: "var(--signal)",
  caution: CAUTION,
  ready: READY,
  muted: "var(--muted)",
};

/** How heavy the card's domain spine is — see the altitude note above. */
export type DeckVariant = "marked" | "bounded";

/** Remaining effort, for the eye — the card's *weight*. The week header counts
 *  cards; hours are the currency the pinch math actually runs on, so a column of
 *  weights explains an overloaded sprint in a way "5/2" can't. Never rounded up
 *  from nothing: a project with no sized steps returns null and says nothing. */
export function deckWeight(mins: number): string | null {
  if (!mins || mins <= 0) return null;
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = mins / 60;
  return `${h < 10 ? Math.round(h * 10) / 10 : Math.round(h)}h`;
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
  pipTone,
  dim,
  shipped,
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
  /** `phone` = the same card, sized for a thumb (bigger radius + padding). One
   *  card serves both shells — the grammar must not fork per device. */
  size?: "deck" | "phone";
  /** domain colour — identity, never status (design-language: colour is semantic). */
  spine: string;
  /** the area this belongs to, named. Colour alone fails for anyone who hasn't
   *  memorised the palette — which is every account but the builder's (P16). */
  eyebrow: string;
  title: string;
  /** remaining effort / size, already formatted. null = we don't know, so we don't say. */
  weight?: string | null;
  /** the single most important thing wrong (or settled). null = the card is quiet. */
  status?: { label: string; tone: DeckTone } | null;
  /** readiness axes, met/unmet — three for a project, two for a bet. */
  pips?: boolean[];
  pipTone?: DeckTone;
  /** parked / settled — the card recedes without disappearing. Never true together
   *  with `shipped`: a finished card reads as an affirmation, not a fade. */
  dim?: boolean;
  /** finished — full ink, no fade, a quiet check beside the status word. The
   *  Shipped wall's own restrained look, brought inline (Principle 9: no badge
   *  register, just "this happened"). */
  shipped?: boolean;
  /** card-specific extras (the initiative's auto-link chip). */
  footer?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** the deck's pointer-drag hook — `data-project-drag` / `data-init-drag`. */
  dragAttr?: Record<string, string>;
  onContextMenu?: (e: React.MouseEvent) => void;
  onPointerDown?: (e: ReactPointerEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
  /** absolutely-positioned siblings (the project deck's resize handles). */
  children?: ReactNode;
}) {
  const pipColor = TONE_COLOR[pipTone ?? "ready"];
  const bounded = variant === "bounded";
  const phone = size === "phone";
  const radius = phone ? "0.75rem" : "0.5rem";
  return (
    <div
      {...dragAttr}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      onClick={onClick}
      className={`group/card ${shipped ? "glass-tint" : "glass-card"} lift-anim fast relative flex select-none flex-col border pl-4 pr-3 hover:border-line-strong ${
        shipped ? "" : "border-line"
      } ${phone ? "rounded-xl py-3" : "rounded-lg py-2.5"} ${className}`}
      style={{
        opacity: dim ? 0.55 : undefined,
        ...(shipped
          ? ({
              "--tint": PROJECT_STATUS_COLORS.complete,
              borderColor: `color-mix(in srgb, ${PROJECT_STATUS_COLORS.complete} 35%, var(--line))`,
            } as CSSProperties)
          : {}),
        ...style,
      }}
    >
      {/* The one thing that differs between the altitudes. A project wears a 3px
          rounded spine inset from the card's ends — a mark *on* the card, the bar
          it occupies on the grid. A bet wears the same colour at 5px, square and
          full-height, so the mark becomes the card's left boundary: heavier, and
          the thing projects sit inside. Everything else is identical. */}
      <span
        className="pointer-events-none absolute"
        style={
          bounded
            ? { insetBlock: 0, left: 0, width: 5, background: spine, borderRadius: `${radius} 0 0 ${radius}` }
            : { top: phone ? 12 : 10, bottom: phone ? 12 : 10, left: 6, width: 3, background: spine, borderRadius: 999 }
        }
        aria-hidden
      />

      {/* the hero — full width, nothing to its left */}
      <div
        className={`relative min-w-0 break-words text-body font-semibold leading-snug ${
          dim ? "text-muted" : "text-ink"
        }`}
        style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
      >
        {title}
      </div>

      {/* the one meta line: where · how heavy — then, right-aligned, what's wrong
          and how groomed. Right-alignment gives the wall a consistent column to
          scan down; the pips are the quietest thing on the card on purpose. */}
      <div className="relative mt-1.5 flex items-center gap-2">
        {/* Both halves truncate, but the area name is floored: it's the card's
            identity for anyone who hasn't memorised the palette, so a long status
            must never be allowed to eat it down to "Tr…". */}
        <span className="mono min-w-0 flex-1 truncate text-micro text-muted" style={{ minWidth: "4.25rem" }}>
          {eyebrow}
          {weight ? <span className="tabular-nums"> · {weight}</span> : null}
        </span>
        {status && (
          <span
            className={`mono flex min-w-0 shrink items-center gap-1 truncate ${
              shipped ? `font-semibold ${bounded ? "text-caption" : "text-micro"}` : "text-micro"
            }`}
            style={{ color: TONE_COLOR[status.tone] }}
            title={status.label}
          >
            {shipped && <ShipSeal size={bounded ? 22 : 18} />}
            {status.label}
          </span>
        )}
        {pips && pips.length > 0 && (
          <span className="flex shrink-0 items-center gap-[3px]" aria-hidden>
            {pips.map((met, i) => (
              <span
                key={i}
                className="h-[4px] w-[4px] rounded-full"
                style={{ background: met ? pipColor : "var(--line-strong)", opacity: met ? 1 : 0.45 }}
              />
            ))}
          </span>
        )}
      </div>

      {footer}
      {children}
    </div>
  );
}
