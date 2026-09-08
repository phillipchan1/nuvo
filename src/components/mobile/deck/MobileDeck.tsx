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
//   ＋       — every page ends in a composer, the pool included. Naming a thing on
//             a column page dates it there; naming it in the pool creates it with
//             no week / quarter yet, which is the rail's foot pill on desktop.
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
import DomainSymbol from "../../domain/DomainSymbol";

// 260ms/10px picked up cards during ordinary scroll starts — a flick's first
// frames often sit still longer than 260ms with <10px of travel. 450ms with a
// wider wobble allowance only fires on a deliberate hold, and the arming ramp
// (CardShell) makes the wait legible.
const LONG_PRESS_MS = 450;
const CANCEL_PX = 14;
// The pool cell in the strip doubles as the coverage strip's label gutter, so a
// lit coverage cell sits directly under its column.
const GUTTER_PX = 46;
// The narrowest a column cell may get before the strip starts scrolling instead
// of squeezing. Past ~4 columns a phone can't give each one a legible chip, so
// the horizon grew and the strip scrolls — the coverage rows scroll with it.
const COL_MIN_PX = 68;

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
  poolAddHint,
  onCreate,
  onMove,
  coverage,
  groomAction,
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
  /** the pool composer's footer line — "⏎ adds it with no week yet". */
  poolAddHint?: string;
  /** name one thing into a column — `col` is null when it's named into the pool
   *  (no week / quarter yet), and `domain` is set when the compose started from
   *  a coverage cell ("start a Church project next week"). */
  onCreate: (col: number | null, name: string, domain: Domain | null) => Promise<void>;
  /** a card was dropped: `col` = column index, or null to shelve it in the pool. */
  onMove: (id: string, col: number | null) => void;
  coverage?: DeckCoverage | null;
  /** the grooming-session action — quiet, self-hiding (see GroomingSessionAction). */
  groomAction?: ReactNode;
}) {
  const pagerRef = useRef<HTMLDivElement>(null);
  // Page 0 is the pool; column i is page i + 1. Open on the current column (the
  // sprint you're in), not the pool — "what now" before "what's waiting".
  const [page, setPage] = useState(() => {
    const nowIdx = columns.findIndex((c) => c.now);
    return nowIdx >= 0 ? nowIdx + 1 : 1;
  });
  // `col: null` composes into the pool — a thing named before it has a week.
  const [compose, setCompose] = useState<{ col: number | null; domain: Domain | null } | null>(null);
  // Ghost identity is state (set once, at pickup); its position is a direct
  // transform write per rAF — the same pattern as Sheet.tsx, so following the
  // finger never re-renders the deck.
  const [drag, setDrag] = useState<{ id: string; name: string; dot: string } | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const ghostPos = useRef({ x: 0, y: 0 });
  const ghostTransform = (x: number, y: number) =>
    `translate3d(${Math.min(x - 40, window.innerWidth - 232)}px, ${y - 56}px, 0) rotate(-2deg)`;
  const [target, setTarget] = useState<number | "pool" | null>(null);
  // The card being held but not yet picked up — drives the visible arming ramp
  // so the long-press wait reads as "keep holding" instead of a dead delay.
  const [arming, setArming] = useState<string | null>(null);
  // Where a card just landed — a brief flash on the strip cell, because
  // navigator.vibrate is a no-op on iOS Safari and a silent drop reads as a
  // maybe.
  const [flash, setFlash] = useState<number | "pool" | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);
  const flashDrop = (col: number | "pool") => {
    window.clearTimeout(flashTimer.current);
    setFlash(col);
    flashTimer.current = window.setTimeout(() => setFlash(null), 650);
  };

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

    // rAF-coalesced: the finger position lands as a transform write, and the
    // hit-test (elementFromPoint) runs once per frame instead of per event.
    let lastEv: PointerEvent | null = null;
    let raf = 0;
    const flush = () => {
      raf = 0;
      const ev = lastEv;
      if (!ev || !held) return;
      ghostPos.current = { x: ev.clientX, y: ev.clientY };
      if (ghostRef.current) ghostRef.current.style.transform = ghostTransform(ev.clientX, ev.clientY);
      const t = hitTest(ev.clientX, ev.clientY);
      if (t !== targetRef.current) {
        targetRef.current = t;
        setTarget(t);
        // The destination is always shown: follow the finger to the page it
        // would land on, so you see the sprint you're about to commit to.
        if (t === "pool") goto(0);
        else if (typeof t === "number") goto(t + 1);
      }
    };
    const move = (ev: PointerEvent) => {
      if (!held) {
        if (Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) > CANCEL_PX) {
          cancelled = true;
          end();
        }
        return;
      }
      lastEv = ev;
      if (!raf) raf = requestAnimationFrame(flush);
    };

    const up = () => {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      flush(); // land the drop on the final finger position
      const from = dragRef.current?.from ?? null;
      const t = targetRef.current;
      end();
      // the release that ended a drag must not also read as a tap on the card
      if (held) justDragged.current = Date.now();
      if (held && t !== null) {
        const col = t === "pool" ? null : t;
        if (col !== from) {
          navigator.vibrate?.(12);
          flashDrop(t);
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
      ghostPos.current = { x: origin.x, y: origin.y };
      setDrag({ id: card.id, name: card.name, dot: card.dot });
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

  // ── the strip and the coverage rows are one grid in two scrollers ───────────
  // They have to agree about which cell sits under which column, so whichever
  // one the finger moves drags the other to the same offset.
  const stripRef = useRef<HTMLDivElement>(null);
  const covRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const syncScroll = (from: React.RefObject<HTMLDivElement>, to: React.RefObject<HTMLDivElement>) => () => {
    if (syncing.current || !from.current || !to.current) return;
    syncing.current = true;
    to.current.scrollLeft = from.current.scrollLeft;
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  };

  // Keep the cell you're standing on in view — with six columns the strip is
  // wider than the phone, and the map must not lose your place (or, mid-drag,
  // the target the pager just followed you to). Page 0 is the pool, which lives
  // in the fixed gutter outside the scroller, so it rewinds instead.
  useEffect(() => {
    if (page === 0) {
      stripRef.current?.scrollTo({ left: 0, behavior: "smooth" });
      return;
    }
    stripRef.current
      ?.querySelector(`[data-strip-cell="${page}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [page]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Where the pager landed, for screen readers — the visual strip alone
          is silent about page changes. */}
      <span className="sr-only" aria-live="polite">
        {page === 0 ? poolLabel : columns[page - 1]?.title}
      </span>
      <DeckCrownFace crown={crown} groomAction={groomAction} />

      <ColumnStrip
        columns={columns}
        poolLabel={poolLabel}
        poolCount={poolCards.length}
        page={page}
        goto={goto}
        dragging={dragging}
        target={target}
        flash={flash}
        scrollRef={stripRef}
        onScroll={syncScroll(stripRef, covRef)}
      />

      {coverage && coverage.rows.length > 0 && (
        <CoverageBand
          scope={scope}
          rows={coverage.rows}
          columns={columns}
          scrollRef={covRef}
          onScroll={syncScroll(covRef, stripRef)}
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
          <div className="flex flex-col gap-2 px-4 fab-clear pt-3">
            <div className="section-label !px-0 !pb-0">{poolLabel} · {poolCards.length}</div>
            {poolCards.length === 0 ? (
              // an empty pool still says what it's for — the composer below is the
              // way in, so the hint stays a hint, not a dead end
              <div>{poolEmpty}</div>
            ) : (
              poolCards.map((c) => (
                <CardShell
                  key={c.id}
                  card={c}
                  lifted={drag?.id === c.id}
                  arming={arming === c.id}
                  onPress={startPress}
                  justDragged={justDragged}
                />
              ))
            )}
            {/* the pool's own ＋ — the rail's foot pill, at phone scale. Naming a
                thing here gives it no week yet, which is exactly what the pool is
                for; the columns each have the same composer for a dated one. */}
            {compose && compose.col === null ? (
              <InlineAdd
                placeholder={`Name a ${addNoun}…`}
                accent={addAccent ?? "var(--accent)"}
                hint={poolAddHint ?? `⏎ adds it to ${poolLabel}`}
                onCreate={(name) => onCreate(null, name, null)}
                onClose={() => setCompose(null)}
              />
            ) : (
              <button
                onClick={() => setCompose({ col: null, domain: null })}
                className="slot-open tap fast w-full rounded-xl border border-dashed px-3 py-3 text-center text-caption font-medium text-muted"
              >
                ＋ {addNoun}
              </button>
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
                    {/* not "Nothing in {title} yet" — the titles read "In 3
                        weeks", so that printed "Nothing in In 3 weeks". The
                        hero directly above already names the week. */}
                    {dragging ? "Release here to commit it" : "Nothing here yet — tap to start one"}
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
                      ＋ {addNoun}
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

      {/* the thing in your hand — glass, following the finger. pop-in is the
          visible pickup confirmation (iOS has no haptics to lean on). */}
      {drag && (
        <div
          ref={ghostRef}
          className="glass-grab pop-in pointer-events-none fixed left-0 top-0 z-[70] w-56 rounded-xl border border-line bg-surface px-3 py-2.5"
          style={{
            transform: ghostTransform(ghostPos.current.x, ghostPos.current.y),
            willChange: "transform",
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
// One line, deliberately quiet. The horizon's readiness is CONTEXT for the week
// you're standing in, not the headline — when it wore a hero's weight (its own
// eyebrow row, its own bar row, a bordered gap row beneath) it stacked three
// bands above the strip and the page hero read as the fourth-most important
// thing on a screen that was mostly chrome.
function DeckCrownFace({ crown, groomAction }: { crown: DeckCrown; groomAction?: ReactNode }) {
  const pct = crown.total > 0 ? (crown.done / crown.total) * 100 : 0;
  return (
    <div className="shrink-0 border-b border-line px-4 py-2">
      <div className="flex items-center gap-2">
        <span className="section-label shrink-0 !px-0 !pb-0">{crown.eyebrow}</span>
        {crown.total === 0 ? (
          <span className="text-caption text-muted">Nothing on the board yet</span>
        ) : (
          <>
            <span className="shrink-0 text-caption">
              <span className="mono font-medium text-ink">{crown.done}</span>
              <span className="text-muted">/</span>
              <span className="mono font-medium text-ink">{crown.total}</span>
              <span className="text-muted"> {crown.noun}</span>
            </span>
            <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
              <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: "var(--accent)" }} />
            </span>
          </>
        )}
      </div>
      {crown.gap && (
        <button
          onClick={crown.gap.onJump}
          disabled={!crown.gap.onJump}
          className="fast mt-0.5 flex w-full items-center gap-1.5 py-1 text-left"
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
      {groomAction && <div className="mt-0.5">{groomAction}</div>}
    </div>
  );
}

// ── the strip — every column at once: map, navigation, and drop target ────────
function ColumnStrip({
  columns,
  poolLabel,
  poolCount,
  page,
  goto,
  dragging,
  target,
  flash,
  scrollRef,
  onScroll,
}: {
  columns: DeckColumn[];
  poolLabel: string;
  poolCount: number;
  page: number;
  goto: (p: number) => void;
  dragging: boolean;
  target: number | "pool" | null;
  /** the cell a card just landed on — brief confirmation flash. */
  flash: number | "pool" | null;
  scrollRef: React.RefObject<HTMLDivElement>;
  onScroll: () => void;
}) {
  return (
    // The pool cell is a LABEL GUTTER, not a slice of time, so it sits outside
    // the scroller — pinned, the way the coverage band's domain icons are. Past
    // four columns the time cells scroll under it and "shelve this" stays one
    // tap (or one drag) away no matter how far out you've walked.
    <div role="tablist" aria-label="Deck pages" className="flex shrink-0 items-stretch border-b border-line">
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
        } ${flash === "pool" ? "deck-drop-flash" : ""}`}
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

      <div ref={scrollRef} onScroll={onScroll} className="mobile-scroll min-w-0 flex-1 overflow-x-auto">
        <div className="flex w-max min-w-full items-stretch">
      {columns.map((c, i) => {
        const on = page === i + 1;
        const isTarget = dragging && target === i;
        const over = c.load > c.cap;
        const fill = c.cap > 0 ? Math.min(1, c.load / c.cap) : 0;
        return (
          <button
            key={c.key}
            data-deck-col={i}
            data-strip-cell={i + 1}
            role="tab"
            aria-selected={on}
            onClick={() => goto(i + 1)}
            title={c.title}
            aria-label={`${c.title}, ${c.load} of ${c.cap}`}
            className={`fast relative flex flex-col items-center justify-center gap-1 border-r border-line px-1 py-2 last:border-r-0 ${
              flash === i ? "deck-drop-flash" : ""
            }`}
            style={{
              flex: `1 0 ${COL_MIN_PX}px`,
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
      </div>
    </div>
  );
}

// ── the page header — which slice of time you're standing in ──────────────────
// This is the page's HERO, so it's set in Fraunces like every other floor / day
// hero (design-language.md), not in the same semibold sans the crown and the
// section labels use. The load count is dropped unless it's over cap: the strip
// cell directly above already reads "3", and printing "3/2" here again next to
// it was two numbers for one fact. Over cap it comes back, because that's the
// one time the number is telling you something the bar can't.
function ColumnHead({ col }: { col: DeckColumn }) {
  const over = col.load > col.cap;
  return (
    <div className="border-b border-line px-4 pb-2.5 pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-lead masthead" style={{ color: col.now ? NOW_INK : "var(--ink)" }}>
          {col.now && (
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: NOW_MARK }} />
          )}
          {col.title}
        </span>
        {over && (
          <span className="mono shrink-0 text-caption tabular-nums" style={{ color: "#D97706" }}>
            {col.load}/{col.cap} ⚠
          </span>
        )}
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
  scrollRef,
  onScroll,
  onAdd,
}: {
  scope: string;
  rows: { domain: Domain; cells: number[] }[];
  columns: DeckColumn[];
  /** the rows scroll sideways with the strip above them — one grid, two scrollers. */
  scrollRef: React.RefObject<HTMLDivElement>;
  onScroll: () => void;
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
        // Same shape as the strip: a pinned icon gutter, and the cells scrolling
        // beside it in lockstep with the strip's columns.
        <div className="flex items-stretch pb-1.5">
          <div className="shrink-0" style={{ width: GUTTER_PX }}>
            {rows.map((r) => (
              <span
                key={r.domain.id}
                className="flex h-6 items-center justify-center text-caption"
                style={{ color: r.domain.color }}
                title={r.domain.name}
              >
                <DomainSymbol value={r.domain.icon} size={14} />
              </span>
            ))}
          </div>
          <div ref={scrollRef} onScroll={onScroll} className="mobile-scroll min-w-0 flex-1 overflow-x-auto">
            {rows.map((r) => (
              <div
                key={r.domain.id}
                className="grid w-max min-w-full items-center"
                style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(${COL_MIN_PX}px, 1fr))` }}
              >
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
        </div>
      )}
    </div>
  );
}
