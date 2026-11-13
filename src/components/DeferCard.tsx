// DeferCard — the Schedule's frame for "can't get to this".
//
// A project sitting on the grid could be opened, duplicated or deleted, and
// deleting it left the project on the week with its work stranded on the day.
// The honest acts — free this block, move the project, take it off the week —
// lived two surfaces away, and only when the app had noticed a problem. This
// puts them on the block itself. It is a frame and nothing more: the panel
// (`DeferPanel`) and the acts (`useDeferProject`) are the ones the Week's Plan
// row and the phone's slot sheet use.
//
// Instrument (D-190): the kit's Popover — grown from the point it was opened
// at, flipped and clamped to the window, closed by a press outside or Escape —
// headed by the project's name and its domain's Dot.

import { useEffect } from "react";
import { useOptionalVertical } from "../hooks/useVertical";
import { domainById, projectById } from "../lib/vertical";
import type { Slot } from "../lib/types";
import { SlotDeferPanel } from "./floors/DeferPanel";
import { Dot, Popover } from "./kit";

export function DeferCard({
  slot,
  point,
  onClose,
}: {
  slot: Slot;
  /** where the menu was opened — the card lands beside it, clamped to the window */
  point: { x: number; y: number };
  onClose: () => void;
}) {
  const store = useOptionalVertical();
  const project = store ? projectById(store.data, slot.project_id) : null;
  const domain = store && project ? domainById(store.data, project.domainId) : null;

  // The kit's popover closes on a press outside and on Escape; this card also
  // closes when the window loses focus, like every other floating thing on the
  // pane.
  useEffect(() => {
    window.addEventListener("blur", onClose);
    return () => window.removeEventListener("blur", onClose);
  }, [onClose]);

  if (!project) return null;

  return (
    <Popover anchor={point} open onClose={onClose} label={project.name} className="defer-card">
      <div className="defer-card-head">
        {domain?.color && <Dot color={domain.color} />}
        <span>{project.name}</span>
      </div>
      <div className="defer-card-body">
        <SlotDeferPanel slot={slot} onDone={onClose} />
      </div>
    </Popover>
  );
}
