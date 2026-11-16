// A dial's fixes, right under it (D-226). On the decks a dial's "what's left"
// ("2 to shape", "23.5h over") is a button, the way the Schedule's "1 needs a
// time" is (D-219): it unfolds the projects (or bets) behind that number, each
// with the act that fixes it on its own row — *Suggest tasks*, *Use this
// outcome*, *Move to Nov 30*, *Suggest projects*. The name opens the record,
// where its lead line asks the question (D-050). So the fix is one press from
// the number, not behind Get ready.
//
// The cards are the deck's own Get ready cards (`lib/deckReady`), cut by the
// dial they move; nothing here decides what a fix is.

import { Button } from "../kit";
import { Icon } from "../Icon";
import { subjectOf } from "../../lib/deckReady";
import type { ReadyCard } from "../../lib/readyCards";

export function DeckFixList({
  cards,
  label,
  onOpen,
  walk,
}: {
  cards: readonly ReadyCard[];
  label: string;
  /** open the card's record */
  onOpen: (id: string) => void;
  /** the walk over everything not Ready — *Plan projects* / *Plan initiatives* */
  walk?: { label: string; run: () => void } | null;
}) {
  return (
    <div className="deck-fixes" role="list" aria-label={label}>
      {cards.map((c) => {
        const id = subjectOf(c);
        const acts = c.primary.verb !== "Open";
        return (
          <div key={c.key} role="listitem" className="deck-fix" data-kind={c.kind}>
            <button type="button" className="deck-fix-name" onClick={() => onOpen(id)} title={`Open ${c.title}`}>
              <span className="deck-fix-title">{c.title}</span>
              <span className="deck-fix-why">{c.why}</span>
            </button>
            {acts ? (
              <Button size="xs" kind="secondary" onClick={(e) => c.primary.run(e.currentTarget)}>
                {c.primary.name ? `${c.primary.verb} ${c.primary.name}` : c.primary.verb}
              </Button>
            ) : (
              <Icon name="chevron-right" size={12} />
            )}
          </div>
        );
      })}
      {walk && (
        <Button size="xs" kind="ghost" onClick={walk.run} trailing={<Icon name="chevron-right" size={12} />}>
          {walk.label}
        </Button>
      )}
    </div>
  );
}
