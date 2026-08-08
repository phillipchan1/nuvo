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

import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, format } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import { useCapacity } from "../../hooks/useCapacity";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { useMaxPerWeek, useCoverageHidden, useCoverageCollapsed } from "../../hooks/usePlannerPrefs";
import { useRecordContextMenu } from "../RecordContextMenu";
import { domainById, isOpenStatus, type Domain } from "../../lib/vertical";
import { readOnDeck, sprintSpanFor, weekIndexIn } from "../../lib/onDeck";
import { weekName, weekSpan as weekDates } from "../../lib/week";
import { noticeIfUnready } from "../../lib/readyNotice";
import { PROJECT_STATUS_COLORS } from "../floors/parts";
import ShippedStrip from "../floors/ShippedStrip";
import InlineAdd from "./InlineAdd";
import DomainCoverage, { type CoverageRow } from "./DomainCoverage";
import CoverageControls from "./CoverageControls";
import PlannerRail from "./PlannerRail";
import DeckCard, { deckWeight } from "./DeckCard";
import { PIP_TONE, projectCardStatus } from "./deckStatus";
import { NOW_BAND, NOW_BORDER, NOW_INK, NOW_MARK } from "./plannerNow";

const CAUTION = PROJECT_STATUS_COLORS.waiting;

// A planning surface wants runway — show more weeks than the compact hub and let
// it scroll. More than this many projects committed to one week is a red flag.
// The left label column — holds coverage domain names, empty in the deck; wide enough
// for a domain name, so coverage cells align to the sprint columns beneath. Kept as
// narrow as the names allow: below the strip it's necessarily blank, and every pixel
// of it is a void running down the middle of the page.
const LABEL_W = 96;
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
  const { onContextMenu, menu } = useRecordContextMenu();
  const { byWeek, weeklyAvgMins } = useCapacity();
  const { openRecord, openFloorModal, setProjectView } = useAppNavigation();
  const [maxPerWeek] = useMaxPerWeek();
  const [coverageHidden, toggleCoverageHidden] = useCoverageHidden();
  const [coverageCollapsed, setCoverageCollapsed] = useCoverageCollapsed();
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
  const cols = `${LABEL_W}px repeat(${H}, minmax(${WEEK_COL_PX}px, 1fr))`;
  const gridMinW = LABEL_W + H * WEEK_COL_PX;

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
  const [drag, setDrag] = useState<{ name: string; dot: string; sub: string; x: number; y: number } | null>(null);
  const [dropWeek, setDropWeek] = useState<number | null>(null);
  const [overInbox, setOverInbox] = useState(false);
  const [preview, setPreview] = useState<Preview>(null);
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
  const rows: (typeof geom)[] = [];
  const doneRank = (g: (typeof geom)[number]) => (g.l.readyTier === "done" ? 1 : 0);
  for (const g of [...geom].sort(
    (a, b) => doneRank(a) - doneRank(b) || b.l.readyCount - a.l.readyCount || a.start - b.start || a.end - b.end,
  )) {
    const row = rows.find((r) => r.every((x) => !(g.start <= x.end && x.start <= g.end)));
    if (row) row.push(g);
    else rows.push([g]);
  }
  const effOf = (g: (typeof geom)[number]) =>
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
      <div style={{ gridColumn: `${cw + 2} / ${cw + 3}`, gridRow: 1 }} className="pointer-events-auto mx-1 self-start">
        <InlineAdd
          placeholder={composeDomain ? `Name a ${composeDomain.name} project…` : "Name a project…"}
          accent={composeDom?.color ?? "var(--accent)"}
          onCreate={(name) => createInWeek(cw, name)}
          onClose={closeCompose}
        />
      </div>
    );

  const projectById = useMemo(() => new Map(data.projects.map((p) => [p.id, p])), [data.projects]);
  const live = useRef({ projectById, board, updateProject, openRecord, data });
  live.current = { projectById, board, updateProject, openRecord, data };

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

      const move = (ev: PointerEvent) => {
        if (!moved && Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) < 5) return;
        if (!moved) {
          moved = true;
          document.body.classList.add("wb-noselect");
          // bars + handles ignore the pointer mid-drag so hit-testing sees the
          // week cells beneath (see .odp-dragging in index.css).
          document.body.classList.add("odp-dragging");
          document.body.style.cursor = mode === "move" ? "grabbing" : "ew-resize";
          window.getSelection()?.removeAllRanges();
        }
        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        const wk = hit?.closest("[data-week]");
        if (wk) { tWeek = Number(wk.getAttribute("data-week")); tInbox = false; }
        else if (mode === "move" && hit?.closest("[data-pool-drop]")) { tInbox = true; tWeek = null; }
        else { tWeek = null; tInbox = false; }
        setDropWeek(tWeek);
        setOverInbox(tInbox);
        // live preview: existing bars follow to their prospective span; an inbox
        // project has no bar yet, so it rides the floating chip + column highlight.
        if (fromInbox) {
          setDrag({ name: p.name, dot: ghostDot, sub: ghostSub, x: ev.clientX, y: ev.clientY });
          setPreview(null);
        } else if (tWeek != null) {
          if (mode === "move") setPreview({ id: p.id, start: tWeek, end: tWeek + width - 1 });
          else if (mode === "end") setPreview({ id: p.id, start: curStart, end: Math.max(tWeek, curStart) });
          else setPreview({ id: p.id, start: Math.min(tWeek, curEnd), end: curEnd });
        } else {
          setPreview(null);
        }
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.cursor = "";
        document.body.classList.remove("wb-noselect");
        document.body.classList.remove("odp-dragging");
        const s = live.current;
        const w = s.board.weeks;
        if (!moved) {
          s.openRecord("project", p.id);
        } else if (mode === "move" && tWeek != null && w[tWeek]) {
          s.updateProject(p.id, { ...weekSpan(p, w[tWeek].weekStart), status: "in_progress" });
          // Dropped either way — but say what an unshaped project costs the week.
          noticeIfUnready(s.data, p, () => s.openRecord("project", p.id));
        } else if (mode === "move" && tInbox && p.targetDate) {
          s.updateProject(p.id, { startDate: null, targetDate: null, status: "backlog" });
        } else if (mode === "end" && tWeek != null && w[tWeek]) {
          const wi = Math.max(tWeek, weekIndex(w, p.startDate));
          s.updateProject(p.id, { targetDate: toISO(addDays(w[wi].weekStart, 4)), status: "in_progress" });
        } else if (mode === "start" && tWeek != null && w[tWeek]) {
          const wi = Math.min(tWeek, weekIndex(w, p.targetDate));
          s.updateProject(p.id, { startDate: toISO(w[wi].weekStart), status: "in_progress" });
        }
        setDrag(null);
        setDropWeek(null);
        setOverInbox(false);
        setPreview(null);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  // "You are here" — a quiet band down the current week (idx 0). Orientation, not
  // alarm: `--signal` stays for at-risk / overdue; `--slot` is the drop target.
  const DROP_BAND = "color-mix(in srgb, var(--slot) 14%, transparent)";
  const cellBg = (i: number) => (dropWeek === i ? DROP_BAND : i === 0 ? NOW_BAND : undefined);

  return (
    <div className="flex h-full min-h-0">
      {menu}
      {/* ── the pool — the same rail the Schedule wears, one clock speed up:
          "needs a week" instead of "needs a time". Structure, not a panel. ──── */}
      <PlannerRail
        dropAttr="data-pool-drop"
        over={overInbox}
        crown={{
          eyebrow: `Next ${H} weeks`,
          // a finished project isn't waiting on you either — it counts as ready,
          // so the meter can actually reach full at the end of a week.
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
        onFoot={() => openFloorModal("new-project")}
      >
        {inbox.length === 0 ? (
          <p className="px-1 py-6 text-center text-caption text-muted">
            Nothing waiting — every project has a sprint. Drag a project here to shelve it.
          </p>
        ) : (
          <div className="mt-1.5 flex flex-col gap-2">
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
          No hero here: the crown is this surface's one anchor (execution voice),
          and the floor's top bar already names On Deck — the same reason the
          Schedule has no header over its calendar. */}
      <div className="flex min-w-0 flex-1 flex-col px-5 pb-3 pt-2">
        {/* coverage controls — collapse + domain filter. One quiet toolbar over the grid. */}
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

        {/* The grid FILLS the pane (flex-1, per the design language's "grid views go
            single-plane, full-height" rule — flex-1, never min-h-full). Short column
            stubs floating in a tall pane were the surface's real imbalance: with
            nothing running down beside it, the coverage label gutter read as a hole
            in the middle of the page rather than as the grid's margin. */}
        <div className="mt-1 flex min-h-0 flex-1 flex-col overflow-auto pb-1">
          <div className="relative flex min-h-0 flex-1 flex-col" style={{ minWidth: gridMinW }}>
            {/* domain coverage — a NAMED read aligned OVER the sprint columns (shares
                the grid template), so a lit cell points straight down at its sprint.
                Collapsible: the deck is the primary surface. */}
            {!coverageCollapsed && <DomainCoverage rows={coverageRows} gridTemplate={cols} onAdd={addForDomain} />}
            {/* week headers — label · date, with the week's committed load folded in
                (amber past the max). Faint column rules only — no frame, no gauge row. */}
            <div
              className="grid shrink-0"
              style={{
                gridTemplateColumns: cols,
                borderTop: coverageCollapsed ? undefined : "1px solid var(--line)",
              }}
            >
              <div aria-hidden />
              {board.weeks.map((w) => {
                const n = weekLoad[w.idx];
                const over = n > maxPerWeek;
                return (
                  <div
                    key={w.idx}
                    data-week={w.idx}
                    className="fast border-l border-line first:border-l-0 px-4 pb-2.5 pt-2"
                    style={{ background: cellBg(w.idx), borderTop: w.idx === 0 ? NOW_BORDER : undefined }}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-caption font-semibold" style={{ color: w.idx === 0 ? NOW_INK : "var(--ink)" }}>
                        {w.idx === 0 && <span className="h-1.5 w-1.5 rounded-full" style={{ background: NOW_MARK }} />}
                        {weekName(w.weekStart)}
                      </span>
                      <span className="mono text-micro tabular-nums" title={`${n} committed · max ${maxPerWeek} — your per-week focus cap`} style={{ color: over ? CAUTION : n > 0 ? "var(--muted)" : "var(--line-strong)" }}>
                        {n}/{maxPerWeek}{over ? " ⚠" : ""}
                      </span>
                    </div>
                    <div className="mono mt-0.5 text-micro text-muted">
                      {weekDates(w.weekStart)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="h-px w-full shrink-0" style={{ background: "var(--line)" }} />

            {/* the timeline body — one relative box. Behind: full-height,
                clickable week columns, each with a "+ project" pinned at its
                base, so the whole empty area of a column starts a project in
                that week (not just a hover sliver). In front: the lane-packed
                cards, whose wrapper ignores the pointer so a click on empty space
                falls through to the week column beneath. */}
            <div className="relative flex-1" style={{ minHeight: 320 }}>
              {/* week columns — drop targets + click-to-create + faint rules. The
                  leading spacer holds the label gutter so columns align with coverage. */}
              <div className="absolute inset-0 grid" style={{ gridTemplateColumns: cols }}>
                <div aria-hidden />
                {board.weeks.map((w) => (
                  <div
                    key={w.idx}
                    data-week={w.idx}
                    onClick={() => { setComposeDomain(null); setComposeWeek(w.idx); }}
                    title={composeWeek === w.idx ? undefined : `New project — ${weekName(w.weekStart).toLowerCase()}`}
                    className="group/col slot-col relative cursor-pointer border-l border-line transition-colors"
                    style={{ background: cellBg(w.idx) }}
                  >
                    {/* the base affordance — a pinned "+ project" hint. Clicking it
                        (or anywhere in the column) drops the inline composer into the
                        card flow above, right under this week's last card. Hidden while
                        this week is the one being composed. */}
                    {composeWeek !== w.idx && (
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-2.5">
                        {/* text-only open-time cue — no dashed box. Blooms to
                            `--slot` when the column is hovered. */}
                        <span className="slot-hint fast text-micro font-medium transition-colors">
                          + project
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* cards — lane-packed rows float on top. items-stretch equalizes a
                  row's card heights; pb clears the pinned + project button. The
                  inline composer slots into the grid right under the clicked week's
                  last card (composeRowIdx). */}
              {rows.length === 0 ? (
                cw != null ? (
                  <div className="relative pb-16 pt-2.5">
                    <div className="grid items-stretch px-1.5 py-1" style={{ gridTemplateColumns: cols }}>
                      {composerCell}
                    </div>
                  </div>
                ) : (
                  <div className="pointer-events-none relative px-4 pt-14 text-center text-caption text-muted">
                    No projects placed yet — drag one in from the rail, or tap a week to start one here.
                  </div>
                )
              ) : (
                <div className="pointer-events-none relative pb-16 pt-2.5">
                  {rows.map((row, ri) => (
                    <div key={ri} className="grid items-stretch px-1.5 py-1" style={{ gridTemplateColumns: cols }}>
                    {row.map((g) => {
                      const { l } = g;
                      const { start, end, beyond } = effOf(g);
                      const dot = domainById(data, l.project.domainId)?.color ?? "var(--accent)";
                      const dragging = preview?.id === l.project.id;
                      const done = l.readyTier === "done";
                      return (
                        <DeckCard
                          key={l.project.id}
                          dragAttr={{ "data-project-drag": l.project.id }}
                          onContextMenu={onContextMenu("project", l.project.id)}
                          className="pointer-events-auto mx-1 min-h-[62px] cursor-grab justify-center active:cursor-grabbing"
                          style={{
                            gridColumn: `${start + 2} / ${end + 3}`,
                            gridRow: 1,
                            borderColor: dragging ? dot : undefined,
                            boxShadow: dragging ? "var(--shadow-lift)" : beyond ? `5px 0 0 -1px ${dot}` : undefined,
                            transform: dragging ? "translateY(-3px)" : undefined,
                          }}
                          spine={dot}
                          eyebrow={domainById(data, l.project.domainId)?.name ?? "no area"}
                          title={l.project.name}
                          // the weight the pinch math actually runs on — a column of
                          // hours explains an over-committed sprint; a count doesn't.
                          weight={done ? null : deckWeight(l.pace.remainingMins)}
                          status={projectCardStatus(l)}
                          pips={done ? [true, true, true] : [l.axes.defined, l.axes.planned, l.axes.fits === true]}
                          pipTone={PIP_TONE[l.readyTier]}
                          dim={l.readyTier === "parked"}
                          shipped={done}
                        >
                          <span data-resize="start" className="absolute inset-y-0 left-0 w-2.5 cursor-ew-resize" aria-hidden />
                          <span data-resize="end" className="absolute inset-y-0 right-0 w-2.5 cursor-ew-resize" aria-hidden />
                        </DeckCard>
                      );
                    })}
                    {composeRowIdx === ri && composerCell}
                    </div>
                  ))}
                  {composeRowIdx === rows.length && (
                    <div className="grid items-stretch px-1.5 py-1" style={{ gridTemplateColumns: cols }}>
                      {composerCell}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-micro text-muted">Drag onto a week to time-box · drag an edge to resize · click to edit</span>
          <ShippedStrip rung="project" />
        </div>
      </div>

      {/* drag ghost — a lifted copy of the inbox card (placed bars preview in place) */}
      {drag && (
        <div
          className="glass-grab pointer-events-none fixed z-[60] w-60 rounded-lg border border-line bg-surface px-3 py-2.5"
          style={{ left: drag.x + 14, top: drag.y + 8, transform: "rotate(-2deg)" }}
        >
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: drag.dot }} />
            <span className="truncate text-caption text-ink">{drag.name}</span>
          </div>
          <div className="mono mt-0.5 pl-4 text-micro text-muted">{drag.sub}</div>
        </div>
      )}
    </div>
  );
}
