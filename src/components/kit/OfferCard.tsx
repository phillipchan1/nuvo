import { forwardRef } from "react";
import { Icon } from "../Icon";
import { Button, Dest, IconButton } from "./Button";
import { cx } from "./cx";

// OfferCard — one thing Nuvo can do for you, as a card (D-206, Get ready).
//
// The thing (title), ONE evidence line in muted (P6), and ONE act written as
// where the thing goes (D-204's Dest: the verb holds, the name gives). "Not
// now" is an icon on a pointer and a visible text act under a finger. A
// repair's second act ("Leave it where it is") is a state, so it is text too.
// The card writes nothing itself — the host's act does, on the press (P3).
//
// Motion is the host's to ask for, and only on the user's act (D-187): it
// `leaving` (Let go) after its act ran, `arriving` when it slid in to replace
// one. Transform and opacity only (styles/kit.css).

export interface OfferCardProps {
  title: string;
  why: string;
  /** the act's verb — never truncates */
  verb: string;
  /** the act's destination — truncates */
  name?: string;
  /** the keycap riding the act (desktop) */
  shortcut?: string;
  onPress: (el: HTMLButtonElement) => void;
  /** "Not now" */
  onNotNow?: () => void;
  /** a second act that is a state, said in words ("Leave it where it is") */
  secondary?: { label: string; onPress: () => void };
  focused?: boolean;
  leaving?: boolean;
  arriving?: boolean;
  /** under a finger: 44px acts, Not now said as text in the footer */
  touch?: boolean;
  onFocusCard?: () => void;
}

export const OfferCard = forwardRef<HTMLDivElement, OfferCardProps>(function OfferCard(
  { title, why, verb, name, shortcut, onPress, onNotNow, secondary, focused, leaving, arriving, touch, onFocusCard },
  ref,
) {
  const tap = touch ? "tap" : undefined;
  return (
    <div
      ref={ref}
      className="k-offer-card"
      role="group"
      aria-label={title}
      aria-current={focused || undefined}
      data-focused={focused || undefined}
      data-leaving={leaving || undefined}
      data-arriving={arriving || undefined}
      data-touch={touch || undefined}
      onPointerDown={onFocusCard}
    >
      <div className="k-offer-card-head">
        <span className="k-offer-card-title" title={title}>
          {title}
        </span>
        {onNotNow && !touch && (
          <IconButton size="xs" label="Not now" shortcut={focused ? "⌫" : undefined} icon={<Icon name="close" size={12} />} onClick={onNotNow} />
        )}
      </div>
      <p className="k-offer-card-why" title={why}>
        {why}
      </p>
      <div className="k-offer-card-acts">
        <Button
          kind={focused ? "primary" : "secondary"}
          size={touch ? "md" : "sm"}
          className={cx("k-offer-card-act", tap)}
          shortcut={focused && !touch ? shortcut : undefined}
          onClick={(e) => onPress(e.currentTarget)}
        >
          {name ? <Dest verb={verb} name={name} /> : verb}
        </Button>
        {secondary && (
          <Button kind="ghost" size={touch ? "md" : "sm"} className={tap} shortcut={focused && !touch && !onNotNow ? "⌫" : undefined} onClick={secondary.onPress}>
            {secondary.label}
          </Button>
        )}
        {onNotNow && touch && (
          <Button kind="ghost" size="md" className={tap} onClick={onNotNow}>
            Not now
          </Button>
        )}
      </div>
    </div>
  );
});
