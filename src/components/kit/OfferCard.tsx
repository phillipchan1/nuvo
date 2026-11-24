import { forwardRef, useEffect, useId, type ReactNode } from "react";
import { clearOfferPreview, showOfferPreview } from "../../lib/offerPreview";
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
  /** the second answer every time offer carries (R13): the host's Other
   *  times control, beside the act it's an alternative to */
  other?: ReactNode;
  focused?: boolean;
  leaving?: boolean;
  arriving?: boolean;
  /** under a finger: 44px acts, Not now said as text in the footer */
  touch?: boolean;
  onFocusCard?: () => void;
  /** "It's already done" — a text act, so it is findable, not guessed (D-255) */
  onDone?: () => void;
  /** the word for it when it isn't "Done" — "Ship it…" (D-256) */
  doneLabel?: string;
  /** Pointing at the act draws where it would land on the Schedule and dims
   *  the rest (R3). Nothing is written. */
  preview?: { label: string; start: Date; end: Date } | null;
  /** The pointer or keyboard focus is on the card (true) or left it (false):
   *  the host rings where the thing is now */
  onPoint?: (on: boolean) => void;
}

export const OfferCard = forwardRef<HTMLDivElement, OfferCardProps>(function OfferCard(
  { title, why, verb, name, shortcut, onPress, onNotNow, secondary, other, focused, leaving, arriving, touch, onFocusCard, onDone, doneLabel, preview, onPoint },
  ref,
) {
  const tap = touch ? "tap" : undefined;
  const previewId = useId();
  const showPreview = () => {
    if (preview) showOfferPreview({ id: previewId, ...preview });
  };
  const hidePreview = () => clearOfferPreview(previewId);
  // A card that goes (acted on, re-rendered away) takes its picture with it.
  useEffect(() => () => clearOfferPreview(previewId), [previewId]);
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
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") onPoint?.(true);
      }}
      onPointerLeave={() => onPoint?.(false)}
      onFocus={(e) => {
        if (e.target.matches(":focus-visible")) onPoint?.(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onPoint?.(false);
      }}
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
          onClick={(e) => {
            hidePreview();
            onPress(e.currentTarget);
          }}
          onPointerEnter={(e) => {
            if (e.pointerType === "mouse") showPreview();
          }}
          onPointerLeave={hidePreview}
          onFocus={(e) => {
            if (e.currentTarget.matches(":focus-visible")) showPreview();
          }}
          onBlur={hidePreview}
        >
          {name ? <Dest verb={verb} name={name} /> : verb}
        </Button>
        {other}
        {secondary && (
          <Button kind="ghost" size={touch ? "md" : "sm"} className={tap} shortcut={focused && !touch && !onNotNow ? "⌫" : undefined} onClick={secondary.onPress}>
            {secondary.label}
          </Button>
        )}
        {onDone && (
          <Button
            kind="ghost"
            size={touch ? "md" : "sm"}
            className={tap}
            icon={<Icon name="check" size={12} />}
            shortcut={focused && !touch ? "D" : undefined}
            onClick={() => {
              hidePreview();
              onDone();
            }}
          >
            {doneLabel ?? "Done"}
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
