// Get ready on the phone (D-206) — the crown's door opens a bottom Sheet with
// the same cards as the desktop rail mode (`lib/readyCards` through
// `useReadyCards`), the same stack (`useReadyStack`: at most five, the next
// arrives as one leaves, never a count), by tap. 44px acts; Not now is said as
// text in the card's footer — a hidden gesture is never the only path to an act.
//
// Repairs are not carded here: the phone's repair card (MobileRepairCard) owns
// the one repair state above the Calendar, and a second instance would apply a
// Handle twice. Everything else is the desktop's list, word for word.

import { useCallback, useEffect } from "react";
import Sheet from "./Sheet";
import { SHEET_BODY, SHEET_SCROLL } from "./sheetKit";
import { OfferCard } from "../kit";
import { haptic } from "../../lib/haptics";
import type { MemoryApi } from "../memory/MemoryPage";
import { useTaskMutations } from "../../hooks/useTasks";
import { useReadyCards } from "../plan/useReadyCards";
import { READY_HOLD_MS, useReadyStack } from "../plan/GetReadyRail";
import type { ReadyCard } from "../../lib/readyCards";

export function ReadyStackSheet({ cards, onClose }: { cards: readonly ReadyCard[]; onClose: () => void }) {
  const s = useReadyStack(cards);

  useEffect(() => {
    if (!s.empty) return;
    const t = window.setTimeout(onClose, READY_HOLD_MS);
    return () => window.clearTimeout(t);
  }, [s.empty, onClose]);

  const press = (c: ReadyCard, which: "primary" | "secondary", el: HTMLElement | null) => {
    // An act that changes your week lands with a success tap (D-207 §6); one
    // that only opens a mode or a record is a light tap; Not now is a tick.
    haptic(which === "primary" ? (c.opensMode || c.kind === "path" ? "light" : "success") : "selection");
    s.act(c, which, el, el?.closest<HTMLElement>(".k-offer-card") ?? null);
  };

  return (
    <Sheet title="Get ready" onClose={onClose} contentClassName={SHEET_SCROLL}>
      <div className={SHEET_BODY} data-ready-sheet>
        {s.empty ? (
          <p className="py-8 text-center text-head" role="status" data-ready-done>
            Ready.
          </p>
        ) : (
          <div className="grid gap-2.5" role="list" aria-label="Get ready">
            {s.visible.map((c) => (
              <div key={c.key} role="listitem">
                <OfferCard
                  touch
                  title={c.title}
                  why={c.why}
                  verb={c.primary.verb}
                  name={c.primary.name}
                  leaving={s.lettingGo.has(c.key)}
                  arriving={s.arriving.has(c.key)}
                  onPress={(el) => press(c, "primary", el)}
                  onNotNow={c.secondary?.label === "Not now" ? () => press(c, "secondary", null) : undefined}
                  secondary={
                    c.secondary && c.secondary.label !== "Not now"
                      ? { label: c.secondary.label, onPress: () => press(c, "secondary", null) }
                      : undefined
                  }
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** The live sheet — mounted only while open, so nothing composes at rest. */
export default function MobileGetReady({
  now,
  onClose,
  onPlanWeek,
  onOpenProject,
  learned,
}: {
  now: Date;
  /** the shell's one Memory read */
  learned?: MemoryApi | null;
  onClose: () => void;
  onPlanWeek: () => void;
  onOpenProject: (projectId: string) => void;
}) {
  const mutations = useTaskMutations();
  // A card that opens somewhere else closes the sheet first: one thing on top.
  const toPlan = useCallback(() => {
    onClose();
    onPlanWeek();
  }, [onClose, onPlanWeek]);
  const toProject = useCallback(
    (id: string) => {
      onClose();
      onOpenProject(id);
    },
    [onClose, onOpenProject],
  );
  const cards = useReadyCards({ now, mutations, learned, onPlanWeek: toPlan, onOpenProject: toProject });
  return <ReadyStackSheet cards={cards} onClose={onClose} />;
}
