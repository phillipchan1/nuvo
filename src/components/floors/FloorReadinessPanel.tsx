// The floor's readiness panel — the Projects / Initiatives mirror of the rail's
// WeekReadiness. Answers "how prepared is this floor to be worked?" as an
// inspectable list: each to-groom row NAMES its gap with a lens tag (the §4
// router in lib/lenses.ts) and routes straight into the lens that closes it —
// Brief (Defined) or Path (Planned). Dissolves to a single quiet line once
// everything's groomed.
//
// COMPLEMENTARY to FloorStanding (Defined · Capacity · Motion = *assessment*):
// readiness = *preparedness*. Reads the same axis checklist the Groom flow and
// On Deck route by, so they can never disagree.

import { useMemo } from "react";
import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { isOpenStatus } from "../../lib/vertical";
import { itemsNeedingLenses, LENS_LABEL } from "../../lib/lenses";

// A few rows inline; the rest fold into a "+N more" line into the same pass.
const SHOWN = 5;

/** A tick (groomed) or an open ring (a gap) — mirrors WeekReadiness's Mark. */
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

export default function FloorReadinessPanel({ kind }: { kind: "project" | "initiative" }) {
  const { data } = useVertical();
  const { openFlow } = useAppNavigation();

  const { groomed, toGroom } = useMemo(() => {
    const open = (kind === "project" ? data.projects : data.initiatives).filter((x) =>
      isOpenStatus(x.status),
    );
    // gapped = still missing a readiness axis (Defined / Planned); everything
    // else open is groomed or deliberately resting. Same source as the hub.
    const gapped = itemsNeedingLenses(data, kind, new Date());
    return { groomed: Math.max(0, open.length - gapped.length), toGroom: gapped };
  }, [data, kind]);

  // Reward — everything in flight is groomed. A quiet line, not a card.
  if (toGroom.length === 0) {
    return (
      <div className="mb-6 flex items-center gap-2 text-caption text-muted">
        <Mark done />
        <span>{groomed > 0 ? `All ${groomed} ready for a week — nothing to groom.` : "Nothing to groom yet."}</span>
      </div>
    );
  }

  const shown = toGroom.slice(0, SHOWN);
  const overflow = toGroom.length - shown.length;
  // "+N more" and the header route into the guided experience for this floor:
  // projects land on the On Deck hub; initiatives start their pass directly.
  const openAll = () =>
    kind === "project" ? openFlow("refine") : openFlow("refine", { pass: "initiative" });

  return (
    <div className="mb-6 max-w-[920px]">
      <div className="section-label flex items-center justify-between !px-0 !pb-1.5">
        <span>To groom</span>
        <span className="mono text-meta text-muted">{groomed} ready for a week · {toGroom.length} to groom</span>
      </div>
      <div className="flex flex-col">
        {shown.map(({ item, gaps }) => (
          <button
            key={`${kind}:${item.id}`}
            type="button"
            onClick={() => openFlow("refine", { kind, id: item.id })}
            className="fast tap flex items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-surface-2"
          >
            <Mark done={false} />
            <span className="min-w-0 flex-1 truncate text-body text-ink">{item.name}</span>
            {gaps.map((g) => (
              <span
                key={g.lens}
                title={g.label}
                className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-meta font-medium text-accent"
              >
                {LENS_LABEL[g.lens]} · {g.label}
              </span>
            ))}
          </button>
        ))}
        {overflow > 0 && (
          <button
            type="button"
            onClick={openAll}
            className="fast tap px-1.5 py-1.5 text-left text-caption text-muted hover:text-ink"
          >
            +{overflow} more to groom →
          </button>
        )}
      </div>
    </div>
  );
}
