/**
 * The thin-path mark's act on a deck card (D-196): ✦ Draft the path. It opens
 * the project with Draft the path already running (D-193) — the card never owns
 * a copy of the draft. A card control, so the deck's drag ignores it.
 */
import { requestPathDraft } from "../../lib/draftIntent";
import { Icon } from "../Icon";
import { ChipButton } from "../kit";
import { TouchButton } from "../mobile/touch";

export default function ThinDoor({ projectId, onOpen, size = "deck" }: { projectId: string; onOpen: (projectId: string) => void; size?: "deck" | "phone" }) {
  const go = (e: React.MouseEvent) => {
    e.stopPropagation();
    requestPathDraft(projectId);
    onOpen(projectId);
  };
  return (
    <div data-card-control className="flex pt-1" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {size === "phone" ? (
        <TouchButton compact icon={<Icon name="sparkles" size={14} />} onClick={go}>
          Draft the path
        </TouchButton>
      ) : (
        <ChipButton icon={<Icon name="sparkles" size={12} />} onClick={go} title="Nuvo drafts the steps this project is missing. Nothing is added until you keep it.">
          Draft the path
        </ChipButton>
      )}
    </div>
  );
}
