// The Projects tab — the phone's On Deck, and now the SAME surface the desktop
// deck is: projects time-boxed onto weeks. Desktop lays the weeks out as
// columns you drag across; the phone pages through them (pool first, then time),
// so the act is identical — press and hold a project, drop it on a week, and it
// is committed there. What changed from the old mobile screen: it is no longer a
// demand-ranked *list* that only reads. It is the deck, and it edits.
//
// The pool ("Needs a week") is page one, exactly the desktop rail's job. Each
// week page carries its own load against your focus cap, its capacity read
// (demand blocks vs open blocks) and — on the week that pinches — the one steward
// sentence. Cards are the desktop cards: domain rail, name, the three-check
// definition-of-ready meter. Tap opens the record (where the week picker moves
// it without a gesture); the check ships it, asking first.
//
// "All" stays what it was: the flat browse list, reaching backlog/complete work
// the deck (in-flight only) leaves out.

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useVertical } from "../../hooks/useVertical";
import { useCapacity } from "../../hooks/useCapacity";
import { useMaxPerWeek } from "../../hooks/usePlannerPrefs";
import { readOnDeck, sprintSpanFor, weekIndexIn, type OnDeckLane } from "../../lib/onDeck";
import { weekName, weekSpan, weekTick } from "../../lib/week";
import { domainById, isOpenStatus, type Domain, type Project } from "../../lib/vertical";
import MobileDeck, { type DeckCard, type DeckColumn } from "./deck/MobileDeck";
import { Hint, PHONE_WEEK_HORIZON, VerticalList } from "./detail/verticalDetail";
// One card across both shells — the phone must not invent its own grammar (D-048).
import PlannerCard, { deckWeight } from "../ondeck/DeckCard";
import { PIP_TONE, projectCardStatus } from "../ondeck/deckStatus";

// How far out the phone plans. Six weeks is a month and a half — far enough
// that "not this month" still has somewhere to land, which four weeks didn't
// give you. Past what fits on a phone, so the strip scrolls (MobileDeck). The
// record's week picker reaches the same six (PHONE_WEEK_HORIZON).
const HORIZON_SPRINTS = PHONE_WEEK_HORIZON;

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
  // that still carries a date; it needs a week, so it belongs here.
  const pool = d.projects.filter((p) => isOpenStatus(p.status) && !placedIds.has(p.id));

  const geom = placed.map((l) => {
    const dIdx = clampIdx(l.dueWeekIdx ?? H - 1, H);
    const sIdx = l.project.startDate ? clampIdx(weekIndexIn(board.weeks, l.project.startDate), H) : dIdx;
    return { l, start: Math.min(sIdx, dIdx), end: Math.max(sIdx, dIdx), beyond: l.dueWeekIdx == null };
  });

  // Load per week — projects occupying it, finished ones excluded (they're no
  // longer pending work). Matches the desktop's `weekLoad`.
  const load = board.weeks.map(
    (_, i) => geom.filter((g) => i >= g.start && i <= g.end && g.l.readyTier !== "done").length,
  );

  const columns: DeckColumn[] = board.weeks.map((w) => ({
    key: String(w.idx),
    chip: weekTick(w.weekStart),
    title: weekName(w.weekStart),
    when: weekSpan(w.weekStart),
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
      domainName={domainById(d, l.project.domainId)?.name ?? "no area"}
      onOpen={() => onOpenItem("project", l.project.id)}
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
    // a project spanning weeks appears in each of them, with continuation marks
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

  const create = async (col: number | null, name: string, domain: Domain | null) => {
    const dom = domain ?? defaultDomain;
    if (!dom) {
      toast.error("Add an area first — a project has to live somewhere.");
      return;
    }
    // named into the pool: it exists, it just hasn't been given a week yet
    if (col == null) {
      await addProject(dom.id, null, { name, status: "backlog" });
      return;
    }
    const ws = board.weeks[col]?.weekStart;
    if (!ws) return;
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
            eyebrow: `Next ${H} weeks`,
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
          poolLabel="Needs a week"
          poolEmpty={
            <Hint>Nothing waiting for a week. Hold a project and drop it here to shelve it, or start one below.</Hint>
          }
          addNoun="project"
          addAccent={defaultDomain?.color}
          poolAddHint="⏎ adds it with no week yet"
          onCreate={create}
          onMove={move}
          coverage={{ rows: coverageRows }}
        />
      )}

    </div>
  );
}

// ── the deck card — the desktop card at thumb scale ───────────────────────────
// The SAME card the desktop deck wears (D-048), sized for a thumb — the grammar
// must not fork per device. Marked (a domain spine) = a project; enclosed = a bet.
// No completion check here either: tapping the card opens the record, which owns
// the ship assessment, and the card's left edge belongs to the name.
function ProjectCard({
  lane,
  dot,
  domainName,
  onOpen,
}: {
  lane: OnDeckLane;
  dot: string;
  domainName: string;
  onOpen: () => void;
}) {
  const done = lane.readyTier === "done";
  return (
    <PlannerCard
      size="phone"
      onClick={onOpen}
      spine={dot}
      eyebrow={domainName}
      title={lane.project.name}
      weight={done ? null : deckWeight(lane.pace.remainingMins)}
      status={projectCardStatus(lane)}
      pips={done ? [true, true, true] : [lane.axes.defined, lane.axes.planned, lane.axes.fits === true]}
      pipTone={PIP_TONE[lane.readyTier]}
      dim={done || lane.readyTier === "parked"}
    />
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
