// Readings (D-209) — the marks every planner altitude reads through, and the
// day above them. docs/readiness-ladder.md; every state at `?kit`.
//
//   Stop       the ember full stop a title earns when its altitude is ready
//   MarkBar    one bar of pieces, one piece per real thing
//   MarkSet    three marks side by side — shaped · given time · the run — each
//              label carrying its definition (hover, focus, or a tap)
//   DayCrown   "Today." — the day's bar, and the hour you got back
//
// Motion only on a transition this part watched happen (never on mount, so a
// page opening is still), transform and opacity only (lib/celebrate.ts).

import { memo, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { advanceSegment, play, reachArrivalDelay } from "../../lib/motion";
import { closeMark, dropStop, pop, ring, sweep } from "../../lib/celebrate";
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

// ── three marks ─────────────────────────────────────────────────────────────

export const MarkSet = memo(function MarkSet({
  marks,
  attrsFor,
  reachKeyFor,
  thin = false,
}: {
  marks: readonly Mark[];
  attrsFor?: (k: MarkKey) => Record<string, string> | undefined;
  reachKeyFor?: (k: MarkKey) => string | undefined;
  thin?: boolean;
}) {
  const bars = useRef(new Map<MarkKey, HTMLSpanElement | null>());
  const fullSig = marks.map((m) => (m.full ? "1" : "0")).join("");
  const prev = usePrev(fullSig);
  useLayoutEffect(() => {
    if (prev === null || prev === fullSig) return;
    marks.forEach((m, i) => {
      if (m.full && prev[i] === "0") closeMark(bars.current.get(m.key) ?? null, m.tier);
    });
  }, [fullSig, prev, marks]);
  const { onDefine, node } = useDefine();
  const detail = marks.find((m) => m.detail)?.detail;
  return (
    <div className="k-markset">
      <div className="k-markset-cols">
        {marks.map((m) => (
          <div key={m.key} className="k-mark" data-full={m.full ? "" : undefined} data-mark={m.key}>
            <div className="k-mark-head">
              <MarkLabel k={m.key} onDefine={onDefine}>
                {m.label}
              </MarkLabel>
              <span className="k-mark-v">
                <b>{m.key === "fits" ? `${m.n}h` : m.n}</b>/{m.key === "fits" ? `${m.of}h` : m.of}
              </span>
            </div>
            <MarkBar
              pieces={m.pieces}
              thin={thin}
              reachKey={reachKeyFor?.(m.key)}
              attrs={attrsFor?.(m.key)}
              label={`${m.label}: ${m.n} of ${m.of}`}
              barRef={(el) => {
                bars.current.set(m.key, el);
              }}
            />
          </div>
        ))}
      </div>
      {detail && <p className="k-markset-detail">{detail}</p>}
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
  pieces,
  next,
  attrs,
}: {
  day: DayRead;
  pieces: MarkPiece[];
  /** what's next, in words ("Measure wall at 4pm"), while the day is open */
  next?: string | null;
  attrs?: Record<string, string>;
}) {
  const bar = useRef<HTMLSpanElement | null>(null);
  const line = useRef<HTMLParagraphElement | null>(null);
  const prev = usePrev(day.closed);
  const { onDefine, node } = useDefine();
  useLayoutEffect(() => {
    if (prev !== false || !day.closed) return;
    // The day closed under your hand: the bar sweeps and rings, the stop drops
    // (Stop plays itself), the hour you got back rises in.
    sweep(bar.current, 200);
    ring(bar.current, 380);
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
    <div className="k-day" data-closed={day.closed ? "" : undefined}>
      <div className="k-day-head">
        <h2 className="k-day-hero text-display masthead">
          Today
          <Stop on={day.closed} />
        </h2>
        <MarkLabel k="day" onDefine={onDefine}>
          {day.total === 0 ? "Nothing dated today" : day.closed ? "All done" : `${day.done} of ${day.total} done`}
        </MarkLabel>
      </div>
      {day.total > 0 && (
        <MarkBar
          pieces={pieces}
          label={`Today: ${day.done} of ${day.total} done`}
          attrs={{ "data-crown-day": "", ...(attrs ?? {}) }}
          barRef={(el) => {
            bar.current = el;
          }}
        />
      )}
      {said && (
        <p ref={line} className="k-day-line" aria-live="polite">
          {said}
        </p>
      )}
      {node}
    </div>
  );
});
