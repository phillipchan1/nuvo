// Shipped strip — the compact, everyday glimpse of the Shipped wall. A quiet
// celebratory line for the deck / table footers: "N shipped this quarter", the
// domains they landed in, and a tap through to the full wall. Self-contained
// (reads the vertical + drives its own nav) so any Build surface can drop it in.
// Renders nothing when nothing has shipped — it never nags an empty state.

import { useMemo } from "react";
import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { readShipped } from "../../lib/shipped";
import { READY } from "./ReadinessBanner";

export default function ShippedStrip({ rung }: { rung: "project" | "initiative" }) {
  const { data } = useVertical();
  const { setProjectView, setInitiativeView } = useAppNavigation();
  const now = useMemo(() => new Date(), []);
  const board = useMemo(() => readShipped(data, rung, now), [data, rung, now]);
  if (board.total === 0) return null;

  const openWall = () => (rung === "project" ? setProjectView("shipped") : setInitiativeView("shipped"));
  const n = board.thisPeriodCount;
  const dots = board.byDomain.slice(0, 5);

  return (
    <button
      onClick={openWall}
      className="fast group/strip flex items-center gap-2.5 rounded-full border border-line bg-surface px-3.5 py-1.5 hover:border-line-strong"
      title="Open the Shipped wall"
    >
      <span
        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full"
        style={{ background: `color-mix(in srgb, ${READY} 15%, transparent)` }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ color: READY }}>
          <path d="M1.5 5.5L4 8L8.5 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="text-caption text-ink">
        {n > 0 ? (
          <>
            <span className="font-semibold">{n}</span> shipped {board.periodNoun}
          </>
        ) : (
          <>
            <span className="font-semibold">{board.total}</span> shipped
          </>
        )}
      </span>
      {dots.length > 0 && (
        <span className="flex items-center -space-x-0.5">
          {dots.map((b, i) => (
            <span
              key={b.domain?.id ?? `none-${i}`}
              className="h-2 w-2 rounded-full ring-1 ring-surface"
              style={{ background: b.domain?.color ?? "var(--line-strong)" }}
            />
          ))}
        </span>
      )}
      <span className="mono text-micro text-muted transition-colors group-hover/strip:text-ink">wall →</span>
    </button>
  );
}
