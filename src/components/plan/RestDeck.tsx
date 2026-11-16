// The deck at rest (D-209, docs/readiness-ladder.md §3): the Get ready stack's
// top card, shown in the rail under the crown instead of a line that opens it.
// Deck first, because "what's my next winning move?" is the rail's second
// question and the card IS the answer — the line only said there was one.
//
// The same stack (`useReadyStack`), the same cards (`lib/readyCards` — Repair,
// Hold, Draft the path and the other ✦ drafts the agent writes), the same act:
// pressing lands the card and Reaches to the bar it moved. Two differences from
// the full mode: one card shows, with its siblings drawn as edges under it (no
// count of what's left, P4); and Not now sends a card to the back of the stack
// instead of snoozing it, so a pass costs nothing. "All" opens the full mode.

import { useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
import { OfferCard } from "../kit";
import { CardOtherTimes } from "../nuvo/OtherTimes";
import type { ReadyCard } from "../../lib/readyCards";
import { useReadyStack } from "./GetReadyRail";
import { haptic } from "../../lib/haptics";

export default function RestDeck({
  cards,
  onAll,
  touch = false,
}: {
  cards: readonly ReadyCard[];
  /** open the full Get ready mode */
  onAll?: () => void;
  touch?: boolean;
}) {
  // Not now = to the back. Session-local; the model's order is the default.
  const [back, setBack] = useState<string[]>([]);
  const ordered = useMemo(() => {
    const keys = new Set(cards.map((c) => c.key));
    const tail = back.filter((k) => keys.has(k));
    return [...cards.filter((c) => !tail.includes(c.key)), ...tail.map((k) => cards.find((c) => c.key === k)!)];
  }, [cards, back]);
  const s = useReadyStack(ordered, 1);
  const cardEl = useRef<HTMLDivElement | null>(null);
  const top = s.visible[0] ?? null;
  if (!top) return null;
  const edges = Math.min(2, ordered.length - 1);

  const press = (which: "primary" | "secondary", from?: HTMLElement | null) => {
    const el = cardEl.current;
    if (which === "primary") haptic(top.opensMode ? "light" : "success");
    s.act(top, which, from ?? el?.querySelector<HTMLElement>(".k-offer-card-act") ?? el, el);
  };
  const later = () => {
    haptic("selection");
    setBack((b) => [...b.filter((k) => k !== top.key), top.key]);
  };

  return (
    <section className="rest-deck" aria-label="Nuvo">
      <div className="rest-deck-head">
        <span className="rest-deck-spark" aria-hidden>
          ✦
        </span>
        <span>Nuvo</span>
        {onAll && ordered.length > 1 && (
          <button type="button" className="rest-deck-all" onClick={onAll} title="Every card, one after another">
            All
            <Icon name="chevron-right" size={12} />
          </button>
        )}
      </div>
      <div className="rest-deck-stack" data-edges={edges || undefined}>
        {edges > 1 && <span className="rest-deck-edge" data-n="2" aria-hidden />}
        {edges > 0 && <span className="rest-deck-edge" data-n="1" aria-hidden />}
        <OfferCard
          key={top.key}
          ref={cardEl}
          title={top.title}
          why={top.why}
          verb={top.primary.verb}
          name={top.primary.name}
          focused
          touch={touch}
          leaving={s.lettingGo.has(top.key)}
          arriving={s.arriving.has(top.key)}
          onPress={(el) => press("primary", el)}
          // To the back while there's a back to go to; the last card's Not now
          // is the stack's own (a two-week snooze).
          onNotNow={ordered.length > 1 ? later : top.secondary?.label === "Not now" ? () => press("secondary") : undefined}
          secondary={top.secondary && top.secondary.label !== "Not now" ? { label: top.secondary.label, onPress: () => press("secondary") } : undefined}
          other={<CardOtherTimes card={top} touch={touch} />}
        />
      </div>
    </section>
  );
}
