// RemedyPanel — "here's what's wrong with this row, and the acts that resolve
// it." Lifted out of the Sunday ritual so the two surfaces that name a problem
// with a project's week can't drift: D-039 decided the *acts and their wording*
// ("Give it another week" / "Move it to next week"), and copy drifts fastest
// when it lives in two places. What differs by caller is the sentence, so that's
// the seam: shared shell, caller-supplied problem.
//
// One change from the Sunday original: the acts are ALWAYS visible and ≥44px.
// They were hover-revealed there, which is a dead end on a phone (P13) — and
// this panel now renders inside the mobile Week's Plan sheet.

import type { ReactNode } from "react";

export interface RemedyAct {
  label: string;
  /** the tooltip that explains what the act actually writes */
  title: string;
  onPress: () => void;
  /** a de-emphasized act — the one you take when you're conceding the week */
  quiet?: boolean;
}

export function RemedyPanel({
  problem,
  why,
  acts,
}: {
  /** the problem in one sentence — stated, never scolded (P4) */
  problem: ReactNode;
  /** …and why, in the composer's own words, when there is one */
  why?: ReactNode;
  acts: RemedyAct[];
}) {
  return (
    <div className="mb-2 rounded-md px-2.5 py-2" style={{ background: "var(--signal-soft)" }}>
      <div className="text-caption" style={{ color: "var(--signal)" }}>
        {problem}
      </div>
      {why && <div className="mt-0.5 text-meta text-muted">{why}</div>}
      {acts.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {acts.map((a) => (
            <button
              key={a.label}
              onClick={a.onPress}
              title={a.title}
              className={`tap fast inline-flex min-h-[44px] items-center rounded-md border border-line px-2.5 py-1 text-caption hover:border-line-strong hover:bg-surface-2 ${
                a.quiet ? "text-muted" : "text-ink"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
