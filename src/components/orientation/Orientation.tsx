import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "../kit";
import { FlowHead, FlowMark } from "../rituals/FlowShell";
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
// vocabulary arrives, and hands off. The doors-in grammar (D-190): the window
// ground, one 12px raised card, the mark, one hero, the act bottom-right.
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
      className="scrim fixed inset-0 z-[60] overflow-y-auto"
      style={{ background: "var(--ground)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="orient-title"
    >
      <div className="f-ground min-h-full">
        <div ref={cardRef} tabIndex={-1} className="f-card outline-none" data-width="wide">
          <div className="h-[132px] w-full overflow-hidden rounded-[var(--r-card)] sm:h-[160px]" style={{ background: "var(--sunk)", boxShadow: "inset 0 0 0 1px var(--line-1)" }}>
            <WelcomeHero />
          </div>

          <div className="mt-6 grid gap-5">
            <FlowMark />
            {/* "Organized" was the first draft and it's the wrong verb: it's what
                the tools this replaces already do. Tidiness is the failure mode,
                not the promise. The promise is that it *moves*. */}
            <FlowHead
              hero={
                <span id="orient-title">
                  Your whole life,
                  <br />
                  actually moving.
                </span>
              }
              /* Says what the diagram says: loose things in, one line out — Nuvo
                 takes the complexity, and the deciding stays yours in the same
                 breath (N-01: never Motion-style autopilot). Do NOT enumerate
                 domains here (Principle 16). */
              fact="The complexity is ours. The decisions stay yours."
            />
          </div>

          <div className="f-card-foot">
            <span className="f-sum">Three minutes · stop anywhere</span>
            {/* Quiet, always available — leaving costs one click and no explanation. */}
            <Button kind="ghost" size="md" shortcut="Esc" onClick={dismiss}>
              Skip
            </Button>
            <Button kind="primary" size="md" shortcut="↵" onClick={() => chooseMode("teach")}>
              Walk me through it
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
