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
//
// The tab now carries the desktop's FOUR faces, in the desktop's order — On Deck
// (when) · Groom (what) · All (everything) · Shipped (what landed). Groom and
// Shipped were desktop-only, which left the phone able to place work it could
// not shape, and unable to look at what it had finished.

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useVertical } from "../../hooks/useVertical";
import { useDeferProject } from "../../hooks/useProjectTime";
import { useCapacity } from "../../hooks/useCapacity";
import { useMaxPerWeek } from "../../hooks/usePlannerPrefs";
import { readOnDeck, sprintSpanFor, weekIndexIn, type OnDeckLane } from "../../lib/onDeck";
import { weekName, weekSpan, weekTick } from "../../lib/week";
import { domainById, isOpenStatus, type Domain, type Project } from "../../lib/vertical";
import MobileDeck, { type DeckCard, type DeckColumn } from "./deck/MobileDeck";
import SkeletonRows from "./Skeleton";
import { PHONE_WEEK_HORIZON, VerticalList } from "./detail/verticalDetail";
// One card across both shells — the phone must not invent its own grammar (D-048).
import PlannerCard from "../ondeck/DeckCard";
import { deckWeight } from "../../lib/pace";
import { PIP_TONE, projectCardStatus } from "../ondeck/deckStatus";
import ThinDoor from "../ondeck/ThinDoor";
import { useThinPaths } from "../../hooks/useThinPaths";
import type { ThinPath } from "../../lib/thinPath";
import { pressable } from "../../lib/a11y";
import { Card, Dot } from "../kit";
import { PhEmpty, TouchSegmented } from "./touch";
import MobileGroom from "./MobileGroom";
import MobileShipped from "./MobileShipped";
import { useRecordActions } from "./MobileRecordActions";
import GroomingSessionAction from "../floors/GroomingSessionAction";

// How far out the phone plans. Six weeks is a month and a half — far enough
// that "not this month" still has somewhere to land, which four weeks didn't
// give you. Past what fits on a phone, so the strip scrolls (MobileDeck). The
// record's week picker reaches the same six (PHONE_WEEK_HORIZON).
const HORIZON_SPRINTS = PHONE_WEEK_HORIZON;

const clampIdx = (i: number, H: number) => Math.max(0, Math.min(i, H - 1));

const SEG_KEY = "nuvo-mobile-projects-seg";
export type BuildFace = "ondeck" | "groom" | "all" | "shipped";
type Seg = BuildFace;

export default function MobileProjects({
  onOpenItem,
}: {
  onOpenItem: (kind: "project" | "initiative" | "domain", id: string) => void;
}) {
  const { data: d, ready, updateProject, addProject } = useVertical();
  const defer = useDeferProject();
  // The All list is a document surface, so a hold there means "what can I do to
  // this" — the phone's right-click. (On the deck below, a hold means "pick it
  // up"; that surface is a drag surface, and its records reach the same acts
  // through the ⋯ in the record itself.)
  const { actionProps, sheet: actionSheet } = useRecordActions(onOpenItem);
  const { byWeek, weeklyAvgMins } = useCapacity();
  const [maxPerWeek] = useMaxPerWeek();
  const now = useMemo(() => new Date(), []);
  const board = useMemo(
    () => readOnDeck(d, byWeek, weeklyAvgMins, now, HORIZON_SPRINTS, true),
    [d, byWeek, weeklyAvgMins, now],
  );
  // projects with time held in the next two weeks and too little work in it (D-196)
  const thin = useThinPaths();

  const [seg, setSegState] = useState<Seg>(() => {
    try {
      const v = localStorage.getItem(SEG_KEY);
      return v === "groom" || v === "all" || v === "shipped" ? v : "ondeck";
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
    chip: weekTick(w.weekStart, { within: HORIZON_SPRINTS }),
    title: weekName(w.weekStart),
    when: weekSpan(w.weekStart),
    load: load[w.idx],
    cap: maxPerWeek,
    now: w.idx === 0,
    head: <CapacityGauge blocks={w.blocks} demand={w.demandBlocks} over={w.over} />,
    // The week that pinches says so once, as a fact in the verdict tone —
    // never --signal, which is spent on "now".
    note:
      board.pinch?.weekIdx === w.idx ? (
        <div className="mt-2 flex items-start gap-2 text-caption text-ink">
          <Dot color="var(--warn)" shape="round" size="sm" />
          <span className="-mt-0.5 min-w-0">{board.pinch.line}</span>
        </div>
      ) : null,
  }));

  const cardNode = (l: OnDeckLane) => (
    <ProjectCard
      lane={l}
      dot={domainById(d, l.project.domainId)?.color ?? "var(--accent)"}
      domainName={domainById(d, l.project.domainId)?.name ?? "no area"}
      onOpen={() => onOpenItem("project", l.project.id)}
      thin={thin.get(l.project.id) ?? null}
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
      // Off the deck — and off the calendar it was still holding.
      void defer.takeOff(p, undefined, { status: "backlog" });
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
      <BuildFaces value={seg} onChange={setSeg} />

      {!ready ? (
        <SkeletonRows rows={4} />
      ) : seg === "groom" ? (
        <MobileGroom scope="project" onOpenItem={onOpenItem} />
      ) : seg === "shipped" ? (
        <MobileShipped scope="project" onOpenItem={onOpenItem} />
      ) : seg === "all" ? (
        <div className="mobile-scroll min-h-0 flex-1 overflow-y-auto fab-clear">
          <VerticalList
            d={d}
            lens="projects"
            onOpenProject={(id) => onOpenItem("project", id)}
            onOpenInitiative={(id) => onOpenItem("initiative", id)}
            onOpenDomain={(id) => onOpenItem("domain", id)}
            hold={actionProps}
          />
          {actionSheet}
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
          poolEmpty={<PhEmpty>Nothing waiting</PhEmpty>}
          addNoun="project"
          addAccent={defaultDomain?.color}
          poolAddHint="⏎ adds it with no week yet"
          onCreate={create}
          onMove={move}
          coverage={{ rows: coverageRows }}
          groomAction={<GroomingSessionAction kind="project" />}
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
  thin,
}: {
  lane: OnDeckLane;
  dot: string;
  domainName: string;
  onOpen: () => void;
  /** time held in the next two weeks, too little work in it (D-196) */
  thin?: ThinPath | null;
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
      status={projectCardStatus(lane, thin)}
      pips={done ? undefined : [lane.axes.defined, lane.axes.planned, lane.axes.fits === true]}
      pipTone={PIP_TONE[lane.readyTier]}
      dim={lane.readyTier === "parked"}
      shipped={done}
      footer={thin ? <ThinDoor size="phone" projectId={lane.project.id} onOpen={() => onOpen()} /> : undefined}
    />
  );
}

// ── a pool card — no sprint yet, so no meter noise: name and where it belongs ──
// The kit Card at thumb scale, with the project's mark on its left edge (the
// same 3px spine the deck card wears). The name is the card's hero; the hold
// that places it is the deck's gesture, so the card no longer says so.
function PoolCard({ p, dot, onOpen }: { p: Project; dot: string; onOpen: () => void }) {
  return (
    <Card
      interactive
      onClick={onOpen}
      {...pressable(onOpen, { label: p.name })}
      className="ph-card relative min-h-12 !py-3 !pl-5"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-3 left-2 top-3 w-[3px] rounded-[2px]"
        style={{ background: dot }}
      />
      <span className="truncate text-head font-semibold text-ink">{p.name}</span>
    </Card>
  );
}

// ── the sprint's capacity read — demand against open time, as ink ─────────────
function CapacityGauge({ blocks, demand, over }: { blocks: number; demand: number; over: boolean }) {
  const pct = blocks > 0 ? Math.min(1, demand / blocks) : demand > 0 ? 1 : 0;
  return (
    <div className="mt-2 flex items-center gap-2">
      <span className="h-[3px] flex-1 overflow-hidden rounded-[2px] bg-[var(--line-2)]">
        <span
          className="block h-full rounded-[2px]"
          style={{ width: `${pct * 100}%`, background: over ? "var(--warn)" : "var(--accent)" }}
        />
      </span>
      <span className="shrink-0 text-caption tabular-nums" style={{ color: over ? "var(--warn)" : "var(--muted)" }}>
        {demand}/{blocks} blocks
      </span>
    </div>
  );
}

const FACES: { value: BuildFace; label: string }[] = [
  { value: "ondeck", label: "On Deck" },
  { value: "groom", label: "Groom" },
  { value: "all", label: "All" },
  { value: "shipped", label: "Shipped" },
];

/** The Build altitudes' four faces — the desktop's, in the desktop's order
 *  (FloorPane's RungTabs): when · what · everything · what landed (D-099). The
 *  kit Segmented at thumb size, in a --panel strip under the top bar; shared by
 *  the Projects and Initiatives tabs. */
export function BuildFaces({ value, onChange }: { value: BuildFace; onChange: (f: BuildFace) => void }) {
  return (
    <div className="sticky top-0 z-10 shrink-0 border-b border-[var(--line-1)] bg-[var(--panel)] px-4 pb-2.5 pt-1">
      {/* Four faces at 320px leave ~70px each: the faces keep one line by
          trading side padding, never by wrapping "On Deck" in two. */}
      <TouchSegmented<BuildFace>
        full
        label="View"
        value={value}
        onChange={onChange}
        options={FACES}
        className="[&>button]:!px-1 [&>button]:whitespace-nowrap"
      />
    </div>
  );
}
