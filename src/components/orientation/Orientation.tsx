import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Btn } from "../ui";
import { useOrientation } from "../../hooks/useOrientation";
import { ORIENTATION_STEPS, type OrientationAction } from "./steps";
import TeachPanel from "./TeachPanel";

// The first-run welcome. Full-viewport warm paper (same trick the floor overlay
// uses — an opaque `.atmosphere` layer over everything) with a single glass card
// that teaches one concept at a time. One component serves both shells: two-column
// on desktop, stacked ≤767px. Chrome, not a route (see useOrientation).
//
// The welcome step is a fork, not a slide: **Show me around** runs this card path
// (rebuilt art, no data required), **Walk me through it** hands off to TeachPanel,
// which docks aside and narrates over the live app. Both are skippable at every
// step; the chooser itself has a Skip.
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
  const [rawStep, setStep] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  const last = ORIENTATION_STEPS.length - 1;
  // Step 0 is the fork, so it belongs to `choose` alone. Clamping here (rather
  // than trusting setStep) is what keeps a reload honest: `mode` is persisted but
  // `step` isn't, so a refresh mid-tour would otherwise land on the welcome slide
  // with the doors already gone and no way back to them.
  const step = mode === "show" ? Math.max(1, rawStep) : rawStep;
  const atEnd = step >= last;

  // Fresh start every time it opens (first run or a Settings replay).
  useEffect(() => {
    if (visible) setStep(0);
  }, [visible]);

  const next = useCallback(() => {
    setStep((s) => (s >= last ? s : s + 1));
  }, [last]);
  // Stepping back off the first slide reopens the fork — the other door should
  // never be more than one Back away.
  const back = useCallback(() => {
    if (step <= 1) { chooseMode("choose"); setStep(0); return; }
    setStep((s) => Math.max(0, s - 1));
  }, [step, chooseMode]);

  const advance = useCallback(() => {
    if (atEnd) dismiss();
    else next();
  }, [atEnd, dismiss, next]);

  // Keyboard: ←/→ move, Enter advances, Esc skips. Captured so it wins over the
  // app. Idle while the fork is open (Enter would pick a door arbitrarily) and
  // while the live walkthrough runs — TeachPanel owns the keyboard then.
  useEffect(() => {
    if (!visible || mode !== "show") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); dismiss(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
      else if (e.key === "Enter") { e.preventDefault(); advance(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible, mode, dismiss, next, back, advance]);

  // Land keyboard focus inside the dialog when it opens.
  useEffect(() => {
    if (visible) cardRef.current?.focus();
  }, [visible]);

  // Escape from the fork itself — the card path's handler is idle here.
  useEffect(() => {
    if (!visible || mode !== "choose") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); dismiss(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible, mode, dismiss]);

  if (!visible) return null;

  // The live door — the overlay gets out of the way entirely and the panel takes
  // over, docked beside a fully usable app.
  if (mode === "teach") {
    return <TeachPanel onDone={dismiss} onAction={onAction} mobile={mobile} />;
  }

  const s = ORIENTATION_STEPS[step];
  const Visual = s.Visual;
  // The welcome slide with the door still unchosen: its footer is the fork.
  const isFork = mode === "choose";

  const runCta = () => {
    if (s.cta) {
      onAction?.(s.cta.action);
      dismiss(); // opening Settings needs the overlay out of the way
    }
  };

  return createPortal(
    <div
      className="scrim atmosphere fixed inset-0 z-[60] flex items-center justify-center p-4 pt-safe pb-safe"
      role="dialog"
      aria-modal="true"
      aria-labelledby="orient-title"
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        className="moment glass elev-3 relative w-full max-w-3xl overflow-hidden rounded-2xl border border-line outline-none"
      >
        {/* Skip — quiet, top-right, always available */}
        <button
          onClick={dismiss}
          className="tap fast absolute right-3 top-3 z-10 rounded-md px-2.5 py-1.5 text-caption text-muted hover:text-ink"
        >
          Skip
        </button>

        <div className="grid gap-0 md:grid-cols-2">
          {/* Visual — on top on mobile, left on desktop */}
          <div className="flex min-h-[200px] items-center justify-center p-5 md:min-h-[380px] md:p-8">
            <div key={`v-${s.id}`} className="rise flex h-full w-full items-center justify-center">
              <Visual />
            </div>
          </div>

          {/* Teaching column */}
          <div className="flex flex-col justify-center p-6 md:p-9">
            <div key={`t-${s.id}`} className="rise">
              <div className="section-label mb-3">{s.eyebrow}</div>
              <h1 id="orient-title" className="masthead text-display leading-tight text-ink">
                {s.title}
              </h1>
              <p className="text-lead mt-4 leading-relaxed text-muted">{s.teach}</p>
              {s.cta && (
                <button
                  onClick={runCta}
                  className="tap fast mt-5 inline-flex w-fit items-center gap-1.5 rounded-md border border-accent px-3.5 py-2 text-body font-medium text-accent hover:bg-accent-soft active:translate-y-px"
                >
                  {s.cta.label}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Footer. On the welcome step it's the fork — two doors, no Next. The
            choice is how you want to learn this, which is the one question that
            step asks (P8). */}
        {isFork ? (
          <div className="flex flex-col gap-2.5 border-t border-line px-5 py-4 sm:flex-row sm:items-center md:px-9">
            <Btn
              kind="ghost"
              onClick={() => { chooseMode("show"); setStep(1); }}
              title="A two-minute read-through — nothing to set up"
            >
              Show me around
            </Btn>
            <Btn
              kind="primary"
              onClick={() => chooseMode("teach")}
              title="Set up your first week together, one step at a time"
            >
              Walk me through it
            </Btn>
            <p className="text-caption text-muted sm:ml-auto sm:max-w-[14rem] sm:text-right">
              Either way, you can stop at any point.
            </p>
          </div>
        ) : (
        <div className="flex items-center gap-3 border-t border-line px-5 py-4 md:px-9">
          {/* The fork isn't a slide you can page back to, so it gets no dot. */}
          <div className="flex items-center gap-1.5">
            {ORIENTATION_STEPS.slice(1).map((st, idx) => {
              const i = idx + 1;
              return (
              <button
                key={st.id}
                aria-label={`Go to step ${i}: ${st.eyebrow}`}
                onClick={() => setStep(i)}
                className="tap fast flex h-6 items-center"
              >
                <span
                  className="block rounded-full transition-all"
                  style={{
                    width: i === step ? 20 : 7,
                    height: 7,
                    background: i === step ? "var(--accent)" : "var(--line-strong)",
                  }}
                />
              </button>
              );
            })}
          </div>

          <div className="ml-auto flex items-center gap-2.5">
            {/* Back is always live here — at step 1 it reopens the fork. */}
            <Btn kind="ghost" onClick={back}>Back</Btn>
            <Btn kind="primary" onClick={advance}>
              {atEnd ? "Get started" : "Next"}
            </Btn>
          </div>
        </div>
        )}
      </div>
    </div>,
    document.body
  );
}
