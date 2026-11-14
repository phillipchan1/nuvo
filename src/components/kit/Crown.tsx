// The crown (D-207, docs/rail-line.md §3) — the head of every planner page's
// rail, one part:
//
//   EYEBROW                     what this page measures ("This week · Nov 9–15")
//   13 of 17 done               the one number — the surface's hero
//   ━━━━━━━━▪▪◌◌                the track (the page brings its own)
//   ◌ fact · Get ready ›        THE LINE — the one place Nuvo speaks
//
// The Schedule (`WeekPanel`) and both decks (`PlannerRail`) wear it, so the
// three heads stop being three shapes. The line is the door to Get ready: there
// is no other button for it. Nothing to say → no line, and nothing to press.

import type { ReactNode } from "react";
import type { CrownLineData } from "../../lib/crownLine";
import { Icon } from "../Icon";

export interface CrownProps {
  eyebrow: ReactNode;
  /** a quiet control at the eyebrow's end (the decks' arrow into Groom) */
  eyebrowAction?: ReactNode;
  /** the hero: `done` of `total` `noun`, or a few words when there's nothing to count */
  done?: number;
  total?: number;
  noun?: string;
  /** what the hero says when there's nothing to count ("No projects yet") */
  empty?: ReactNode;
  /** the page's track, drawn under the hero */
  track?: ReactNode;
  /** `data-*` the Reach lands on (the track's own) */
  line?: CrownLineData | null;
  onLine?: () => void;
  /** anything that must ride under the line (the decks' grooming session) */
  children?: ReactNode;
  className?: string;
}

export function Crown({ eyebrow, eyebrowAction, done, total, noun, empty, track, line, onLine, children, className }: CrownProps) {
  const counted = total != null && total > 0;
  return (
    <div className={className ? `k-crown ${className}` : "k-crown"} data-crown="">
      <div className="k-crown-k">
        <span className="k-crown-eyebrow">{eyebrow}</span>
        <span className="k-crown-grow" />
        {eyebrowAction}
      </div>
      {counted ? (
        <h2 className="k-crown-hero text-display masthead" aria-label={`${done} of ${total} ${noun ?? ""}`.trim()}>
          {done}
          <span className="k-crown-of"> of {total}</span> {noun}
        </h2>
      ) : (
        <h2 className="k-crown-hero text-display masthead" data-empty="">
          {empty ?? "Nothing yet"}
        </h2>
      )}
      {track && <div className="k-crown-track">{track}</div>}
      {line && <CrownLine line={line} onPress={onLine} />}
      {children}
    </div>
  );
}

/** The line alone — the crown draws it; the phone's crown strip borrows it. */
export function CrownLine({ line, onPress }: { line: CrownLineData; onPress?: () => void }) {
  const body = (
    <>
      {line.glyph && (
        <span className="k-crown-line-glyph" aria-hidden>
          {line.glyph}
        </span>
      )}
      <span className="k-crown-line-text">{line.text}</span>
      <span className="k-crown-line-act">
        {line.act}
        <Icon name="chevron-right" size={12} />
      </span>
    </>
  );
  return (
    <div className="k-crown-line-wrap">
      {onPress ? (
        <button type="button" className="k-crown-line" data-tone={line.tone} data-crown-line="" onClick={onPress} aria-label={`${line.text}. ${line.act}.`}>
          {body}
        </button>
      ) : (
        <p className="k-crown-line" data-tone={line.tone} data-crown-line="">
          {body}
        </p>
      )}
      {line.then && <p className="k-crown-line-then">then: {line.then}</p>}
    </div>
  );
}
