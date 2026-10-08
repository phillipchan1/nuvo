// DeferCard — the Schedule's frame for "can't get to this".
//
// A project sitting on the grid could be opened, duplicated or deleted, and
// deleting it left the project on the week with its work stranded on the day.
// The honest acts — free this block, move the project, take it off the week —
// lived two surfaces away, and only when the app had noticed a problem. This
// puts them on the block itself. It is a frame and nothing more: the panel
// (`DeferPanel`) and the acts (`useDeferProject`) are the ones the Week's Plan
// row and the phone's slot sheet use.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOptionalVertical } from "../hooks/useVertical";
import { projectById } from "../lib/vertical";
import type { Slot } from "../lib/types";
import { SlotDeferPanel } from "./floors/DeferPanel";

const CARD_W = 300;

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
  const ref = useRef<HTMLDivElement | null>(null);

  // Closes like every other floating thing on the pane: a press outside, Escape,
  // or the window losing focus.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // The card's height depends on how much it has to say, so it is measured
  // rather than guessed — a block near the bottom of the day is exactly where
  // you right-click, and a card that runs off the window hides its own acts.
  const [height, setHeight] = useState(260);
  useLayoutEffect(() => {
    if (ref.current) setHeight(ref.current.offsetHeight);
  }, [project?.id]);

  if (!project) return null;

  const left = Math.max(8, Math.min(point.x, window.innerWidth - CARD_W - 8));
  const top = Math.max(8, Math.min(point.y, window.innerHeight - height - 8));

  return createPortal(
    <div
      ref={ref}
      // Opaque, like every other menu on this pane — it sits on the block it acts on.
      className="pop-in fixed z-[60] rounded-[var(--radius)] border border-line bg-surface p-3 pb-1"
      style={{ top, left, width: CARD_W, boxShadow: "var(--shadow-3)" }}
    >
      <div className="section-label !px-0 !pb-1.5 truncate" style={{ color: "var(--accent)" }}>
        {project.name}
      </div>
      <SlotDeferPanel slot={slot} onDone={onClose} />
    </div>,
    document.body,
  );
}
