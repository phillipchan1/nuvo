// Capture on the phone — the capture door (`components/capture/CaptureDoor`)
// in a bottom Sheet. ONE door, on every screen, for anything you just thought
// of: the floating ＋, the lock-screen widget, a tap on empty Day-canvas time
// (D-130, `initialStart` is that seed — not a second composer).
//
// Everything that decides what the words mean and what gets written lives in
// the door, shared with ⌘K and ⌥Space on the desktop (D-125, D-149). This file
// only owns the frame and raising the keyboard.

import { useRef } from "react";
import { useRaiseKeyboard } from "../../hooks/useRaiseKeyboard";
import Sheet from "./Sheet";
import CaptureDoor, { type CaptureKind } from "../capture/CaptureDoor";

export type { CaptureKind };

export default function MobileCapture({
  onClose,
  defaultDoDate = null,
  initialKind = "task",
  initialStart = null,
  initialDurationMinutes = null,
  held,
}: {
  onClose: () => void;
  /** The day the screen you captured from is about — Today on the Today list,
   *  and on the Calendar the day you are actually looking at, not today. */
  defaultDoDate?: string | null;
  /** Which face to open on — Task unless a door genuinely knows better. */
  initialKind?: CaptureKind;
  /** A tap on the day canvas already chose the clock. The sentence can still
   *  override it; this is the seed when the text is silent. */
  initialStart?: Date | null;
  initialDurationMinutes?: number | null;
  /** The line a dismissed sheet was holding, owned by the shell. A scrim tap
   *  or swipe is easy to do by accident — the sheet shrinks as typed chips
   *  replace the When/Time rows, so the next tap can land above it — and the
   *  thought was simply gone. Restored only on a plain open: a canvas tap's
   *  clock must not be overridden by an old sentence's. Cleared once added. */
  held?: { text: string; set: (text: string) => void };
}) {
  const restore = held && !initialStart ? held.text : "";
  const inputRef = useRef<HTMLInputElement | null>(null);
  // In-app ＋ is a webview gesture so the 120ms retry raises the keyboard;
  // a lock-screen widget is not — useRaiseKeyboard still lands the caret,
  // and the native WKWebView flag (D-115) is what lets the keys come up.
  useRaiseKeyboard(inputRef);

  return (
    <Sheet onClose={onClose} title="Capture">
      <div className="ph-body pb-5">
        <CaptureDoor
          variant="sheet"
          fieldRef={inputRef}
          onClose={onClose}
          onAdded={() => {
            held?.set("");
            onClose();
          }}
          initialText={restore}
          onTextChange={held && !initialStart ? held.set : undefined}
          defaultDoDate={defaultDoDate}
          initialKind={initialKind}
          initialStart={initialStart}
          initialDurationMinutes={initialDurationMinutes}
        />
      </div>
    </Sheet>
  );
}
