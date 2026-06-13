// FlowShell — the left-to-right canvas every flow runs on. The pipeline is
// literal: an inputs node (the boundaries) on the far left, the stages in
// between, the output node on the far right — and every node shows its LIVE
// output, the artifact that feeds the next stage. The stations are mounted
// side by side on one wide track that slides as you move, so back/next is
// spatial movement (and station state survives navigation).

import { useEffect, type ReactNode } from "react";
import { Btn } from "../ui";

export interface FlowStage {
  id: string;
  label: string; // "The Gain"
  /** The stage's live output — one short line, updates as you decide. */
  value: ReactNode;
  body: ReactNode;
}

export interface FlowEndpoint {
  label: string; // "inputs" / "the week"
  value: ReactNode;
  /** Output only: has the artifact landed yet? */
  reached?: boolean;
}

export default function FlowShell({
  title,
  sub,
  inputs,
  output,
  stages,
  step,
  setStep,
  finished,
  lastHint,
  lastCta,
  onClose,
  onStepBack,
}: {
  title: string;
  sub: string;
  inputs: FlowEndpoint;
  output: FlowEndpoint;
  stages: FlowStage[];
  step: number;
  setStep: (s: number) => void;
  /** When set, the canvas is replaced by the closing screen. */
  finished?: ReactNode;
  /** Footer hint at the last station (when the commit lives in-body). */
  lastHint?: string;
  /** Footer CTA at the last station (when the commit lives in the shell). */
  lastCta?: { label: string; onClick: () => void };
  onClose: () => void;
  onStepBack?: () => void;
}) {
  const last = stages.length - 1;

  // ← → travel the canvas (never while typing)
  useEffect(() => {
    if (finished) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      if (e.key === "ArrowRight") setStep(Math.min(last, step + 1));
      if (e.key === "ArrowLeft") {
        if (step > 0) onStepBack ? onStepBack() : setStep(Math.max(0, step - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, last, setStep, finished, onStepBack]);

  return (
    <div className="scrim atmosphere fixed inset-0 z-50 flex flex-col">
      {/* the pipeline header: inputs → stages → output, all live */}
      <header className="flex shrink-0 items-center gap-4 border-b border-line bg-surface px-5 py-2 elev-1">
        <div className="w-[108px] shrink-0">
          <div className="wordmark text-[14px]">{title}</div>
          <div className="mono text-[10px] text-muted">{sub}</div>
        </div>

        <div className="flex min-w-0 flex-1 items-stretch justify-center gap-1.5 overflow-x-auto">
          <PipelineNode
            kicker={inputs.label}
            value={inputs.value}
            kind="inputs"
            active={false}
            onClick={() => !finished && setStep(last)}
          />
          {stages.map((s, i) => (
            <span key={s.id} className="flex items-stretch gap-1.5">
              <Arrow lit={Boolean(finished) || step >= i} />
              <PipelineNode
                kicker={s.label}
                value={s.value}
                kind="stage"
                active={!finished && i === step}
                passed={Boolean(finished) || i < step}
                onClick={() => !finished && setStep(i)}
              />
            </span>
          ))}
          <Arrow lit={Boolean(finished) || Boolean(output.reached)} />
          <PipelineNode
            kicker={output.label}
            value={output.value}
            kind="output"
            active={false}
            reached={Boolean(finished) || Boolean(output.reached)}
            onClick={() => !finished && setStep(last)}
          />
        </div>

        <button onClick={onClose} className="keycap shrink-0">esc — resumes later</button>
      </header>

      {/* the canvas: one wide track, stations side by side, slide to travel */}
      {finished ? (
        <div className="moment min-h-0 flex-1 overflow-y-auto px-8 py-7">
          <div className="mx-auto max-w-[1100px]">{finished}</div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <div
            className="flex h-full"
            style={{
              transform: `translateX(-${step * 100}%)`,
              transition: "transform var(--d-slow) var(--ease-out)",
            }}
          >
            {stages.map((s) => (
              <div key={s.id} className="h-full w-full shrink-0 overflow-y-auto px-8 py-7">
                <div className="mx-auto max-w-[1100px]">{s.body}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* footer travel */}
      {!finished && (
        <footer className="flex h-12 shrink-0 items-center justify-between border-t border-line bg-surface px-5">
          <Btn
            onClick={() => { if (step > 0) (onStepBack ?? (() => setStep(step - 1)))(); }}
            disabled={step === 0}
          >
            ‹ back
          </Btn>
          <span className="mono text-[10px] text-muted">
            {step + 1} / {stages.length} · {stages[step]?.label} · ← →
          </span>
          {step < last ? (
            <Btn kind="primary" onClick={() => setStep(step + 1)}>next ›</Btn>
          ) : lastCta ? (
            <Btn kind="primary" onClick={lastCta.onClick}>{lastCta.label}</Btn>
          ) : (
            <span className="mono text-[10px] text-muted">{lastHint ?? ""}</span>
          )}
        </footer>
      )}
    </div>
  );
}

function PipelineNode({
  kicker,
  value,
  kind,
  active,
  passed,
  reached,
  onClick,
}: {
  kicker: string;
  value: ReactNode;
  kind: "inputs" | "stage" | "output";
  active: boolean;
  passed?: boolean;
  reached?: boolean;
  onClick: () => void;
}) {
  const border =
    kind === "inputs"
      ? "1px dashed var(--line)"
      : active
        ? "1px solid var(--accent)"
        : reached
          ? "1px solid var(--accent)"
          : "1px solid var(--line)";
  return (
    <button
      onClick={onClick}
      className="fast min-w-0 shrink-0 rounded-md px-2.5 py-1 text-left"
      style={{
        border,
        background: active ? "var(--accent-soft)" : reached ? "var(--accent-soft)" : "transparent",
        opacity: kind === "stage" && !active && !passed ? 0.55 : 1,
        boxShadow: active ? "0 0 0 3px var(--accent-soft), 0 6px 18px -8px var(--accent-glow)" : "none",
        transform: active ? "translateY(-1px)" : "none",
      }}
    >
      <div
        className="mono whitespace-nowrap text-[8px] uppercase tracking-wider"
        style={{ color: active || reached ? "var(--accent)" : "var(--muted)" }}
      >
        {kicker}
      </div>
      <div className="mono max-w-[150px] truncate whitespace-nowrap text-[10px]" style={{ color: "var(--text)" }}>
        {value}
      </div>
    </button>
  );
}

function Arrow({ lit }: { lit: boolean }) {
  return (
    <span
      className={`self-center text-[11px] ${lit ? "pulse-arrow" : ""}`}
      style={{ color: lit ? "var(--accent)" : "var(--line)", transition: "color var(--d-base) var(--ease-out)" }}
    >
      →
    </span>
  );
}
