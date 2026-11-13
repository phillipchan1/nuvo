/**
 * Nuvo on the phone (D-198, D-200) — what the ✦ opens now that the chat is gone.
 * A bottom Sheet (golden rule 3): the offers for where you are, Memory one tap
 * away in the title row, and the card for talking to Nuvo from your own
 * assistant. Nothing here is typed into.
 */

import Sheet from "./Sheet";
import { SHEET_SCROLL } from "./sheetKit";
import { IconButton } from "../kit";
import { MemoryIcon } from "../memory/MemoryIcon";
import NuvoOffers from "../nuvo/NuvoOffers";
import { NuvoConnect } from "../nuvo/NuvoConnect";
import type { NuvoOffersState, OfferMemorySource } from "../nuvo/useNuvoOffers";
import { ASSISTANT_NAME } from "../../lib/assistant";

export default function NuvoSheet({
  offers,
  memory,
  onClose,
  onMemory,
  onOpenProject,
  onConnect,
}: {
  offers: NuvoOffersState;
  memory: OfferMemorySource | null;
  onClose: () => void;
  onMemory: () => void;
  onOpenProject: (projectId: string) => void;
  onConnect: () => void;
}) {
  return (
    <Sheet
      title={ASSISTANT_NAME}
      onClose={onClose}
      contentClassName={SHEET_SCROLL}
      action={<IconButton label="Memory" size="md" data-land="memory" icon={<MemoryIcon size={18} />} onClick={onMemory} className="tap-icon" />}
    >
      <div className="nuvo-sheet">
        {offers.offers.length ? (
          <NuvoOffers state={offers} memory={memory} phone onOpenProject={onOpenProject} />
        ) : (
          <p className="nuvo-quiet">Nothing to offer right now. {ASSISTANT_NAME} speaks when it's sure.</p>
        )}
        <NuvoConnect phone onConnect={onConnect} />
      </div>
    </Sheet>
  );
}
