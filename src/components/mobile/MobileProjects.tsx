// The Projects tab — the phone's On Deck, and now the SAME surface the desktop
// deck is: projects time-boxed onto sprints. Desktop lays the sprints out as
// columns you drag across; the phone pages through them (pool first, then time),
// so the act is identical — press and hold a project, drop it on a sprint, and it
// is committed there. What changed from the old mobile screen: it is no longer a
// demand-ranked *list* that only reads. It is the deck, and it edits.
//
// The pool ("Needs a sprint") is page one, exactly the desktop rail's job. Each
// sprint page carries its own load against your focus cap, its capacity read
// (demand blocks vs open blocks) and — on the week that pinches — the one steward
// sentence. Cards are the desktop cards: domain rail, name, the three-check
// definition-of-ready meter. Tap opens the record (where the sprint picker moves
// it without a gesture); the check ships it, asking first.
//
// "All" stays what it was: the flat browse list, reaching backlog/complete work
// the deck (in-flight only) leaves out.

import { useMemo, useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import { useCapacity } from "../../hooks/useCapacity";
import { useMaxPerWeek } from "../../hooks/usePlannerPrefs";
import {
  readOnDeck,
  sprintSpanFor,
  weekIndexIn,
  type OnDeckLane,
  type ReadyTier,
} from "../../lib/onDeck";
import { sprintNumber } from "../../lib/sprint";
import { domainById, isOpenStatus, type Domain, type Project } from "../../lib/vertical";
import { PROJECT_STATUS_COLORS } from "../floors/parts";
import { READY } from "../floors/ReadinessBanner";
import { ProjectShipAssess } from "../record/ShipAssess";
import MobileDeck, { type DeckCard, type DeckColumn } from "./deck/MobileDeck";
import { Hint, VerticalList } from "./detail/verticalDetail";

const CAUTION = PROJECT_STATUS_COLORS.waiting;
// The same near-term horizon the desktop deck plans over.
const HORIZON_SPRINTS = 4;

// Readiness ramp — one color per tier, so a page of cards sorts itself by eye.
const TIER_COLOR: Record<ReadyTier, string> = {
  ready: READY,
  grooming: CAUTION,
  raw: "var(--line-strong)",
  parked: "var(--muted)",
  done: READY,
};

/** The one label beside the meter: a word for the extremes, else the specific
 *  missing check. Same rule as the desktop card (`meterHint`). */
function meterHint(l: OnDeckLane): string {
  if (l.readyTier === "done") return "Done";
  if (l.readyTier === "parked") return "Parked";
  if (l.readyTier === "ready") return "Ready";
  if (l.gaps.length) return l.gaps.map((g) => g.label).join(" · ");
  if (l.axes.fits === false) return "won't fit the sprint";
  return "Raw";
}

const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
const clampIdx = (i: number, H: number) => Math.max(0, Math.min(i, H - 1));

const SEG_KEY = "nuvo-mobile-projects-seg";
type Seg = "ondeck" | "all";

export default function MobileProjects({
  onOpenItem,
}: {
  onOpenItem: (kind: "project" | "initiative" | "domain", id: string) => void;
}) {
  const { data: d, updateProject, addProject } = useVertical();
  const { byWeek, weeklyAvgMins } = useCapacity();
  const [maxPerWeek] = useMaxPerWeek();
  const now = useMemo(() => new Date(), []);
  const board = useMemo(
    () => readOnDeck(d, byWeek, weeklyAvgMins, now, HORIZON_SPRINTS, true),
    [d, byWeek, weeklyAvgMins, now],
  );
  const [shipId, setShipId] = useState<string | null>(null);

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

  const H = board.horizonWeeks;
  const domainsSorted = useMemo(() => [...d.domains].sort((a, b) => a.sort - b.sort), [d.domains]);
  const defaultDomain = domainsSorted[0] ?? null;

  // ── placement geometry — the same read the desktop bars use ─────────────────
  const placed = board.lanes.filter((l) => l.project.targetDate);
  const placedIds = new Set(placed.map((l) => l.project.id));
  // The pool is every open project NOT on the timeline — including a backlog one
  // that still carries a date; it needs a sprint, so it belongs here.
  const pool = d.projects.filter((p) => isOpenStatus(p.status) && !placedIds.has(p.id));

  const geom = placed.map((l) => {
    const dIdx = clampIdx(l.dueWeekIdx ?? H - 1, H);
    const sIdx = l.project.startDate ? clampIdx(weekIndexIn(board.weeks, l.project.startDate), H) : dIdx;
    return { l, start: Math.min(sIdx, dIdx), end: Math.max(sIdx, dIdx), beyond: l.dueWeekIdx == null };
  });

  // Load per sprint — projects occupying it, finished ones excluded (they're no
  // longer pending work). Matches the desktop's `weekLoad`.
  const load = board.weeks.map(
    (_, i) => geom.filter((g) => i >= g.start && i <= g.end && g.l.readyTier !== "done").length,
  );

  const columns: DeckColumn[] = board.weeks.map((w) => ({
    key: String(w.idx),
    chip: `S${sprintNumber(w.weekStart)}`,
    title: `Sprint ${sprintNumber(w.weekStart)}`,
    when:
      (w.idx === 0 ? "This week · " : w.idx === 1 ? "Next week · " : "Week of ") +
      fmtDay(w.weekStart),
    load: load[w.idx],
    cap: maxPerWeek,
    now: w.idx === 0,
    head: <CapacityGauge blocks={w.blocks} demand={w.demandBlocks} over={w.over} />,
    note:
      board.pinch?.weekIdx === w.idx ? (
        <div className="mt-2 rounded-lg border border-signal/40 bg-signal-soft px-2.5 py-2 text-caption text-ink">
          {board.pinch.line}
        </div>
      ) : null,
  }));

  const cardNode = (l: OnDeckLane) => (
    <ProjectCard
      lane={l}
      dot={domainById(d, l.project.domainId)?.color ?? "var(--accent)"}
      onOpen={() => onOpenItem("project", l.project.id)}
      onShip={() => setShipId(l.project.id)}
      onReopen={() => updateProject(l.project.id, { status: "in_progress" })}
    />
  );

  const cards: DeckCard[] = [
    ...pool.map((p) => {
      const dot = domainById(d, p.domainId)?.color ?? "var(--accent)";
      return {
        id: p.id,
        col: null,
        name: p.name,
        dot,
        node: <PoolCard p={p} dot={dot} onOpen={() => onOpenItem("project", p.id)} />,
      } satisfies DeckCard;
    }),
    // a project spanning sprints appears in each of them, with continuation marks
    ...geom.flatMap((g) => {
      const dot = domainById(d, g.l.project.domainId)?.color ?? "var(--accent)";
      const out: DeckCard[] = [];
      for (let i = g.start; i <= g.end; i++)
        out.push({
          id: g.l.project.id,
          col: i,
          name: g.l.project.name,
          dot,
          node: cardNode(g.l),
          contPrev: i > g.start,
          contNext: i < g.end || g.beyond,
        });
      return out;
    }),
  ];

  // ── the two writes the deck makes ───────────────────────────────────────────
  const move = (id: string, col: number | null) => {
    const p = d.projects.find((x) => x.id === id);
    if (!p) return;
    if (col == null) {
      updateProject(id, { startDate: null, targetDate: null, status: "backlog" });
      return;
    }
    const ws = board.weeks[col]?.weekStart;
    if (!ws) return;
    updateProject(id, { ...sprintSpanFor(p, ws), status: "in_progress" });
  };

  const create = async (col: number, name: string, domain: Domain | null) => {
    const ws = board.weeks[col]?.weekStart;
    const dom = domain ?? defaultDomain;
    if (!ws || !dom) return;
    await addProject(dom.id, null, {
      name,
      ...sprintSpanFor({ startDate: null, targetDate: null }, ws),
      status: "in_progress",
    });
  };

  // ── the crown — how ready the next four sprints are for the weeks below ─────
  const readyN = placed.filter((l) => l.readyTier === "ready").length;
  const doneN = placed.filter((l) => l.readyTier === "done").length;
  const needsShaping = placed.filter((l) => l.readyTier === "grooming" || l.readyTier === "raw");
  const rawN = placed.filter((l) => l.readyTier === "raw").length;

  const coverageRows = domainsSorted.map((domain) => {
    const cells = new Array(H).fill(0) as number[];
    for (const g of geom)
      if (g.l.project.domainId === domain.id)
        for (let i = g.start; i <= g.end; i++) if (i >= 0 && i < H) cells[i] += 1;
    return { domain, cells };
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SegHeader seg={seg} setSeg={setSeg} />

      {seg === "all" ? (
        <div className="mobile-scroll min-h-0 flex-1 overflow-y-auto pb-24">
          <VerticalList
            d={d}
            lens="projects"
            onOpenProject={(id) => onOpenItem("project", id)}
            onOpenInitiative={(id) => onOpenItem("initiative", id)}
            onOpenDomain={(id) => onOpenItem("domain", id)}
          />
        </div>
      ) : (
        <MobileDeck
          scope="project"
          crown={{
            eyebrow: `Next ${H} sprints`,
            done: readyN + doneN,
            total: placed.length,
            noun: "ready",
            gap: needsShaping.length
              ? {
                  label: `${needsShaping.length} need${needsShaping.length === 1 ? "s" : ""} shaping`,
                  detail: rawN > 0 ? `${rawN} raw · ${needsShaping[0].project.name}` : needsShaping[0].project.name,
                  onJump: () => onOpenItem("project", needsShaping[0].project.id),
                }
              : null,
          }}
          columns={columns}
          cards={cards}
          poolLabel="Needs a sprint"
          poolEmpty={
            <Hint>Every project has a sprint. Hold one and drop it here to shelve it.</Hint>
          }
          addNoun="project"
          addAccent={defaultDomain?.color}
          onCreate={create}
          onMove={move}
          coverage={{ rows: coverageRows }}
        />
      )}

      {shipId && <ProjectShipAssess id={shipId} onClose={() => setShipId(null)} />}
    </div>
  );
}

// ── the deck card — the desktop card at thumb scale ───────────────────────────
function ProjectCard({
  lane,
  dot,
  onOpen,
  onShip,
  onReopen,
}: {
  lane: OnDeckLane;
  dot: string;
  onOpen: () => void;
  onShip: () => void;
  onReopen: () => void;
}) {
  const done = lane.readyTier === "done";
  const color = TIER_COLOR[lane.readyTier];
  const segs = done ? [true, true, true] : [lane.axes.defined, lane.axes.planned, lane.axes.fits];
  return (
    <div
      onClick={onOpen}
      className="glass-card fast relative rounded-xl border border-line py-3 pl-4 pr-3"
      style={{ opacity: lane.readyTier === "parked" ? 0.6 : 1 }}
    >
      {/* domain rail — identity; readiness lives in the meter */}
      <span className="pointer-events-none absolute inset-y-3 left-1.5 w-[3px] rounded-full" style={{ background: dot }} />
      <div className="flex items-start gap-2.5">
        <button
          data-card-control
          aria-label={done ? "Reopen project" : "Mark project complete"}
          onClick={(e) => {
            e.stopPropagation();
            done ? onReopen() : onShip();
          }}
          className="tap fast -my-2 -ml-1 flex w-9 shrink-0 items-center justify-center"
        >
          <span
            className="flex h-[22px] w-[22px] items-center justify-center rounded-full border"
            style={done ? { background: READY, borderColor: READY } : { borderColor: "var(--line-strong)" }}
          >
            <svg width="11" height="11" viewBox="0 0 10 10" fill="none" className={done ? "opacity-100" : "opacity-0"} style={{ color: "#fff" }}>
              <path d="M1.5 5.5L4 8L8.5 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
        <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
        <div className={`min-w-0 flex-1 text-body font-semibold leading-snug ${done ? "text-muted" : "text-ink"}`}>
          {lane.project.name}
        </div>
      </div>
      {/* Defined · Planned · Fits — the meter IS the "N of 3", so no number */}
      <div className="mt-2.5 flex items-center gap-2 pl-9">
        <span className="flex flex-1 items-center gap-1">
          {segs.map((met, i) => (
            <span key={i} className="h-[5px] flex-1 rounded-full" style={{ background: met ? color : "var(--line)" }} />
          ))}
        </span>
        <span className="mono shrink-0 text-micro" style={{ color }}>{meterHint(lane)}</span>
      </div>
    </div>
  );
}

// ── a pool card — no sprint yet, so no meter noise: name and where it belongs ──
function PoolCard({ p, dot, onOpen }: { p: Project; dot: string; onOpen: () => void }) {
  return (
    <div onClick={onOpen} className="glass-card fast relative rounded-xl border border-line py-3 pl-4 pr-3">
      <span className="pointer-events-none absolute inset-y-3 left-1.5 w-[3px] rounded-full" style={{ background: dot }} />
      <div className="flex items-center gap-2.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
        <span className="min-w-0 flex-1 truncate text-body text-ink">{p.name}</span>
        <span className="mono shrink-0 text-micro text-muted">hold to place</span>
      </div>
    </div>
  );
}

// ── the sprint's capacity read — demand against open time, as ink ─────────────
function CapacityGauge({ blocks, demand, over }: { blocks: number; demand: number; over: boolean }) {
  const pct = blocks > 0 ? Math.min(1, demand / blocks) : demand > 0 ? 1 : 0;
  return (
    <div className="mt-2 flex items-center gap-2">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct * 100}%`, background: over ? "var(--signal)" : "var(--accent)" }}
        />
      </span>
      <span className="mono shrink-0 text-micro tabular-nums" style={{ color: over ? "var(--signal)" : "var(--muted)" }}>
        {demand}/{blocks} blocks
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
