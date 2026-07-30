import type { FC } from "react";
import { Btn } from "../ui";

// The first-visit teacher for an elevation. Shown when a Build floor is genuinely
// un-set-up (zero domains / initiatives / projects) — the empty state IS the guide:
// it teaches the one thing this surface is for, offers the first action, and
// self-cleans the moment a first item exists. Same warm-paper voice + orientation
// visuals as the Welcome, so the whole onboarding reads as one hand showing you
// around. NOT used on the Schedule, where "empty" is a normal daily state, not a
// first-run.
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
      <div className="max-w-md">
        <div className="rise section-label mb-2">{eyebrow}</div>
        <h1 className="rise masthead text-display leading-tight text-ink">{title}</h1>
        <p className="rise text-lead mx-auto mt-3 max-w-sm leading-relaxed text-muted">{teach}</p>
        {actionLabel && (
          // Tagged for the live walkthrough: on a floor with nothing on it yet,
          // this button IS the floor's only act, so it's what the orb lights.
          <div className="rise mt-6 flex justify-center" data-teach="floor-new">
            <Btn kind="primary" onClick={onAction}>{actionLabel}</Btn>
          </div>
        )}
      </div>
    </div>
  );
}
