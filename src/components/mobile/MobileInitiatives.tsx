// The Initiatives tab — the phone's initiative On Deck, the same board the desktop
// runs: bets time-boxed onto QUARTERS. One clock speed up from the Projects tab and
// the identical act — the pool ("Needs a quarter") is page one, each quarter is a
// page after it, and holding a bet and dropping it on a quarter commits its finish
// line there.
//
// A quarter is a long way off in sprints, which is the honest unit of runway, so
// every quarter page counts itself out in sprints: thirteen pips, the spent ones
// dimmed, the one you're standing in marked quietly. That is the read the old
// text list never gave — "this bet has nine sprints left," not "Q3 2026".
//
// Cards lead with OKR health, because grooming a bet is about making the outcome
// measurable: the two-segment meter (Defined · Measured) and one state word. A bet
// with no domain still gets its one-tap auto-link, exactly like the desktop card.

import { useMemo, useState } from "react";
import { NOW_MARK } from "../ondeck/plannerNow";
import { useVertical } from "../../hooks/useVertical";
import { useMaxPerQuarter } from "../../hooks/usePlannerPrefs";
import {
  quarterEndISO,
  quarterRangeLabel,
  readInitiativeDeck,
  suggestDomainForInitiative,
  type InitiativeLane,
  type InitiativeLaneState,
} from "../../lib/initiativeDeck";
import { initiativeReadinessAxes } from "../../lib/lenses";
import { sprintsBetween } from "../../lib/sprint";
import { domainById, type Domain, type Initiative, type VerticalData } from "../../lib/vertical";
import { DomainPicker } from "../floors/parts";
import MobileDeck, { type DeckCard, type DeckColumn } from "./deck/MobileDeck";
// One card across both shells — the phone must not invent its own grammar (D-048).
import PlannerCard, { type DeckTone } from "../ondeck/DeckCard";
import { initiativeCardStatus, initiativeWeight } from "../ondeck/deckStatus";
import { Hint, VerticalList } from "./detail/verticalDetail";

const HORIZON_QUARTERS = 4;

// Most urgent first inside a quarter — the desktop deck's order.
const STATE_ORDER: Record<InitiativeLaneState, number> = {
  at_risk: 0, needs_okrs: 1, needs_shaping: 2, on_track: 3, idea: 4, parked: 5,
};

const SEG_KEY = "nuvo-mobile-initiatives-seg";
type Seg = "ondeck" | "all";

export default function MobileInitiatives({
  onOpenItem,
}: {
  onOpenItem: (kind: "project" | "initiative" | "domain", id: string) => void;
}) {
  const { data: d, updateInitiative, updateProject, addInitiative } = useVertical();
  const [maxPerQuarter] = useMaxPerQuarter();
  const now = useMemo(() => new Date(), []);
  const board = useMemo(() => readInitiativeDeck(d, now, HORIZON_QUARTERS), [d, now]);

  const [seg, setSegState] = useState<Seg>(() => {
    try {
      return localStorage.getItem(SEG_KEY) === "all" ? "all" : "ondeck";
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

  const Q = board.quarters.length;
  const domainsSorted = useMemo(() => [...d.domains].sort((a, b) => a.sort - b.sort), [d.domains]);
  const defaultDomain = domainsSorted[0] ?? null;

  // Re-homing a bet takes its projects with it — the same cascade the floors use.
  const setDomain = (i: Initiative, domainId: string) => {
    updateInitiative(i.id, { domainId });
    d.projects.filter((p) => p.initiativeId === i.id).forEach((p) => updateProject(p.id, { domainId }));
  };

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

  const columns: DeckColumn[] = board.quarters.map((q) => {
    const total = sprintsBetween(q.start, q.end) + 1;
    const spent = q.idx === 0 ? Math.min(total, Math.max(1, sprintsBetween(q.start, now) + 1)) : 0;
    return {
      key: q.key,
      chip: q.shortLabel.split(" ")[0],
      title: q.shortLabel,
      when: `${q.label} · ${quarterRangeLabel(q.start, q.end)}`,
      load: (byColumn.get(q.idx) ?? []).length,
      cap: maxPerQuarter,
      now: q.idx === 0,
      head: <SprintRunway total={total} spent={spent} current={q.idx === 0} />,
    };
  });

  const cards: DeckCard[] = [
    ...board.inbox.map((i) => {
      const dot = domainById(d, i.domainId)?.color ?? "var(--line-strong)";
      return {
        id: i.id,
        col: null,
        name: i.name,
        dot,
        node: (
          <InitiativeCard
            lane={{
              initiative: i,
              state: "idea",
              attainment: null,
              krCount: i.keyResults.length,
              uncovered: 0,
              atRisk: { atRisk: false, reasons: [] },
              gaps: [],
              needsDomain: !i.domainId || !domainById(d, i.domainId),
              quarterIdx: null,
              overdue: false,
            }}
            d={d}
            onOpen={() => onOpenItem("initiative", i.id)}
            onSetDomain={setDomain}
          />
        ),
      } satisfies DeckCard;
    }),
    // most urgent first inside a quarter — the desktop column's order
    ...[...board.quarters.flatMap((q) => byColumn.get(q.idx) ?? [])].map((l) => ({
      id: l.initiative.id,
      col: l.quarterIdx ?? 0,
      name: l.initiative.name,
      dot: domainById(d, l.initiative.domainId)?.color ?? "var(--line-strong)",
      node: (
        <InitiativeCard
          lane={l}
          d={d}
          onOpen={() => onOpenItem("initiative", l.initiative.id)}
          onSetDomain={setDomain}
        />
      ),
    })),
  ];

  const move = (id: string, col: number | null) => {
    if (col == null) {
      updateInitiative(id, { targetDate: null, status: "backlog" });
      return;
    }
    const q = board.quarters[col];
    if (!q) return;
    updateInitiative(id, { targetDate: quarterEndISO(q.start), status: "in_progress" });
  };

  const create = async (col: number, name: string, domain: Domain | null) => {
    const q = board.quarters[col];
    const dom = domain ?? defaultDomain;
    if (!q || !dom) return;
    await addInitiative(dom.id, { name, targetDate: quarterEndISO(q.start), status: "in_progress" });
  };

  const onTrack = board.lanes.filter((l) => l.state === "on_track").length;
  const atRisk = board.lanes.filter((l) => l.state === "at_risk");
  const grooming = board.lanes.filter(
    (l) => l.state === "needs_okrs" || l.state === "needs_shaping" || l.state === "idea",
  );
  const needsYou = [...atRisk, ...grooming];

  const coverageRows = domainsSorted.map((domain) => {
    const cells = new Array(Q).fill(0) as number[];
    for (const l of board.lanes)
      if (l.initiative.domainId === domain.id && l.quarterIdx != null && l.quarterIdx >= 0 && l.quarterIdx < Q)
        cells[l.quarterIdx] += 1;
    return { domain, cells };
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SegHeader seg={seg} setSeg={setSeg} />

      {seg === "all" ? (
        <div className="mobile-scroll min-h-0 flex-1 overflow-y-auto pb-24">
          <VerticalList
            d={d}
            lens="initiatives"
            onOpenProject={(id) => onOpenItem("project", id)}
            onOpenInitiative={(id) => onOpenItem("initiative", id)}
            onOpenDomain={(id) => onOpenItem("domain", id)}
          />
        </div>
      ) : (
        <MobileDeck
          scope="initiative"
          crown={{
            eyebrow: `Next ${Q} quarters`,
            done: onTrack,
            total: board.lanes.length,
            noun: "on track",
            gap: needsYou.length
              ? {
                  label: `${needsYou.length} need${needsYou.length === 1 ? "s" : ""} you`,
                  detail: atRisk.length > 0 ? `${atRisk.length} at risk · ${needsYou[0].initiative.name}` : needsYou[0].initiative.name,
                  onJump: () => onOpenItem("initiative", needsYou[0].initiative.id),
                }
              : null,
          }}
          columns={columns}
          cards={cards}
          poolLabel="Needs a quarter"
          poolEmpty={<Hint>Every bet has a quarter. Hold one and drop it here to shelve it.</Hint>}
          addNoun="initiative"
          addAccent={defaultDomain?.color}
          onCreate={create}
          onMove={move}
          coverage={{ rows: coverageRows }}
        />
      )}
    </div>
  );
}

// ── one bet — OKR health first, the way grooming an initiative actually goes ───
function InitiativeCard({
  lane,
  d,
  onOpen,
  onSetDomain,
}: {
  lane: InitiativeLane;
  d: VerticalData;
  onOpen: () => void;
  onSetDomain: (i: Initiative, domainId: string) => void;
}) {
  const i = lane.initiative;
  const dot = domainById(d, i.domainId)?.color ?? "var(--line-strong)";
  const suggestion = lane.needsDomain ? suggestDomainForInitiative(d, i) : null;
  const axes = initiativeReadinessAxes(d, i);
  const met = (axes.defined ? 1 : 0) + (axes.planned ? 1 : 0);
  const pipTone: DeckTone = lane.state === "parked" ? "muted" : met === 2 ? "ready" : met === 1 ? "caution" : "muted";

  // The same card the desktop deck wears (D-048), sized for a thumb. The only
  // altitude tell is the spine: heavier and full-height for a bet.
  return (
    <PlannerCard
      size="phone"
      variant="bounded"
      onClick={onOpen}
      spine={dot}
      eyebrow={domainById(d, i.domainId)?.name ?? "no area"}
      title={i.name}
      weight={initiativeWeight(lane)}
      status={initiativeCardStatus(lane)}
      pips={[axes.defined, axes.planned]}
      pipTone={pipTone}
      dim={lane.state === "parked"}
      footer={
        // the one placement necessity: a bet with no domain gets a one-tap home
        lane.needsDomain ? (
          <div data-card-control className="relative mt-2 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {suggestion ? (
              <button
                onClick={() => onSetDomain(i, suggestion.domain.id)}
                className="tap fast flex items-center gap-1 rounded-full border px-2.5 py-1 text-micro font-medium"
                style={{ color: suggestion.domain.color, borderColor: `${suggestion.domain.color}66`, background: `${suggestion.domain.color}12` }}
              >
                <span>{suggestion.domain.icon}</span>
                <span>Link → {suggestion.domain.name}</span>
              </button>
            ) : (
              <DomainPicker domains={d.domains} value="" onChange={(id) => onSetDomain(i, id)} />
            )}
          </div>
        ) : null
      }
    />
  );
}

// ── the quarter, counted out in sprints — the runway you actually spend ────────
function SprintRunway({ total, spent, current }: { total: number; spent: number; current: boolean }) {
  const left = current ? total - spent : total;
  return (
    <div className="mt-2 flex items-center gap-2">
      <span className="flex flex-1 items-center gap-[3px]">
        {Array.from({ length: total }).map((_, i) => {
          const isNow = current && i === spent - 1;
          const past = current && i < spent - 1;
          return (
            <span
              key={i}
              className="h-1.5 flex-1 rounded-full"
              style={{
                background: isNow ? NOW_MARK : past ? "var(--line-strong)" : "var(--accent)",
                opacity: isNow ? 1 : past ? 0.3 : 0.55,
              }}
            />
          );
        })}
      </span>
      <span className="mono shrink-0 text-micro tabular-nums text-muted">
        {left} sprint{left === 1 ? "" : "s"} left
      </span>
    </div>
  );
}

function SegHeader({ seg, setSeg }: { seg: Seg; setSeg: (s: Seg) => void }) {
  const items: { id: Seg; label: string }[] = [
    { id: "ondeck", label: "On Deck" },
    { id: "all", label: "All" },
  ];
  return (
    <div className="flex shrink-0 gap-1 border-b border-line px-3 py-2">
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
