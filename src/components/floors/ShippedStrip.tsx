// Shipped strip — the compact, everyday glimpse of the Shipped wall: "N shipped
// this quarter" and the domains they landed in, as one kit ghost button that
// opens the wall. Self-contained (reads the vertical + drives its own nav) so any
// Build surface can drop it in. Renders nothing when nothing has shipped — it
// never nags an empty state.

import { useMemo } from "react";
import { Icon } from "../Icon";
import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { readShipped } from "../../lib/shipped";
import { READY } from "./ReadinessBanner";
import { Button, Dot } from "../kit";

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
    <Button
      kind="ghost"
      size="sm"
      className="tap"
      onClick={openWall}
      title="Open the Shipped wall"
      icon={<Icon name="check" size={14} style={{ color: READY }} />}
      trailing={
        dots.length > 0 ? (
          <span className="flex items-center gap-[3px]" aria-hidden>
            {dots.map((b, i) => (
              <Dot key={b.domain?.id ?? `none-${i}`} color={b.domain?.color ?? "var(--faint)"} shape="round" size="sm" />
            ))}
          </span>
        ) : undefined
      }
    >
      <span className="tabular-nums">
        {n > 0 ? `${n} shipped ${board.periodNoun}` : `${board.total} shipped`}
      </span>
    </Button>
  );
}
