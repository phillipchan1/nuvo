import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Btn } from "../ui";
import { useOrientation } from "../../hooks/useOrientation";
import type { OrientationAction } from "./steps";
import { WelcomeHero } from "./Visuals";
import TeachPanel from "./TeachPanel";

// The first-run welcome — one screen, one promise, one door.
//
// It used to fork: a visual tour of rebuilt art beside the live walkthrough. The
// tour is gone (D-065). The whole reason this work started was that a diagram
// asks the reader to map a picture onto a screen they've never seen, and once the
// live path existed the tour was strictly the weaker half of the pair — while the
// closing rules card now carries the *concepts* the tour was there to deliver. A
// power user doesn't need a second door either: Skip sits on every step and Esc
// leaves from anywhere.
//
// So this screen's only job is emotional. It says what the app is *for* before any
// vocabulary arrives, and hands off. Deliberately not a dialog-shaped card: full
// warm paper, one Fraunces line, generous air.
export default function Orientation({
  onAction,
  mobile = false,
}: {
  // The shell wires semantic CTA verbs to something real (open its Settings surface).
  onAction?: (action: OrientationAction) => void;
  /** Phone shell — TeachPanel drops auto-navigation and floor-only targets. */
  mobile?: boolean;
}) {
  const { visible, dismiss, mode, chooseMode } = useOrientation();
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible) cardRef.current?.focus();
  }, [visible]);

  // Esc leaves from the welcome. (TeachPanel owns the key once it's running.)
  useEffect(() => {
    if (!visible || mode !== "choose") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); dismiss(); }
      else if (e.key === "Enter") { e.preventDefault(); chooseMode("teach"); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible, mode, dismiss, chooseMode]);

  if (!visible) return null;

  if (mode === "teach") {
    return <TeachPanel onDone={dismiss} onAction={onAction} mobile={mobile} />;
  }

  return createPortal(
    <div
      className="scrim atmosphere fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto p-6 pt-safe pb-safe"
      role="dialog"
      aria-modal="true"
      aria-labelledby="orient-title"
    >
      {/* Quiet, always available — leaving costs one click and no explanation. */}
      <button
        onClick={dismiss}
        className="tap fast absolute right-4 top-4 z-10 rounded-md px-3 py-2 text-caption text-muted hover:text-ink"
      >
        Skip
      </button>

      <div
        ref={cardRef}
        tabIndex={-1}
        className="moment flex w-full max-w-xl flex-col items-center text-center outline-none"
      >
        <div className="rise h-[132px] w-full max-w-[360px] sm:h-[168px]">
          <WelcomeHero />
        </div>

        {/* "Organized" was the first draft and it's the wrong verb: it's what the
            tools this replaces already do. personas.md on the boards P1 left —
            "work goes in and never comes out onto a Tuesday; the board is a
            graveyard with good UI." Tidiness is the failure mode, not the
            promise. The promise is that it *moves*. */}
        <h1
          id="orient-title"
          className="rise masthead mt-7 text-[32px] leading-[1.12] text-ink sm:text-[44px]"
        >
          Your whole life,
          <br />
          actually moving.
        </h1>

        {/* Says what the diagram says: loose things in, one line out — Nuvo takes
            the complexity. The second half is not decoration. "Nuvo handles it"
            alone promises Motion-style autopilot, which is N-01 ("removes the
            judgment the product exists to build"), so the sentence has to hand
            the deciding back in the same breath. It's also the cleanest thing we
            can say against both neighbours: a board organizes but never moves it;
            an auto-scheduler moves it but takes the call.

            Do NOT enumerate domains here. An earlier draft read "work, family,
            faith, health" — persona zero's own list, which personas.md §1 names
            as the Principle 16 violation behind the retired four-domain seed. */}
        <p className="rise text-lead mt-5 max-w-md leading-relaxed text-muted">
          The complexity is ours. The decisions stay yours.
        </p>

        <div className="rise mt-8 flex w-full justify-center">
          <Btn kind="primary" onClick={() => chooseMode("teach")} className="!px-7 !py-3 !text-lead">
            Walk me through it →
          </Btn>
        </div>

        <p className="rise mt-4 text-caption text-muted">Three minutes. Stop anywhere.</p>
      </div>
    </div>,
    document.body
  );
}
