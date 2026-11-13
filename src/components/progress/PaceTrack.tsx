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
//   WeekTrack — the WEEK as one track (D-206): a piece per slate task, done
//               toward an initiative · done, other · placed · no time, the
//               week's pace tick, and one number. The crown header's drawing.
//   SlatePips — the week: one pip per project in its domain's hue, filled when
//               it landed. A pip filling under your hand LANDS.
//
// Motion is forward only and only after mount: the first render draws the
// state as it is (data arriving is not progress), an increase plays ADVANCE,
// a decrease (undo, reopen) snaps.

import { useLayoutEffect, useRef } from "react";
import { WEEK_REACH_KEY, advanceFill, advanceSegment, landMark, reachArrivalDelay } from "../../lib/motion";
import { weekTrackPieces, type WeekPiece, type WeekTrack as WeekTrackModel } from "../../lib/weekTrack";
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

/** The PLACED state's tint: the domain's hue, thinned over the rail. A time is
 *  a promise, not a result — it must never read as done (D-202 §5.1). (Not
 *  exported, for the same Fast Refresh reason as PIP_CEILING.) */
function placedTint(color: string): string {
  return `color-mix(in srgb, ${color} 55%, var(--line))`;
}

export function PaceTrack({
  done,
  total,
  color,
  placed = 0,
  elapsed = null,
  width,
  reachKey,
}: {
  done: number;
  total: number;
  /** the domain's hue — the fill is that world's work */
  color: string;
  /** Open pieces that HAVE a time this week (D-202): drawn tinted between the
   *  done pieces and the loose ones. The pace tick still compares only DONE —
   *  placing isn't progress on pace (P6). Omitted, the track draws two states
   *  (done · not), as before. */
  placed?: number;
  /** 0–1 through the project's span (`WeekCrownRow.elapsed`), or null */
  elapsed?: number | null;
  /** px; defaults to the piece count's natural width */
  width?: number;
  /** the project this track stands for — a Reach in flight to it (D-202)
   *  holds the Advance until the mark arrives */
  reachKey?: string;
}) {
  const segmented = total > 0 && total <= PIP_CEILING;
  const segs = useRef<(HTMLSpanElement | null)[]>([]);
  const fill = useRef<HTMLSpanElement | null>(null);
  const placedFill = useRef<HTMLSpanElement | null>(null);
  const doneN = Math.max(0, Math.min(done, total));
  // Never more placed than there is open work to place — the two counts come
  // from different reads (the vertical and the week's blocks).
  const placedN = Math.max(0, Math.min(placed, total - doneN));
  const reached = doneN + placedN;
  const prev = usePrevious(`${doneN}:${placedN}`);

  useLayoutEffect(() => {
    if (prev === null) return;
    const [pd, pp] = prev.split(":").map(Number);
    const prevReached = pd + pp;
    if (doneN <= pd && reached <= prevReached) return; // unchanged, or an undo — snaps
    const wait = reachArrivalDelay(reachKey);
    if (segmented) {
      // Pieces that became done, then pieces that became placed: each grows in
      // once, from its left edge, in order (forward only).
      let nth = 0;
      for (let i = pd; i < doneN; i++) advanceSegment(segs.current[i], nth++, wait);
      for (let i = Math.max(doneN, prevReached); i < reached; i++) advanceSegment(segs.current[i], nth++, wait);
    } else {
      if (doneN > pd) advanceFill(fill.current, pd / total, doneN / total);
      if (reached > prevReached) advanceFill(placedFill.current, prevReached / total, reached / total);
    }
  }, [doneN, reached, prev, segmented, total, reachKey]);

  if (total === 0) return null;
  const w = width ?? (segmented ? Math.min(96, Math.max(32, total * 9)) : 64);
  const frac = Math.min(1, doneN / total);
  const tick = elapsed == null ? null : Math.max(0, Math.min(1, elapsed));
  const tint = placedTint(color);
  const title =
    `${doneN} of ${total} done` +
    (placedN > 0 ? ` · ${placedN} placed` : "") +
    (tick == null ? "" : ` · ${Math.round(tick * 100)}% of its time gone`);

  return (
    <span className="pace-track shrink-0" style={{ width: w, gap: segmented ? 2 : 0 }} title={title} aria-hidden>
      {segmented ? (
        Array.from({ length: total }, (_, i) => {
          const state = i < doneN ? "done" : i < reached ? "placed" : "loose";
          return (
            <span key={i} className="pace-seg" data-piece={state} style={{ flex: "1 1 0" }}>
              <span
                ref={(el) => {
                  segs.current[i] = el;
                }}
                className="pace-fill"
                style={{
                  background: state === "placed" ? tint : color,
                  transform: state === "loose" ? "scaleX(0)" : undefined,
                }}
              />
            </span>
          );
        })
      ) : (
        <span className="pace-rail" style={{ width: "100%", position: "relative" }}>
          {placedN > 0 && (
            <span
              ref={placedFill}
              className="pace-fill"
              data-piece="placed"
              style={{ position: "absolute", inset: "0 auto 0 0", background: tint, width: `${(reached / total) * 100}%` }}
            />
          )}
          <span
            ref={fill}
            className="pace-fill"
            data-piece="done"
            style={{ position: "relative", background: color, width: `${frac * 100}%` }}
          />
        </span>
      )}
      {tick != null && <span className="pace-now" style={{ left: `${tick * 100}%` }} />}
    </span>
  );
}

// ── the week ────────────────────────────────────────────────────────────────

/** How far along a piece is — a piece only ever ADVANCES to a higher rank. */
const RANK: Record<WeekPiece, number> = { "no-time": 0, placed: 1, "done-other": 2, "done-initiative": 2, done: 2 };
const RUN_KINDS: WeekPiece[] = ["done-initiative", "done-other", "done", "placed"];

/** A piece's fill. Done toward an initiative is the intent's own colour
 *  (`--landed`); done, other is quiet solid structure (never `--warn`: other
 *  work is not a fault, P4); placed is the tint (a time is a promise, not a
 *  result); no time has no fill — its amber outline is the CSS's. */
function pieceFill(p: WeekPiece): string | undefined {
  if (p === "done-initiative" || p === "done") return "var(--landed)";
  if (p === "done-other") return "var(--faint)";
  if (p === "placed") return placedTint("var(--landed)");
  return undefined;
}

export function WeekTrack({ track, className = "" }: { track: WeekTrackModel; className?: string }) {
  const pieces = weekTrackPieces(track);
  const total = pieces.length;
  const segmented = total > 0 && total <= PIP_CEILING;
  const segs = useRef<(HTMLSpanElement | null)[]>([]);
  const runs = useRef(new Map<WeekPiece, HTMLSpanElement | null>());
  const sig = pieces.join(",");
  const prev = usePrevious(sig);

  useLayoutEffect(() => {
    if (prev === null || prev === sig) return;
    const was = (prev ? prev.split(",") : []) as WeekPiece[];
    const now = (sig ? sig.split(",") : []) as WeekPiece[];
    const wait = reachArrivalDelay(WEEK_REACH_KEY);
    if (now.length > 0 && now.length <= PIP_CEILING) {
      // A piece that moved up a state grows in from its left edge, in order —
      // forward only; an undo snaps.
      let nth = 0;
      now.forEach((p, i) => {
        if (RANK[p] > 0 && RANK[p] > (was[i] ? RANK[was[i]] : 0)) advanceSegment(segs.current[i], nth++, wait);
      });
      return;
    }
    // Fill mode: a run that grew advances from its old length to its new one.
    const count = (list: readonly WeekPiece[], k: WeekPiece) => list.reduce((n, x) => n + (x === k ? 1 : 0), 0);
    for (const k of RUN_KINDS) {
      const a = count(was, k);
      const b = count(now, k);
      if (b > a) advanceFill(runs.current.get(k), a, b);
    }
  }, [sig, prev]);

  if (total === 0) return null;
  const tick = track.elapsed == null ? null : Math.max(0, Math.min(1, track.elapsed));
  const runsInOrder: { k: WeekPiece; n: number; at: number }[] = [];
  pieces.forEach((p, i) => {
    const last = runsInOrder[runsInOrder.length - 1];
    if (last && last.k === p) last.n++;
    else runsInOrder.push({ k: p, n: 1, at: i });
  });

  return (
    <span
      className={`pace-track week-track ${className}`}
      style={{ gap: segmented ? 2 : 0 }}
      role="img"
      aria-label={track.label}
      title={track.label}
      // The Reach's landing for an act that changes the WEEK (D-206).
      data-crown-week=""
      data-crown-color="var(--landed)"
    >
      {segmented ? (
        pieces.map((p, i) => (
          <span key={i} className="pace-seg" data-piece={p} style={{ flex: "1 1 0" }}>
            <span
              ref={(el) => {
                segs.current[i] = el;
              }}
              className="pace-fill"
              style={{ background: pieceFill(p), transform: p === "no-time" ? "scaleX(0)" : undefined }}
            />
          </span>
        ))
      ) : (
        <span className="pace-rail" style={{ width: "100%", position: "relative" }}>
          {runsInOrder.map((r) => (
            <span
              key={r.k}
              ref={(el) => {
                runs.current.set(r.k, el);
              }}
              className="pace-run"
              data-piece={r.k}
              style={{
                left: `${(r.at / total) * 100}%`,
                width: `${(r.n / total) * 100}%`,
                background: pieceFill(r.k),
              }}
            />
          ))}
        </span>
      )}
      {tick != null && <span className="pace-now" style={{ left: `${tick * 100}%` }} />}
    </span>
  );
}

const isLanded = (r: WeekCrownRow) => r.state === "landed" || r.state === "shipped";

export function SlatePips({
  rows,
  allPlaced,
}: {
  rows: WeekCrownRow[];
  /** Projects whose every open piece has a time (or is held in a plan's draft)
   *  — drawn TINTED, the PaceTrack's placed state at pip size (D-202 §5.1.4):
   *  hollow · all placed · landed. A pip that becomes all-placed under your
   *  hand lands once, after any Reach in flight to it arrives. Omitted, a pip
   *  is hollow or landed, as before. */
  allPlaced?: ReadonlySet<string>;
}) {
  const pips = useRef(new Map<string, HTMLSpanElement | null>());
  const meter = useRef<HTMLSpanElement | null>(null);
  const landedIds = rows.filter(isLanded).map((r) => r.rock.id);
  const key = landedIds.join(",");
  const prevKey = usePrevious(key);
  const placedKey = allPlaced ? rows.filter((r) => !isLanded(r) && allPlaced.has(r.projectId)).map((r) => r.projectId).join(",") : "";
  const prevPlacedKey = usePrevious(placedKey);

  useLayoutEffect(() => {
    if (prevPlacedKey === null || prevPlacedKey === placedKey || rows.length > PIP_CEILING) return;
    const before = new Set(prevPlacedKey ? prevPlacedKey.split(",") : []);
    for (const id of placedKey ? placedKey.split(",") : []) {
      if (before.has(id)) continue;
      const row = rows.find((r) => r.projectId === id);
      if (row) landMark(pips.current.get(row.rock.id), 0.4, reachArrivalDelay(id));
    }
  }, [placedKey, prevPlacedKey, rows]);

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
        const tinted = !on && Boolean(allPlaced?.has(r.projectId));
        return (
          <span
            key={r.rock.id}
            ref={(el) => {
              pips.current.set(r.rock.id, el);
            }}
            // The Reach's landing when the crown is shut (D-202).
            data-crown-project={r.projectId}
            data-crown-color={r.color}
            data-pip={on ? "landed" : tinted ? "placed" : "open"}
            // The kit's Dot geometry (8px, 2.5px corner): the project's
            // identity, hollow until it lands.
            className="slate-pip"
            style={{
              background: on ? r.color : tinted ? placedTint(r.color) : "transparent",
              // A ring drawn with an inset shadow, so a hollow pip and a filled
              // one occupy exactly the same box — a border would nudge the row.
              boxShadow: on ? undefined : `inset 0 0 0 1.5px color-mix(in srgb, ${r.color} 55%, transparent)`,
            }}
          />
        );
      })}
    </span>
  );
}
