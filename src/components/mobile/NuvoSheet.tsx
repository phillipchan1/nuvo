/**
 * Nuvo on the phone (D-198, D-200, D-205) — what the ✦ opens. Nuvo's offers
 * left it for the rows they change (D-205), so the sheet is the door to the two
 * things that have no row: Memory (whose dot the ✦ carries, D-194) and talking
 * to Nuvo from your own assistant. A bottom Sheet (golden rule 3); nothing here
 * is typed into.
 */

import Sheet from "./Sheet";
import { RowList, SHEET_BODY, SHEET_SCROLL, FactRow } from "./sheetKit";
import { MemoryIcon } from "../memory/MemoryIcon";
import { NuvoConnect } from "../nuvo/NuvoConnect";
import { ASSISTANT_NAME } from "../../lib/assistant";

export default function NuvoSheet({
  memoryNew = false,
  onClose,
  onMemory,
  onConnect,
}: {
  /** Memory has something you haven't seen — said on its row, as the ✦'s dot. */
  memoryNew?: boolean;
  onClose: () => void;
  onMemory: () => void;
  onConnect: () => void;
}) {
  return (
    <Sheet title={ASSISTANT_NAME} onClose={onClose} contentClassName={SHEET_SCROLL}>
      <div className={SHEET_BODY}>
        <RowList>
          <FactRow
            lead={
              <span data-land="memory" className="flex">
                <MemoryIcon size={18} />
              </span>
            }
            label="Memory"
            value={memoryNew ? "Something new" : undefined}
            onClick={onMemory}
          />
        </RowList>
        <div className="mt-4">
          <NuvoConnect phone onConnect={onConnect} />
        </div>
      </div>
    </Sheet>
  );
}
