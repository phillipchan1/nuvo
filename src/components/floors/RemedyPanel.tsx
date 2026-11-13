// RemedyPanel — "here's what's wrong with this row, and the acts that resolve
// it." Lifted out of the Sunday ritual so the two surfaces that name a problem
// with a project's week can't drift: D-039 decided the *acts and their wording*
// ("Give it another week" / "Move it to next week"), and copy drifts fastest
// when it lives in two places. What differs by caller is the sentence, so that's
// the seam: shared shell, caller-supplied problem.
//
// The acts are ALWAYS visible and ≥44px under a finger (P13) — kit buttons
// with the `.tap` floor — because this panel renders inside the phone's
// Week's Plan sheet and slot sheet as well as on the desktop.

import type { ReactNode } from "react";
import { Button } from "../kit";

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
  tone = "problem",
}: {
  /** the problem in one sentence — stated, never scolded (P4) */
  problem: ReactNode;
  /** …and why, in the composer's own words, when there is one */
  why?: ReactNode;
  acts: RemedyAct[];
  /** `problem` is the app naming something wrong with the row. `asked` is the
   *  same acts opened by YOU ("can't get to this") — nothing is wrong, so it
   *  wears no tint. */
  tone?: "problem" | "asked";
}) {
  const asked = tone === "asked";
  return (
    <div className="fl-panel mb-2" style={asked ? undefined : { background: "var(--sunk)", boxShadow: "inset 0 0 0 1px var(--line-1)" }}>
      <div className="text-body" style={{ color: "var(--ink)", fontWeight: asked ? 450 : 500 }}>
        {problem}
      </div>
      {why && <p className="fl-note">{why}</p>}
      {acts.length > 0 && (
        <div className="fl-work-row">
          {acts.map((a) => (
            <Button
              key={a.label}
              kind={a.quiet ? "ghost" : "secondary"}
              size="sm"
              className="tap"
              onClick={a.onPress}
              title={a.title}
            >
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
