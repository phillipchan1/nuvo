// ⌘K — the capture door in the app's responsive Modal.
//
// It used to be a command palette that also captured, searched every record,
// ran commands and opened a chat. Each of those made adding worse: a query
// that resembled a record moved Enter onto the record, a leading space
// switched you into the chat, and the close raced its own "Captured" beat into
// a second history.back(). ⌘K now does the one thing (D-149). Navigation keeps
// its own keys (⌘1–4, the spine), and Nuvo keeps ⌘J.

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Modal } from "../ui";
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

  return (
    <Modal onClose={close} width="max-w-xl" closeOnEscape={false}>
      <div className="px-4 pb-3 pt-4">
        <CaptureDoor
          variant="panel"
          autoFocus
          onClose={close}
          onAdded={(a) => {
            announceAdded(a);
            close();
          }}
        />
      </div>
    </Modal>
  );
}
