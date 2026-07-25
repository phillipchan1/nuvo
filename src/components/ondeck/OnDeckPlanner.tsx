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
import { domainById, isOpenStatus, type Domain, type Project } from "../../lib/vertical";
import { readOnDeck, type OnDeckLane, type ReadyTier, type WeekColumn } from "../../lib/onDeck";
import { sprintNumber } from "../../lib/sprint";
import { PROJECT_STATUS_COLORS } from "../floors/parts";
import { READY } from "../floors/ReadinessBanner";
import ShippedStrip from "../floors/ShippedStrip";
import { ProjectShipAssess } from "../record/ShipAssess";
import InlineAdd from "./InlineAdd";
import DomainCoverage, { type CoverageRow } from "./DomainCoverage";
import CoverageControls from "./CoverageControls";
import PlannerRail from "./PlannerRail";

const CAUTION = PROJECT_STATUS_COLORS.waiting;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// A planning surface wants runway — show more weeks than the compact hub and let
// it scroll. More than this many projects committed to one week is a red flag.
// The left label column — holds coverage domain names, empty in the deck; wide enough
// for a domain name, so coverage cells align to the sprint columns beneath.
const LABEL_W = 132;
// A fixed near-term horizon — the deck is for scaffolding the next stretch; coverage
// measures load per domain over it. (A window selector proved to be noise once the
// pips carried "how much" per lane.)
const HORIZON_WEEKS = 4;
// Cards now carry the readiness meter + completion control, so give them room:
// wide columns mean ~4 weeks fill a typical pane comfortably and the rest scroll.
const WEEK_COL_PX = 288;

// Readiness ramp — one color per tier, so a wall of cards sorts itself by eye:
// teal = ready to pull in, amber = mid-groom, faint = raw/untouched.
const TIER_COLOR: Record<ReadyTier, string> = {
  ready: READY,
  grooming: CAUTION,
  raw: "var(--line-strong)",
  parked: "var(--muted)",
  done: READY,
};
/** The one readiness label beside the meter — the meter carries "how many of 3"
 *  (so no redundant N/3 number), this names the *state*: a word for the extremes,
 *  the specific missing check while grooming ("no steps"). Never null — the label
 *  is the meter's caption. */
function meterHint(l: OnDeckLane): string {
  if (l.readyTier === "done") return "Done";
  if (l.readyTier === "parked") return "Parked";
  if (l.readyTier === "ready") return "Ready";
  if (l.gaps.length) return l.gaps.map((g) => g.label).join(" · ");
  if (l.axes.fits === false) return "won't fit the week";
  return "Raw";
}

const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtWk = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
const clampIdx = (i: number, H: number) => Math.max(0, Math.min(i, H - 1));

/** Which horizon week a date falls in (clamped into range; 0 when undated). */
function weekIndex(weeks: WeekColumn[], iso: string | null): number {
  if (!iso) return 0;
  const ms = new Date(iso + "T12:00:00").getTime();
  for (let i = 0; i < weeks.length; i++) {
    const ws = weeks[i].weekStart.getTime();
    if (ms >= ws && ms < ws + WEEK_MS) return i;
  }
  return ms < (weeks[0]?.weekStart.getTime() ?? 0) ? 0 : weeks.length - 1;
}


/** Whole-week span for a project dropped so it STARTS on the Monday `ws`,
 *  preserving its current width in weeks (default 1). Always Mon → Fri. */
function weekSpan(p: Project, ws: Date): { startDate: string; targetDate: string } {
  let widthWeeks = 1;
  if (p.startDate && p.targetDate) {
    const d = new Date(p.targetDate + "T00:00:00").getTime() - new Date(p.startDate + "T00:00:00").getTime();
    widthWeeks = Math.max(1, Math.floor(d / WEEK_MS) + 1);
  }
  return { startDate: toISO(ws), targetDate: toISO(addDays(ws, (widthWeeks - 1) * 7 + 4)) };
}

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
  // Shipping asks first — the card's check is one click, and a project with open
  // tasks used to get sealed by it silently. The assessment owns the write; the
  // check bloom + card fade only play once you've actually said yes (readOnDeck
  // excludes complete projects, so the card drops off after).
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [shipId, setShipId] = useState<string | null>(null);
  const completeProject = (id: string) => setShipId(id);
  const onShipped = (id: string) => {
    setCompletingId(id);
    window.setTimeout(() => setCompletingId(null), 260);
  };
  // Reopen a finished project — the check toggles it back into flight.
  const reopenProject = (id: string) => updateProject(id, { status: "in_progress" });
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
      // the completion check owns its click — never start a drag / open the record.
      if (tgt?.closest?.("[data-card-complete]")) return;
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

  // "You are here" — a band down the current week (idx 0), the focus column and the
  // one that matters most, so the eye lands on now first. NOW is `--signal` at every
  // altitude (it's the same idea as the calendar's now-line); `--accent` stays your
  // *intent*. The drop target is `--slot` — open time you're about to claim — and it
  // still wins while dragging.
  const THISWEEK_BAND = "color-mix(in srgb, var(--signal) 7%, transparent)";
  const DROP_BAND = "color-mix(in srgb, var(--slot) 14%, transparent)";
  const cellBg = (i: number) => (dropWeek === i ? DROP_BAND : i === 0 ? THISWEEK_BAND : undefined);

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
        onFoot={() => openFloorModal("new-project")}
      >
        {inbox.length === 0 ? (
          <p className="px-1 py-6 text-center text-caption text-muted">
            Nothing waiting — every project has a week. Drag a project here to shelve it.
          </p>
        ) : (
          <div className="mt-1.5 flex flex-col gap-2">
            {inbox.map((p) => {
              const dot = domainById(data, p.domainId)?.color ?? "var(--accent)";
              const sub = !p.targetDate ? "no finish line" : `due ${format(new Date(p.targetDate + "T00:00:00"), "MMM d")}`;
              return (
                <div
                  key={p.id}
                  data-project-drag={p.id}
                  onContextMenu={onContextMenu("project", p.id)}
                  className="glass-card fast relative cursor-grab select-none rounded-lg border border-line py-2.5 pl-4 pr-3 hover:border-line-strong active:cursor-grabbing"
                >
                  {/* domain rail — the same identity edge the placed cards wear */}
                  <span className="pointer-events-none absolute inset-y-2.5 left-1.5 w-[3px] rounded-full" style={{ background: dot }} />
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
                    <span className="truncate text-caption text-ink">{p.name}</span>
                  </div>
                  <div className="mono mt-0.5 pl-4 text-micro text-muted">{sub}</div>
                </div>
              );
            })}
          </div>
        )}
      </PlannerRail>

      {/* ── the grid ──────────────────────────────────────────────────────────
          No hero here: the crown is this surface's one anchor (execution voice),
          and the floor's top bar already names On Deck — the same reason the
          Schedule has no header over its calendar. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-6 py-4">
        {/* coverage controls — collapse + window length + domain filter (fixed, outside the scroll) */}
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

        <div className="mt-2 overflow-x-auto pb-3">
          <div className="relative" style={{ minWidth: gridMinW }}>
            {/* domain coverage — a NAMED read aligned OVER the sprint columns (shares
                the grid template), so a lit cell points straight down at its sprint.
                Collapsible: the deck is the primary surface. */}
            {!coverageCollapsed && <DomainCoverage rows={coverageRows} gridTemplate={cols} onAdd={addForDomain} />}
            {/* week headers — label · date, with the week's committed load folded in
                (amber past the max). Faint column rules only — no frame, no gauge row. */}
            <div className="grid" style={{ gridTemplateColumns: cols }}>
              <div aria-hidden />
              {board.weeks.map((w) => {
                const n = weekLoad[w.idx];
                const over = n > maxPerWeek;
                return (
                  <div
                    key={w.idx}
                    data-week={w.idx}
                    className="fast border-l border-line first:border-l-0 px-4 pb-2.5 pt-1"
                    style={{ background: cellBg(w.idx), borderTop: w.idx === 0 ? "2px solid var(--signal)" : undefined }}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-caption font-semibold" style={{ color: w.idx === 0 ? "var(--signal)" : "var(--ink)" }}>
                        {w.idx === 0 && <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--signal)" }} />}
                        Sprint {sprintNumber(w.weekStart)}
                      </span>
                      <span className="mono text-micro tabular-nums" title={`${n} committed · max ${maxPerWeek} — your per-week focus cap`} style={{ color: over ? CAUTION : n > 0 ? "var(--muted)" : "var(--line-strong)" }}>
                        {n}/{maxPerWeek}{over ? " ⚠" : ""}
                      </span>
                    </div>
                    <div className="mono mt-0.5 text-micro text-muted">
                      {w.idx === 0 ? `This week · ${fmtWk(w.weekStart)}` : w.idx === 1 ? `Next week · ${fmtWk(w.weekStart)}` : `Week of ${fmtWk(w.weekStart)}`}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="h-px w-full" style={{ background: "var(--line)" }} />

            {/* the timeline body — one relative box. Behind: full-height,
                clickable week columns, each with a "+ project" pinned at its
                base, so the whole empty area of a column starts a project in
                that week (not just a hover sliver). In front: the lane-packed
                cards, whose wrapper ignores the pointer so a click on empty space
                falls through to the week column beneath. */}
            <div className="relative" style={{ minHeight: 320 }}>
              {/* week columns — drop targets + click-to-create + faint rules. The
                  leading spacer holds the label gutter so columns align with coverage. */}
              <div className="absolute inset-0 grid" style={{ gridTemplateColumns: cols }}>
                <div aria-hidden />
                {board.weeks.map((w) => (
                  <div
                    key={w.idx}
                    data-week={w.idx}
                    onClick={() => { setComposeDomain(null); setComposeWeek(w.idx); }}
                    title={composeWeek === w.idx ? undefined : w.idx === 0 ? "New project this week" : w.idx === 1 ? "New project next week" : `New project — week of ${fmtWk(w.weekStart)}`}
                    className="group/col slot-col relative cursor-pointer border-l border-line transition-colors"
                    style={{ background: cellBg(w.idx) }}
                  >
                    {/* the base affordance — a pinned "+ project" hint. Clicking it
                        (or anywhere in the column) drops the inline composer into the
                        card flow above, right under this week's last card. Hidden while
                        this week is the one being composed. */}
                    {composeWeek !== w.idx && (
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 px-1.5 pb-1.5">
                        {/* open, unclaimed time reads `--slot` at every altitude —
                            the same teal the calendar's open slots wear. */}
                        <div
                          className="slot-open fast w-full rounded-lg border border-dashed px-2 py-1.5 text-center text-micro font-medium text-muted transition-colors"
                        >
                          + project
                        </div>
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
                      const color = TIER_COLOR[l.readyTier];
                      const dragging = preview?.id === l.project.id;
                      const done = l.readyTier === "done";
                      const segs = done ? [true, true, true] : [l.axes.defined, l.axes.planned, l.axes.fits];
                      const hint = meterHint(l);
                      const completing = completingId === l.project.id;
                      return (
                        <div
                          key={l.project.id}
                          data-project-drag={l.project.id}
                          onContextMenu={onContextMenu("project", l.project.id)}
                          className="group/bar glass-card pointer-events-auto fast relative mx-1 flex min-h-[62px] cursor-grab flex-col gap-2 rounded-xl border py-3 pl-4 pr-3.5 active:cursor-grabbing"
                          style={{
                            gridColumn: `${start + 2} / ${end + 3}`,
                            gridRow: 1,
                            borderColor: dragging ? dot : "var(--line)",
                            boxShadow: dragging ? "var(--shadow-lift)" : beyond ? `5px 0 0 -1px ${dot}` : undefined,
                            transform: dragging ? "translateY(-3px)" : undefined,
                            opacity: l.readyTier === "parked" ? 0.6 : 1,
                          }}
                        >
                          {/* domain rail — color demarcation of *which area* this is (identity);
                              readiness lives in the meter below (status). Same as the Groom card. */}
                          <span className="pointer-events-none absolute inset-y-2.5 left-1.5 w-[3px] rounded-full" style={{ background: dot }} />
                          <span data-resize="start" className="absolute inset-y-0 left-0 w-2.5 cursor-ew-resize" aria-hidden />
                          {/* title row — just the check, domain dot, and name. Readiness
                              lives entirely in the meter below; the sprint column carries
                              the "when" so no due-date pill. */}
                          <div className="flex items-start gap-2">
                            {/* completion check — mirrors the Schedule's done toggle. Fills
                                teal + blooms on complete; a finished project stays on the
                                deck in a done state and the check toggles it back open. */}
                            <button
                              data-card-complete
                              aria-label={done ? "Reopen project" : "Mark project complete"}
                              title={done ? "Reopen" : "Mark complete"}
                              onClick={(e) => { e.stopPropagation(); done ? reopenProject(l.project.id) : completeProject(l.project.id); }}
                              className={`fast relative mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border ${completing ? "bloom" : ""}`}
                              style={done || completing ? { background: READY, borderColor: READY } : { borderColor: "var(--line-strong)" }}
                            >
                              <svg
                                width="10"
                                height="10"
                                viewBox="0 0 10 10"
                                fill="none"
                                className={done || completing ? "opacity-100" : "opacity-0 transition-opacity group-hover/bar:opacity-50"}
                                style={{ color: done || completing ? "#fff" : READY }}
                              >
                                <path d="M1.5 5.5L4 8L8.5 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                            <span className="mt-[6px] h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
                            <div className={`min-w-0 flex-1 text-caption font-semibold leading-snug ${done ? "text-muted" : "text-ink"}`}>{l.project.name}</div>
                          </div>
                          {/* the definition-of-ready meter — Defined · Planned · Fits — with
                              its one caption (state word, or the specific missing check). The
                              meter IS the "N of 3", so no redundant number. */}
                          <div className="flex items-center gap-1.5">
                            <span className="flex flex-1 items-center gap-1" title={done ? "Complete" : "Defined · Planned · Fits"}>
                              {segs.map((met, i) => (
                                <span
                                  key={i}
                                  className="h-[5px] flex-1 rounded-full"
                                  style={{ background: met ? color : "var(--line)" }}
                                />
                              ))}
                            </span>
                            <span className="mono shrink-0 text-micro" style={{ color }}>{hint}</span>
                          </div>
                          <span data-resize="end" className="absolute inset-y-0 right-0 w-2.5 cursor-ew-resize" aria-hidden />
                        </div>
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

      {shipId && (
        <ProjectShipAssess
          id={shipId}
          onClose={() => setShipId(null)}
          onShipped={() => onShipped(shipId)}
        />
      )}
    </div>
  );
}
