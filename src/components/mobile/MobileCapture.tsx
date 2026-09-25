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
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  // In-app ＋ is a webview gesture so the 120ms retry raises the keyboard;
  // a lock-screen widget is not — useRaiseKeyboard still lands the caret,
  // and the native WKWebView flag (D-115) is what lets the keys come up.
  useRaiseKeyboard(inputRef);

  return (
    <Sheet onClose={onClose} title="Capture">
      <div className="px-4 pb-4">
        <CaptureDoor
          variant="sheet"
          fieldRef={inputRef}
          onClose={onClose}
          onAdded={() => onClose()}
          defaultDoDate={defaultDoDate}
          initialKind={initialKind}
          initialStart={initialStart}
          initialDurationMinutes={initialDurationMinutes}
        />
      </div>
    </Sheet>
  );
}
