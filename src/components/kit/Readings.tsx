// Readings (D-209) — the marks every planner altitude reads through, and the
// day above them. docs/readiness-ladder.md; every state at `?kit`.
//
//   Stop       the ember full stop a title earns when its altitude is ready
//   MarkBar    one bar of pieces, one piece per real thing
//   Dial       one ring, one colour, fill means yes (D-219)
//   MarkSet    three dials side by side — shaped · given time · the run — each
//              label carrying its definition, and under it what's left, which
//              is the button that opens it
//   DayCrown   "Today." — the day's bar, and the hour you got back
//
// Motion only on a transition this part watched happen (never on mount, so a
// page opening is still), transform and opacity only (lib/celebrate.ts).

import { memo, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { advanceSegment, play, reachArrivalDelay } from "../../lib/motion";
import { bump, closeDial, closeRing, dropStop, pop, stepRing, type FinishTier } from "../../lib/celebrate";
import { haptic } from "../../lib/haptics";
import { MARK_DEFS, markTitle, spanWords, type DayRead, type Mark, type MarkKey, type MarkPiece } from "../../lib/marks";
import { cx } from "./cx";

/** The previous value, or null on the first render. */
function usePrev<T>(v: T): T | null {
  const ref = useRef<T | null>(null);
  const prev = ref.current;
  useLayoutEffect(() => {
    ref.current = v;
  });
  return prev;
}

const RANK: Record<MarkPiece["state"], number> = { empty: 0, soft: 1, other: 2, fill: 2 };
/** Past this, pieces stop being countable and the bar draws runs. */
const PIECE_CEILING = 40;

// ── the stop ────────────────────────────────────────────────────────────────

export function Stop({ on, className }: { on: boolean; className?: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const prev = usePrev(on);
  useLayoutEffect(() => {
    if (prev === false && on) dropStop(ref.current, 120);
  }, [on, prev]);
  // Always mounted, so the title never reflows when it lands (D-123).
  return <span ref={ref} className={cx("k-stop", className)} data-on={on ? "" : undefined} aria-hidden />;
}

// ── one bar ─────────────────────────────────────────────────────────────────

function fillOf(p: MarkPiece): string | undefined {
  if (p.state === "fill") return p.color;
  if (p.state === "soft") return `color-mix(in srgb, ${p.color} 55%, var(--line))`;
  if (p.state === "other") return "color-mix(in srgb, var(--muted) 50%, var(--line))";
  return undefined;
}

export function MarkBar({
  pieces,
  thin = false,
  reachKey,
  barRef,
  attrs,
  label,
}: {
  pieces: readonly MarkPiece[];
  thin?: boolean;
  /** hold the Advance until a Reach in flight to this key lands */
  reachKey?: string;
  barRef?: (el: HTMLSpanElement | null) => void;
  /** `data-*` the Reach lands on */
  attrs?: Record<string, string>;
  label?: string;
}) {
  const segs = useRef<(HTMLSpanElement | null)[]>([]);
  const sig = pieces.map((p) => p.state).join(",");
  const prev = usePrev(sig);
  useLayoutEffect(() => {
    if (prev === null || prev === sig) return;
    const was = prev ? prev.split(",") : [];
    const now = sig ? sig.split(",") : [];
    const wait = reachArrivalDelay(reachKey);
    let nth = 0;
    let grew = false;
    now.forEach((s, i) => {
      const before = (was[i] ?? "empty") as MarkPiece["state"];
      if (RANK[s as MarkPiece["state"]] > RANK[before]) {
        advanceSegment(segs.current[i], nth, wait);
        pop(segs.current[i]?.parentElement, wait + nth * 72 + 120);
        nth++;
        grew = true;
      }
    });
    if (grew) setTimeout(() => haptic("light"), wait);
  }, [sig, prev, reachKey]);

  if (pieces.length === 0) return <span className={cx("k-markbar", thin && "k-markbar-thin")} data-empty="" {...attrs} />;
  const segmented = pieces.length <= PIECE_CEILING;
  return (
    <span
      ref={barRef}
      className={cx("k-markbar", thin && "k-markbar-thin")}
      role="img"
      aria-label={label}
      {...attrs}
      style={{ gap: segmented ? undefined : 0 }}
    >
      {pieces.map((p, i) => (
        <span key={i} className="k-markpiece" data-state={p.state}>
          <span
            ref={(el) => {
              segs.current[i] = el;
            }}
            className="k-markfill"
            style={{ background: fillOf(p), transform: p.state === "empty" ? "scaleX(0)" : undefined }}
          />
        </span>
      ))}
    </span>
  );
}

// ── the label that carries its definition ───────────────────────────────────

export function MarkLabel({ k, children, onDefine }: { k: MarkKey; children: ReactNode; onDefine?: (k: MarkKey) => void }) {
  // The words ride `title`, so the native-feel tooltip shows them on hover and
  // a screen reader reads them; a tap (no hover) says them inline instead —
  // no definition is hover-only (CLAUDE.md, mobile rule 4).
  return (
    <span
      className="k-mark-k"
      title={markTitle(k)}
      tabIndex={0}
      role="button"
      aria-label={markTitle(k)}
      onClick={() => onDefine?.(k)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onDefine?.(k);
        }
      }}
    >
      {children}
    </span>
  );
}

function useCoarse(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(hover: none)").matches === true;
}

/** The definition a tap opened (touch only; hover has the tooltip). */
function useDefine() {
  const coarse = useCoarse();
  const [open, setOpen] = useState<MarkKey | null>(null);
  const onDefine = (k: MarkKey) => {
    if (!coarse) return;
    setOpen((o) => (o === k ? null : k));
  };
  const def = open ? MARK_DEFS[open] : null;
  const node = def ? (
    <p className="k-mark-def" role="note">
      <b>{def.name}.</b> {def.counts} <span>{def.closes}</span>
    </p>
  ) : null;
  return { onDefine, node };
}

// ── the dial (D-219) ────────────────────────────────────────────────────────

/** One ring that fills in ONE colour — fill means yes. Empty is just empty (no
 *  second colour to decode), and a closed ring turns `--ok` with a ✓. */
export function Dial({
  frac,
  closed,
  size = 64,
  stroke,
  children,
  ringRef,
  attrs,
}: {
  frac: number;
  closed: boolean;
  size?: number;
  stroke?: number;
  children?: ReactNode;
  ringRef?: (el: HTMLSpanElement | null) => void;
  attrs?: Record<string, string>;
}) {
  const w = stroke ?? Math.max(2.5, Math.round(size / 8));
  const r = (size - w) / 2;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, frac));
  return (
    <span ref={ringRef} className="k-dial-ring" data-closed={closed ? "" : undefined} style={{ width: size, height: size }} {...attrs}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle className="k-dial-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={w} />
        {f > 0 && <circle
          className="k-dial-arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={w}
          strokeDasharray={`${f * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />}
      </svg>
      {children != null && <span className="k-dial-mid">{children}</span>}
    </span>
  );
}

// ── three dials ─────────────────────────────────────────────────────────────

const valueOf = (m: Mark) => (m.key === "fits" ? `${m.n}h` : `${m.n}/${m.of}`);

export const MarkSet = memo(function MarkSet({
  marks,
  attrsFor,
  acts,
  reachKeyFor,
}: {
  marks: readonly Mark[];
  attrsFor?: (k: MarkKey) => Record<string, string> | undefined;
  /** the dials whose "what's left" opens something — that line is then the
   *  button. A dial with no act here just says it (Done is the run). */
  acts?: Partial<Record<MarkKey, () => void>>;
  /** hold a dial's motion until a Reach in flight to this key lands */
  reachKeyFor?: (k: MarkKey) => string | undefined;
  thin?: boolean;
}) {
  const rings = useRef(new Map<MarkKey, HTMLSpanElement | null>());
  // Motion answers the hand (D-219): every step a dial takes swells it with a
  // light tap — the click a piece used to give — and a dial that closes gets
  // its lock (`closeDial`). Only on a change this part watched; never on mount.
  const sig = marks.map((m) => `${m.n}/${m.of}/${m.full ? 1 : 0}`).join(",");
  const prev = usePrev(sig);
  useLayoutEffect(() => {
    if (prev === null || prev === sig) return;
    const was = prev.split(",").map((x) => x.split("/").map(Number));
    marks.forEach((m, i) => {
      const [n0 = 0, , f0 = 0] = was[i] ?? [];
      const el = rings.current.get(m.key) ?? null;
      const wait = reachArrivalDelay(reachKeyFor?.(m.key));
      if (m.full && !f0) closeDial(el, m.tier, wait);
      else if (m.n > n0) {
        bump(el, wait, 1.08);
        setTimeout(() => haptic("light"), wait);
      }
    });
  }, [sig, prev, marks, reachKeyFor]);
  const { onDefine, node } = useDefine();
  return (
    <div className="k-markset">
      <div className="k-dials">
        {marks.map((m) => {
          const frac = m.of > 0 ? m.n / m.of : 0;
          const act = !m.full && m.todo ? acts?.[m.key] : undefined;
          return (
            <div key={m.key} className="k-dial" data-full={m.full ? "" : undefined} data-mark={m.key}>
              <Dial
                frac={frac}
                closed={m.full}
                attrs={attrsFor?.(m.key)}
                ringRef={(el) => {
                  rings.current.set(m.key, el);
                }}
              >
                {m.full ? "\u2713" : valueOf(m)}
              </Dial>
              <MarkLabel k={m.key} onDefine={onDefine}>
                {m.label}
              </MarkLabel>
              {m.full ? (
                <span className="k-dial-todo" data-done="">All set</span>
              ) : act ? (
                <button type="button" className="k-dial-todo" data-act="" onClick={act}>
                  {m.todo}
                </button>
              ) : (
                <span className="k-dial-todo">{m.todo ?? ""}</span>
              )}
            </div>
          );
        })}
      </div>
      {node}
    </div>
  );
});

// ── the day ─────────────────────────────────────────────────────────────────

/** "3:04pm" — the clock vocabulary the calendar speaks (dayPlan's `at`). */
function clock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const hh = h % 12 || 12;
  return `${hh}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

/** **The finish ring** (D-231) — one mark for the unit you can finish now: a
 *  day, a week's projects, a quarter's bets. Two arcs: the faint outer one is
 *  what has its time (scheduled · held · moving), the solid inner one what is
 *  done. Each finish under it steps it; the unit closing is the moment — the
 *  ring swells and rings, a check draws in, sparks fly — sized by `tier`.
 *  Motion only on a change this part watched, never on mount. */
export function FinishRing({
  outer,
  inner,
  n,
  of,
  closed,
  tier,
  size = 72,
}: {
  /** what has its time, 0–1; null draws the inner arc alone */
  outer: number | null;
  /** what is done, 0–1 */
  inner: number;
  n: number;
  of: number;
  closed: boolean;
  tier: FinishTier;
  size?: number;
}) {
  const el = useRef<HTMLSpanElement | null>(null);
  const was = usePrev(`${n}/${closed ? 1 : 0}`);
  useLayoutEffect(() => {
    if (was === null) return;
    const [n0, c0] = was.split("/").map(Number);
    if (closed && !c0) closeRing(el.current, tier);
    else if (n > n0) stepRing(el.current);
  }, [n, closed, was, tier]);
  const c = size / 2;
  const wo = Math.max(3, Math.round(size / 16));
  const wi = Math.max(5, Math.round(size / 10));
  const ro = c - wo / 2;
  const ri = outer == null ? c - wi / 2 : ro - wo / 2 - 2.5 - wi / 2;
  const arc = (r: number, f: number) => `${Math.max(0, Math.min(1, f)) * 2 * Math.PI * r} ${2 * Math.PI * r}`;
  const rot = `rotate(-90 ${c} ${c})`;
  const ck = size * 0.12;
  return (
    <span ref={el} className="k-finish" data-closed={closed ? "" : undefined} data-tier={tier} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden>
        {outer != null && (
          <>
            <circle className="k-dial-track" cx={c} cy={c} r={ro} strokeWidth={wo} />
            {outer > 0 && <circle className="k-finish-out" cx={c} cy={c} r={ro} strokeWidth={wo} strokeDasharray={arc(ro, outer)} transform={rot} />}
          </>
        )}
        <circle className="k-dial-track" cx={c} cy={c} r={ri} strokeWidth={wi} />
        {inner > 0 && <circle className="k-finish-in" cx={c} cy={c} r={ri} strokeWidth={wi} strokeDasharray={arc(ri, inner)} transform={rot} />}
        <path className="k-finish-check" d={`M${c - ck * 1.1} ${c + ck * 0.05} l${ck * 0.75} ${ck * 0.75} l${ck * 1.45} -${ck * 1.5}`} pathLength={1} />
      </svg>
      <span className="k-finish-mid">{n}/{of}</span>
    </span>
  );
}

/** **The unit crown** (D-231) — a rail's hero at any altitude: the finish ring
 *  beside the unit's name (with its ember stop), one line of what's next or
 *  how it closed, and — while some of it has no time — the act that finds it.
 *  The Schedule's Today, the project deck's This week, the initiative deck's
 *  This quarter: one shape, three clock speeds. */
export const UnitCrown = memo(function UnitCrown({
  title,
  outer,
  n,
  of,
  closed,
  said,
  todo,
  tier,
  attrs,
}: {
  title: string;
  outer: number | null;
  n: number;
  of: number;
  closed: boolean;
  said: string;
  todo?: { label: string; run: () => void } | null;
  tier: FinishTier;
  attrs?: Record<string, string>;
}) {
  const line = useRef<HTMLParagraphElement | null>(null);
  const prev = usePrev(closed);
  useLayoutEffect(() => {
    if (prev !== false || !closed) return;
    // how it closed rises in after the ring has had its moment
    play(line.current, [{ transform: "translateY(6px)", opacity: 0 }, { transform: "none", opacity: 1 }], "--d-land", "--ease-land", 520);
  }, [closed, prev]);
  return (
    <div className="k-unit" data-closed={closed ? "" : undefined} {...attrs}>
      <FinishRing outer={outer} inner={of > 0 ? n / of : 0} n={n} of={of} closed={closed} tier={tier} />
      <div className="k-unit-text">
        <h2 className="k-unit-hero text-display masthead">
          {title}
          <Stop on={closed} />
        </h2>
        {said && (
          <p ref={line} className="k-unit-line" aria-live="polite">
            {said}
          </p>
        )}
        {todo && !closed && (
          <button type="button" className="k-dial-todo k-unit-todo" data-act="" onClick={todo.run}>
            {todo.label}
          </button>
        )}
      </div>
    </div>
  );
});

/** The day (D-209, D-231): today's own tasks as a finish ring — scheduled
 *  outside, done inside — closed the moment the last one is, with the hour you
 *  got back. */
export const DayCrown = memo(function DayCrown({
  day,
  next,
  loose,
  attrs,
}: {
  day: DayRead;
  /** what's next, in words ("Measure wall at 4pm"), while the day is open */
  next?: string | null;
  /** today's tasks with no time yet, and the act that finds them */
  loose?: { n: number; run: () => void } | null;
  attrs?: Record<string, string>;
}) {
  const timed = day.tasks.filter((t) => t.start_time || t.slot_id || t.status === "done").length;
  const said = day.closed
    ? day.closedAtDate
      ? day.backMins
        ? `Done at ${clock(day.closedAtDate)}. ${spanWords(day.backMins)} of your day back.`
        : `Done at ${clock(day.closedAtDate)}.`
      : "Done."
    : next
      ? `Next: ${next}`
      : "";
  return (
    <UnitCrown
      title="Today"
      outer={day.total > 0 ? timed / day.total : 0}
      n={day.done}
      of={day.total}
      closed={day.closed}
      said={said}
      todo={loose && loose.n > 0 ? { label: `${loose.n} ${loose.n === 1 ? "needs" : "need"} a time`, run: loose.run } : null}
      tier="day"
      attrs={{ "data-crown-day": "", ...attrs }}
    />
  );
});
