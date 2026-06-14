import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

export const SELECT_INTERACTIVE = "input,button,textarea,select,a,[contenteditable=true],[data-no-select]";

export function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: DOMRect,
): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function useRecordSelection(orderedIds: string[]) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null);

  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => orderedIds.includes(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [orderedIds]);

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  const clear = useCallback(() => {
    setSelected(new Set());
    anchorRef.current = null;
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(orderedIds));
    anchorRef.current = orderedIds[0] ?? null;
  }, [orderedIds]);

  const setMany = useCallback((ids: string[], mode: "replace" | "add" | "toggle") => {
    setSelected((prev) => {
      if (mode === "replace") return new Set(ids);
      const next = new Set(prev);
      for (const id of ids) {
        if (mode === "add") next.add(id);
        else if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      return next;
    });
    if (ids.length) anchorRef.current = ids[ids.length - 1] ?? null;
  }, []);

  const pick = useCallback(
    (id: string, opts: { extend?: boolean; range?: boolean }) => {
      const { extend = false, range = false } = opts;
      setSelected((prev) => {
        const next = new Set(prev);
        if (range && anchorRef.current) {
          const a = orderedIds.indexOf(anchorRef.current);
          const b = orderedIds.indexOf(id);
          if (a >= 0 && b >= 0) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            for (let i = lo; i <= hi; i++) next.add(orderedIds[i]);
          } else {
            next.add(id);
          }
        } else if (extend) {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        } else {
          next.clear();
          next.add(id);
        }
        return next;
      });
      anchorRef.current = id;
    },
    [orderedIds],
  );

  const allSelected = orderedIds.length > 0 && orderedIds.every((id) => selected.has(id));
  const someSelected = orderedIds.some((id) => selected.has(id));

  const toggleAll = useCallback(() => {
    if (allSelected) clear();
    else selectAll();
  }, [allSelected, clear, selectAll]);

  return {
    selected,
    count: selected.size,
    isSelected,
    pick,
    setMany,
    clear,
    selectAll,
    toggleAll,
    allSelected,
    someSelected,
  };
}

type DragState = { x0: number; y0: number; x1: number; y1: number; additive: boolean; pendingId?: string };

const MARQUEE_MIN = 5;

function marqueeRect(drag: DragState) {
  return {
    left: Math.min(drag.x0, drag.x1),
    top: Math.min(drag.y0, drag.y1),
    right: Math.max(drag.x0, drag.x1),
    bottom: Math.max(drag.y0, drag.y1),
  };
}

function isMarqueeDrag(drag: DragState) {
  return Math.abs(drag.x1 - drag.x0) >= MARQUEE_MIN || Math.abs(drag.y1 - drag.y0) >= MARQUEE_MIN;
}

export function computeMarqueeHits(drag: DragState, itemRefs: Map<string, HTMLElement>): string[] {
  if (!isMarqueeDrag(drag)) return [];
  const norm = marqueeRect(drag);
  const hit: string[] = [];
  itemRefs.forEach((el, id) => {
    if (rectsIntersect(norm, el.getBoundingClientRect())) hit.push(id);
  });
  return hit;
}

function applyMarquee(drag: DragState, itemRefs: Map<string, HTMLElement>, sel: ReturnType<typeof useRecordSelection>) {
  const hit = computeMarqueeHits(drag, itemRefs);
  if (hit.length) sel.setMany(hit, drag.additive ? "add" : "replace");
  else if (!drag.additive) sel.clear();
}

export function useCollectionSelection(
  orderedIds: string[],
  enabled: boolean,
  onBulkDelete?: (ids: string[]) => void,
) {
  const sel = useRecordSelection(orderedIds);
  const itemRefs = useRef<Map<string, HTMLElement>>(new Map());
  const dragRef = useRef<DragState | null>(null);
  const [marquee, setMarquee] = useState<DragState | null>(null);
  const [previewIds, setPreviewIds] = useState<Set<string>>(() => new Set());
  const previewKeyRef = useRef("");
  const [deleteArmed, setDeleteArmed] = useState(false);

  const updatePreview = useCallback((drag: DragState | null) => {
    if (!drag) {
      previewKeyRef.current = "";
      setPreviewIds(new Set());
      return;
    }
    const hit = computeMarqueeHits(drag, itemRefs.current);
    const key = hit.slice().sort().join("\0");
    if (key === previewKeyRef.current) return;
    previewKeyRef.current = key;
    setPreviewIds(new Set(hit));
  }, []);

  const isPreviewSelected = useCallback((id: string) => previewIds.has(id), [previewIds]);
  const isMarqueeActive = marquee !== null && isMarqueeDrag(marquee);

  const registerRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) itemRefs.current.set(id, el);
    else itemRefs.current.delete(id);
  }, []);

  useEffect(() => {
    if (!deleteArmed) return;
    const t = window.setTimeout(() => setDeleteArmed(false), 2600);
    return () => window.clearTimeout(t);
  }, [deleteArmed]);

  // Block text selection while marquee-dragging
  useEffect(() => {
    if (!marquee) return;
    const blockSelect = (e: Event) => e.preventDefault();
    const blockDragStart = (e: Event) => {
      if ((e.target as HTMLElement).closest("[data-drag-item]")) return;
      e.preventDefault();
    };
    document.body.classList.add("nuvo-selecting");
    document.addEventListener("selectstart", blockSelect);
    document.addEventListener("dragstart", blockDragStart);
    return () => {
      document.body.classList.remove("nuvo-selecting");
      document.removeEventListener("selectstart", blockSelect);
      document.removeEventListener("dragstart", blockDragStart);
    };
  }, [marquee]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      e.preventDefault();
      drag.x1 = e.clientX;
      drag.y1 = e.clientY;
      dragRef.current = drag;
      setMarquee({ ...drag });
      updatePreview(drag);
    };
    const onUp = () => {
      const drag = dragRef.current;
      if (!drag) return;

      const dx = Math.abs(drag.x1 - drag.x0);
      const dy = Math.abs(drag.y1 - drag.y0);
      const isClick = dx < MARQUEE_MIN && dy < MARQUEE_MIN;

      dragRef.current = null;
      setMarquee(null);
      updatePreview(null);

      if (isClick && drag.pendingId) {
        sel.pick(drag.pendingId, { extend: false, range: false });
        return;
      }
      if (isClick && !drag.pendingId) {
        sel.clear();
        return;
      }
      applyMarquee(drag, itemRefs.current, sel);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [sel, updatePreview]);

  const beginPointer = useCallback(
    (e: ReactMouseEvent, id?: string) => {
      if (!enabled || e.button !== 0) return false;
      if ((e.target as HTMLElement).closest(SELECT_INTERACTIVE)) return false;

      if (e.shiftKey && id) {
        e.preventDefault();
        sel.pick(id, { extend: false, range: true });
        return true;
      }
      if ((e.metaKey || e.ctrlKey) && id) {
        e.preventDefault();
        sel.pick(id, { extend: true, range: false });
        return true;
      }

      e.preventDefault();
      e.stopPropagation();
      dragRef.current = {
        x0: e.clientX,
        y0: e.clientY,
        x1: e.clientX,
        y1: e.clientY,
        additive: e.metaKey || e.ctrlKey,
        pendingId: id,
      };
      setMarquee({ ...dragRef.current });
      updatePreview(dragRef.current);
      return true;
    },
    [enabled, sel, updatePreview],
  );

  const surfaceProps = {
    onMouseDown: (e: ReactMouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-select-id]")) return;
      beginPointer(e);
    },
    className: enabled ? "select-none" : "",
  };

  const cancelPointer = useCallback(() => {
    dragRef.current = null;
    setMarquee(null);
    updatePreview(null);
  }, [updatePreview]);

  const itemClickSelect = useCallback(
    (id: string) => (e: ReactMouseEvent) => {
      if (!enabled) return;
      if ((e.target as HTMLElement).closest(SELECT_INTERACTIVE)) return;
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        sel.pick(id, { extend: true, range: false });
      } else if (e.shiftKey) {
        e.preventDefault();
        sel.pick(id, { extend: false, range: true });
      }
    },
    [enabled, sel],
  );

  const itemPointerDown = (id: string) => (e: ReactMouseEvent) => {
    beginPointer(e, id);
  };

  const bulkDelete = useCallback(() => {
    if (!onBulkDelete || !sel.count) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    onBulkDelete([...sel.selected]);
    sel.clear();
    setDeleteArmed(false);
  }, [deleteArmed, onBulkDelete, sel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!enabled) return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;

      if (e.key === "Escape") {
        if (deleteArmed) {
          setDeleteArmed(false);
          return;
        }
        if (!sel.count) return;
        sel.clear();
        return;
      }

      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (!onBulkDelete || !sel.count) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      bulkDelete();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, deleteArmed, bulkDelete, onBulkDelete, sel]);

  const marqueeStyle = marquee
    ? {
        left: Math.min(marquee.x0, marquee.x1),
        top: Math.min(marquee.y0, marquee.y1),
        width: Math.abs(marquee.x1 - marquee.x0),
        height: Math.abs(marquee.y1 - marquee.y0),
      }
    : null;

  return {
    ...sel,
    registerRef,
    surfaceProps,
    itemPointerDown,
    itemClickSelect,
    cancelPointer,
    marqueeStyle,
    deleteArmed,
    setDeleteArmed,
    bulkDelete,
    enabled,
    previewIds,
    isPreviewSelected,
    isMarqueeActive,
    previewCount: previewIds.size,
  };
}

export type CollectionSelection = ReturnType<typeof useCollectionSelection>;
