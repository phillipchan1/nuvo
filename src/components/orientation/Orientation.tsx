import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Btn } from "../ui";
import { useOrientation } from "../../hooks/useOrientation";
import { ORIENTATION_STEPS, type OrientationAction } from "./steps";

// The first-run welcome. Full-viewport warm paper (same trick the floor overlay
// uses — an opaque `.atmosphere` layer over everything) with a single glass card
// that teaches one concept at a time. One component serves both shells: two-column
// on desktop, stacked ≤767px. Chrome, not a route (see useOrientation).
export default function Orientation({
  onAction,
}: {
  // The shell wires semantic CTA verbs to something real (open its Settings surface).
  onAction?: (action: OrientationAction) => void;
}) {
  const { visible, dismiss } = useOrientation();
  const [step, setStep] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  const last = ORIENTATION_STEPS.length - 1;
  const atEnd = step >= last;

  // Fresh start every time it opens (first run or a Settings replay).
  useEffect(() => {
    if (visible) setStep(0);
  }, [visible]);

  const next = useCallback(() => {
    setStep((s) => (s >= last ? s : s + 1));
  }, [last]);
  const back = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);

  const advance = useCallback(() => {
    if (atEnd) dismiss();
    else next();
  }, [atEnd, dismiss, next]);

  // Keyboard: ←/→ move, Enter advances, Esc skips. Captured so it wins over the app.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); dismiss(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
      else if (e.key === "Enter") { e.preventDefault(); advance(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible, dismiss, next, back, advance]);

  // Land keyboard focus inside the dialog when it opens.
  useEffect(() => {
    if (visible) cardRef.current?.focus();
  }, [visible]);

  if (!visible) return null;

  const s = ORIENTATION_STEPS[step];
  const Visual = s.Visual;

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

        {/* Footer: progress dots + navigation */}
        <div className="flex items-center gap-3 border-t border-line px-5 py-4 md:px-9">
          <div className="flex items-center gap-1.5">
            {ORIENTATION_STEPS.map((st, i) => (
              <button
                key={st.id}
                aria-label={`Go to step ${i + 1}: ${st.eyebrow}`}
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
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2.5">
            {step > 0 && (
              <Btn kind="ghost" onClick={back}>Back</Btn>
            )}
            <Btn kind="primary" onClick={advance}>
              {atEnd ? "Get started" : "Next"}
            </Btn>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
