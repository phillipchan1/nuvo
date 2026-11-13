// Initiative On Deck — the initiatives, grouped by the quarter they land in. The
// sibling of OnDeckPlanner (projects → weeks); here an initiative time-boxes onto a
// QUARTER. A kanban, not a Gantt: each column is a quarter, each card an initiative,
// and you drag a card between columns to move its finish line. The pool rail on the
// left holds initiatives with no quarter yet (mirrors the project planner's "needs a
// week"). Drawn by styles/decks.css, on the kit.
//
// Unlinked initiatives (no domain) surface a one-tap auto-link to the domain they
// belong under (suggestDomainForInitiative), so the tree stays connected without a
// form.
//
// Pointer-events drag (HTML5 DnD is swallowed by Tauri) — the same idiom as
// OnDeckPlanner / WeekBoard: one document-level capture pointerdown, a 5px move
// threshold to tell a drag from a click, elementFromPoint hit-testing.

import { armDragCancel } from "../../lib/dragCancel";
import { useOptionalUndoStack } from "../../hooks/useUndoStack";
import { writeWithUndo } from "../../lib/deckUndo";
import { useEffect, useMemo, useRef, useState } from "react";
import { getQuarter, getYear } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { useRecordContextMenu } from "../RecordContextMenu";
import { useMaxPerQuarter, useCoverageHidden, useCoverageCollapsed, useDeckByDomain } from "../../hooks/usePlannerPrefs";
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
import { DomainPicker } from "../floors/parts";
import ShippedStrip from "../floors/ShippedStrip";
import InlineAdd from "./InlineAdd";
import PlannerRail from "./PlannerRail";
import DeckCard, { type DeckTone } from "./DeckCard";
import GroomingSessionAction from "../floors/GroomingSessionAction";
import { initiativeCardStatus } from "./deckStatus";
import SlotCreateButton from "./SlotCreateButton";
import { LANE_LABEL_W, LaneCell, LaneLabel, domainLanes, laneColor, laneName } from "./DomainLanes";
import { ChipButton, Dot, EmptyState } from "../kit";
import { Icon } from "../Icon";
import ProjectDraftQuarter from "./ProjectDraftQuarter";
import { canDraftProjects, quarterWeeks } from "../../lib/projectDraft";

const COL_PX = 216;
// Quarters are adjacent, ruled columns (not gapped boxes) — the same demarcation
// the project deck's weeks use, so both decks read as one grid idiom.
const COL_GAP = 0;
// The left label column — holds coverage domain names, empty in the deck; aligns the
// coverage cells to the quarter columns beneath.
const LABEL_W = 96;
// A fixed near-term horizon — a year of quarters. Coverage measures load per
// domain (the pips), so a window selector was noise; near-term is what matters.
const HORIZON_QUARTERS = 4;
// By domain: a card-sized socket. The kanban stacks a cell's cards, so the lane's row
// is as tall as its fullest quarter — the socket keeps one card's height rather than
// stretching into a tall empty box beside a stack of three.
const SOCKET_H = 54;

export default function InitiativeDeck() {
  const { data, updateInitiative, updateProject, addInitiative } = useVertical();
  const { openRecord, openFloorModal, setInitiativeView } = useAppNavigation();
  const [maxPerQuarter] = useMaxPerQuarter();
  const [coverageHidden, toggleCoverageHidden] = useCoverageHidden("initiative");
  const [coverageCollapsed, setCoverageCollapsed] = useCoverageCollapsed("initiative");
  // "By domain" — one lane per domain × quarter (D-179, the project deck's toggle one
  // clock speed up). Scoped: the two decks remember it independently.
  const [byDomain, setByDomain] = useDeckByDomain("initiative");
  const [filterOpen, setFilterOpen] = useState(false);
  const now = useMemo(() => new Date(), []);
  const board = useMemo(() => readInitiativeDeck(data, now, HORIZON_QUARTERS, true), [data, now]);
  // Draft the projects (D-196): the quarter that's open over the deck, if any.
  const [drafting, setDrafting] = useState<{ lane: InitiativeLane; from: DOMRect | null } | null>(null);
  const draftQuarter = drafting ? board.quarters.find((q) => q.idx === drafting.lane.quarterIdx) ?? null : null;
  const draftWeeks = useMemo(
    () => (draftQuarter ? quarterWeeks({ start: draftQuarter.start, end: draftQuarter.end }, now) : []),
    [draftQuarter, now],
  );
  const onDraftProjects = (lane: InitiativeLane, from: DOMRect | null) => setDrafting({ lane, from });
  // The domain a lane-composed initiative lands in (reassignable in the record);
  // the first domain, mirroring the full composer's default.
  const domainsSorted = useMemo(() => [...data.domains].sort((a, b) => a.sort - b.sort), [data.domains]);
  const defaultDomain = domainsSorted[0] ?? null;

  // ── domain coverage — a NAMED read of "which domains have an initiative, and in
  // which quarter?", aligned OVER the quarter columns (shared grid + label gutter).
  // One row per tracked domain, a cell per shown quarter lit where a bet lands. Empty
  // cell = one-tap start an initiative for that domain in that quarter.
  const Q = board.quarters.length;
  // By domain the gutter widens to carry lane names; the extra comes out of the
  // columns' minimum so the toggle never changes the deck's total width.
  const labelW = byDomain ? LANE_LABEL_W : LABEL_W;
  const colMin = COL_PX - Math.ceil((labelW - LABEL_W) / Math.max(Q, 1));
  const cols = `${labelW}px repeat(${Q}, minmax(${colMin}px, 1fr))`;
  const gridMinW = labelW + Q * (colMin + COL_GAP);
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

  // the crown's read — the placed bets by health, mirroring the projects deck's
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
  // The ghost's identity is React state (it changes once, at drag start); its
  // POSITION is not — pointer coords go straight to the DOM node, as a transform,
  // so a drag never re-renders the deck per pointermove.
  const [drag, setDrag] = useState<{ name: string; dot: string; domainId: string | null } | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const ghostPos = useRef({ x: 0, y: 0 });
  const ghostTransform = (x: number, y: number) => `translate3d(${x + 14}px, ${y + 8}px, 0) rotate(-2deg)`;
  const [dropCol, setDropCol] = useState<number | null>(null);
  const [overInbox, setOverInbox] = useState(false);
  // click into a quarter → compose an initiative inline, right there (no modal). The
  // full composer (domain, finish line) stays a click away in the pool rail.
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

  // Column state, as data attributes the stylesheet draws: the current quarter
  // wears the faintest ember (now), the live drop target open time.
  const colState = (i: number) => ({
    "data-now": i === 0 ? "" : undefined,
    "data-drop": dropCol === i ? "" : undefined,
  });

  // ── a quarter's header — the Schedule's day header, two clock speeds up: the
  // year and the quarter's numeral (the current quarter on the ember disc), and
  // the quarter's open commitments against your cap. One copy for both layouts.
  const quarterHead = (q: (typeof board.quarters)[number]) => {
    const lanes = byColumn.get(q.idx) ?? [];
    // The per-quarter cap counts open commitments — a finished bet doesn't
    // still owe the quarter anything, so it shouldn't trip the "over" read
    // (mirrors the project deck's pinch math, which never counts a done
    // project's hours as still-demanded).
    const openLanes = lanes.filter((l) => l.state !== "done");
    const risky = lanes.filter((l) => l.atRisk.atRisk).length;
    const over = openLanes.length > maxPerQuarter;
    const weeks = weeksBetween(q.start, q.end) + 1;
    const into = q.idx === 0 ? Math.min(weeks, Math.max(1, weeksBetween(q.start, new Date()) + 1)) : null;
    // The cards below already say which bets are at risk; the header carries
    // the count only in its name and tooltip, so it is never said twice on screen.
    const read =
      `${openLanes.length} committed of ${maxPerQuarter}` +
      (over ? ", over the cap" : "") +
      (risky > 0 ? `, ${risky} at risk` : "");
    return (
      <div
        key={q.key}
        data-quarter={q.idx}
        className="dk-head-cell"
        {...colState(q.idx)}
        title={`${q.label} · ${quarterRangeLabel(q.start, q.end)} · ${into != null ? `week ${into} of ${weeks}` : `${weeks} weeks`}`}
      >
        <span>{getYear(q.start)}</span>
        <span className="dk-head-num">Q{getQuarter(q.start)}</span>
        <span className="dk-grow" />
        <span
          className="dk-load"
          data-some={openLanes.length > 0 ? "" : undefined}
          data-over={over ? "" : undefined}
          aria-label={read}
          title={`${read} — your per-quarter focus cap is ${maxPerQuarter}`}
        >
          {openLanes.length}/{maxPerQuarter}
        </span>
      </div>
    );
  };

  // ── By domain: one lane per domain (the shared rule, domainLanes), each a row of
  // quarter cells stacking that domain's bets — most urgent first, as in a column.
  const domainRows = byDomain ? domainLanes(data, domainsSorted, coverageHidden, board.lanes, (l) => l.initiative.domainId) : [];
  const renderLane = (lane: (typeof domainRows)[number]) => {
    const { domain } = lane;
    const name = laneName(domain);
    const cells = board.quarters.map((q) =>
      lane.items.filter((l) => (l.quarterIdx ?? 0) === q.idx).sort((a, b) => LANE_ORDER[a.state] - LANE_ORDER[b.state]),
    );
    const composing = composeCol != null && domain != null && composeDom?.id === domain.id;
    const span = "1 / span 2";
    return (
      <div
        key={lane.key}
        role="group"
        aria-label={`${name} — ${lane.items.length > 0 ? `${lane.items.length} initiative${lane.items.length === 1 ? "" : "s"}` : "nothing placed"}`}
        className="dk-lane"
        style={{
          gridTemplateColumns: cols,
          // one stacking row + a 10px tail: below a full stack, still a place to
          // start another bet for this domain in that quarter.
          gridTemplateRows: "minmax(62px, auto) 10px",
        }}
      >
        <LaneLabel domain={domain} count={lane.items.length} noun="initiative" gridRow={span} />
        {board.quarters.map((q) => (
          <LaneCell
            key={`c${q.idx}`}
            domain={domain}
            column={q.idx + 2}
            dropAttr={{ "data-quarter": String(q.idx) }}
            label={`New ${name} initiative in ${q.label}`}
            onAdd={() => domain && addForDomain(domain, q.idx)}
            // a bet being dragged lights its OWN lane in the quarter under the
            // pointer — where it will land (dragging never re-homes it).
            landing={drag != null && drag.domainId === domain?.id && dropCol === q.idx}
            socket={cells[q.idx].length === 0 && !(composing && composeCol === q.idx)}
            gridRow={span}
            socketStyle={{ alignSelf: "start", height: SOCKET_H }}
          />
        ))}
        {board.quarters.map((q) =>
          cells[q.idx].length > 0 || (composing && composeCol === q.idx) ? (
            // The stack ignores the pointer so empty space under it falls through
            // to the cell (create); the cards and the composer take it back.
            <div
              key={`s${q.idx}`}
              className="pointer-events-none relative flex min-w-0 flex-col gap-1.5 px-1.5 py-1"
              style={{ gridColumn: q.idx + 2, gridRow: 1 }}
            >
              {cells[q.idx].map((l) => (
                <div key={l.initiative.id} className="pointer-events-auto">
                  <InitiativeCard lane={l} data={data} onSetDomain={setDomain} onDraftProjects={onDraftProjects} inLane />
                </div>
              ))}
              {composing && composeCol === q.idx && (
                <div className="pointer-events-auto" data-card-control onPointerDown={(e) => e.stopPropagation()}>
                  <InlineAdd
                    placeholder={`Name a ${name} initiative…`}
                    accent={laneColor(domain)}
                    onCreate={(n) => createInCol(q.idx, n)}
                    onClose={closeCompose}
                  />
                </div>
              )}
            </div>
          ) : null,
        )}
      </div>
    );
  };

  const initiativeById = useMemo(() => new Map(data.initiatives.map((i) => [i.id, i])), [data.initiatives]);
  const { recordUndo } = useOptionalUndoStack();
  /** A deck drag is one ⌘Z: the fields it wrote go back to what they were. */
  const moveInitiative = (i: Initiative, patch: Partial<Initiative>, verb: string) =>
    writeWithUndo((x) => updateInitiative(i.id, x), i, patch, recordUndo, `${verb} “${i.name}”`, verb.toLowerCase());
  const live = useRef({ initiativeById, board, moveInitiative, openRecord, data });
  live.current = { initiativeById, board, moveInitiative, openRecord, data };

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const tgt = e.target as HTMLElement;
      // a control inside the card (domain picker, auto-link) handles itself
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
        ghostPos.current = { x: ev.clientX, y: ev.clientY };
        if (!moved) {
          moved = true;
          document.body.classList.add("wb-noselect");
          document.body.style.cursor = "grabbing";
          window.getSelection()?.removeAllRanges();
          // Identity set once, here; the position rides the ref below.
          setDrag({ name: p.name, dot, domainId: p.domainId ?? null });
        }
        if (ghostRef.current) ghostRef.current.style.transform = ghostTransform(ev.clientX, ev.clientY);
        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        const col = hit?.closest("[data-quarter]");
        if (col) { tCol = Number(col.getAttribute("data-quarter")); tInbox = false; }
        else if (hit?.closest("[data-inbox-drop]")) { tInbox = true; tCol = null; }
        else { tCol = null; tInbox = false; }
        setDropCol(tCol);
        setOverInbox(tInbox);
      };
      let cancelled = false;
      let disarm = () => {};
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.cursor = "";
        document.body.classList.remove("wb-noselect");
        disarm();
        if (cancelled) { tCol = null; tInbox = false; }
        const s = live.current;
        if (!moved) {
          s.openRecord("initiative", p.id);
        } else if (tCol != null && s.board.quarters[tCol]) {
          s.moveInitiative(p, { targetDate: quarterEndISO(s.board.quarters[tCol].start), status: "in_progress" }, "Moved");
        } else if (tInbox && p.targetDate) {
          s.moveInitiative(p, { targetDate: null, status: "backlog" }, "Shelved");
        }
        setDrag(null);
        setDropCol(null);
        setOverInbox(false);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      // Esc / ⌘Tab / an OS cancel ends the drag with nothing written.
      disarm = armDragCancel(() => {
        cancelled = true;
        if (moved) { up(); return; }
        // Not yet a drag: just stand down — never open the card on an Esc.
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.cursor = "";
        document.body.classList.remove("wb-noselect");
      });
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  return (
    <div className="dk">
      {/* Draft the projects (D-196): the quarter opens over the whole deck — the
          pool beside it has nothing to say while you walk a draft. */}
      {drafting && draftQuarter && draftWeeks.length > 0 && (
        <ProjectDraftQuarter
          initiative={drafting.lane.initiative}
          quarterLabel={draftQuarter.shortLabel}
          weeks={draftWeeks}
          color={domainById(data, drafting.lane.initiative.domainId)?.color ?? "var(--accent)"}
          from={drafting.from}
          onClose={() => setDrafting(null)}
        />
      )}
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
        footShortcut="I"
        onFoot={() => openFloorModal("new-initiative")}
        groomAction={<GroomingSessionAction kind="initiative" />}
      >
        {board.inbox.length === 0 ? (
          <EmptyState>Nothing waiting</EmptyState>
        ) : (
          <div className="pr-list">
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
          No hero: the crown is this surface's one hero, and the bar above already
          names the page. */}
      <div className="dk-pane">
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
          byDomain={byDomain}
          setByDomain={(v) => { closeCompose(); setByDomain(v); }}
          itemNoun="initiative"
        />
        {/* the grid FILLS the pane — same rule as the project deck. */}
        <div className="dk-scroll">
          <div className="dk-canvas" style={{ minWidth: gridMinW }}>
            {!byDomain && !coverageCollapsed && (
              <DomainCoverage
                rows={coverageRows}
                gridTemplate={cols}
                columnGap={COL_GAP}
                itemNoun="initiative"
                colNoun="quarter"
                onAdd={addForDomain}
              />
            )}

            {/* the quarters, over every column / lane — sticky, so a tall deck
                keeps its dates. */}
            <div className="dk-head" style={{ gridTemplateColumns: cols }}>
              <div aria-hidden className="dk-gutter" />
              {board.quarters.map(quarterHead)}
            </div>

            {byDomain ? (
              // body — full-height quarter columns behind (the now wash, the drop
              // wash, the rules, and ONE gutter for every lane), lanes on top. The
              // lanes ARE the coverage read here, so the strip steps aside.
              <div className="dk-body">
                <div className="dk-cols" style={{ gridTemplateColumns: cols }}>
                  <div aria-hidden className="dk-gutter" />
                  {board.quarters.map((q) => (
                    <div key={q.key} data-quarter={q.idx} className="dk-col" {...colState(q.idx)} />
                  ))}
                </div>
                <div className="relative pb-6">
                  {domainRows.length === 0 ? (
                    <div className="dk-empty">
                      <EmptyState>All domains hidden</EmptyState>
                    </div>
                  ) : (
                    domainRows.map(renderLane)
                  )}
                </div>
              </div>
            ) : (
              <div className="dk-qcols" style={{ gridTemplateColumns: cols }}>
                <div aria-hidden className="dk-gutter" />
                {board.quarters.map((q) => {
                  const lanes = byColumn.get(q.idx) ?? [];
                  const composing = composeCol === q.idx;
                  return (
                    <div key={q.key} data-quarter={q.idx} className="dk-qcol" {...colState(q.idx)}>
                      {lanes.map((l) => (
                        <InitiativeCard key={l.initiative.id} lane={l} data={data} onSetDomain={setDomain} onDraftProjects={onDraftProjects} />
                      ))}
                      {composing ? (
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
                        // the rest of the quarter is a click target too — anywhere
                        // below the cards starts an initiative in this quarter
                        <AddSlotFiller onAdd={() => composeInCol(q.idx)} label={`New initiative in ${q.label}`} />
                      )}

                      {/* "+ initiative" at the column's base — the one quiet create
                          voice both decks share. Hidden while composing. */}
                      {!composing && (
                        <SlotCreateButton
                          noun="initiative"
                          title="New initiative in this quarter"
                          onCreate={() => composeInCol(q.idx)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="dk-foot">
          <ShippedStrip rung="initiative" />
        </div>
      </div>

      {/* drag ghost — the bet in your hand, lifted onto --sh-pop */}
      {drag && (
        <div
          ref={ghostRef}
          className="deck-ghost"
          style={{ transform: ghostTransform(ghostPos.current.x, ghostPos.current.y) }}
        >
          <div className="deck-ghost-name">
            <Dot color={drag.dot} />
            <span>{drag.name}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The rest of a quarter column: drop target for a pointer, "add here" for a
 * keyboard. A button, so creating an initiative *in a particular quarter* is
 * never a mouse-only act (`I` opens the composer from anywhere, but it can't say
 * which column you meant).
 *
 * The words appear on keyboard focus: an invisible tab stop is worse than no tab
 * stop — the ring would land on an empty rectangle. Under a pointer the column's
 * own "+ initiative" already says it.
 */
function AddSlotFiller({ onAdd, label }: { onAdd: () => void; label: string }) {
  return (
    <button type="button" onClick={onAdd} title={label} className="dk-filler">
      <span>{label}</span>
    </button>
  );
}

// ── one initiative card — the deck card, bounded: the same object as a project
// card, its domain hue its left edge rather than a mark on it (D-048). The
// readiness pie draws its two axes (Defined · Measured — a bet has no pace/Fits
// axis). The deep OKR work (attainment, uncovered KRs, momentum) lives in Groom /
// the record. The one deck-specific keeper is the auto-link chip, shown only when
// a bet has no domain.
function InitiativeCard({
  lane,
  data,
  onSetDomain,
  onDraftProjects,
  inLane = false,
}: {
  lane: InitiativeLane;
  data: VerticalData;
  onSetDomain: (i: Initiative, domainId: string) => void;
  /** ✦ Draft the projects — offered only just in time (canDraftProjects, D-196) */
  onDraftProjects?: (lane: InitiativeLane, from: DOMRect | null) => void;
  /** By domain: the lane names the area, so the card stops saying it (D-122). */
  inLane?: boolean;
}) {
  const { onContextMenu, menu } = useRecordContextMenu();
  const i = lane.initiative;
  const domain = domainById(data, i.domainId);
  const dot = domain?.color ?? "var(--faint)";
  const suggestion = lane.needsDomain ? suggestDomainForInitiative(data, i) : null;

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

  // one status word, by precedence — the shared rule the project card follows too.
  const status = initiativeCardStatus(lane);

  return (
    <DeckCard
      dragAttr={{ "data-init-drag": i.id }}
      onContextMenu={onContextMenu("initiative", i.id)}
      className="cursor-grab active:cursor-grabbing"
      // The one altitude tell: the same domain hue, as the card's edge, so a
      // bet reads as a weightier sibling — not a different kind of object.
      variant="bounded"
      spine={dot}
      eyebrow={inLane ? (weight ?? "") : (domain?.name ?? "no area")}
      title={i.name}
      weight={inLane ? null : weight}
      status={status}
      pips={done ? undefined : [axes.defined, axes.planned]}
      pipTone={pipTone}
      dim={lane.state === "parked"}
      shipped={done}
      footer={
        // auto-link — only when the bet has no domain yet (a placement necessity,
        // not default clutter); the deep OKR work lives in Groom / the record
        lane.needsDomain ? (
          <div data-card-control className="flex items-center gap-2 pt-1" onPointerDown={(e) => e.stopPropagation()}>
            {suggestion ? (
              <ChipButton
                dot={suggestion.domain.color}
                onClick={() => onSetDomain(i, suggestion.domain.id)}
                title="Link this initiative to its domain"
              >
                Link to {suggestion.domain.name}
              </ChipButton>
            ) : (
              <DomainPicker domains={data.domains} value="" onChange={(id) => onSetDomain(i, id)} />
            )}
          </div>
        ) : onDraftProjects && canDraftProjects(data, lane) ? (
          // just in time: this quarter or next, an outcome to read, no open
          // project under it — the one moment the bet is missing its projects
          <div data-card-control className="flex pt-1" onPointerDown={(e) => e.stopPropagation()}>
            <ChipButton
              icon={<Icon name="sparkles" size={12} />}
              onClick={(e) => {
                e.stopPropagation();
                onDraftProjects(lane, (e.currentTarget.closest(".deck-card") as HTMLElement | null)?.getBoundingClientRect() ?? null);
              }}
              title="Nuvo drafts the projects this outcome is missing, across the quarter. Nothing is added until you hold it."
            >
              Draft the projects
            </ChipButton>
          </div>
        ) : null
      }
    >
      {menu}
    </DeckCard>
  );
}
