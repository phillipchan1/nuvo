// The phone's planner deck — the desktop deck ROTATED INTO A SWIPE.
//
// Desktop lays a planner surface out horizontally: a pool of unclaimed things on
// the left, a grid of time on the right, and you drag from one into the other
// (docs/design-language.md — "Planner surfaces — one grammar, three registers").
// A phone can't shrink that grid, but it can keep the same axis: the pool is the
// FIRST page and each column of time is the next, so swiping right walks forward
// through time exactly the way the eye walks right across the desktop grid.
//
//   crown   — readiness in the execution voice (the PlannerRail crown, compact).
//   strip   — every column at once: pool · sprint · sprint · … Each cell carries
//             its load as a bar, a quiet now-band marks the current column, and
//             the cells are the DROP TARGETS while you're holding a card.
//   pager   — one page per column, snap-scrolled; the page you're on is lifted in
//             the strip.
//
// Gesture: press and hold a card → it becomes `.glass-grab` glass in your hand and
// every column lights as a target; drag to a strip cell (the pager follows so the
// destination is always shown) and release to time-box it. The tap path is always
// there too — tap a card to open its record, where the sprint picker does the same
// move without a gesture (no drag-only affordances, per the mobile golden rule).
//
// Altitude-agnostic: the projects deck passes sprints, the initiative deck passes
// quarters. Everything a rung differs on (labels, cards, what a drop writes) is a
// prop — the grammar lives here, once.

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Domain } from "../../../lib/vertical";
import InlineAdd from "../../ondeck/InlineAdd";
import { NOW_BAND, NOW_BORDER, NOW_INK, NOW_MARK } from "../../ondeck/plannerNow";
import { EDGE_GUARD_PX } from "../swipe";

// 260ms/10px picked up cards during ordinary scroll starts — a flick's first
// frames often sit still longer than 260ms with <10px of travel. 450ms with a
// wider wobble allowance only fires on a deliberate hold, and the arming ramp
// (CardShell) makes the wait legible.
const LONG_PRESS_MS = 450;
const CANCEL_PX = 14;
// The pool cell in the strip doubles as the coverage strip's label gutter, so a
// lit coverage cell sits directly under its column.
const GUTTER_PX = 46;

export interface DeckColumn {
  key: string;
  /** the strip's short identity — "Now" / "+2" / "Q3". */
  chip: string;
  /** a hairline note under the chip — "Jul 26" / "2026". */
  chipNote?: string;
  /** the page's hero — "Next week" / "Q3 2026". */
  title: string;
  /** the page's second line — "This week · Jul 26 – Aug 1". */
  when: string;
  /** how many items are committed here, and your focus cap. */
  load: number;
  cap: number;
  /** the current sprint / quarter — quiet orientation, not alarm. */
  now: boolean;
  /** optional per-page read (capacity gauge, sprint runway). */
  head?: ReactNode;
  /** optional per-page warning (the pinch sentence). */
  note?: ReactNode;
}

/** One card, on one page. A thing that spans several columns appears on each of
 *  them (same `id`) with continuation marks — the phone's echo of a desktop bar
 *  stretched across weeks. */
export interface DeckCard {
  id: string;
  /** the column it sits in; null = the pool page. */
  col: number | null;
  /** ghost identity while dragging. */
  name: string;
  dot: string;
  node: ReactNode;
  /** the span continues into the previous / next column. */
  contPrev?: boolean;
  contNext?: boolean;
}

export interface DeckCrown {
  eyebrow: string;
  done: number;
  total: number;
  noun: string;
  gap?: { label: string; detail?: string; onJump?: () => void } | null;
}

export interface DeckCoverage {
  rows: { domain: Domain; cells: number[] }[];
}

export default function MobileDeck({
  scope,
  crown,
  columns,
  cards,
  poolLabel,
  poolEmpty,
  addNoun,
  addAccent,
  onCreate,
  onMove,
  coverage,
}: {
  /** persistence scope for the coverage toggle — "project" | "initiative". */
  scope: string;
  crown: DeckCrown;
  columns: DeckColumn[];
  cards: DeckCard[];
  poolLabel: string;
  poolEmpty: ReactNode;
  addNoun: string;
  addAccent?: string;
  /** name one thing into a column — `domain` is set when the compose started from
   *  a coverage cell ("start a Church project next week"). */
  onCreate: (col: number, name: string, domain: Domain | null) => Promise<void>;
  /** a card was dropped: `col` = column index, or null to shelve it in the pool. */
  onMove: (id: string, col: number | null) => void;
  coverage?: DeckCoverage | null;
}) {
  const pagerRef = useRef<HTMLDivElement>(null);
  // Page 0 is the pool; column i is page i + 1. Open on the current column (the
  // sprint you're in), not the pool — "what now" before "what's waiting".
  const [page, setPage] = useState(() => {
    const nowIdx = columns.findIndex((c) => c.now);
    return nowIdx >= 0 ? nowIdx + 1 : 1;
  });
  const [compose, setCompose] = useState<{ col: number; domain: Domain | null } | null>(null);
  const [drag, setDrag] = useState<{ id: string; name: string; dot: string; x: number; y: number } | null>(null);
  const [target, setTarget] = useState<number | "pool" | null>(null);
  // The card being held but not yet picked up — drives the visible arming ramp
  // so the long-press wait reads as "keep holding" instead of a dead delay.
  const [arming, setArming] = useState<string | null>(null);

  // Land on the opening page once mounted (the pager starts at scrollLeft 0).
  const landed = useRef(false);
  useEffect(() => {
    const el = pagerRef.current;
    if (!el || landed.current || el.clientWidth === 0) return;
    landed.current = true;
    el.scrollTo({ left: page * el.clientWidth });
  });

  const goto = (p: number, smooth = true) => {
    const el = pagerRef.current;
    if (!el) return;
    el.scrollTo({ left: p * el.clientWidth, behavior: smooth ? "smooth" : "auto" });
    setPage(p);
  };

  const onPagerScroll = () => {
    const el = pagerRef.current;
    if (!el || el.clientWidth === 0) return;
    const p = Math.round(el.scrollLeft / el.clientWidth);
    if (p !== page) setPage(p);
  };

  // ── press-and-hold to pick up ───────────────────────────────────────────────
  // Pointer events (HTML5 DnD is swallowed by the Tauri webview and useless on
  // touch anyway). A hold with no movement means "pick this up"; any movement
  // before the hold fires is a scroll, so the deck stays swipeable. While held we
  // block touch scrolling directly — a mid-gesture `touch-action` change doesn't
  // affect a pan the browser already owns.
  const dragRef = useRef<{ id: string; from: number | null } | null>(null);
  const targetRef = useRef<number | "pool" | null>(null);

  // A card's own controls (the completion check, an auto-link chip) own their tap:
  // never start a drag, never open the record.
  const justDragged = useRef(0);

  const startPress = (e: React.PointerEvent, card: DeckCard) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((e.target as HTMLElement)?.closest?.("[data-card-control]")) return;
    const origin = { x: e.clientX, y: e.clientY };
    let held = false;
    let cancelled = false;

    const blockScroll = (ev: TouchEvent) => ev.preventDefault();

    const end = () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("touchmove", blockScroll);
      document.body.classList.remove("deck-dragging");
      setArming(null);
    };

    const hitTest = (x: number, y: number): number | "pool" | null => {
      const el = document.elementFromPoint(x, y)?.closest("[data-deck-col]");
      if (!el) return null;
      const v = el.getAttribute("data-deck-col");
      if (v === "pool") return "pool";
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const move = (ev: PointerEvent) => {
      if (!held) {
        if (Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) > CANCEL_PX) {
          cancelled = true;
          end();
        }
        return;
      }
      const t = hitTest(ev.clientX, ev.clientY);
      if (t !== targetRef.current) {
        targetRef.current = t;
        setTarget(t);
        // The destination is always shown: follow the finger to the page it
        // would land on, so you see the sprint you're about to commit to.
        if (t === "pool") goto(0);
        else if (typeof t === "number") goto(t + 1);
      }
      setDrag((d) => (d ? { ...d, x: ev.clientX, y: ev.clientY } : d));
    };

    const up = () => {
      const from = dragRef.current?.from ?? null;
      const t = targetRef.current;
      end();
      // the release that ended a drag must not also read as a tap on the card
      if (held) justDragged.current = Date.now();
      if (held && t !== null) {
        const col = t === "pool" ? null : t;
        if (col !== from) {
          navigator.vibrate?.(12);
          onMove(card.id, col);
        }
      }
      dragRef.current = null;
      targetRef.current = null;
      setDrag(null);
      setTarget(null);
    };

    const timer = window.setTimeout(() => {
      if (cancelled) return;
      held = true;
      dragRef.current = { id: card.id, from: card.col };
      document.body.classList.add("deck-dragging");
      window.addEventListener("touchmove", blockScroll, { passive: false });
      navigator.vibrate?.(8);
      setArming(null);
      setDrag({ id: card.id, name: card.name, dot: card.dot, x: origin.x, y: origin.y });
      setTarget(card.col ?? "pool");
      targetRef.current = card.col ?? "pool";
    }, LONG_PRESS_MS);

    setArming(card.id);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const dragging = drag != null;
  const poolCards = cards.filter((c) => c.col == null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Where the pager landed, for screen readers — the visual strip alone
          is silent about page changes. */}
      <span className="sr-only" aria-live="polite">
        {page === 0 ? poolLabel : columns[page - 1]?.title}
      </span>
      <DeckCrownFace crown={crown} />

      <ColumnStrip
        columns={columns}
        poolLabel={poolLabel}
        poolCount={poolCards.length}
        page={page}
        pageCount={columns.length + 1}
        goto={goto}
        dragging={dragging}
        target={target}
      />

      {coverage && coverage.rows.length > 0 && (
        <CoverageBand
          scope={scope}
          rows={coverage.rows}
          columns={columns}
          onAdd={(domain, col) => {
            setCompose({ col, domain });
            goto(col + 1);
          }}
        />
      )}

      {/* ── the pager — the pool, then time ─────────────────────────────────── */}
      <div className="relative min-h-0 flex-1">
      <div
        ref={pagerRef}
        data-deck-pager
        onScroll={onPagerScroll}
        className="mobile-scroll flex h-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden"
      >
        {/* page 0 — the pool. Dropping here RELEASES the commitment, so it washes
            `--slot` (open, unclaimed) exactly like the desktop rail. */}
        <section
          data-deck-col="pool"
          className="mobile-scroll w-full shrink-0 snap-center overflow-y-auto"
          style={
            dragging && target === "pool"
              ? { background: "color-mix(in srgb, var(--slot) 12%, transparent)" }
              : undefined
          }
        >
          <div className="px-4 fab-clear pt-3">
            <div className="section-label !px-0">{poolLabel} · {poolCards.length}</div>
            {poolCards.length === 0 ? (
              <div className="mt-2">{poolEmpty}</div>
            ) : (
              <div className="mt-2 flex flex-col gap-2">
                {poolCards.map((c) => (
                  <CardShell
                    key={c.id}
                    card={c}
                    lifted={drag?.id === c.id}
                    arming={arming === c.id}
                    onPress={startPress}
                    justDragged={justDragged}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        {columns.map((col, i) => {
          const mine = cards.filter((c) => c.col === i);
          const isTarget = dragging && target === i;
          return (
            <section
              key={col.key}
              data-deck-col={i}
              className="mobile-scroll w-full shrink-0 snap-center overflow-y-auto"
              style={
                isTarget
                  ? { background: "color-mix(in srgb, var(--slot) 12%, transparent)" }
                  : col.now
                    ? { background: NOW_BAND }
                    : undefined
              }
            >
              <ColumnHead col={col} />
              <div className="flex flex-col gap-2 px-4 fab-clear pt-3">
                {mine.length === 0 && compose?.col !== i && (
                  <button
                    onClick={() => setCompose({ col: i, domain: null })}
                    className="slot-open tap fast flex min-h-[96px] w-full items-center justify-center rounded-xl border border-dashed px-3 text-center text-caption text-muted"
                  >
                    {dragging ? "Release here to commit it" : `Nothing in ${col.title} yet — tap to start one`}
                  </button>
                )}
                {mine.map((c) => (
                  <CardShell
                    key={`${c.id}:${i}`}
                    card={c}
                    lifted={drag?.id === c.id}
                    arming={arming === c.id}
                    onPress={startPress}
                    justDragged={justDragged}
                  />
                ))}
                {compose?.col === i ? (
                  <InlineAdd
                    placeholder={
                      compose.domain ? `Name a ${compose.domain.name} ${addNoun}…` : `Name a ${addNoun}…`
                    }
                    accent={compose.domain?.color ?? addAccent ?? "var(--accent)"}
                    hint={`⏎ adds it to ${col.title}`}
                    onCreate={(name) => onCreate(i, name, compose.domain)}
                    onClose={() => setCompose(null)}
                  />
                ) : (
                  mine.length > 0 && (
                    <button
                      onClick={() => setCompose({ col: i, domain: null })}
                      className="slot-open tap fast w-full rounded-xl border border-dashed px-3 py-3 text-center text-caption font-medium text-muted"
                    >
                      ＋ {addNoun} in {col.title}
                    </button>
                  )
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* Left edge-guard: touches starting here belong to the OS back gesture,
          so they must never begin a horizontal pager pan (touch-action: pan-y
          alone doesn't stop Safari's edge-back from colliding with a half-
          committed page change). Vertical scrolling stays native. */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 z-10"
        style={{ width: EDGE_GUARD_PX, touchAction: "pan-y" }}
      />
      </div>

      {/* the thing in your hand — glass, following the finger */}
      {drag && (
        <div
          className="glass-grab pointer-events-none fixed z-[70] w-56 rounded-xl border border-line bg-surface px-3 py-2.5"
          style={{
            left: Math.min(drag.x - 40, window.innerWidth - 232),
            top: drag.y - 56,
            transform: "rotate(-2deg)",
          }}
        >
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: drag.dot }} />
            <span className="truncate text-caption text-ink">{drag.name}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── the crown — readiness, execution voice (PlannerRail's, at phone width) ─────
// One line by default: an 812px screen was spending ~600px on chrome before the
// first card, so the read collapses to a single tappable summary and the
// progress bar + "needs shaping" jump live behind it.
function DeckCrownFace({ crown }: { crown: DeckCrown }) {
  const [open, setOpen] = useState(false);
  const pct = crown.total > 0 ? (crown.done / crown.total) * 100 : 0;
  return (
    <div className="shrink-0 border-b border-line px-4 pb-2 pt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="tap fast flex w-full items-center gap-2 text-left"
      >
        <span className="section-label !p-0" style={{ color: "var(--accent)" }}>
          {crown.eyebrow}
        </span>
        {crown.total === 0 ? (
          <span className="text-caption text-muted">nothing on the board yet</span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-caption text-muted">
            <span className="mono font-medium text-ink">{crown.done}</span>/
            <span className="mono">{crown.total}</span> {crown.noun}
            {crown.gap ? ` · ${crown.gap.label}` : ""}
          </span>
        )}
        <span className="mono ml-auto shrink-0 text-micro text-muted">{open ? "▾" : "▸"}</span>
      </button>

      {open && crown.total > 0 && (
        <div className="mt-1.5 flex items-center gap-2.5">
          <span className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
            <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: "var(--accent)" }} />
          </span>
        </div>
      )}
      {open && crown.gap && (
        <button
          onClick={crown.gap.onJump}
          disabled={!crown.gap.onJump}
          className="tap fast mt-1.5 flex w-full items-center gap-2 border-t border-line pt-1.5 text-left"
        >
          <span className="shrink-0 text-caption text-muted">{crown.gap.label}</span>
          {crown.gap.detail && (
            <span className="min-w-0 flex-1 truncate text-caption" style={{ color: "var(--accent)" }}>
              — {crown.gap.detail}
            </span>
          )}
          {crown.gap.onJump && <span className="ml-auto shrink-0 text-micro text-muted">›</span>}
        </button>
      )}
    </div>
  );
}

// ── the strip — every column at once: map, navigation, and drop target ────────
function ColumnStrip({
  columns,
  poolLabel,
  poolCount,
  page,
  pageCount,
  goto,
  dragging,
  target,
}: {
  columns: DeckColumn[];
  poolLabel: string;
  poolCount: number;
  page: number;
  pageCount: number;
  goto: (p: number) => void;
  dragging: boolean;
  target: number | "pool" | null;
}) {
  return (
    <div className="flex shrink-0 items-stretch border-b border-line">
      {/* Explicit prev/next — the tap path for page traversal, so the swipe
          (which yields to the iOS edge-back near the bezel) is never the only
          way to move. */}
      <button
        type="button"
        onClick={() => goto(Math.max(0, page - 1))}
        disabled={page <= 0}
        aria-label="Previous page"
        className="fast flex w-9 shrink-0 items-center justify-center border-r border-line text-head text-muted active:bg-surface-2 disabled:opacity-30"
      >
        ‹
      </button>
      <div role="tablist" aria-label="Deck pages" className="flex min-w-0 flex-1 items-stretch">
      {/* the pool cell — same width as the coverage gutter beneath it */}
      <button
        data-deck-col="pool"
        role="tab"
        aria-selected={page === 0}
        onClick={() => goto(0)}
        title={poolLabel}
        aria-label={poolLabel}
        style={{ width: GUTTER_PX }}
        className={`fast relative flex shrink-0 flex-col items-center justify-center gap-0.5 border-r border-line py-2 ${
          page === 0 ? "text-accent" : "text-muted"
        }`}
      >
        <span
          className="fast flex h-5 w-5 items-center justify-center rounded-md border text-micro"
          style={
            dragging && target === "pool"
              ? { borderColor: "var(--slot)", color: "var(--slot)", background: "color-mix(in srgb, var(--slot) 16%, transparent)" }
              : { borderColor: page === 0 ? "var(--accent)" : "var(--line-strong)" }
          }
        >
          ◇
        </span>
        <span className="mono text-micro tabular-nums">{poolCount}</span>
      </button>

      {columns.map((c, i) => {
        const on = page === i + 1;
        const isTarget = dragging && target === i;
        const over = c.load > c.cap;
        const fill = c.cap > 0 ? Math.min(1, c.load / c.cap) : 0;
        return (
          <button
            key={c.key}
            data-deck-col={i}
            role="tab"
            aria-selected={on}
            onClick={() => goto(i + 1)}
            title={c.title}
            aria-label={`${c.title}, ${c.load} of ${c.cap}`}
            className="fast relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 border-r border-line px-1 py-2 last:border-r-0"
            style={{
              background: isTarget
                ? "color-mix(in srgb, var(--slot) 16%, transparent)"
                : on
                  ? "var(--surface)"
                  : undefined,
              borderTop: c.now ? NOW_BORDER : "1px solid transparent",
              boxShadow: isTarget ? "inset 0 0 0 1.5px color-mix(in srgb, var(--slot) 55%, transparent)" : undefined,
            }}
          >
            <span
              className="mono truncate text-caption font-semibold leading-none"
              style={{ color: isTarget ? "var(--slot)" : c.now ? NOW_INK : on ? "var(--ink)" : "var(--muted)" }}
            >
              {c.chip}
            </span>
            {/* load — how full this column is against your focus cap, as ink */}
            <span className="h-1 w-full overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
              <span
                className="fast block h-full rounded-full"
                style={{
                  width: `${Math.max(fill * 100, c.load > 0 ? 12 : 0)}%`,
                  background: over ? "#D97706" : on ? "var(--accent)" : "var(--line-strong)",
                }}
              />
            </span>
            <span className="mono text-micro leading-none tabular-nums" style={{ color: over ? "#D97706" : "var(--muted)" }}>
              {c.load}
              {over ? "⚠" : ""}
            </span>
          </button>
        );
      })}
      </div>
      <button
        type="button"
        onClick={() => goto(Math.min(pageCount - 1, page + 1))}
        disabled={page >= pageCount - 1}
        aria-label="Next page"
        className="fast flex w-9 shrink-0 items-center justify-center border-l border-line text-head text-muted active:bg-surface-2 disabled:opacity-30"
      >
        ›
      </button>
    </div>
  );
}

// ── the page header — which slice of time you're standing in ──────────────────
function ColumnHead({ col }: { col: DeckColumn }) {
  return (
    <div className="border-b border-line px-4 pb-2.5 pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="text-head font-semibold"
          style={{ color: col.now ? NOW_INK : "var(--ink)" }}
        >
          {col.now && (
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: NOW_MARK }} />
          )}
          {col.title}
        </span>
        <span
          className="mono shrink-0 text-caption tabular-nums"
          style={{ color: col.load > col.cap ? "#D97706" : "var(--muted)" }}
        >
          {col.load}/{col.cap}
          {col.load > col.cap ? " ⚠" : ""}
        </span>
      </div>
      <div className="mono mt-0.5 text-micro text-muted">{col.when}</div>
      {col.head}
      {col.note}
    </div>
  );
}

// ── one card — the tap path opens it, the hold path moves it ──────────────────
function CardShell({
  card,
  lifted,
  arming,
  onPress,
  justDragged,
}: {
  card: DeckCard;
  lifted: boolean;
  /** held but not yet picked up — the visible arming ramp. */
  arming: boolean;
  onPress: (e: React.PointerEvent, card: DeckCard) => void;
  justDragged: React.MutableRefObject<number>;
}) {
  return (
    <div
      onPointerDown={(e) => onPress(e, card)}
      onClickCapture={(e) => {
        if (Date.now() - justDragged.current < 400) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      className={`relative select-none ${arming ? "deck-arming" : "fast"}`}
      style={lifted ? { opacity: 0.35 } : undefined}
    >
      {card.node}
      {/* span continuation — this thing also occupies the neighbouring column,
          the phone's read of a desktop bar stretched across weeks */}
      {card.contPrev && (
        <span
          className="pointer-events-none absolute -left-1.5 top-1/2 -translate-y-1/2 text-micro"
          style={{ color: card.dot }}
        >
          ◀
        </span>
      )}
      {card.contNext && (
        <span
          className="pointer-events-none absolute -right-1.5 top-1/2 -translate-y-1/2 text-micro"
          style={{ color: card.dot }}
        >
          ▶
        </span>
      )}
    </div>
  );
}

// ── coverage — which domains are carried, and when ────────────────────────────
// The desktop strip, at phone scale: one row per domain, one cell per column, each
// unit of work an identical accumulating pip. Empty cell = one tap to start work
// for that domain in that column. Collapsed by default here — vertical space on a
// phone belongs to the deck.
function CoverageBand({
  scope,
  rows,
  columns,
  onAdd,
}: {
  scope: string;
  rows: { domain: Domain; cells: number[] }[];
  columns: DeckColumn[];
  onAdd: (domain: Domain, col: number) => void;
}) {
  const key = `nuvo.mobile.deck.coverage.${scope}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setOpen((v) => {
      try {
        localStorage.setItem(key, v ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !v;
    });
  };
  const covered = rows.filter((r) => r.cells.some((c) => c > 0)).length;

  // Plain language, not palette knowledge: a collapsed row of coloured dots
  // only reads if you've memorised which hue is which domain. Name the first
  // couple of domains with a status word instead; the rest sit behind the
  // count expander.
  const statusOf = (r: { cells: number[] }): string => {
    const first = r.cells.findIndex((c) => c > 0);
    if (first === -1) return "idle";
    if (columns[first]?.now) return "now";
    return columns[first]?.chip ?? "later";
  };

  return (
    <div className="shrink-0 border-b border-line">
      <button onClick={toggle} className="tap fast flex w-full items-center gap-2 px-4 py-1.5 text-left">
        <span className="section-label !px-0 !pb-0">Coverage</span>
        <span className="min-w-0 flex-1 truncate text-micro text-muted">
          {rows.slice(0, 2).map((r, i) => (
            <span key={r.domain.id}>
              {i > 0 && " · "}
              <span style={{ color: r.domain.color }}>{r.domain.name}</span> {statusOf(r)}
            </span>
          ))}
        </span>
        <span className="mono ml-auto shrink-0 text-micro text-muted">
          {covered}/{rows.length} {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div className="pb-1.5">
          {rows.map((r) => (
            <div
              key={r.domain.id}
              className="grid items-center"
              style={{ gridTemplateColumns: `${GUTTER_PX}px repeat(${columns.length}, 1fr)` }}
            >
              <span
                className="flex h-6 items-center justify-center text-caption"
                style={{ color: r.domain.color }}
                title={r.domain.name}
              >
                {r.domain.icon}
              </span>
              {columns.map((c, i) => {
                const n = r.cells[i] ?? 0;
                return (
                  <button
                    key={c.key}
                    onClick={() => onAdd(r.domain, i)}
                    title={n > 0 ? `${n} in ${c.title}` : `Start one in ${c.title}`}
                    className="fast flex h-6 items-center justify-center gap-0.5 border-l border-line"
                    style={c.now ? { background: NOW_BAND } : undefined}
                  >
                    {n === 0 ? (
                      <span className="text-micro text-muted/35">+</span>
                    ) : (
                      Array.from({ length: Math.min(n, 4) }).map((_, k) => (
                        <span
                          key={k}
                          className="h-2 w-2 rounded-[2px]"
                          style={{ background: r.domain.color }}
                        />
                      ))
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
