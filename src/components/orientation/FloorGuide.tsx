import type { FC } from "react";
import { Button } from "../kit";
import { FlowHead } from "../rituals/FlowShell";

// The first-visit teacher for an elevation. Shown when a Build floor is genuinely
// un-set-up (zero domains / initiatives / projects) — the empty state IS the guide:
// it teaches the one thing this surface is for, offers the first action, and
// self-cleans the moment a first item exists. Same voice + orientation visuals
// as the Welcome, so the whole onboarding reads as one hand showing you around.
// NOT used on the Schedule, where "empty" is a normal daily state, not a
// first-run. Instrument (D-190): the illustration on its plate, a kicker, the one
// hero, one line, the act as a kit Button.
export function FloorGuide({
  eyebrow,
  title,
  teach,
  Visual,
  actionLabel,
  onAction,
}: {
  eyebrow: string;
  title: string;
  teach: string;
  Visual: FC;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-7 px-6 py-10 text-center">
      <div className="rise h-52 w-full max-w-xs">
        <Visual />
      </div>
      <div className="rise grid max-w-md justify-items-center gap-5">
        <FlowHead align="center" kicker={eyebrow} hero={title} fact={teach} />
        {actionLabel && onAction && (
          // Tagged for the live walkthrough: on a floor with nothing on it yet,
          // this button IS the floor's only act, so it's what the orb lights.
          // No label without a handler — a painted no-op is how "Add your first
          // project" failed the live walk.
          <div className="flex justify-center" data-teach="floor-new">
            <Button kind="primary" size="md" onClick={onAction}>
              {actionLabel}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
