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
import { useMaxPerWeek } from "../../hooks/usePlannerPrefs";
import { domainById, isOpenStatus, type Project } from "../../lib/vertical";
import { readOnDeck, type LaneState, type OnDeckLane, type WeekColumn } from "../../lib/onDeck";
import { PROJECT_STATUS_COLORS } from "../floors/parts";
import { READY } from "../floors/ReadinessBanner";
import NewProject from "../floors/NewProject";

const CAUTION = PROJECT_STATUS_COLORS.waiting;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// A planning surface wants runway — show more weeks than the compact hub and let
// it scroll. More than this many projects committed to one week is a red flag.
const PLANNER_HORIZON = 8;
// Wide enough that ~4 weeks (about a month) show at once; the rest scroll.
const WEEK_COL_PX = 232;

const STATE_COLOR: Record<LaneState, string> = {
  ready: READY,
  needs_shaping: CAUTION,
  stalled: CAUTION,
  idea: "var(--line-strong)",
  parked: "var(--muted)",
};
const STATE_LABEL: Record<LaneState, string> = {
  ready: "ready",
  needs_shaping: "needs shaping",
  stalled: "stalled",
  idea: "no finish line",
  parked: "parked",
};

const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtWk = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
const clampIdx = (i: number, H: number) => Math.max(0, Math.min(i, H - 1));
const OVERLOAD_TINT = `color-mix(in srgb, ${CAUTION} 16%, transparent)`;

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

function barLabel(l: OnDeckLane): string | null {
  if (!l.project.targetDate) return null;
  const d = new Date(l.project.targetDate + "T00:00:00");
  const dl = l.pace.daysLeft;
  const when = dl != null && dl >= 0 && dl <= 6 ? format(d, "EEE") : format(d, "MMM d");
  const warn = l.state === "needs_shaping" || l.pace.read === "overdue";
  return `${warn ? "⚠ " : ""}due ${when}`;
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
  const { data, updateProject } = useVertical();
  const { byWeek, weeklyAvgMins } = useCapacity();
  const { openRecord, openFlow, openFloorModal } = useAppNavigation();
  const [maxPerWeek] = useMaxPerWeek();
  const now = useMemo(() => new Date(), []);
  const board = useMemo(() => readOnDeck(data, byWeek, weeklyAvgMins, now, PLANNER_HORIZON), [data, byWeek, weeklyAvgMins, now]);

  const H = board.horizonWeeks;
  // No project column — the bar carries the title. One uniform week grid.
  const cols = `repeat(${H}, minmax(${WEEK_COL_PX}px, 1fr))`;
  const gridMinW = H * WEEK_COL_PX;

  const placed = board.lanes.filter((l) => l.project.targetDate);
  // Inbox = every open project NOT on the timeline. That's not just the undated
  // ones: a backlog project WITH a date isn't in-flight so it's off the timeline,
  // yet it still needs a week — it belongs here, not lost between the two.
  const placedIds = new Set(placed.map((l) => l.project.id));
  const inbox = data.projects.filter((p) => isOpenStatus(p.status) && !placedIds.has(p.id));
  const needShaping = placed.filter((l) => l.gaps.length > 0).length;
  const shapeable = placed.some((l) => l.gaps.length > 0);

  // ── drag state (in React so the bar + counts preview live) ───────────────────
  // inbox drags ride a card-shaped ghost (placed bars preview in place instead)
  const [drag, setDrag] = useState<{ name: string; dot: string; sub: string; x: number; y: number } | null>(null);
  const [dropWeek, setDropWeek] = useState<number | null>(null);
  const [overInbox, setOverInbox] = useState(false);
  const [preview, setPreview] = useState<Preview>(null);
  // Click an empty week cell → create a project placed in that week (calendar-style).
  const [createWeek, setCreateWeek] = useState<number | null>(null);
  const createInWeek = (i: number) => (id: string) => {
    const ws = board.weeks[i]?.weekStart;
    if (ws) updateProject(id, { startDate: toISO(ws), targetDate: toISO(addDays(ws, 4)), status: "in_progress" });
    setCreateWeek(null);
    openRecord("project", id);
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
  const weekLoad = board.weeks.map((_, i) => effGeom.filter((g) => i >= g.start && i <= g.end).length);

  // Lane-packing: bars that don't overlap in time share a row, so the same week's
  // projects stack together in a column instead of staggering one-per-row. Row
  // assignment uses the BASE geom (stable during a drag); the preview only slides
  // a bar's column within its row.
  const rows: (typeof geom)[] = [];
  for (const g of [...geom].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const row = rows.find((r) => r.every((x) => !(g.start <= x.end && x.start <= g.end)));
    if (row) row.push(g);
    else rows.push([g]);
  }
  const effOf = (g: (typeof geom)[number]) =>
    preview && preview.id === g.l.project.id
      ? { start: clampIdx(preview.start, H), end: clampIdx(preview.end, H), beyond: false }
      : { start: g.start, end: g.end, beyond: g.beyond };

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

  const cellBg = (i: number) => (dropWeek === i ? "var(--accent-soft)" : undefined);

  return (
    <div className="flex min-h-0 gap-6">
      {/* ── the inbox — a left panel, mirroring Schedule's task inbox ──────── */}
      <aside
        data-pool-drop
        className="fast w-72 shrink-0 self-start rounded-xl border p-3"
        style={{
          borderColor: overInbox ? "var(--accent)" : "var(--line)",
          background: overInbox ? "var(--accent-soft)" : "var(--surface-2)",
        }}
      >
        <div className="flex items-center justify-between gap-2 px-1.5 pb-2">
          <span className="section-label !p-0">Needs a week · {inbox.length}</span>
          <button
            onClick={() => openFloorModal("new-project")}
            className="tap fast rounded-md px-1.5 py-0.5 text-caption font-medium text-muted hover:text-ink"
            title="New project"
          >
            + project
          </button>
        </div>
        {inbox.length === 0 ? (
          <p className="px-1.5 py-6 text-center text-caption text-muted">Nothing waiting — every project has a week. <button onClick={() => openFloorModal("new-project")} className="fast underline hover:text-ink">Add one</button> or drag a project here to shelve it.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {inbox.map((p) => {
              const dot = domainById(data, p.domainId)?.color ?? "var(--accent)";
              const sub = !p.targetDate ? "no finish line" : `due ${format(new Date(p.targetDate + "T00:00:00"), "MMM d")}`;
              return (
                <div
                  key={p.id}
                  data-project-drag={p.id}
                  className="fast cursor-grab select-none rounded-lg border border-line bg-surface px-3 py-2.5 hover:border-line-strong active:cursor-grabbing"
                >
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
      </aside>

      {/* ── the timeline ──────────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1">
        <div className="flex items-end justify-between gap-3">
          <h1 className="text-lead masthead leading-none">On deck · next {H} weeks</h1>
          <span className="shrink-0 text-caption text-muted">
            {placed.length} placed{needShaping > 0 && <> · {needShaping} need shaping</>}
          </span>
        </div>

        <div className="mt-4 overflow-x-auto">
          <div className="overflow-hidden rounded-xl border border-line glass-card" style={{ minWidth: gridMinW }}>
            {/* column headers — just the week; capacity math removed (manual for now) */}
            <div className="grid border-b border-line" style={{ gridTemplateColumns: cols }}>
              {board.weeks.map((w) => (
                <div key={w.idx} data-week={w.idx} className="border-l border-line first:border-l-0 px-3.5 py-3" style={{ background: cellBg(w.idx) }}>
                  <div className="text-caption font-medium text-ink">
                    {w.idx === 0 ? "This week" : w.idx === 1 ? "Next week" : `Week of ${fmtWk(w.weekStart)}`}
                  </div>
                </div>
              ))}
            </div>

            {/* placed project rows — lane-packed so same-week cards stack in a column */}
            {rows.length === 0 ? (
              <div className="px-4 py-8 text-center text-caption text-muted">
                No projects placed yet — drag one in from the inbox to give it a week. →
              </div>
            ) : (
              rows.map((row, ri) => (
                <div key={ri} className="relative border-t border-line first:border-t-0">
                  {/* week cells — drop targets + gridlines/tint, and click-to-create
                      zones (empty space → new project placed in that week). */}
                  <div className="absolute inset-0 grid" style={{ gridTemplateColumns: cols }}>
                    {board.weeks.map((w) => (
                      <div
                        key={w.idx}
                        data-week={w.idx}
                        onClick={() => setCreateWeek(w.idx)}
                        className="group/cell relative cursor-pointer border-l border-line transition-colors first:border-l-0 hover:bg-accent-soft/40"
                        style={{ background: cellBg(w.idx) }}
                      >
                        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-caption font-medium text-accent opacity-0 transition-opacity group-hover/cell:opacity-55">+ project</span>
                      </div>
                    ))}
                  </div>

                  {/* the cards in this row — each carries its full title (wraps) and is
                      itself the drag/resize/click target. In flow, so they set the row
                      height; items-stretch makes every card in the row equal height. */}
                  <div className="pointer-events-none relative grid items-stretch px-1.5 py-2" style={{ gridTemplateColumns: cols }}>
                    {row.map((g) => {
                      const { l } = g;
                      const { start, end, beyond } = effOf(g);
                      const dot = domainById(data, l.project.domainId)?.color ?? "var(--accent)";
                      const color = STATE_COLOR[l.state];
                      const dragging = preview?.id === l.project.id;
                      const due = barLabel(l)?.replace("⚠ ", "") ?? null; // border color carries the warning
                      const fillPct = l.state === "needs_shaping" ? 22 : 34;
                      return (
                        <div
                          key={l.project.id}
                          data-project-drag={l.project.id}
                          className="group/bar pointer-events-auto fast relative flex min-h-[52px] cursor-grab items-start gap-2 rounded-xl px-3.5 py-2.5 active:cursor-grabbing"
                          style={{
                            gridColumn: `${start + 1} / ${end + 2}`,
                            gridRow: 1,
                            background: `color-mix(in srgb, ${color} ${dragging ? fillPct + 16 : fillPct}%, var(--surface))`,
                            border: `1.5px solid ${dragging || l.state === "needs_shaping" ? color : "transparent"}`,
                            color: `color-mix(in srgb, ${color} 80%, var(--ink))`,
                            boxShadow: dragging ? "var(--shadow-lift)" : beyond ? `5px 0 0 -1px ${color}` : "none",
                            opacity: l.state === "parked" ? 0.5 : 1,
                          }}
                        >
                          <span data-resize="start" className="absolute inset-y-0 left-0 flex w-2 cursor-ew-resize items-center justify-center" aria-hidden>
                            <span className="h-5 w-[3px] rounded-full opacity-0 transition-opacity group-hover/bar:opacity-40" style={{ background: "currentColor" }} />
                          </span>
                          <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
                          <div className="min-w-0 flex-1">
                            <div className="text-caption font-semibold leading-snug text-ink">{l.project.name}</div>
                            <div className="mono mt-1 text-micro" style={{ color }}>
                              {STATE_LABEL[l.state]}{due ? ` · ${due}` : ""}
                            </div>
                          </div>
                          <span data-resize="end" className="absolute inset-y-0 right-0 flex w-2 cursor-ew-resize items-center justify-center" aria-hidden>
                            <span className="h-5 w-[3px] rounded-full opacity-0 transition-opacity group-hover/bar:opacity-40" style={{ background: "currentColor" }} />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}

            {/* per-week load — more than OVERLOAD_LIMIT projects in a week is a problem */}
            {effGeom.length > 0 && (
              <>
                <div className="flex items-center gap-2 border-t border-line px-3.5 pt-2">
                  <span className="section-label !p-0">projects / week</span>
                  <span className="text-micro text-muted">· max {maxPerWeek}</span>
                </div>
                <div className="grid pb-1" style={{ gridTemplateColumns: cols }}>
                  {board.weeks.map((w) => {
                    const n = weekLoad[w.idx];
                    const over = n > maxPerWeek;
                    return (
                      <div
                        key={w.idx}
                        data-week={w.idx}
                        className="flex items-center justify-center border-l border-line first:border-l-0 py-1.5"
                        style={{ background: dropWeek === w.idx ? "var(--accent-soft)" : over ? OVERLOAD_TINT : undefined }}
                      >
                        <span className="mono text-caption" style={{ color: over ? CAUTION : n > 0 ? "var(--ink)" : "var(--muted)" }}>
                          {n}{over && " ⚠"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-micro text-muted">Drag onto a week to time-box · drag an edge to resize · click to edit</span>
          {shapeable && (
            <button
              onClick={() => openFlow("refine", { pass: "project" })}
              className="tap fast rounded-xl px-5 py-2.5 text-body font-medium text-white active:scale-[.98]"
              style={{ background: "var(--accent)" }}
            >
              Groom the {needShaping} that need it →
            </button>
          )}
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

      {/* click-to-create — the composer, then place the new project in that week */}
      {createWeek != null && (
        <NewProject onClose={() => setCreateWeek(null)} onCreated={createInWeek(createWeek)} />
      )}
    </div>
  );
}
