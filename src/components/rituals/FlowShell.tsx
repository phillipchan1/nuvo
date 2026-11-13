// The Flow layout (D-190, "Six layouts") — every ritual, the plan, the doors in.
//
// A flow takes the window: a 56px bar with ✕ at the left and a centred stepper,
// one hero per step, a one-line fact in tabular figures, kit parts for the
// content, and a 56px footer — a quiet summary on the left, ghost Back and the
// primary act on the right with its keycap. Styles: styles/flows.css.
//
// `FlowShell` (the default export) is that frame run over N stages, the way
// Summit uses it. The parts are exported for the flows that lay out their own
// body — Plan the week's old walk, the Week's Review, the capacity run, the
// recap story — so each one is the same frame, never a lookalike.
//
// The stations are still mounted side by side on one wide track that slides as
// you move, so back/next is spatial movement and a station keeps its state.

import { Fragment, useEffect, type ReactNode } from "react";
import { Button, IconButton, NuvoMark } from "../kit";
import { Icon } from "../Icon";

// ── the parts ────────────────────────────────────────────────────────────────

export interface FlowStepDef {
  id: string;
  label: string;
  /** the tooltip — the label is shown, this says more */
  title?: string;
}

/** Numbered circles joined by short hairlines: done = --ok with a ✓, current
 *  = ink, upcoming = a faint outline. Every station stays one click away — a
 *  walk, not a wizard — unless `onStep` is omitted. */
export function FlowStepper({
  steps,
  current,
  onStep,
  dense,
  label = "Steps",
}: {
  steps: readonly FlowStepDef[];
  /** the index you're on; `steps.length` means every step is done */
  current: number;
  onStep?: (i: number) => void;
  /** a finger's height on every station (the phone) */
  dense?: boolean;
  label?: string;
}) {
  return (
    <nav className="f-steps" aria-label={label} data-dense={dense || undefined}>
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <Fragment key={s.id}>
            {i > 0 && <span className="f-step-sep" aria-hidden="true" />}
            <button
              type="button"
              className="f-step"
              data-state={state}
              aria-current={state === "current" ? "step" : undefined}
              aria-label={`Step ${i + 1} of ${steps.length}: ${s.label}${state === "done" ? ", done" : ""}`}
              title={s.title ?? s.label}
              disabled={!onStep}
              onClick={() => onStep?.(i)}
            >
              <span className="f-step-n" aria-hidden="true">
                {state === "done" ? <Icon name="check" size={11} strokeWidth={2.6} /> : i + 1}
              </span>
              <span className="f-step-label">{s.label}</span>
            </button>
          </Fragment>
        );
      })}
    </nav>
  );
}

/** The window-sized frame: bar, body, footer. */
export function FlowFrame({
  label,
  onClose,
  closeLabel = "Close",
  center,
  left,
  right,
  footer,
  children,
}: {
  /** the flow's accessible name */
  label: string;
  onClose: () => void;
  closeLabel?: string;
  /** the stepper (or a walker) */
  center?: ReactNode;
  /** beside the ✕ */
  left?: ReactNode;
  right?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="f-flow" role="dialog" aria-label={label}>
      <header className="f-top" data-tauri-drag-region="deep">
        <div className="f-top-l">
          <IconButton label={closeLabel} shortcut="Esc" icon={<Icon name="close" size={16} />} onClick={onClose} />
          {left}
        </div>
        <div className="f-top-c">{center}</div>
        <div className="f-top-r">{right}</div>
      </header>
      <div className="f-main">{children}</div>
      {footer}
    </div>
  );
}

/** The 56px foot: a quiet summary, then the acts (ghost Back, primary last). */
export function FlowFoot({ summary, children }: { summary?: ReactNode; children?: ReactNode }) {
  return (
    <footer className="f-foot">
      <div className="f-sum">{summary}</div>
      {children}
    </footer>
  );
}

/** A step's head: an optional kicker, THE hero, an optional one-line fact. */
export function FlowHead({
  kicker,
  hero,
  fact,
  level = 1,
  align,
  className,
  children,
}: {
  kicker?: ReactNode;
  hero: ReactNode;
  fact?: ReactNode;
  level?: 1 | 2;
  align?: "center";
  className?: string;
  children?: ReactNode;
}) {
  const H = level === 1 ? "h1" : "h2";
  return (
    <div className={className ? `f-head ${className}` : "f-head"} data-align={align}>
      {kicker != null && <div className="f-kicker">{kicker}</div>}
      <H className="text-display masthead">{hero}</H>
      {fact != null && <div className="f-fact">{fact}</div>}
      {children}
    </div>
  );
}

export interface MeterSegment {
  key: string;
  value: number;
  /** a token or a domain's stored colour */
  color: string;
  title?: string;
  /** still to come — drawn at its real width, faint */
  ghost?: boolean;
}

/** A segmented bar on --sunk. Every piece is placed by transform alone, so a
 *  keep or a drop slides the load in front of you without a layout. */
export function FlowMeter({
  segments,
  total,
  ticks = [],
  size,
  label,
}: {
  segments: readonly MeterSegment[];
  /** the track's full value — the segments sum to at most this */
  total: number;
  /** marks across the track: a pace, a budget */
  ticks?: readonly { key: string; at: number; tone?: "warn"; title?: string }[];
  size?: "sm";
  label: string;
}) {
  const span = Math.max(1, total);
  const frac = (v: number) => Math.max(0, Math.min(1, v / span));
  let offset = 0;
  const placed = segments.map((s) => {
    const start = frac(offset);
    offset += Math.max(0, s.value);
    const end = frac(offset);
    return { ...s, start, width: Math.max(0, end - start), end };
  });
  const lastLive = [...placed].reverse().find((p) => p.width > 0)?.key;
  return (
    <div className="f-meter" data-size={size} role="img" aria-label={label}>
      {placed.map((s) => (
        <span
          key={s.key}
          className="f-meter-seg"
          title={s.title}
          style={{
            background: s.color,
            opacity: s.ghost ? 0.3 : 1,
            transform: `translateX(${(s.start * 100).toFixed(3)}%) scaleX(${s.width.toFixed(4)})`,
          }}
        />
      ))}
      {placed.map((s) => (
        <span
          key={`seam-${s.key}`}
          className="f-meter-seam"
          aria-hidden="true"
          style={{
            opacity: s.width > 0 && s.key !== lastLive && s.end < 1 ? 1 : 0,
            transform: `translateX(${(s.end * 100).toFixed(3)}%)`,
          }}
        />
      ))}
      {ticks.map((t) => (
        <span
          key={t.key}
          className="f-meter-tick"
          data-tone={t.tone}
          title={t.title}
          style={{ transform: `translateX(${(frac(t.at) * 100).toFixed(3)}%)` }}
        />
      ))}
    </div>
  );
}

/** The Nuvo mark — the app icon's N on the accent field (same path as
 *  `src-tauri/app-icon.svg`). Flat: one accent, no gradient (D-189). */
/** The app's mark on a flow (login, first run, orientation) — the one
 *  NuvoMark, so a flow can never drift from the icon (D-191). */
export function FlowMark({ size = 28 }: { size?: number }) {
  return <NuvoMark size={size} />;
}

/** Is this key event aimed at something that already answers it? (A focused
 *  button handles ↵ itself; a field owns its arrows.) */
export function keyIsTaken(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el || !el.closest) return false;
  return Boolean(
    el.isContentEditable ||
      el.closest("input, textarea, select, button, a[href], [role='button'], [role='menu'], [role='dialog'][aria-modal='true'], [contenteditable='true']"),
  );
}

// ── FlowShell — the frame over N stages ─────────────────────────────────────

export interface FlowStage {
  id: string;
  label: string; // "Gain"
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
  const back = () => {
    if (step > 0) (onStepBack ?? (() => setStep(step - 1)))();
  };
  const primary = step < last ? () => setStep(step + 1) : lastCta?.onClick;

  // ← → travel the canvas, ↵ takes the primary act, Esc leaves (never while typing)
  useEffect(() => {
    if (finished) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowRight") setStep(Math.min(last, step + 1));
      if (e.key === "ArrowLeft") {
        if (step > 0) onStepBack ? onStepBack() : setStep(Math.max(0, step - 1));
      }
      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !keyIsTaken(e) && primary) {
        e.preventDefault();
        primary();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, last, setStep, finished, onStepBack, onClose, primary]);

  return (
    <FlowFrame
      label={`${title} — ${sub}`}
      onClose={onClose}
      center={
        <FlowStepper
          steps={stages.map((s) => ({ id: s.id, label: s.label }))}
          current={finished ? stages.length : step}
          onStep={finished ? undefined : setStep}
          label={title}
        />
      }
      right={
        <span className="f-top-meta" title={output.label} style={{ color: finished || output.reached ? "var(--ok)" : undefined }}>
          {output.value}
        </span>
      }
      footer={
        finished ? undefined : (
          <FlowFoot summary={stages[step]?.value}>
            <Button kind="ghost" size="md" onClick={back} disabled={step === 0}>
              Back
            </Button>
            {primary ? (
              <Button kind="primary" size="md" shortcut="↵" onClick={primary}>
                {step < last ? "Continue" : lastCta!.label}
              </Button>
            ) : (
              <span className="f-sum" style={{ flex: "none" }}>{lastHint ?? ""}</span>
            )}
          </FlowFoot>
        )
      }
    >
      {finished ? (
        <div className="f-scroll">
          <div className="f-page" data-width="narrow">{finished}</div>
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
            {stages.map((s, i) => (
              <div key={s.id} className="h-full w-full shrink-0 overflow-y-auto" aria-hidden={i === step ? undefined : true}>
                <div className="f-page">
                  <div className="f-kicker mb-1.5">
                    {title}
                    <span aria-hidden="true">·</span>
                    {inputs.value}
                  </div>
                  {s.body}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </FlowFrame>
  );
}
