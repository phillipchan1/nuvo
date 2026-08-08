// Initiative On Deck — the initiatives, grouped by the quarter they land in. The
// sibling of OnDeckPlanner (projects → weeks); here an initiative time-boxes onto a
// QUARTER. A kanban, not a Gantt: each column is a quarter, each card an initiative,
// and you drag a card between columns to move its finish line. An inbox rail on the
// left holds initiatives with no quarter yet (mirrors the project planner's "needs a
// week").
//
// Every card leads with its OKR health — attainment, KR count, coverage — because
// that is what grooming an initiative is *for*: making the outcome measurable and
// sound. Unlinked initiatives (no domain) surface a one-tap auto-link to the "main"
// they belong under (suggestDomainForInitiative), so the tree stays connected
// without a form.
//
// Pointer-events drag (HTML5 DnD is swallowed by Tauri) — the same idiom as
// OnDeckPlanner / WeekBoard: one document-level capture pointerdown, a 5px move
// threshold to tell a drag from a click, elementFromPoint hit-testing.

import { useEffect, useMemo, useRef, useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { useRecordContextMenu } from "../RecordContextMenu";
import { useMaxPerQuarter, useCoverageHidden, useCoverageCollapsed } from "../../hooks/usePlannerPrefs";
import { weeksBetween } from "../../lib/week";
import {
  domainById,
  type Domain,
  type Initiative,
  type VerticalData,
} from "../../lib/vertical";
import DomainCoverage, { type CoverageRow } from "./DomainCoverage";
import CoverageControls from "./CoverageControls";
import { initiativeReadinessAxes } from "../../lib/lenses";
import {
  LANE_ORDER,
  quarterEndISO,
  quarterRangeLabel,
  readInitiativeDeck,
  suggestDomainForInitiative,
  type InitiativeLane,
} from "../../lib/initiativeDeck";
import { DomainPicker, PROJECT_STATUS_COLORS } from "../floors/parts";
import ShippedStrip from "../floors/ShippedStrip";
import InlineAdd from "./InlineAdd";
import PlannerRail from "./PlannerRail";
import DeckCard, { type DeckTone } from "./DeckCard";
import { initiativeCardStatus } from "./deckStatus";
import { NOW_BAND, NOW_BORDER, NOW_INK, NOW_MARK } from "./plannerNow";

const CAUTION = PROJECT_STATUS_COLORS.waiting;
const COL_PX = 216;
// Quarters are adjacent, ruled columns now (not gapped boxes) — the same
// demarcation the project deck's weeks use, so both decks read as one grid idiom.
const COL_GAP = 0;
// The left label column — holds coverage domain names, empty in the deck; aligns the
// coverage cells to the quarter columns beneath.
const LABEL_W = 96;
// A fixed near-term horizon — a year of quarters. Coverage now measures load per
// domain (the pips), so a window selector was noise; near-term is what matters.
const HORIZON_QUARTERS = 4;

export default function InitiativeDeck() {
  const { data, updateInitiative, updateProject, addInitiative } = useVertical();
  const { openRecord, openFloorModal, setInitiativeView } = useAppNavigation();
  const [maxPerQuarter] = useMaxPerQuarter();
  const [coverageHidden, toggleCoverageHidden] = useCoverageHidden("initiative");
  const [coverageCollapsed, setCoverageCollapsed] = useCoverageCollapsed("initiative");
  const [filterOpen, setFilterOpen] = useState(false);
  const now = useMemo(() => new Date(), []);
  const board = useMemo(() => readInitiativeDeck(data, now, HORIZON_QUARTERS, true), [data, now]);
  // The domain a lane-composed initiative lands in (reassignable in the record);
  // the first domain, mirroring the full composer's default.
  const domainsSorted = useMemo(() => [...data.domains].sort((a, b) => a.sort - b.sort), [data.domains]);
  const defaultDomain = domainsSorted[0] ?? null;

  // ── domain coverage — a NAMED read of "which domains have an initiative, and in
  // which quarter?", aligned OVER the quarter columns (shared grid + label gutter).
  // One row per tracked domain, a cell per shown quarter lit where a bet lands. Empty
  // cell = one-tap start an initiative for that domain in that quarter.
  const Q = board.quarters.length;
  const cols = `${LABEL_W}px repeat(${Q}, minmax(${COL_PX}px, 1fr))`;
  const gridMinW = LABEL_W + Q * (COL_PX + COL_GAP);
  const coverageRows: CoverageRow[] = domainsSorted
    .filter((d) => !coverageHidden.has(d.id))
    .map((domain) => {
      const cells = new Array(Q).fill(0) as number[];
      for (const l of board.lanes)
        if (l.initiative.domainId === domain.id && l.quarterIdx != null && l.quarterIdx >= 0 && l.quarterIdx < Q)
          cells[l.quarterIdx] += 1;
      return { domain, cells };
    });
  const coveredCount = coverageRows.filter((r) => r.cells.some((c) => c > 0)).length;

  // group placed lanes by their quarter column
  const byColumn = useMemo(() => {
    const m = new Map<number, InitiativeLane[]>();
    for (const l of board.lanes) {
      const idx = l.quarterIdx ?? 0;
      const arr = m.get(idx) ?? [];
      arr.push(l);
      m.set(idx, arr);
    }
    // most urgent first inside a column: at risk / overdue, then needs work, then
    // parked, then finished (shared with the phone deck via LANE_ORDER)
    for (const arr of m.values()) arr.sort((a, b) => LANE_ORDER[a.state] - LANE_ORDER[b.state]);
    return m;
  }, [board.lanes]);

  // header legend — the placed bets by health, mirroring the projects deck's
  // ready/grooming/done rollup (grooming = still needs OKRs / shaping / a finish line).
  const onTrack = board.lanes.filter((l) => l.state === "on_track").length;
  const atRisk = board.lanes.filter((l) => l.state === "at_risk").length;
  const grooming = board.lanes.filter((l) => l.state === "needs_okrs" || l.state === "needs_shaping" || l.state === "idea").length;

  // ── domain re-home cascade (same rule as InitiativesFloor) ──────────────────
  const setDomain = (i: Initiative, domainId: string) => {
    updateInitiative(i.id, { domainId });
    data.projects
      .filter((p) => p.initiativeId === i.id)
      .forEach((p) => updateProject(p.id, { domainId }));
  };

  // ── drag state ──────────────────────────────────────────────────────────────
  const [drag, setDrag] = useState<{ name: string; dot: string; x: number; y: number } | null>(null);
  const [dropCol, setDropCol] = useState<number | null>(null);
  const [overInbox, setOverInbox] = useState(false);
  // click into a quarter → compose an initiative inline, right there (no modal). The
  // full composer (domain, finish line) stays a click away in the inbox rail.
  // composeDomain carries an explicit domain when launched from a coverage cell.
  const [composeCol, setComposeCol] = useState<number | null>(null);
  const [composeDomain, setComposeDomain] = useState<Domain | null>(null);
  const composeDom = composeDomain ?? defaultDomain;
  const closeCompose = () => { setComposeCol(null); setComposeDomain(null); };
  const composeInCol = (i: number) => { setComposeDomain(null); setComposeCol(i); };
  const createInCol = async (i: number, name: string) => {
    const col = board.quarters[i];
    if (!col || !composeDom) { openFloorModal("new-initiative"); return; }
    await addInitiative(composeDom.id, {
      name,
      targetDate: quarterEndISO(col.start),
      status: "in_progress",
    });
  };
  // start an initiative for a domain in a chosen quarter — from the coverage cell.
  const addForDomain = (dom: Domain, quarterIdx: number) => {
    setComposeDomain(dom);
    setComposeCol(quarterIdx);
  };

  const initiativeById = useMemo(() => new Map(data.initiatives.map((i) => [i.id, i])), [data.initiatives]);
  const live = useRef({ initiativeById, board, updateInitiative, openRecord, data });
  live.current = { initiativeById, board, updateInitiative, openRecord, data };

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const tgt = e.target as HTMLElement;
      // a control inside the card (domain picker, momentum, auto-link) handles itself
      if (tgt?.closest?.("[data-card-control]")) return;
      const el = tgt?.closest?.("[data-init-drag]") as HTMLElement | null;
      if (!el) return;
      const id = el.getAttribute("data-init-drag");
      const p = id ? live.current.initiativeById.get(id) : null;
      if (!p) return;
      const dot = domainById(live.current.data, p.domainId)?.color ?? "var(--accent)";
      const origin = { x: e.clientX, y: e.clientY };
      let moved = false;
      let tCol: number | null = null;
      let tInbox = false;

      const move = (ev: PointerEvent) => {
        if (!moved && Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) < 5) return;
        if (!moved) {
          moved = true;
          document.body.classList.add("wb-noselect");
          document.body.style.cursor = "grabbing";
          window.getSelection()?.removeAllRanges();
        }
        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        const col = hit?.closest("[data-quarter]");
        if (col) { tCol = Number(col.getAttribute("data-quarter")); tInbox = false; }
        else if (hit?.closest("[data-inbox-drop]")) { tInbox = true; tCol = null; }
        else { tCol = null; tInbox = false; }
        setDropCol(tCol);
        setOverInbox(tInbox);
        setDrag({ name: p.name, dot, x: ev.clientX, y: ev.clientY });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.cursor = "";
        document.body.classList.remove("wb-noselect");
        const s = live.current;
        if (!moved) {
          s.openRecord("initiative", p.id);
        } else if (tCol != null && s.board.quarters[tCol]) {
          s.updateInitiative(p.id, { targetDate: quarterEndISO(s.board.quarters[tCol].start), status: "in_progress" });
        } else if (tInbox && p.targetDate) {
          s.updateInitiative(p.id, { targetDate: null, status: "backlog" });
        }
        setDrag(null);
        setDropCol(null);
        setOverInbox(false);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  return (
    <div className="flex h-full min-h-0">
      {/* ── the pool — the same rail as the Schedule and the project deck, one
          clock speed up again: a bet needs a QUARTER. ────────────────────────── */}
      <PlannerRail
        dropAttr="data-inbox-drop"
        over={overInbox}
        crown={{
          eyebrow: `Next ${board.quarters.length} quarters`,
          done: onTrack,
          total: board.lanes.length,
          noun: "on track",
          onOpen: board.lanes.length > 0 ? () => setInitiativeView("groom") : undefined,
          openTitle: "Shape the bets that need it",
          gap:
            grooming + atRisk > 0
              ? {
                  label: `${grooming + atRisk} need${grooming + atRisk === 1 ? "s" : ""} you`,
                  detail: atRisk > 0 ? `${atRisk} at risk` : "needs OKRs or shaping",
                  onJump: () => setInitiativeView("groom"),
                }
              : null,
        }}
        poolLabel="Needs a quarter"
        poolCount={board.inbox.length}
        footLabel="initiative"
        footTitle="New initiative"
        footTeach="initiative-new"
        onFoot={() => openFloorModal("new-initiative")}
      >
        {board.inbox.length === 0 ? (
          <p className="px-1 py-6 text-center text-caption text-muted">
            Every initiative has a quarter. Drag one here to shelve it.
          </p>
        ) : (
          <div className="mt-1.5 flex flex-col gap-2">
            {board.inbox.map((i) => (
              <InitiativeCard
                key={i.id}
                lane={{
                  initiative: i,
                  state: "idea",
                  attainment: null,
                  krCount: i.keyResults.length,
                  uncovered: 0,
                  atRisk: { atRisk: false, reasons: [] },
                  gaps: [],
                  needsDomain: !i.domainId || !domainById(data, i.domainId),
                  quarterIdx: null,
                  overdue: false,
                }}
                data={data}
                onSetDomain={setDomain}
              />
            ))}
          </div>
        )}
      </PlannerRail>

      {/* ── the grid ─────────────────────────────────────────────────────────
          No hero: the crown anchors this surface (one hero per surface), and the
          floor's top bar already names On Deck. */}
      <div className="flex min-w-0 flex-1 flex-col px-6 pb-4 pt-2">
          <CoverageControls
            collapsed={coverageCollapsed}
            setCollapsed={setCoverageCollapsed}
            covered={coveredCount}
            tracked={coverageRows.length}
            domains={domainsSorted}
            hidden={coverageHidden}
            toggleHidden={toggleCoverageHidden}
            open={filterOpen}
            setOpen={setFilterOpen}
          />
          {/* the grid FILLS the pane — same rule as the project deck: short column
              stubs in a tall pane leave the coverage label gutter reading as a hole
              in the middle of the page instead of the grid's own margin. */}
          <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-auto pb-1">
            <div className="flex min-h-0 flex-1 flex-col" style={{ minWidth: gridMinW }}>
              {!coverageCollapsed && (
                <DomainCoverage
                  rows={coverageRows}
                  gridTemplate={cols}
                  columnGap={COL_GAP}
                  ruled={false}
                  itemNoun="initiative"
                  colNoun="quarter"
                  onAdd={addForDomain}
                />
              )}
              <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: cols }}>
                <div aria-hidden />
                {board.quarters.map((q) => {
              const lanes = byColumn.get(q.idx) ?? [];
              // The per-quarter cap counts open commitments — a finished bet doesn't
              // still owe the quarter anything, so it shouldn't trip the "over" warning
              // or hide the empty-quarter prompt (mirrors the project deck's pinch math,
              // which never counts a done project's hours as still-demanded).
              const openLanes = lanes.filter((l) => l.state !== "done");
              const risky = lanes.filter((l) => l.atRisk.atRisk).length;
              const over = openLanes.length > maxPerQuarter;
              const dropping = dropCol === q.idx;
              // "You are here" — a quiet band on the current quarter. Orientation,
              // not alarm: `--signal` stays for at-risk; `--slot` is the drop target.
              const current = q.idx === 0;
              return (
                <div
                  key={q.key}
                  data-quarter={q.idx}
                  className="fast relative flex min-w-0 flex-col border-l border-line px-2 pb-2.5"
                  style={{
                    background: dropping
                      ? "color-mix(in srgb, var(--slot) 14%, transparent)"
                      : current
                        ? NOW_BAND
                        : undefined,
                    borderTop: current ? NOW_BORDER : undefined,
                    boxShadow: dropping ? "inset 0 0 0 1.5px color-mix(in srgb, var(--slot) 45%, transparent)" : undefined,
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2 px-1 pb-0.5 pt-1">
                    <span className="flex items-center gap-1.5 text-caption font-semibold" style={{ color: current ? NOW_INK : "var(--ink)" }}>
                      {current && <span className="h-1.5 w-1.5 rounded-full" style={{ background: NOW_MARK }} />}
                      {q.label}
                    </span>
                    <span className="mono text-micro tabular-nums" title={`${openLanes.length} committed · max ${maxPerQuarter} — your per-quarter focus cap`} style={{ color: over ? CAUTION : "var(--muted)" }}>
                      {openLanes.length}/{maxPerQuarter}{over ? " ⚠" : ""}{risky > 0 && <span style={{ color: "var(--signal)" }}> · {risky}⚠</span>}
                    </span>
                  </div>
                  {/* month span + week scale — each column reads when it starts and
                      ends, and (for the current quarter) how many weeks deep you are. */}
                  <div className="mono px-1 pb-2 text-micro text-muted">
                    {quarterRangeLabel(q.start, q.end)}
                    {current
                      ? ` · week ${Math.min(weeksBetween(q.start, q.end) + 1, Math.max(1, weeksBetween(q.start, new Date()) + 1))}/${weeksBetween(q.start, q.end) + 1}`
                      : ` · ${weeksBetween(q.start, q.end) + 1} weeks`}
                  </div>

                  <div className="flex min-h-[60px] flex-1 flex-col gap-2">
                    {lanes.length === 0 && composeCol !== q.idx ? (
                      <div
                        onClick={() => composeInCol(q.idx)}
                        // Not flex-1: now that a column runs the full height of the
                        // pane, a stretched drop zone becomes a huge empty framed box
                        // — the loudest thing in an empty quarter. It stays a modest
                        // offer at the top; the rest of the column is a click target too.
                        className="slot-open fast cursor-pointer rounded-lg border px-2 py-6 text-center text-micro text-muted transition-colors"
                        title="New initiative in this quarter"
                      >
                        Drop an initiative here, or tap to add
                      </div>
                    ) : null}
                    {lanes.length === 0 && composeCol !== q.idx ? (
                      <div
                        onClick={() => composeInCol(q.idx)}
                        title="New initiative in this quarter"
                        className="slot-col fast min-h-[28px] flex-1 cursor-pointer rounded-lg transition-colors"
                      />
                    ) : (
                      <>
                        {lanes.map((l) => (
                          <InitiativeCard
                            key={l.initiative.id}
                            lane={l}
                            data={data}
                            onSetDomain={setDomain}
                          />
                        ))}
                        {composeCol === q.idx ? (
                          // the draft, right under the cards — the next slot, not pinned
                          // to the column's floor; a spacer fills whatever's left below.
                          <>
                            <div data-card-control onPointerDown={(e) => e.stopPropagation()}>
                              <InlineAdd
                                placeholder={composeDomain ? `Name a ${composeDomain.name} initiative…` : "Name an initiative…"}
                                accent={composeDom?.color ?? "var(--accent)"}
                                onCreate={(name) => createInCol(q.idx, name)}
                                onClose={closeCompose}
                              />
                            </div>
                            <div className="flex-1" />
                          </>
                        ) : (
                          // the empty space below the cards is a click target too —
                          // tap anywhere here to start an initiative in this quarter
                          <div
                            onClick={() => composeInCol(q.idx)}
                            title="New initiative in this quarter"
                            className="slot-col fast min-h-[28px] flex-1 cursor-pointer rounded-lg transition-colors"
                          />
                        )}
                      </>
                    )}
                  </div>

                  {/* pinned "+ initiative" — text cue, no dashed box. Hidden while composing. */}
                  {composeCol !== q.idx && (
                    <button
                      data-card-control
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); composeInCol(q.idx); }}
                      className="slot-hint tap fast mt-2 w-full py-2 text-center text-micro font-medium transition-colors hover:text-[color:var(--slot)]"
                      title="New initiative in this quarter"
                    >
                      + initiative
                    </button>
                  )}
                </div>
              );
            })}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-micro text-muted">Drag onto a quarter to commit a finish line · drag to the rail to shelve · click to open</span>
            <ShippedStrip rung="initiative" />
          </div>
      </div>

      {/* drag ghost */}
      {drag && (
        <div
          className="glass-grab pointer-events-none fixed z-[60] w-56 rounded-lg border border-line bg-surface px-3 py-2.5"
          style={{ left: drag.x + 14, top: drag.y + 8, transform: "rotate(-2deg)" }}
        >
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: drag.dot }} />
            <span className="truncate text-caption text-ink">{drag.name}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── one initiative card — a sibling of the project deck card: same silhouette
// (domain rail + dot + title, then a GROOMING METER + caption). The meter is the
// initiative's analogue of the project's readiness bars, so "which bets need grooming"
// scans at a glance — but with TWO segments (Defined · Measured), because a bet has two
// readiness axes (outcome+finish line, and key results); it has no pace/Fits axis. The
// deep OKR work (attainment, uncovered KRs, momentum) lives in Groom / the record. The
// one deck-specific keeper is the auto-link chip, shown only when a bet has no domain.
function InitiativeCard({
  lane,
  data,
  onSetDomain,
}: {
  lane: InitiativeLane;
  data: VerticalData;
  onSetDomain: (i: Initiative, domainId: string) => void;
}) {
  const { onContextMenu, menu } = useRecordContextMenu();
  const i = lane.initiative;
  const domain = domainById(data, i.domainId);
  const dot = domain?.color ?? "var(--line-strong)";
  const suggestion = lane.needsDomain ? suggestDomainForInitiative(data, i) : null;

  // grooming meter — the two readiness axes, coloured by how many are met (teal =
  // groomed, amber = mid, faint = raw), so a partial bar reads "needs grooming".
  const axes = initiativeReadinessAxes(data, i);
  const met = (axes.defined ? 1 : 0) + (axes.planned ? 1 : 0);
  const done = lane.state === "done";
  const pipTone: DeckTone = done ? "ready" : lane.state === "parked" ? "muted" : met === 2 ? "ready" : met === 1 ? "caution" : "muted";

  // The bet's weight isn't hours — it's how measured it is. Key results are the
  // unit, and attainment is the one *measured* number a bet has (Principle 6), so
  // it's shown only when there are KRs to average. Never a guess.
  const weight =
    lane.krCount === 0
      ? null
      : lane.attainment == null
        ? `${lane.krCount} KR${lane.krCount === 1 ? "" : "s"}`
        : `${lane.krCount} KR${lane.krCount === 1 ? "" : "s"} · ${Math.round(lane.attainment * 100)}%`;

  // one status word, by precedence — the shared rule the project card follows too
  // (the phone deck already called this; the desktop one had drifted into its own copy).
  const status = initiativeCardStatus(lane);

  return (
    <DeckCard
      dragAttr={{ "data-init-drag": i.id }}
      onContextMenu={onContextMenu("initiative", i.id)}
      className="cursor-grab active:cursor-grabbing"
      // The one altitude tell: the same domain spine, heavier and full-height, so a
      // bet reads as a weightier sibling — not a different kind of object.
      variant="bounded"
      spine={dot}
      eyebrow={domain?.name ?? "no area"}
      title={i.name}
      weight={weight}
      status={status}
      pips={done ? undefined : [axes.defined, axes.planned]}
      pipTone={pipTone}
      dim={lane.state === "parked"}
      shipped={done}
      footer={
        // auto-link — only when the bet has no domain yet (a placement necessity,
        // not default clutter); the deep OKR work lives in Groom / the record
        lane.needsDomain ? (
          <div data-card-control className="mt-2 flex items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
            {suggestion ? (
              <button
                onClick={() => onSetDomain(i, suggestion.domain.id)}
                className="tap fast flex items-center gap-1 rounded-full border px-2 py-0.5 text-micro font-medium"
                style={{ color: suggestion.domain.color, borderColor: `${suggestion.domain.color}66`, background: `${suggestion.domain.color}12` }}
                title="Link this initiative to its domain"
              >
                <span>{suggestion.domain.icon}</span>
                <span>Link → {suggestion.domain.name}</span>
              </button>
            ) : (
              <DomainPicker domains={data.domains} value="" onChange={(id) => onSetDomain(i, id)} />
            )}
          </div>
        ) : null
      }
    >
      {menu}
    </DeckCard>
  );
}
