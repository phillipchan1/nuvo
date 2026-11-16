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
import { closeMark, dropStop, pop, ring } from "../../lib/celebrate";
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
}: {
  marks: readonly Mark[];
  attrsFor?: (k: MarkKey) => Record<string, string> | undefined;
  /** the dials whose "what's left" opens something — that line is then the
   *  button. A dial with no act here just says it (Done is the run). */
  acts?: Partial<Record<MarkKey, () => void>>;
  /** kept for callers that still pass them; dials have no pieces to advance */
  reachKeyFor?: (k: MarkKey) => string | undefined;
  thin?: boolean;
}) {
  const rings = useRef(new Map<MarkKey, HTMLSpanElement | null>());
  const fullSig = marks.map((m) => (m.full ? "1" : "0")).join("");
  const prev = usePrev(fullSig);
  useLayoutEffect(() => {
    if (prev === null || prev === fullSig) return;
    marks.forEach((m, i) => {
      if (m.full && prev[i] === "0") closeMark(rings.current.get(m.key) ?? null, m.tier);
    });
  }, [fullSig, prev, marks]);
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

export const DayCrown = memo(function DayCrown({
  day,
  next,
  attrs,
}: {
  day: DayRead;
  /** what's next, in words ("Measure wall at 4pm"), while the day is open */
  next?: string | null;
  attrs?: Record<string, string>;
}) {
  const hero = useRef<HTMLHeadingElement | null>(null);
  const line = useRef<HTMLParagraphElement | null>(null);
  const prev = usePrev(day.closed);
  const { onDefine, node } = useDefine();
  useLayoutEffect(() => {
    if (prev !== false || !day.closed) return;
    // The day closed under your hand: the hero pops and rings, the stop drops
    // (Stop plays itself), the hour you got back rises in.
    pop(hero.current, 120);
    ring(hero.current, 260);
    haptic("success");
    play(line.current, [{ transform: "translateY(6px)", opacity: 0 }, { transform: "none", opacity: 1 }], "--d-land", "--ease-land", 520);
  }, [day.closed, prev]);

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
    <div className="k-day" data-closed={day.closed ? "" : undefined} data-crown-day="" {...attrs}>
      <div className="k-day-head">
        <h2 ref={hero} className="k-day-hero text-display masthead">
          Today
          <Stop on={day.closed} />
        </h2>
        <MarkLabel k="day" onDefine={onDefine}>
          {day.closed ? "All done" : `${day.done} of ${day.total} done`}
        </MarkLabel>
      </div>
      {said && (
        <p ref={line} className="k-day-line" aria-live="polite">
          {said}
        </p>
      )}
      {node}
    </div>
  );
});
