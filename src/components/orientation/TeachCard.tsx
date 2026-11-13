import type { ReactNode } from "react";
import { Icon } from "../Icon";
import { Button, Kbd } from "../kit";
import { Stop } from "../statement/StatementPage";
import type { TeachStep } from "./steps";

// The walkthrough card — what the reader sees at every step (D-200).
//
// Pure: it draws one step from props, so `?orientation` can show every step over
// fixtures and the driver (TeachPanel) keeps all the navigation and data reads.
//
// Its shape is the statement grammar shrunk to a card:
//   · the RUN along the top edge — a piece per step, landed pieces in --landed,
//     the one in front of you in ink. It advances forward and snaps back.
//   · WHERE you are (the place and its key) and how far through.
//   · the STATEMENT, ending on the ember full stop — this step is *now*.
//   · one line naming the act.
//   · the RECEIPT — "Your move" until it's done, then your own words, landed:
//     “Call the bank” is in. That line is the whole emotional move of the
//     walkthrough: it never praises you, it tells you what became true.

export function TeachCard({
  step,
  index,
  total,
  dir = "fwd",
  done = false,
  receipt,
  visual,
  onSkip,
  onBack,
  onNext,
  onCta,
}: {
  step: TeachStep;
  index: number;
  total: number;
  /** which way the run last moved — forward advances, back snaps */
  dir?: "fwd" | "back";
  /** this step's milestone is met in real data */
  done?: boolean;
  /** what became true, in the user's words ("“Call the bank” is in") */
  receipt?: ReactNode;
  visual?: ReactNode;
  onSkip: () => void;
  onBack?: () => void;
  onNext: () => void;
  onCta?: () => void;
}) {
  const atEnd = index >= total - 1;
  return (
    <div className="tc" data-dir={dir}>
      <div className="tc-track" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <i key={i} data-done={i < index || undefined} data-on={i === index || undefined} />
        ))}
      </div>

      {/* keyed on the step so each statement arrives (no fade — readable on frame one) */}
      <div className="tc-body" key={step.id} data-step={step.id}>
        <div className="tc-head">
          <span className="tc-where">
            <span>{step.where.label}</span>
            {step.where.keys && <Kbd keys={[...step.where.keys]} />}
          </span>
          <span className="tc-count">
            {index + 1} of {total}
          </span>
        </div>

        <h2 className="tc-hero">
          {step.title}
          <Stop />
        </h2>
        <p className="tc-line">{step.teach}</p>

        {visual && <div className="tc-visual">{visual}</div>}

        {step.milestone && (
          <div className="tc-receipt" data-done={done || undefined} role="status">
            <span className="tc-check" aria-hidden>
              {done && <Icon name="check" size={10} strokeWidth={2.8} />}
            </span>
            {done ? <b>{receipt ?? "Done."}</b> : <span>Your move.</span>}
          </div>
        )}

        {step.cta && !done && onCta && (
          <div className="tc-cta">
            <Button size="sm" trailing={<Icon name="arrow-right" size={12} />} onClick={onCta}>
              {step.cta.label}
            </Button>
          </div>
        )}
      </div>

      <div className="tc-foot">
        <Button className="tc-skip" kind="ghost" size="sm" shortcut="Esc" onClick={onSkip} aria-label="Skip the walkthrough">
          Skip
        </Button>
        {index > 0 && onBack && (
          <Button kind="ghost" size="sm" onClick={onBack}>
            Back
          </Button>
        )}
        <Button kind="primary" size="sm" onClick={onNext}>
          {atEnd ? "Take it from here" : "Next"}
        </Button>
      </div>
    </div>
  );
}
