// On Deck (the planner) — the project altitude's Schedule. A project is either
// in the INBOX (no week committed) or PLACED on the timeline (committed to a
// week, snapped to whole-week increments). You *timebox* a project the way you
// timebox a task: drag it from the inbox onto a week. Drag a bar across weeks to
// move it (the bar follows live so you see where it lands), grab an edge to
// resize its span, or drag off onto the inbox rail to un-commit. Click a project
// (no drag) opens its record for full editing. Floor-only + full page — the
// compact OnDeckTimeline stays the read-view for the groom flow / mobile sheet.
//
// Pointer-events drag (HTML5 DnD is swallowed by Tauri) — same idiom as WeekBoard
// / CalendarPane: one document-level capture pointerdown, a 5px move threshold to
// tell a drag from a click, elementFromPoint hit-testing, imperative during-drag.

import { armDragCancel } from "../../lib/dragCancel";
import { useOptionalUndoStack } from "../../hooks/useUndoStack";
import { writeWithUndo } from "../../lib/deckUndo";
import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, format } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import { useDeferProject } from "../../hooks/useProjectTime";
import { useCapacity } from "../../hooks/useCapacity";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { useMaxPerWeek, useCoverageHidden, useCoverageCollapsed, useDeckByDomain } from "../../hooks/usePlannerPrefs";
import { useRecordContextMenu } from "../RecordContextMenu";
import { domainById, isOpenStatus, type Domain, type Project } from "../../lib/vertical";
import { readOnDeck, sprintSpanFor, weekIndexIn } from "../../lib/onDeck";
import { weekName, weekSpan as weekDates } from "../../lib/week";
import { noticeIfUnready } from "../../lib/readyNotice";
import ShippedStrip from "../floors/ShippedStrip";
import InlineAdd from "./InlineAdd";
import DomainCoverage, { type CoverageRow } from "./DomainCoverage";
import CoverageControls from "./CoverageControls";
import PlannerRail from "./PlannerRail";
import { LANE_LABEL_W, LaneCell, LaneLabel, domainLanes, laneColor, laneName } from "./DomainLanes";
import DeckCard from "./DeckCard";
import GroomingSessionAction from "../floors/GroomingSessionAction";
import { deckWeight } from "../../lib/pace";
import { PIP_TONE, projectCardStatus } from "./deckStatus";
import { SlotCreateHint } from "./SlotCreateButton";
import { pressable } from "../../lib/a11y";
import { Dot, EmptyState } from "../kit";

// A planning surface wants runway — show more weeks than the compact hub and let
// it scroll. More than this many projects committed to one week is a red flag.
// The left label column — holds coverage domain names, empty in the deck; wide enough
// for a domain name, so coverage cells align to the sprint columns beneath. Kept as
// narrow as the names allow: below the strip it's necessarily blank, and every pixel
// of it is a void running down the middle of the page.
const LABEL_W = 96;
// An empty lane is still a full row: the gap IS the information, so it can't be
// allowed to collapse into a hairline. (The lane parts — gutter, label, cell, socket,
// which domains get a lane — are shared with the initiative deck: DomainLanes.tsx.)
const LANE_ROW_MIN = 62;
// A fixed near-term horizon — the deck is for scaffolding the next stretch; coverage
// measures load per domain over it. (A window selector proved to be noise once the
// pips carried "how much" per lane.)
const HORIZON_WEEKS = 4;
// Column width. The card lost its checkbox, its second domain dot and its full-width
// meter, so it needs less: narrower columns mean the whole 4-week horizon fits a
// typical pane instead of leaving a truncated card hanging off the right edge — the
// deck's job is to show you the collision, and a horizon you have to scroll to see
// isn't one. `minmax(…, 1fr)` still lets the columns stretch when there's room.
const WEEK_COL_PX = 216;

const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const clampIdx = (i: number, H: number) => Math.max(0, Math.min(i, H - 1));

// Placement geometry (which week a date lands in, and the span a drop writes) is
// shared with the phone's week deck — one rule, in lib/onDeck.ts.
const weekIndex = weekIndexIn;
const weekSpan = sprintSpanFor;

type Preview = { id: string; start: number; end: number } | null;

export default function OnDeckPlanner() {
  const { data, updateProject, addProject } = useVertical();
  const defer = useDeferProject();
  const { onContextMenu, menu } = useRecordContextMenu();
  const { byWeek, weeklyAvgMins } = useCapacity();
  const { openRecord, openFloorModal, setProjectView } = useAppNavigation();
  const [maxPerWeek] = useMaxPerWeek();
  const [coverageHidden, toggleCoverageHidden] = useCoverageHidden();
  const [coverageCollapsed, setCoverageCollapsed] = useCoverageCollapsed();
  // "By domain" — the deck split into one lane per domain, so a domain with nothing
  // in a week shows as an empty socket in its own row instead of an absence you'd
  // have to notice by reading every card's eyebrow.
  const [byDomain, setByDomain] = useDeckByDomain();
  const now = useMemo(() => new Date(), []);
  const board = useMemo(() => readOnDeck(data, byWeek, weeklyAvgMins, now, HORIZON_WEEKS, true), [data, byWeek, weeklyAvgMins, now]);
  // The domain a lane-composed project lands in (reassignable in the record); the
  // first domain, mirroring the full composer's default.
  const defaultDomain = useMemo(() => [...data.domains].sort((a, b) => a.sort - b.sort)[0] ?? null, [data.domains]);

  const H = board.horizonWeeks;
  // A leading LABEL column runs down the left of the whole planner — it holds the
  // coverage strip's domain names, and stays empty in the deck below, so the coverage
  // cells sit in TRUE columns above their sprints (the aligned demarcation). Deck +
  // coverage share this one template, so a lit coverage cell points straight down at
  // its week column.
  // The lane gutter's extra width comes OUT of the week columns' minimum, so both
  // layouts need the same total width: flipping the toggle must never be the thing
  // that pushes the horizon off the pane (it did, by 6px, at a 1680 window).
  const labelW = byDomain ? LANE_LABEL_W : LABEL_W;
  const weekMin = WEEK_COL_PX - Math.ceil((labelW - LABEL_W) / H);
  const cols = `${labelW}px repeat(${H}, minmax(${weekMin}px, 1fr))`;
  const gridMinW = labelW + H * weekMin;

  const placed = board.lanes.filter((l) => l.project.targetDate);
  // Inbox = every open project NOT on the timeline. That's not just the undated
  // ones: a backlog project WITH a date isn't in-flight so it's off the timeline,
  // yet it still needs a week — it belongs here, not lost between the two.
  const placedIds = new Set(placed.map((l) => l.project.id));
  const inbox = data.projects.filter((p) => isOpenStatus(p.status) && !placedIds.has(p.id));
  // Readiness distribution across the deck — the header rollup. Parked is excluded
  // (it's settled by choice, not a grooming deficit).
  const readyN = placed.filter((l) => l.readyTier === "ready").length;
  const groomN = placed.filter((l) => l.readyTier === "grooming").length;
  const rawN = placed.filter((l) => l.readyTier === "raw").length;
  const doneN = placed.filter((l) => l.readyTier === "done").length;

  // ── drag state (in React so the bar + counts preview live) ───────────────────
  // inbox drags ride a card-shaped ghost (placed bars preview in place instead)
  // The ghost's identity is React state (it changes once, at drag start); its
  // POSITION is not — pointer coords go straight to the DOM node per rAF.
  // Routing x/y through setState re-rendered the whole planner per pointermove
  // (51 commits and 9–10 dropped frames per drag in the audit).
  const [drag, setDrag] = useState<{ name: string; dot: string; sub: string; domainId: string | null } | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const ghostPos = useRef({ x: 0, y: 0 });
  const ghostTransform = (x: number, y: number) => `translate3d(${x + 14}px, ${y + 8}px, 0) rotate(-2deg)`;
  const [dropWeek, setDropWeek] = useState<number | null>(null);
  const [overInbox, setOverInbox] = useState(false);
  const [preview, setPreview] = useState<Preview>(null);

  // "Is there more week to the right?" — the one bit the edge fade needs.
  // Deliberately a boolean and not a scroll position: the listener is passive
  // and the setState only fires when the answer actually flips, so scrolling a
  // 4-week strip commits nothing, and a drag across it (which is what this
  // surface is for) never re-renders the planner from here.
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [moreRight, setMoreRight] = useState(false);
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const read = () => {
      const more = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setMoreRight((prev) => (prev === more ? prev : more));
    };
    read();
    el.addEventListener("scroll", read, { passive: true });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", read);
      ro.disconnect();
    };
  }, []);
  // No completion control on the card. Shipping a project is a *judgment* — the
  // assessment asks about the leftovers — and it is not this surface's act
  // (D-023: the timeline decides, the deck does). It stayed reachable the whole
  // time from right-click ("Ship it…" in RecordContextMenu) and from the record,
  // and completion still derives on its own once every task is done. What the
  // check cost was the card's left edge: the eye met a control before it met the
  // name.
  // Click an empty week → compose a project inline, right there in that week (no
  // modal). The full composer (domain, tasks, links) stays a click away in the inbox.
  // composeDomain carries an explicit domain when the compose was launched from a
  // coverage chip ("start a Frontier project"); otherwise the default domain stands.
  const [composeWeek, setComposeWeek] = useState<number | null>(null);
  const [composeDomain, setComposeDomain] = useState<Domain | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const domainsSorted = useMemo(() => [...data.domains].sort((a, b) => a.sort - b.sort), [data.domains]);
  const composeDom = composeDomain ?? defaultDomain;
  const closeCompose = () => { setComposeWeek(null); setComposeDomain(null); };
  const createInWeek = async (i: number, name: string) => {
    const ws = board.weeks[i]?.weekStart;
    if (!ws || !composeDom) { openFloorModal("new-project"); return; }
    await addProject(composeDom.id, null, {
      name,
      startDate: toISO(ws),
      targetDate: toISO(addDays(ws, 4)),
      status: "in_progress",
    });
  };

  // start a project for a domain in a chosen sprint — drop the inline composer into
  // that week's column, pre-bound to the domain (the one-tap recovery from a gap,
  // straight from the coverage cell you clicked).
  const addForDomain = (dom: Domain, weekIdx: number) => {
    setComposeDomain(dom);
    setComposeWeek(weekIdx);
  };

  // Data-derived bar geometry. A project with no explicit start defaults to a
  // ONE-WEEK box at its due week — never a bar stretched from week 0.
  const geom = placed.map((l) => {
    const dIdx = clampIdx(l.dueWeekIdx ?? H - 1, H);
    const sIdx = l.project.startDate ? clampIdx(weekIndex(board.weeks, l.project.startDate), H) : dIdx;
    return { l, start: Math.min(sIdx, dIdx), end: Math.max(sIdx, dIdx), beyond: l.dueWeekIdx == null };
  });
  const effGeom = geom.map((g) =>
    preview && preview.id === g.l.project.id
      ? { ...g, start: clampIdx(preview.start, H), end: clampIdx(preview.end, H), beyond: false }
      : g,
  );
  // Projects committed to each week (live under the drag) — the overload gauge.
  // Finished projects don't count as load (they're no longer pending work).
  const weekLoad = board.weeks.map((_, i) => effGeom.filter((g) => i >= g.start && i <= g.end && g.l.readyTier !== "done").length);

  // ── domain coverage — a NAMED read (color alone fails: you don't memorize the
  // palette), aligned OVER the deck columns. Off effGeom (previews live under a drag):
  // one row per tracked domain, a cell per shown week lit under the sprints it lands
  // in. The cells carry the meaning — no status words, no "idle" label. Hidden domains
  // (the coverage filter) drop out entirely.
  const coverageRows: CoverageRow[] = domainsSorted
    .filter((domain) => !coverageHidden.has(domain.id))
    .map((domain) => {
      const cells = new Array(H).fill(0) as number[];
      for (const g of effGeom)
        if (g.l.project.domainId === domain.id)
          for (let i = g.start; i <= g.end; i++) if (i >= 0 && i < H) cells[i] += 1;
      return { domain, cells };
    });
  const coveredCount = coverageRows.filter((r) => r.cells.some((c) => c > 0)).length;

  // Lane-packing: bars that don't overlap in time share a row, so the same week's
  // projects stack together in a column instead of staggering one-per-row. Row
  // assignment uses the BASE geom (stable during a drag); the preview only slides
  // a bar's column within its row.
  // Pack most-ready first so the greedy first-fit lands ready cards in the top
  // rows — "shaped to top" within each week — then by time to keep bars tidy.
  type Geom = (typeof geom)[number];
  const doneRank = (g: Geom) => (g.l.readyTier === "done" ? 1 : 0);
  const pack = (gs: Geom[]): Geom[][] => {
    const out: Geom[][] = [];
    for (const g of [...gs].sort(
      (a, b) => doneRank(a) - doneRank(b) || b.l.readyCount - a.l.readyCount || a.start - b.start || a.end - b.end,
    )) {
      const row = out.find((r) => r.every((x) => !(g.start <= x.end && x.start <= g.end)));
      if (row) row.push(g);
      else out.push([g]);
    }
    return out;
  };
  const rows = pack(geom);

  // ── By domain: the same packing, run once per domain, so each lane is its own
  // small deck. Which domains get a lane, and in what order, is the shared rule
  // (domainLanes) — the initiative deck reads By domain through the same one.
  const lanes = byDomain
    ? domainLanes(data, domainsSorted, coverageHidden, geom, (g) => g.l.project.domainId).map((ln) => ({ ...ln, rows: pack(ln.items) }))
    : [];
  const effOf = (g: Geom) =>
    preview && preview.id === g.l.project.id
      ? { start: clampIdx(preview.start, H), end: clampIdx(preview.end, H), beyond: false }
      : { start: g.start, end: g.end, beyond: g.beyond };

  // Where the inline composer slots in for the week being composed: the first row
  // that has no card in that week, so the draft lands *directly beneath* that
  // column's last card (as the next slot) — not pinned to the column's bottom.
  // -1 = not composing; rows.length = every row is occupied there, so append one.
  const cw = composeWeek;
  const composeRowIdx =
    cw == null
      ? -1
      : (() => {
          const idx = rows.findIndex((row) => !row.some((g) => g.start <= cw && g.end >= cw));
          return idx === -1 ? rows.length : idx;
        })();
  // The draft card itself — a real card-sized cell in the clicked week's column,
  // top-aligned so it doesn't stretch to a tall sibling. Slotted into the grid at
  // composeRowIdx below.
  const composerCell =
    cw == null ? null : (
      <div style={{ gridColumn: `${cw + 2} / ${cw + 3}`, gridRow: 1 }} className="pointer-events-auto mx-1.5 self-start">
        <InlineAdd
          placeholder={composeDomain ? `Name a ${composeDomain.name} project…` : "Name a project…"}
          accent={composeDom?.color ?? "var(--accent)"}
          onCreate={(name) => createInWeek(cw, name)}
          onClose={closeCompose}
        />
      </div>
    );


  // One card, both layouts. By domain the lane already names the area, so the card
  // stops saying it — a surface that draws a fact doesn't also write it (D-122) —
  // and its meta line keeps only the weight.
  const renderCard = (g: Geom, gridRow: number) => {
    const { l } = g;
    const { start, end, beyond } = effOf(g);
    const dom = domainById(data, l.project.domainId);
    const dot = dom?.color ?? "var(--accent)";
    const dragging = preview?.id === l.project.id;
    const done = l.readyTier === "done";
    const weight = done ? null : deckWeight(l.pace.remainingMins);
    return (
      <DeckCard
        key={l.project.id}
        dragAttr={{ "data-project-drag": l.project.id }}
        onContextMenu={onContextMenu("project", l.project.id)}
        className={`pointer-events-auto mx-1.5 min-h-[54px] cursor-grab active:cursor-grabbing ${byDomain ? "my-1" : ""}`}
        style={{ gridColumn: `${start + 2} / ${end + 3}`, gridRow }}
        lifted={dragging}
        beyond={beyond}
        spine={dot}
        // By domain the lane names the area, so the card neither draws nor
        // writes it (D-122) — its meta line keeps only the weight.
        mark={!byDomain}
        eyebrow={byDomain ? (weight ?? "") : (dom?.name ?? "no area")}
        title={l.project.name}
        // the weight the pinch math actually runs on — a column of
        // hours explains an over-committed sprint; a count doesn't.
        weight={byDomain ? null : weight}
        status={projectCardStatus(l)}
        pips={done ? undefined : [l.axes.defined, l.axes.planned, l.axes.fits === true]}
        pipTone={PIP_TONE[l.readyTier]}
        dim={l.readyTier === "parked"}
        shipped={done}
      >
        <span data-resize="start" className="absolute inset-y-0 left-0 w-2.5 cursor-ew-resize" aria-hidden />
        <span data-resize="end" className="absolute inset-y-0 right-0 w-2.5 cursor-ew-resize" aria-hidden />
      </DeckCard>
    );
  };

  // ── a lane (By domain): label · per-week create cells · its own packed rows ──
  const renderLane = (lane: (typeof lanes)[number]) => {
    const { domain } = lane;
    const name = laneName(domain);
    const color = laneColor(domain);
    // live coverage under a drag (effOf), so a socket fills the moment a bar slides
    // into this lane's week — the same live read the strip gave.
    const covered = board.weeks.map((w) => lane.rows.some((r) => r.some((g) => { const e = effOf(g); return w.idx >= e.start && w.idx <= e.end; })));
    const count = lane.items.length;
    const composing = cw != null && (composeDom?.id ?? null) === (domain?.id ?? null) && domain != null;
    const laneComposeRow = composing
      ? (() => { const i = lane.rows.findIndex((r) => !r.some((g) => g.start <= cw! && g.end >= cw!)); return i === -1 ? lane.rows.length : i; })()
      : -1;
    const nRows = Math.max(1, lane.rows.length + (laneComposeRow === lane.rows.length ? 1 : 0));
    const span = `1 / span ${nRows + 1}`;
    return (
      <div
        key={lane.key}
        role="group"
        aria-label={`${name} — ${count > 0 ? `${count} project${count === 1 ? "" : "s"}` : "nothing placed"}`}
        className="dk-lane"
        style={{
          gridTemplateColumns: cols,
          // a 10px tail under the last row: the strip where a covered week can
          // still take a second project (the cell above it is all card).
          gridTemplateRows: `repeat(${nRows}, minmax(${LANE_ROW_MIN}px, auto)) 10px`,
        }}
      >
        <LaneLabel domain={domain} count={count} noun="project" gridRow={span} />

        {/* per-week cells — the create control for THIS domain in THIS week, and a
            socket where the week has nothing for it (see LaneCell). */}
        {board.weeks.map((w) => (
          <LaneCell
            key={`c${w.idx}`}
            domain={domain}
            column={w.idx + 2}
            dropAttr={{ "data-week": String(w.idx) }}
            label={`New ${name} project — ${weekName(w.weekStart).toLowerCase()}`}
            onAdd={() => domain && addForDomain(domain, w.idx)}
            // Dragging a project in from the rail: its OWN lane lights in the week
            // under the pointer — exactly where it will land, before the drop.
            landing={drag != null && drag.domainId === domain?.id && dropWeek === w.idx}
            socket={!covered[w.idx] && !(composing && cw === w.idx)}
            gridRow={span}
          />
        ))}

        {lane.rows.map((row, ri) => (
          <div key={ri} className="contents">
            {row.map((g) => renderCard(g, ri + 1))}
          </div>
        ))}
        {composing && cw != null && (
          <div style={{ gridColumn: `${cw + 2} / ${cw + 3}`, gridRow: laneComposeRow + 1 }} className="relative z-[1] mx-1.5 my-1 self-start">
            <InlineAdd
              placeholder={`Name a ${name} project…`}
              accent={color}
              onCreate={(n) => createInWeek(cw, n)}
              onClose={closeCompose}
            />
          </div>
        )}
      </div>
    );
  };

  const projectById = useMemo(() => new Map(data.projects.map((p) => [p.id, p])), [data.projects]);
  const { recordUndo } = useOptionalUndoStack();
  /** A deck drag is one ⌘Z: the fields it wrote go back to what they were. */
  const moveProject = (p: Project, patch: Partial<Project>, verb: string) =>
    // Undo restores the STORED status, never the derived one (an all-done project reads `complete`).
    writeWithUndo((x) => updateProject(p.id, x), { ...p, status: p.storedStatus }, patch, recordUndo, `${verb} “${p.name}”`, verb.toLowerCase());
  const live = useRef({ projectById, board, moveProject, openRecord, data, defer });
  live.current = { projectById, board, moveProject, openRecord, data, defer };

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const tgt = e.target as HTMLElement;
      const el = tgt?.closest?.("[data-project-drag]") as HTMLElement | null;
      if (!el) return;
      const id = el.getAttribute("data-project-drag");
      const p = id ? live.current.projectById.get(id) : null;
      if (!p) return;
      const handle = tgt?.closest?.("[data-resize]")?.getAttribute("data-resize");
      const mode: "move" | "start" | "end" = handle === "start" ? "start" : handle === "end" ? "end" : "move";
      const weeks = live.current.board.weeks;
      // "from inbox" = not on the timeline (an inbox card can still carry a date).
      const fromInbox = !live.current.board.lanes.some((l) => l.project.id === p.id && l.project.targetDate);
      const ghostDot = domainById(live.current.data, p.domainId)?.color ?? "var(--accent)";
      const ghostSub = !p.targetDate ? "no finish line" : `due ${format(new Date(p.targetDate + "T00:00:00"), "MMM d")}`;
      // current geometry (default 1 week when there's no explicit start)
      const dIdx0 = weekIndex(weeks, p.targetDate);
      const sIdx0 = p.startDate ? weekIndex(weeks, p.startDate) : dIdx0;
      const curStart = Math.min(sIdx0, dIdx0);
      const curEnd = Math.max(sIdx0, dIdx0);
      const width = fromInbox ? 1 : curEnd - curStart + 1;
      const origin = { x: e.clientX, y: e.clientY };
      let moved = false;
      let tWeek: number | null = null;
      let tInbox = false;

      // rAF coalescing: pointermove can fire past 120Hz, and every call used to
      // hit-test + setState — the audit clocked 51 commits and a 49.9ms `up`
      // LoAF on one drag. Now the latest pointer event is stashed and ONE flush
      // runs per frame; React state only changes when the derived target
      // actually changed, and the ghost is a direct transform write.
      let lastEv: PointerEvent | null = null;
      let raf = 0;
      let prevWeek: number | null = null;
      let prevInbox = false;
      let prevPreviewKey = "";

      const flush = () => {
        raf = 0;
        const ev = lastEv;
        if (!ev) return;
        if (!moved && Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) < 5) return;
        if (!moved) {
          moved = true;
          document.body.classList.add("wb-noselect");
          // bars + handles ignore the pointer mid-drag so hit-testing sees the
          // week cells beneath (see .odp-dragging in index.css).
          document.body.classList.add("odp-dragging");
          document.body.style.cursor = mode === "move" ? "grabbing" : "ew-resize";
          window.getSelection()?.removeAllRanges();
          // live preview: an inbox project has no bar yet, so it rides the
          // floating chip + column highlight. Identity set once, here.
          if (fromInbox) setDrag({ name: p.name, dot: ghostDot, sub: ghostSub, domainId: p.domainId ?? null });
        }
        ghostPos.current = { x: ev.clientX, y: ev.clientY };
        if (ghostRef.current) ghostRef.current.style.transform = ghostTransform(ev.clientX, ev.clientY);
        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        const wk = hit?.closest("[data-week]");
        if (wk) { tWeek = Number(wk.getAttribute("data-week")); tInbox = false; }
        else if (mode === "move" && hit?.closest("[data-pool-drop]")) { tInbox = true; tWeek = null; }
        else { tWeek = null; tInbox = false; }
        if (tWeek !== prevWeek) { prevWeek = tWeek; setDropWeek(tWeek); }
        if (tInbox !== prevInbox) { prevInbox = tInbox; setOverInbox(tInbox); }
        // existing bars follow to their prospective span
        let next: Preview = null;
        if (!fromInbox && tWeek != null) {
          if (mode === "move") next = { id: p.id, start: tWeek, end: tWeek + width - 1 };
          else if (mode === "end") next = { id: p.id, start: curStart, end: Math.max(tWeek, curStart) };
          else next = { id: p.id, start: Math.min(tWeek, curEnd), end: curEnd };
        }
        const nextKey = next ? `${next.id}:${next.start}:${next.end}` : "";
        if (nextKey !== prevPreviewKey) { prevPreviewKey = nextKey; setPreview(next); }
      };

      const move = (ev: PointerEvent) => {
        lastEv = ev;
        if (!raf) raf = requestAnimationFrame(flush);
      };
      let cancelled = false;
      let disarm = () => {};
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        // a final flush so the drop uses the last pointer position, not the
        // last painted frame
        flush();
        document.body.style.cursor = "";
        document.body.classList.remove("wb-noselect");
        document.body.classList.remove("odp-dragging");
        disarm();
        if (cancelled) { tWeek = null; tInbox = false; }
        const s = live.current;
        const w = s.board.weeks;
        if (!moved) {
          s.openRecord("project", p.id);
        } else if (mode === "move" && tWeek != null && w[tWeek]) {
          s.moveProject(p, { ...weekSpan(p, w[tWeek].weekStart), status: "in_progress" }, "Moved");
          // Dropped either way — but say what an unshaped project costs the week.
          noticeIfUnready(s.data, p, () => s.openRecord("project", p.id));
        } else if (mode === "move" && tInbox && p.targetDate) {
          // Off the deck — and off the calendar it was still holding.
          void s.defer.takeOff(p, undefined, { status: "backlog" });
        } else if (mode === "end" && tWeek != null && w[tWeek]) {
          const wi = Math.max(tWeek, weekIndex(w, p.startDate));
          s.moveProject(p, { targetDate: toISO(addDays(w[wi].weekStart, 4)), status: "in_progress" }, "Changed the finish of");
        } else if (mode === "start" && tWeek != null && w[tWeek]) {
          const wi = Math.min(tWeek, weekIndex(w, p.targetDate));
          s.moveProject(p, { startDate: toISO(w[wi].weekStart), status: "in_progress" }, "Changed the start of");
        }
        setDrag(null);
        setDropWeek(null);
        setOverInbox(false);
        setPreview(null);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      // Esc / ⌘Tab / an OS cancel ends the drag with nothing written.
      disarm = armDragCancel(() => {
        cancelled = true;
        if (moved) { up(); return; }
        // Not yet a drag: just stand down — never open the card on an Esc.
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.cursor = "";
        document.body.classList.remove("wb-noselect");
      });
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  // Column state, as data attributes the stylesheet draws (styles/decks.css):
  // the current week (idx 0) wears the faintest ember — the same "now" as the
  // Schedule's today column — and the live drop target wears open time.
  const colState = (i: number) => ({
    "data-now": i === 0 ? "" : undefined,
    "data-drop": dropWeek === i ? "" : undefined,
  });

  return (
    <div className="dk">
      {menu}
      {/* ── the pool — the same rail the Schedule wears, one clock speed up:
          "needs a week" instead of "needs a time". Structure, not a panel. ──── */}
      <PlannerRail
        dropAttr="data-pool-drop"
        over={overInbox}
        crown={{
          eyebrow: `Next ${H} weeks`,
          // a finished project isn't waiting on you either — it counts as ready,
          // so the count can actually reach full at the end of a week.
          done: readyN + doneN,
          total: placed.length,
          noun: "ready",
          onOpen: placed.length > 0 ? () => setProjectView("groom") : undefined,
          openTitle: "Shape the projects that need it",
          gap:
            groomN + rawN > 0
              ? {
                  label: `${groomN + rawN} need shaping`,
                  detail: rawN > 0 ? `${rawN} raw` : "mid-groom",
                  onJump: () => setProjectView("groom"),
                }
              : null,
        }}
        poolLabel="Needs a week"
        poolCount={inbox.length}
        footLabel="project"
        footTitle="New project"
        footTeach="project-new"
        footShortcut="P"
        onFoot={() => openFloorModal("new-project")}
        groomAction={<GroomingSessionAction kind="project" />}
      >
        {inbox.length === 0 ? (
          <EmptyState>Nothing waiting</EmptyState>
        ) : (
          <div className="pr-list">
            {inbox.map((p) => {
              const dom = domainById(data, p.domainId);
              return (
                <DeckCard
                  key={p.id}
                  dragAttr={{ "data-project-drag": p.id }}
                  onContextMenu={onContextMenu("project", p.id)}
                  className="cursor-grab active:cursor-grabbing"
                  spine={dom?.color ?? "var(--accent)"}
                  eyebrow={dom?.name ?? "no area"}
                  title={p.name}
                  status={p.targetDate ? { label: `due ${format(new Date(p.targetDate + "T00:00:00"), "MMM d")}`, tone: "muted" } : null}
                />
              );
            })}
          </div>
        )}
      </PlannerRail>

      {/* ── the grid ──────────────────────────────────────────────────────────
          No hero here: the crown is this surface's one hero, and the bar above
          already names the page — the same reason the Schedule has no header
          over its calendar. */}
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
        />

        {/* The grid FILLS the pane (single plane, full height). The horizon is
            "the next 4 weeks", and on a narrow window the strip can't show all
            of it; with overlay scrollbars nothing at rest would say the rest of
            the plan exists, so a fade appears only while there is genuinely more
            to the right. It hangs off this wrapper rather than living inside the
            scroller: as a child of a `flex-col` scroll container it became a flex
            ROW, took the full height, and collapsed the grid beside it to zero. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div ref={stripRef} className="dk-scroll">
            <div className="dk-canvas" style={{ minWidth: gridMinW }}>
              {/* domain coverage — a NAMED read aligned OVER the week columns
                  (shares the grid template), so a lit cell points straight down at
                  its week. By domain, the lanes below ARE this read — drawing it
                  twice would be two surfaces claiming one question (P8). */}
              {!byDomain && !coverageCollapsed && <DomainCoverage rows={coverageRows} gridTemplate={cols} onAdd={addForDomain} />}

              {/* the column header — the Schedule's day header, one clock speed
                  up: the week's month and its first day, the current week on the
                  ember disc, and the week's committed load against your cap. */}
              <div className="dk-head" style={{ gridTemplateColumns: cols }}>
                <div aria-hidden className="dk-gutter" />
                {board.weeks.map((w) => {
                  const n = weekLoad[w.idx];
                  const over = n > maxPerWeek;
                  return (
                    <div
                      key={w.idx}
                      data-week={w.idx}
                      className="dk-head-cell"
                      {...colState(w.idx)}
                      title={`${weekName(w.weekStart)} · ${weekDates(w.weekStart)}`}
                    >
                      <span>{format(w.weekStart, "MMM")}</span>
                      <span className="dk-head-num">{format(w.weekStart, "d")}</span>
                      <span className="dk-grow" />
                      <span
                        className="dk-load"
                        data-some={n > 0 ? "" : undefined}
                        data-over={over ? "" : undefined}
                        title={`${n} committed · max ${maxPerWeek} — your per-week focus cap`}
                      >
                        {n}/{maxPerWeek}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* the timeline body — one relative box. Behind: full-height week
                  columns (drop targets, the now wash, the rules), each composing a
                  project in that week on a click, with "+ project" at its base. In
                  front: the lane-packed cards, whose wrapper ignores the pointer so
                  a click on empty space falls through to the column beneath. */}
              <div className="dk-body">
                <div className="dk-cols" style={{ gridTemplateColumns: cols }}>
                  <div aria-hidden className="dk-gutter" />
                  {byDomain ? board.weeks.map((w) => (
                    // By domain, each lane's cell is the create control (it knows its
                    // domain); the column underneath is the now wash, the drop wash
                    // and the rule.
                    <div key={w.idx} data-week={w.idx} className="dk-col" {...colState(w.idx)} />
                  )) : board.weeks.map((w) => (
                    <div
                      key={w.idx}
                      data-week={w.idx}
                      data-compose=""
                      onClick={() => { setComposeDomain(null); setComposeWeek(w.idx); }}
                      // A grid cell, so it stays a div — a <button> here would drop
                      // out of the column track. `pressable` gives it the tab stop
                      // and Enter/Space, so starting a project *in a chosen week*
                      // is never a mouse-only act.
                      {...pressable(() => { setComposeDomain(null); setComposeWeek(w.idx); }, {
                        label: `New project — ${weekName(w.weekStart).toLowerCase()}`,
                      })}
                      title={composeWeek === w.idx ? undefined : `New project — ${weekName(w.weekStart).toLowerCase()}`}
                      className="dk-col"
                      {...colState(w.idx)}
                    >
                      {/* the base affordance — "+ project", presentational on
                          purpose: the column is the control (pressable, above).
                          Hidden while this week is the one being composed. */}
                      {composeWeek !== w.idx && (
                        <div className="dk-col-foot">
                          <SlotCreateHint noun="project" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* cards — lane-packed rows float on top. The inline composer slots
                    into the grid right under the clicked week's last card.

                    NO HORIZONTAL PADDING ON THESE ROWS. They carry the same `cols`
                    template as the week headers and the column rules, and three
                    grids only line up if they resolve it over the SAME width — a
                    row padding once made every card column 3px narrower than its
                    rule column, and the error accumulated across the deck. The
                    card's own margin is the gutter (D-097). */}
                {byDomain ? (
                  // Lanes stack in the domains' order; the body still fills the pane
                  // (the columns run beneath) so a short deck doesn't float.
                  <div className="relative pb-6">
                    {lanes.length === 0 ? (
                      <div className="dk-empty">
                        <EmptyState>All domains hidden</EmptyState>
                      </div>
                    ) : (
                      lanes.map(renderLane)
                    )}
                  </div>
                ) : rows.length === 0 ? (
                  cw != null ? (
                    <div className="dk-rows">
                      <div className="dk-row" style={{ gridTemplateColumns: cols }}>
                        {composerCell}
                      </div>
                    </div>
                  ) : (
                    <div className="dk-empty">
                      <EmptyState>Nothing placed</EmptyState>
                    </div>
                  )
                ) : (
                  <div className="dk-rows pointer-events-none">
                    {rows.map((row, ri) => (
                      <div key={ri} className="dk-row" style={{ gridTemplateColumns: cols }}>
                        {row.map((g) => renderCard(g, 1))}
                        {composeRowIdx === ri && composerCell}
                      </div>
                    ))}
                    {composeRowIdx === rows.length && (
                      <div className="dk-row" style={{ gridTemplateColumns: cols }}>
                        {composerCell}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          {moreRight && <div aria-hidden className="dk-fade" />}
        </div>

        <div className="dk-foot">
          <ShippedStrip rung="project" />
        </div>
      </div>

      {/* drag ghost — a pool card in your hand (placed bars preview in place).
          Positioned by transform only, written directly per rAF. */}
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
          <div className="deck-ghost-sub">{drag.sub}</div>
        </div>
      )}
    </div>
  );
}
