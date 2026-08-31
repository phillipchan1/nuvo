import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * Keep a subtree mounted while it is off-screen.
 *
 * Unmounting FullCalendar to visit a floor rebuilt it on every ⌘1 (~111ms
 * to construct, plus event reconcile — a lived-in week is a full second).
 * `visibility` (not `display:none`) keeps the box, so a reveal is a paint
 * rather than a remount + remeasure. `inert` + `aria-hidden` drop it from
 * the a11y tree and from pointer/focus without collapsing layout.
 */
export default function KeepAlive({
  active,
  className = "",
  children,
}: {
  active: boolean;
  className?: string;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (el) el.inert = !active;
  }, [active]);

  return (
    <div
      ref={wrapRef}
      data-keep-alive={active ? "on" : "off"}
      className={[className, active ? undefined : "invisible pointer-events-none"]
        .filter(Boolean)
        .join(" ")}
      aria-hidden={!active}
    >
      {children}
    </div>
  );
}

/**
 * `memo` compare: while a surface is asleep, ignore every prop change so
 * floor work doesn't reconcile FullCalendar / the rail underneath. One
 * render on the way down (to drop hotkeys) and one on the way up (to
 * catch up). While awake, ordinary shallow compare.
 */
export function skipWhenAsleep<T extends { live?: boolean }>(prev: T, next: T): boolean {
  if (prev.live === false && next.live === false) return true;
  const prevRec = prev as Record<string, unknown>;
  const nextRec = next as Record<string, unknown>;
  const keys = Object.keys(prevRec);
  if (keys.length !== Object.keys(nextRec).length) return false;
  for (const k of keys) {
    if (!Object.is(prevRec[k], nextRec[k])) return false;
  }
  return true;
}
