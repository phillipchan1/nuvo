import { useCallback, useEffect, useRef, useState } from "react";
import { fixedCssPx } from "./useUiScale";

/**
 * Pointer-drag reordering for a vertical list, with a live insertion line.
 *
 * Pointer events, not HTML5 DnD — Tauri's webview swallows the latter (see
 * CLAUDE.md). Deliberately *passive*: it never calls `preventDefault` or
 * `stopPropagation`, so it can ride alongside FullCalendar's external
 * `Draggable` on the same rows. FC owns "drag this row onto the grid" and
 * draws the cursor ghost; this owns "drag this row to a new place in its own
 * list" and draws the line. They resolve by geometry at drop time: inside the
 * list is a reorder, outside it is FC's.
 *
 * `bandOf` is the honesty gate. A row only gets an insertion line when its
 * position is genuinely ours to set — a time-blocked row is ordered by its
 * clock, so offering to drop it two rows up would be offering a move that
 * snaps straight back.
 */
export interface ListReorderOptions {
  /** The scrolling list element. Must be a positioned ancestor for the line. */
  containerRef: React.MutableRefObject<HTMLElement | null>;
  /** Selector matching one draggable row. */
  itemSelector: string;
  /** Attribute on the row element holding its id. */
  idAttr: string;
  /** The band this row can trade places within — `null` = not reorderable. */
  bandOf: (id: string) => string | null;
  /** The band's ids in render order. Bands under 2 rows are ignored. */
  bandIds: (band: string) => string[];
  /** Commit a new order for the band. */
  onCommit: (band: string, ids: string[]) => void;
  /** A destination the surface owns rather than the list — a tab, a tray. Return
   *  a key while the pointer is over one. Reorder stands down for as long as it
   *  answers: no insertion line, and a release commits the external act instead.
   *  Zones win over the band, because a zone that overlaps the list's top edge
   *  must not silently reorder when you meant to leave. */
  externalDropAt?: (x: number, y: number, id: string) => string | null;
  /** Commit the external act. Only called for a release inside a zone. */
  onExternalDrop?: (key: string, id: string) => void;
  /** Label for the cursor-following chip shown while hovering an external zone. */
  zoneLabel?: (zone: string, id: string) => string;
  /** Fired on press, before the gesture has decided what it is. */
  onPointerDown?: (id: string) => void;
  /** Fired once the press clears the drag threshold. */
  onDragStart?: (id: string) => void;
  /** Fired when a *drag* ends (never for a plain click). */
  onDragEnd?: (id: string, reordered: boolean) => void;
  disabled?: boolean;
}

/** Matches FullCalendar's `minDistance` on the same rows, so one wobble can't
 *  mean "reorder" to us and "click" to it. */
const DRAG_THRESHOLD = 6;
/** How far past the band's ends still counts as aiming at it. Half a row:
 *  generous enough to drop at the very top/bottom, tight enough that the empty
 *  space below the list isn't a silent "send it to the end". */
const BAND_SLACK = 22;
/** Edge auto-scroll while dragging a long list. */
const SCROLL_EDGE = 32;
const SCROLL_STEP = 9;

export function useListReorder({
  containerRef,
  itemSelector,
  idAttr,
  bandOf,
  bandIds,
  onCommit,
  externalDropAt,
  onExternalDrop,
  zoneLabel,
  onPointerDown,
  onDragStart,
  onDragEnd,
  disabled,
}: ListReorderOptions) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [zone, setZone] = useState<string | null>(null);

  // Everything the live gesture reads, held in refs so a mid-drag re-render
  // (the line moving) never re-subscribes the listeners underneath it.
  const opts = useRef({ bandOf, bandIds, onCommit, externalDropAt, onExternalDrop, zoneLabel, onPointerDown, onDragStart, onDragEnd });
  opts.current = { bandOf, bandIds, onCommit, externalDropAt, onExternalDrop, zoneLabel, onPointerDown, onDragStart, onDragEnd };

  const rowRect = useCallback(
    (id: string) => {
      const el = containerRef.current?.querySelector<HTMLElement>(
        `[${idAttr}="${CSS.escape(id)}"]`,
      );
      return el?.getBoundingClientRect() ?? null;
    },
    [containerRef, idAttr],
  );

  useEffect(() => {
    if (disabled) return;
    const container = () => containerRef.current;

    let id: string | null = null;
    let band: string | null = null;
    let peers: string[] = [];
    let startY = 0;
    let startX = 0;
    let dragging = false;
    let targetIndex: number | null = null;
    let scrollRaf = 0;
    let pointerY = 0;
    let pointerX = 0;
    let inZone: string | null = null;

    // Cursor-following "you're about to..." label. Plain DOM, not React state —
    // same reasoning as CalendarPane's own drag chip: this repaints on every
    // pointermove of the gesture, and routing that through setState re-rendered
    // the whole rail (every task row) dozens of times a second, which is what
    // read as the app "shifting" while dragging.
    const chip = document.createElement("div");
    chip.className = "slot-drop-chip drop-chip-act";
    chip.setAttribute("aria-hidden", "true");
    document.body.appendChild(chip);

    const line = document.createElement("div");
    line.className = "reorder-insert-line";
    line.setAttribute("aria-hidden", "true");
    line.style.display = "none";

    const mountLine = () => {
      const list = container();
      if (list && !list.contains(line)) list.appendChild(line);
    };

    const stopScroll = () => {
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      scrollRaf = 0;
    };

    /** Where the line goes, and which index a drop would land on. `null` means
     *  the pointer isn't aiming at this band — draw nothing, commit nothing. */
    const measure = (clientY: number) => {
      const list = container();
      if (!list || !band || !id) return null;
      const rects = peers
        .map((pid) => ({ pid, r: rowRect(pid) }))
        .filter((p): p is { pid: string; r: DOMRect } => p.r != null);
      if (!rects.length) return null;
      const first = rects[0].r;
      const last = rects[rects.length - 1].r;
      if (clientY < first.top - BAND_SLACK || clientY > last.bottom + BAND_SLACK) return null;

      let k = 0;
      for (const { r } of rects) if (clientY > r.top + r.height / 2) k++;
      const listRect = list.getBoundingClientRect();
      const edge = k < rects.length ? rects[k].r.top : last.bottom;
      return { index: k, top: edge - listRect.top + list.scrollTop };
    };

    const paint = (clientY: number) => {
      mountLine();
      const hit = measure(clientY);
      targetIndex = hit?.index ?? null;
      if (hit) {
        line.style.display = "";
        line.style.top = `${hit.top}px`;
      } else {
        line.style.display = "none";
      }
    };

    const autoScroll = () => {
      const list = container();
      scrollRaf = 0;
      if (!dragging || !list) return;
      const r = list.getBoundingClientRect();
      let dy = 0;
      if (pointerY < r.top + SCROLL_EDGE) dy = -SCROLL_STEP;
      else if (pointerY > r.bottom - SCROLL_EDGE) dy = SCROLL_STEP;
      if (dy) {
        list.scrollTop += dy;
        paint(pointerY);
      }
      scrollRaf = requestAnimationFrame(autoScroll);
    };

    const finish = (commit: boolean) => {
      const draggedId = id;
      const wasDragging = dragging;
      const droppedIn = inZone;
      stopScroll();
      document.body.classList.remove("wb-noselect");
      chip.classList.remove("is-visible");
      let reordered = false;
      if (commit && wasDragging && draggedId && droppedIn) {
        opts.current.onExternalDrop?.(droppedIn, draggedId);
      } else if (commit && wasDragging && draggedId && band && targetIndex != null) {
        const current = opts.current.bandIds(band);
        const from = current.indexOf(draggedId);
        const next = current.filter((x) => x !== draggedId);
        next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, draggedId);
        if (from !== -1 && next.some((x, i) => x !== current[i])) {
          opts.current.onCommit(band, next);
          reordered = true;
        }
      }
      id = null;
      band = null;
      peers = [];
      dragging = false;
      targetIndex = null;
      inZone = null;
      setDraggingId(null);
      line.style.display = "none";
      setZone(null);
      if (wasDragging && draggedId) opts.current.onDragEnd?.(draggedId, reordered);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !e.isPrimary) return;
      const target = e.target as HTMLElement | null;
      const row = target?.closest<HTMLElement>(itemSelector);
      if (!row || !container()?.contains(row)) return;
      // The row's own controls (checkbox, Accept / ✕) are taps, not handles.
      if (target?.closest("button") && target.closest("button") !== row) return;
      id = row.getAttribute(idAttr);
      if (!id) return;
      const b = opts.current.bandOf(id);
      const members = b ? opts.current.bandIds(b) : [];
      band = b && members.length > 1 ? b : null;
      peers = band ? members.filter((x) => x !== id) : [];
      startX = e.clientX;
      startY = e.clientY;
      pointerY = e.clientY;
      opts.current.onPointerDown?.(id);
    };

    const onMove = (e: PointerEvent) => {
      if (!id) return;
      pointerY = e.clientY;
      pointerX = e.clientX;
      if (!dragging) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
        dragging = true;
        document.body.classList.add("wb-noselect");
        setDraggingId(id);
        opts.current.onDragStart?.(id);
        if (!scrollRaf) scrollRaf = requestAnimationFrame(autoScroll);
      }
      // A surface-owned zone wins outright, so a tab hanging over the list's top
      // edge can't be read as "reorder to position 0".
      const nextZone = opts.current.externalDropAt?.(e.clientX, e.clientY, id) ?? null;
      if (nextZone !== inZone) {
        inZone = nextZone;
        setZone(nextZone);
      }
      if (nextZone) {
        chip.textContent = opts.current.zoneLabel?.(nextZone, id) ?? "";
        chip.style.left = `${fixedCssPx(pointerX + 14)}px`;
        chip.style.top = `${fixedCssPx(pointerY + 16)}px`;
        chip.classList.add("is-visible");
      } else {
        chip.classList.remove("is-visible");
      }
      const list = container();
      const r = list?.getBoundingClientRect();
      // Outside the list horizontally, the gesture belongs to whoever owns the
      // surface it left for (the calendar) — go quiet rather than promising a
      // drop we won't honour.
      if (inZone || !band || !r || e.clientX < r.left || e.clientX > r.right) {
        targetIndex = null;
        line.style.display = "none";
        return;
      }
      paint(e.clientY);
    };

    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dragging) finish(false);
    };

    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onCancel, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onCancel, true);
      window.removeEventListener("keydown", onKey);
      stopScroll();
      document.body.classList.remove("wb-noselect");
      chip.remove();
      line.remove();
    };
  }, [containerRef, itemSelector, idAttr, rowRect, disabled]);

  /**
   * The same reorder, one row at a time, without a pointer.
   *
   * Drag is a *gesture*: it needs an origin, continuous travel and a release,
   * and none of those exist on a keyboard. So the keyboard path can't reuse the
   * gesture — it reuses what the gesture *decides*: the same `bandOf` honesty
   * gate (a time-blocked row is ordered by its clock, so it doesn't move here
   * either) and the same `onCommit`, so ⌥↑ and a drag write identical history.
   *
   * Returns the new 1-based position and the band's length so the caller can
   * say it out loud — a sighted mouse user watches the row travel, and the
   * announcement is what replaces having watched it.
   */
  const moveBy = useCallback(
    (id: string, delta: number): { index: number; total: number } | null => {
      if (disabled) return null;
      const band = bandOf(id);
      if (!band) return null;
      const ids = bandIds(band);
      const from = ids.indexOf(id);
      if (from === -1 || ids.length < 2) return null;
      const to = from + delta;
      // Clamped, not wrapped: ⌥↑ held at the top should rest there, not
      // teleport the row to the bottom of the list.
      if (to < 0 || to >= ids.length) return null;
      const next = ids.filter((x) => x !== id);
      next.splice(to, 0, id);
      onCommit(band, next);
      return { index: to + 1, total: ids.length };
    },
    [disabled, bandOf, bandIds, onCommit],
  );

  return { draggingId, zone, moveBy };
}
