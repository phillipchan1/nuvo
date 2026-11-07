import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { isCanvasTap } from "./canvasTap";

// The empty-space press, shared by every time canvas on the phone (D-130 Day,
// D-175 Week). One gesture, so one state machine: press shows the ghost under
// the finger, a wander past AXIS_SLOP_PX is a scroll or a page-swipe and
// dismisses it, a release in place claims that time. Each lens only says how a
// point on its canvas reads as (column, minute) — never how a tap is told
// apart from a scroll.

export type CanvasPoint = { col: number; startMin: number };

export function useCanvasPress({
  enabled,
  resolve,
  onTap,
}: {
  enabled: boolean;
  /** The (column, snapped minute) under a point, or null for "not a claim" (the gutter). */
  resolve: (clientX: number, clientY: number) => CanvasPoint | null;
  onTap: (p: CanvasPoint) => void;
}) {
  const pressRef = useRef<{ x: number; y: number; point: CanvasPoint; id: number } | null>(null);
  const [press, setPress] = useState<CanvasPoint | null>(null);

  const clear = () => {
    pressRef.current = null;
    setPress(null);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || e.button !== 0) return;
    // A block is its own tap — it opens, it never claims the time under it.
    if ((e.target as HTMLElement).closest("[data-cal-item]")) return;
    const point = resolve(e.clientX, e.clientY);
    if (!point) return;
    pressRef.current = { x: e.clientX, y: e.clientY, point, id: e.pointerId };
    setPress(point);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const p = pressRef.current;
    if (!p || e.pointerId !== p.id) return;
    if (!isCanvasTap(e.clientX - p.x, e.clientY - p.y)) clear();
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const p = pressRef.current;
    clear();
    if (!p || e.pointerId !== p.id) return;
    if (!isCanvasTap(e.clientX - p.x, e.clientY - p.y)) return;
    onTap(p.point);
  };

  return {
    press,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: clear },
  };
}
