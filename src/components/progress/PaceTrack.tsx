// The week's two progress marks, drawn ONCE for both shells (D-187).
//
// The Schedule rail's crown (`WeekPanel`) and the phone's Calendar crown
// (`MobileWeekCrown`) used to each draw their own: the rail a row of 5px pips
// per project, the phone a 40px bar — one fact, two drawings, and two copies of
// the slate's pips. They are one component now, so the motion that makes
// progress feel like progress (a piece landing, a fill advancing, a project's
// pip filling) can't exist on one shell and not the other.
//
// Both compute nothing: they draw a `WeekCrownRow` from `useWeekCrown`.
//
//   PaceTrack — a project's work: a track of pieces (≤10) or a continuous fill,
//               plus the PACE TICK — `--pace-tick` (the signal, i.e. *now*) at
//               how far the project's span has run. Fill past the tick is
//               ahead, short of it is behind; no word says so and nothing turns
//               red (P4). A finished row has no tick.
//   SlatePips — the week: one pip per project in its domain's hue, filled when
//               it landed. A pip filling under your hand LANDS.
//
// Motion is forward only and only after mount: the first render draws the
// state as it is (data arriving is not progress), an increase plays ADVANCE,
// a decrease (undo, reopen) snaps.

import { useLayoutEffect, useRef } from "react";
import { advanceFill, advanceSegment, landMark } from "../../lib/motion";
import type { WeekCrownRow } from "../../hooks/useWeekCrown";

/** Past this many pieces, pips stop being countable at a glance and become the
 *  meter they stood in for (D-110). Shared by both crowns. (Not exported: a
 *  module that exports components AND constants breaks Fast Refresh.) */
const PIP_CEILING = 10;

/** The previous value of `v`, or null on the first render. */
function usePrevious<T>(v: T): T | null {
  const ref = useRef<T | null>(null);
  const prev = ref.current;
  useLayoutEffect(() => {
    ref.current = v;
  });
  return prev;
}

export function PaceTrack({
  done,
  total,
  color,
  elapsed = null,
  width,
}: {
  done: number;
  total: number;
  /** the domain's hue — the fill is that world's work */
  color: string;
  /** 0–1 through the project's span (`WeekCrownRow.elapsed`), or null */
  elapsed?: number | null;
  /** px; defaults to the piece count's natural width */
  width?: number;
}) {
  const segmented = total > 0 && total <= PIP_CEILING;
  const segs = useRef<(HTMLSpanElement | null)[]>([]);
  const fill = useRef<HTMLSpanElement | null>(null);
  const prev = usePrevious(done);

  useLayoutEffect(() => {
    if (prev === null || done <= prev) return;
    if (segmented) {
      for (let i = prev; i < done; i++) advanceSegment(segs.current[i], i - prev);
    } else {
      advanceFill(fill.current, prev / total, done / total);
    }
  }, [done, prev, segmented, total]);

  if (total === 0) return null;
  const w = width ?? (segmented ? Math.min(96, Math.max(32, total * 9)) : 64);
  const frac = Math.min(1, done / total);
  const tick = elapsed == null ? null : Math.max(0, Math.min(1, elapsed));
  const title =
    `${done} of ${total} done` +
    (tick == null ? "" : ` · ${Math.round(tick * 100)}% of its time gone`);

  return (
    <span className="pace-track shrink-0" style={{ width: w, gap: segmented ? 2 : 0 }} title={title} aria-hidden>
      {segmented ? (
        Array.from({ length: total }, (_, i) => (
          <span key={i} className="pace-seg" style={{ flex: "1 1 0" }}>
            <span
              ref={(el) => {
                segs.current[i] = el;
              }}
              className="pace-fill"
              style={{ background: color, transform: i < done ? undefined : "scaleX(0)" }}
            />
          </span>
        ))
      ) : (
        <span className="pace-rail" style={{ width: "100%" }}>
          <span
            ref={fill}
            className="pace-fill"
            style={{ background: color, width: `${frac * 100}%` }}
          />
        </span>
      )}
      {tick != null && <span className="pace-now" style={{ left: `${tick * 100}%` }} />}
    </span>
  );
}

const isLanded = (r: WeekCrownRow) => r.state === "landed" || r.state === "shipped";

export function SlatePips({ rows }: { rows: WeekCrownRow[] }) {
  const pips = useRef(new Map<string, HTMLSpanElement | null>());
  const meter = useRef<HTMLSpanElement | null>(null);
  const landedIds = rows.filter(isLanded).map((r) => r.rock.id);
  const key = landedIds.join(",");
  const prevKey = usePrevious(key);

  useLayoutEffect(() => {
    if (prevKey === null || prevKey === key) return;
    const before = new Set(prevKey ? prevKey.split(",") : []);
    const now = key ? key.split(",") : [];
    if (rows.length > PIP_CEILING) {
      if (now.length > before.size) advanceFill(meter.current, before.size / rows.length, now.length / rows.length);
      return;
    }
    for (const id of now) if (!before.has(id)) landMark(pips.current.get(id));
  }, [key, prevKey, rows.length]);

  if (rows.length > PIP_CEILING) {
    return (
      <span className="pace-track shrink-0" style={{ width: 64 }} aria-hidden>
        <span className="pace-rail" style={{ width: "100%" }}>
          <span
            ref={meter}
            className="pace-fill"
            style={{ width: `${(landedIds.length / rows.length) * 100}%`, background: "var(--landed)" }}
          />
        </span>
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1" aria-hidden>
      {rows.map((r) => {
        const on = isLanded(r);
        return (
          <span
            key={r.rock.id}
            ref={(el) => {
              pips.current.set(r.rock.id, el);
            }}
            className="block h-[7px] w-[7px] shrink-0 rounded-full"
            style={{
              background: on ? r.color : "transparent",
              // A ring drawn with an inset shadow, so a hollow pip and a filled
              // one occupy exactly the same 7px — a border would nudge the row.
              boxShadow: on ? undefined : `inset 0 0 0 1.5px color-mix(in srgb, ${r.color} 55%, transparent)`,
            }}
          />
        );
      })}
    </span>
  );
}
