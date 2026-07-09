// The Initiatives tab — the phone's echo of the desktop initiative On Deck. Where
// projects time-box onto weeks, initiatives (multi-month bets) time-box onto
// QUARTERS. Read-first: initiatives are grouped under the quarter their finish
// line lands in, each leading with OKR health; an "inbox" holds bets with no
// finish line yet. Tapping opens the detail Sheet, where setting a target quarter
// or status re-homes it. The "All" segment reaches every initiative.

import { useMemo, useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import {
  readInitiativeDeck,
  type InitiativeLane,
  type InitiativeLaneState,
} from "../../lib/initiativeDeck";
import { PROJECT_STATUS_COLORS } from "../floors/parts";
import { READY } from "../floors/ReadinessBanner";
import { Row, Empty, Section, Hint, VerticalList } from "./detail/verticalDetail";

const STATE_COLOR: Record<InitiativeLaneState, string> = {
  on_track: READY,
  at_risk: "var(--signal)",
  needs_okrs: PROJECT_STATUS_COLORS.waiting,
  needs_shaping: PROJECT_STATUS_COLORS.waiting,
  idea: "var(--line-strong)",
  parked: "var(--muted)",
};
const STATE_LABEL: Record<InitiativeLaneState, string> = {
  on_track: "on track",
  at_risk: "at risk",
  needs_okrs: "needs OKRs",
  needs_shaping: "needs shaping",
  idea: "no finish line",
  parked: "parked",
};

// Most urgent first inside a quarter.
const STATE_ORDER: Record<InitiativeLaneState, number> = {
  at_risk: 0, needs_okrs: 1, needs_shaping: 2, on_track: 3, idea: 4, parked: 5,
};

const SEG_KEY = "nuvo-mobile-initiatives-seg";
type Seg = "ondeck" | "all";

function laneSubtitle(l: InitiativeLane): string {
  const bits: string[] = [STATE_LABEL[l.state]];
  bits.push(l.krCount === 0 ? "no OKRs" : `${l.krCount} KR${l.krCount === 1 ? "" : "s"}`);
  if (l.uncovered > 0) bits.push(`${l.uncovered} uncovered`);
  if (l.needsDomain) bits.push("no domain");
  return bits.join(" · ");
}

function attainmentText(l: InitiativeLane): string {
  return l.attainment == null ? "—" : `${Math.round(l.attainment * 100)}%`;
}

export default function MobileInitiatives({
  onOpenItem,
}: {
  onOpenItem: (kind: "project" | "initiative" | "domain", id: string) => void;
}) {
  const store = useVertical();
  const d = store.data;
  const now = useMemo(() => new Date(), []);
  const board = useMemo(() => readInitiativeDeck(d, now, 4), [d, now]);

  const byColumn = useMemo(() => {
    const m = new Map<number, InitiativeLane[]>();
    for (const l of board.lanes) {
      const idx = l.quarterIdx ?? 0;
      const arr = m.get(idx) ?? [];
      arr.push(l);
      m.set(idx, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]);
    return m;
  }, [board.lanes]);

  const [seg, setSegState] = useState<Seg>(() => {
    try {
      const v = localStorage.getItem(SEG_KEY);
      return v === "all" ? "all" : "ondeck";
    } catch {
      return "ondeck";
    }
  });
  const setSeg = (s: Seg) => {
    setSegState(s);
    try {
      localStorage.setItem(SEG_KEY, s);
    } catch {
      /* ignore */
    }
  };

  const laneRow = (l: InitiativeLane) => (
    <Row
      key={l.initiative.id}
      onClick={() => onOpenItem("initiative", l.initiative.id)}
      chevron
      leading={<span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATE_COLOR[l.state] }} />}
      title={l.initiative.name}
      subtitle={laneSubtitle(l)}
      meta={<span className="mono shrink-0 text-caption text-muted">{attainmentText(l)}</span>}
    />
  );

  return (
    <div className="pb-24">
      <SegHeader seg={seg} setSeg={setSeg} />

      {seg === "all" ? (
        <VerticalList
          d={d}
          lens="initiatives"
          onOpenProject={(id) => onOpenItem("project", id)}
          onOpenInitiative={(id) => onOpenItem("initiative", id)}
          onOpenDomain={(id) => onOpenItem("domain", id)}
        />
      ) : board.lanes.length === 0 && board.inbox.length === 0 ? (
        <Empty>No initiatives yet. Start one from “All”, or ask Nuvo to shape a bet.</Empty>
      ) : (
        <div className="px-4">
          {/* Quarters stack vertically — 4 columns don't fit a phone. */}
          {board.quarters.map((q) => {
            const lanes = byColumn.get(q.idx) ?? [];
            if (lanes.length === 0) return null;
            return (
              <Section key={q.key} label={`${q.label} · ${q.shortLabel}`}>
                <div className="overflow-hidden rounded-xl border border-line bg-surface-2">
                  {lanes.map(laneRow)}
                </div>
              </Section>
            );
          })}

          {/* Inbox — bets with no finish line yet. */}
          {board.inbox.length > 0 && (
            <Section label={`Needs a quarter · ${board.inbox.length}`}>
              <div className="overflow-hidden rounded-xl border border-line bg-surface-2">
                {board.inbox.map((i) => (
                  <Row
                    key={i.id}
                    onClick={() => onOpenItem("initiative", i.id)}
                    chevron
                    leading={<span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATE_COLOR.idea }} />}
                    title={i.name}
                    subtitle={i.outcome || "Set a target quarter so it lands on the deck."}
                  />
                ))}
              </div>
              <div className="px-1 pt-2">
                <Hint>Tap a bet to give it a finish line.</Hint>
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function SegHeader({ seg, setSeg }: { seg: Seg; setSeg: (s: Seg) => void }) {
  const items: { id: Seg; label: string }[] = [
    { id: "ondeck", label: "On Deck" },
    { id: "all", label: "All" },
  ];
  return (
    <div className="sticky top-0 z-10 flex gap-1 border-b border-line bg-surface/90 px-3 py-2 backdrop-blur">
      {items.map((t) => {
        const on = seg === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setSeg(t.id)}
            className={`tap fast flex flex-1 items-center justify-center rounded-lg py-1.5 text-body font-medium ${
              on ? "bg-accent text-white" : "text-muted active:bg-surface-2"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
