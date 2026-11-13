import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "../kit";
import { DoorTitle, StatementPage } from "../statement/StatementPage";
import { useOrientation } from "../../hooks/useOrientation";
import { useVertical } from "../../hooks/useVertical";
import type { Domain } from "../../lib/vertical";
import type { OrientationAction } from "./steps";
import { Ladder } from "./Ladder";
import { welcomeRungs } from "./ladderRead";
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
  const { data } = useVertical();
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
      <WelcomePage
        domains={data?.domains ?? []}
        cardRef={cardRef}
        onSkip={dismiss}
        onStart={() => chooseMode("teach")}
      />
    </div>,
    document.body
  );
}

// The welcome itself, pure, so `?orientation` can show it over fixtures.
//
// It is the third of three statements a new account reads, and they are one
// sentence in three beats (D-200):
//   sign-in    — "Ambition, down to the hour."
//   first run  — "Name what you're carrying."
//   welcome    — "Now, down to the hour."
// The stage draws the ladder for the first time: the domains they named a
// moment ago at the top, in their own words and hues, and every rung below an
// open socket narrowing to one hour. It's the path the walkthrough is about to
// walk, and the walkthrough's last step draws it again, filled.
export function WelcomePage({
  domains,
  cardRef,
  onSkip,
  onStart,
}: {
  domains: Pick<Domain, "name" | "color">[];
  cardRef?: React.Ref<HTMLDivElement>;
  onSkip: () => void;
  onStart: () => void;
}) {
  return (
    <StatementPage
      stage={<Ladder rungs={welcomeRungs(domains)} hour={{ label: "an hour", filled: false }} size="stage" />}
      hero={
        <span id="orient-title">
          Now, down
          <br />
          to the hour
        </span>
      }
    >
      <div ref={cardRef} tabIndex={-1} className="grid gap-5 outline-none">
        <DoorTitle>Take one thing all the way down</DoorTitle>
        {/* The promise is the walk itself: one real thing, from your head to an
            hour on your calendar, in the real app, with your own words. Do NOT
            enumerate domains here (Principle 16), and never "organized" —
            tidiness is what the tools this replaces already sell. */}
        <p className="st-lead">
          From something on your mind to an hour on your calendar — in the real app, with your own work. Stop
          anywhere.
        </p>
        <div className="f-card-foot">
          <span className="f-sum">Three minutes</span>
          {/* Quiet, always available — leaving costs one click and no explanation. */}
          <Button kind="ghost" size="md" shortcut="Esc" onClick={onSkip}>
            Skip
          </Button>
          <Button kind="primary" size="md" shortcut="↵" onClick={onStart}>
            Walk me through it
          </Button>
        </div>
      </div>
    </StatementPage>
  );
}
