// ⌘K — the capture door in the app's responsive Modal.
//
// It used to be a command palette that also captured, searched every record,
// ran commands and opened a chat. Each of those made adding worse: a query
// that resembled a record moved Enter onto the record, a leading space
// switched you into the chat, and the close raced its own "Captured" beat into
// a second history.back(). ⌘K now does the one thing (D-149). Navigation keeps
// its own keys (⌘1–4, the spine).

import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import CaptureDoor, { type CaptureAdded } from "./CaptureDoor";

const NOUN = { task: "Task", event: "Event", slot: "Slot" } as const;

/** "Task added — Today · 2–3pm", said once, where the user already looks. */
export function announceAdded(a: CaptureAdded) {
  toast.success(`${NOUN[a.kind]} added`, { description: a.title ? `${a.title} — ${a.where}` : a.where });
}

export default function QuickAdd({ onClose }: { onClose: () => void }) {
  // Closing is history.back() — once. Every path funnels through here.
  const closed = useRef(false);
  const rearm = useRef<number | undefined>(undefined);
  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    onClose();
    // The latch stops an add + a stray Escape from walking history back twice.
    // But a dialog that can be closed only once is a dialog you cannot close:
    // when a close didn't take (the navigation left an entry still showing this
    // door) the latch used to eat every Escape and scrim click after it. We are
    // still mounted once the navigation has settled → the close failed → re-arm.
    window.clearTimeout(rearm.current);
    rearm.current = window.setTimeout(() => {
      closed.current = false;
    }, 400);
  }, [onClose]);
  useEffect(() => () => window.clearTimeout(rearm.current), []);

  // Escape with focus outside the door (the dialog frame itself, after a
  // click on its padding). The door marks every Escape it handles.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return <CommandFrame onClose={close} />;
}

/**
 * The ⌘K frame: the kit's scrim and a 600px dialog with no head — the line is
 * the head (D-190, "Command · capture"). Dialog semantics come from the kit's
 * own hook: focus in, Tab trapped, focus restored. Escape belongs to the door
 * (it clears the line first, D-051); a press on the scrim leaves.
 */
function CommandFrame({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(panel);
  return createPortal(
    <div className="k-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label="Capture" tabIndex={-1} className="k-command">
        <CaptureDoor
          variant="panel"
          autoFocus
          onClose={onClose}
          onAdded={(a) => {
            announceAdded(a);
            onClose();
          }}
        />
      </div>
    </div>,
    document.body,
  );
}
