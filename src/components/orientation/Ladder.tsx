import type { CSSProperties } from "react";

// The ladder — the funnel drawn as one line from what you're responsible for
// down to an hour, and the orientation's one picture (D-200).
//
// It appears twice, and the two appearances are the point:
//
//   · On the WELCOME it is mostly empty. The top rung holds the domains you
//     named on the page before — your words, your hues — and every rung below is
//     an open socket narrowing toward a single hour. It is the path you're about
//     to walk, drawn before you walk it.
//   · At the END of the walkthrough it is drawn again, filled with what you just
//     made: your task, at its time; your project; the domain it answers to. The
//     same picture, now true. A rung you haven't filled stays an open socket and
//     says what it would earn — the drawing never invents a row (P7).
//
// Each socket is narrower than the one above it. That narrowing IS the funnel:
// ambition at the top, one hour at the bottom. No labels explain it.

export type LadderAltitude = "domain" | "initiative" | "project" | "task";

export interface LadderItem {
  name: string;
  /** a domain hue — identity, never decoration */
  color?: string;
  /** one short fact after the name: the task's time */
  meta?: string;
}

export interface LadderRung {
  altitude: LadderAltitude;
  /** what's on this rung, in the user's own words. Several only on the domain rung. */
  items: LadderItem[];
}

const LABEL: Record<LadderAltitude, string> = {
  domain: "Domain",
  initiative: "Initiative",
  project: "Project",
  task: "Task",
};

// What a rung earns from the one below it (D-064's law, one word each). The
// domain earns nothing — it is always on and never finished.
const EARNS: Record<LadderAltitude, string> = {
  domain: "always on",
  initiative: "earns a quarter",
  project: "earns a week",
  task: "earns a day",
};

// The socket's width, as a share of the row. Narrowing toward the hour.
const WIDTH: Record<LadderAltitude, number> = {
  domain: 100,
  initiative: 84,
  project: 68,
  task: 52,
};

export function Ladder({
  rungs,
  size = "dock",
  hour,
}: {
  rungs: LadderRung[];
  /** `stage` sits on the welcome's ink stage; `dock` inside the walkthrough card */
  size?: "stage" | "dock";
  /** the bottom of the funnel: the hour the task landed on, or an open hour */
  hour?: { label: string; filled: boolean };
}) {
  return (
    <div className="ladder" data-size={size}>
      {rungs.map((r, i) => (
        <div key={r.altitude} className="ladder-rung" style={{ "--i": i } as CSSProperties}>
          <span className="ladder-alt">{LABEL[r.altitude]}</span>
          <div className="ladder-track">
            <div
              className="ladder-socket"
              data-filled={r.items.length > 0 || undefined}
              style={{ width: `${WIDTH[r.altitude]}%` }}
            >
              {r.items.length === 0 ? (
                <span className="ladder-earns">{EARNS[r.altitude]}</span>
              ) : (
                r.items.map((it) => (
                  <span
                    key={it.name}
                    className="ladder-item"
                    style={{ "--h": it.color ?? "var(--accent)" } as CSSProperties}
                  >
                    <span className="ladder-name">{it.name}</span>
                    {it.meta && <span className="ladder-meta">{it.meta}</span>}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      ))}
      {hour && (
        <div className="ladder-rung ladder-hour" style={{ "--i": rungs.length } as CSSProperties}>
          <span className="ladder-alt">Hour</span>
          <div className="ladder-track">
            <div className="ladder-slot" data-filled={hour.filled || undefined}>
              <span>{hour.label}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
