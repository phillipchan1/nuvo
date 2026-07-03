import { useMemo } from "react";
import { useVertical } from "../hooks/useVertical";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { weekReadiness, type WeekReadinessKey } from "../lib/readiness";

/** A tick (done) or an open ring (still a gap) — dissolve, don't frame. */
function Mark({ done }: { done: boolean }) {
  if (done) {
    return (
      <svg
        aria-hidden
        width="15" height="15" viewBox="0 0 24 24" fill="none"
        className="shrink-0 text-muted"
        stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  return (
    <span
      aria-hidden
      className="shrink-0 rounded-full"
      style={{ width: 11, height: 11, border: "1.5px solid var(--accent)" }}
    />
  );
}

/**
 * "This week" — the inspectable checklist behind the Schedule rung's cue. Every
 * gap between the human and a calm week, each line a jump to where it's fixed.
 * Reads the same `weekReadiness` source as the spine badge, so they never lie to
 * each other. Collapses to a single reward line once the week is groomed.
 *
 * Mounted as an ambient FOOTER in the rail (below capture + the list), so it
 * reads as status, never a primary action — the spine rung badge already carries
 * the urgency. Hence `border-t` (sits above the rail's bottom edge) + `shrink-0`.
 */
export default function WeekReadiness() {
  const { data } = useVertical();
  const { setTab, setCalView, setRung, openFlow } = useAppNavigation();
  const items = useMemo(() => (data ? weekReadiness(data) : []), [data]);
  if (!items.length) return null;

  const remaining = items.filter((i) => !i.done).length;

  const jump = (key: WeekReadinessKey) => {
    switch (key) {
      case "planned":
      case "priorities":
        openFlow("sunday"); // the compose ritual — goal + priorities live here
        break;
      case "inbox":
        setTab("inbox");
        break;
      case "placed":
        setRung("day");
        setCalView("board"); // the Spread view, where the "Needs a day" tray sits
        break;
    }
  };

  // Reward state — the whole checklist is satisfied. A quiet line, not a card.
  if (remaining === 0) {
    return (
      <div className="shrink-0 flex items-center gap-2 border-t border-line px-3 py-2 text-caption text-muted">
        <Mark done />
        <span>Week's groomed — nothing loose.</span>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-line px-2 py-1.5">
      <div className="section-label flex items-center justify-between !px-1 !pb-1">
        <span>This week</span>
        <span className="mono text-meta text-muted">{remaining} to groom</span>
      </div>
      <div className="flex flex-col">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            onClick={() => jump(it.key)}
            disabled={it.done}
            className={`fast tap flex items-center gap-2.5 rounded-md px-1.5 py-1 text-left ${
              it.done ? "cursor-default" : "hover:bg-surface-2"
            }`}
          >
            <Mark done={it.done} />
            <span className={`flex-1 text-body ${it.done ? "text-muted" : "text-ink"}`}>{it.label}</span>
            {!it.done && it.detail && (
              <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-meta font-medium text-accent">
                {it.detail}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
