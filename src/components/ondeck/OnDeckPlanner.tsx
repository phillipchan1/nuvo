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
import { domainById, isOpenStatus, isProjectInFlight, type Project } from "../../lib/vertical";
import { readOnDeck, BLOCK_MINS, type LaneState, type OnDeckLane, type WeekColumn } from "../../lib/onDeck";
import { PROJECT_STATUS_COLORS } from "../floors/parts";
import { READY } from "../floors/ReadinessBanner";

const CAUTION = PROJECT_STATUS_COLORS.waiting;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// A planning surface wants runway — show more weeks than the compact hub and let
// it scroll. More than this many projects committed to one week is a red flag.
const PLANNER_HORIZON = 8;
const WEEK_COL_PX = 116;
const OVERLOAD_LIMIT = 3;

const STATE_COLOR: Record<LaneState, string> = {
  ready: READY,
  needs_shaping: CAUTION,
  stalled: CAUTION,
  idea: "var(--line-strong)",
  parked: "var(--muted)",
};

const toBlocks = (mins: number) => Math.round(mins / BLOCK_MINS);
const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtWk = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
const clampIdx = (i: number, H: number) => Math.max(0, Math.min(i, H - 1));
const TINT = `color-mix(in srgb, ${CAUTION} 9%, transparent)`;
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

function statusOf(l: OnDeckLane): { text: string; color: string } {
  switch (l.state) {
    case "ready": {
      const b = toBlocks(l.pace.remainingMins);
      return { text: b >= 2 ? `ready · ~${b} blocks` : "ready", color: READY };
    }
    case "needs_shaping":
      return { text: "needs shaping", color: CAUTION };
    case "stalled":
      return { text: l.pace.read === "overdue" ? `overdue · ${l.pace.driftDays ?? 0}d late` : "stalled", color: CAUTION };
    default:
      return { text: "parked", color: "var(--muted)" };
  }
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
  const { openRecord, openFlow } = useAppNavigation();
  const now = useMemo(() => new Date(), []);
  const board = useMemo(() => readOnDeck(data, byWeek, weeklyAvgMins, now, PLANNER_HORIZON), [data, byWeek, weeklyAvgMins, now]);

  const H = board.horizonWeeks;
  const cols = `minmax(150px, 1.15fr) repeat(${H}, minmax(${WEEK_COL_PX}px, 1fr))`;
  const weekCols = `repeat(${H}, minmax(${WEEK_COL_PX}px, 1fr))`;
  const gridMinW = 150 + H * WEEK_COL_PX;

  const placed = board.lanes.filter((l) => l.project.targetDate);
  const inbox = useMemo(
    () => data.projects.filter((p) => isOpenStatus(p.status) && !p.targetDate),
    [data.projects],
  );
  const needShaping = placed.filter((l) => l.gaps.length > 0).length;
  const shapeable = placed.some((l) => l.gaps.length > 0);

  // ── drag state (in React so the bar + counts preview live) ───────────────────
  const [drag, setDrag] = useState<{ name: string; x: number; y: number } | null>(null); // inbox chip only
  const [dropWeek, setDropWeek] = useState<number | null>(null);
  const [overInbox, setOverInbox] = useState(false);
  const [preview, setPreview] = useState<Preview>(null);

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

  const projectById = useMemo(() => new Map(data.projects.map((p) => [p.id, p])), [data.projects]);
  const live = useRef({ projectById, board, updateProject, openRecord });
  live.current = { projectById, board, updateProject, openRecord };

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
      // current geometry (default 1 week when there's no explicit start)
      const fromInbox = !p.targetDate;
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
          document.body.style.cursor = mode === "move" ? "grabbing" : "ew-resize";
          window.getSelection()?.removeAllRanges();
          document.querySelectorAll<HTMLElement>("[data-resize]").forEach((h) => (h.style.pointerEvents = "none"));
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
          setDrag({ name: p.name, x: ev.clientX, y: ev.clientY });
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
        document.querySelectorAll<HTMLElement>("[data-resize]").forEach((h) => (h.style.pointerEvents = ""));
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

  const cellBg = (i: number) => (dropWeek === i ? "var(--accent-soft)" : board.weeks[i].over ? TINT : undefined);

  return (
    <div className="flex min-h-0 gap-5">
      {/* ── the timeline ──────────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1">
        <div className="flex items-end justify-between gap-3">
          <h1 className="text-lead masthead leading-none">On deck · next {H} weeks</h1>
          <span className="shrink-0 text-caption text-muted">
            {placed.length} placed{needShaping > 0 && <> · {needShaping} need shaping</>}
          </span>
        </div>

        {board.pinch && (
          <div
            className="mt-4 rounded-xl border px-4 py-3"
            style={{ borderColor: `color-mix(in srgb, ${CAUTION} 45%, var(--line))`, background: `color-mix(in srgb, ${CAUTION} 8%, transparent)` }}
          >
            <div className="section-label !p-0 flex items-center gap-1.5" style={{ color: CAUTION }}>
              <span aria-hidden>⚠</span> The pinch
            </div>
            <p className="mt-1 text-body leading-relaxed text-ink/90">{board.pinch.line}</p>
          </div>
        )}

        <div className="mt-4 overflow-x-auto">
          <div className="overflow-hidden rounded-xl border border-line glass-card" style={{ minWidth: gridMinW }}>
            {/* column headers */}
            <div className="grid border-b border-line" style={{ gridTemplateColumns: cols }}>
              <div className="section-label !p-0 self-end px-3.5 py-2.5">project</div>
              {board.weeks.map((w) => (
                <div key={w.idx} data-week={w.idx} className="border-l border-line px-3 py-2" style={{ background: cellBg(w.idx) }}>
                  <div className="flex items-center gap-1 text-caption font-medium text-ink">
                    {w.idx === 0 ? "This week" : w.idx === 1 ? "Next week" : `Week of ${fmtWk(w.weekStart)}`}
                    {w.over && <span style={{ color: CAUTION }} aria-hidden>⚠</span>}
                  </div>
                  <div className="mono text-micro" style={{ color: w.over ? CAUTION : "var(--muted)" }}>
                    {w.over ? `over by ${Math.max(1, w.demandBlocks - w.blocks)}` : `${w.demandBlocks} of ${w.blocks} blocks`}
                  </div>
                </div>
              ))}
            </div>

            {/* placed project rows */}
            {effGeom.length === 0 ? (
              <div className="px-4 py-8 text-center text-caption text-muted">
                No projects placed yet — drag one in from the inbox to give it a week. →
              </div>
            ) : (
              effGeom.map(({ l, start, end, beyond }) => {
                const st = statusOf(l);
                const dot = domainById(data, l.project.domainId)?.color ?? "var(--accent)";
                const color = STATE_COLOR[l.state];
                const dragging = preview?.id === l.project.id;
                const single = start === end;
                const label = barLabel(l);
                const fillPct = l.state === "needs_shaping" ? 20 : 32;

                return (
                  <div
                    key={l.project.id}
                    data-project-drag={l.project.id}
                    className="group fast relative cursor-grab border-t border-line first:border-t-0 select-none hover:bg-accent-soft active:cursor-grabbing"
                  >
                    <div className="grid" style={{ gridTemplateColumns: cols }}>
                      <div className="min-w-0 px-3.5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
                          <span className="truncate text-body text-ink">{l.project.name}</span>
                        </div>
                        <div className="mono mt-0.5 pl-4 text-micro" style={{ color: st.color }}>{st.text}</div>
                      </div>
                      {board.weeks.map((w) => (
                        <div key={w.idx} data-week={w.idx} className="border-l border-line" style={{ background: cellBg(w.idx) }} />
                      ))}
                    </div>

                    {/* bar overlay — moves live to `start..end` during a drag */}
                    <div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: cols }}>
                      <div />
                      <div className="grid items-center px-1.5" style={{ gridColumn: `2 / span ${H}`, gridTemplateColumns: weekCols }}>
                        <div
                          className="relative flex h-7 items-center overflow-hidden rounded-md px-2.5 text-micro font-medium"
                          style={{
                            gridColumn: `${start + 1} / ${end + 2}`,
                            justifyContent: single ? "center" : "flex-end",
                            background: `color-mix(in srgb, ${color} ${dragging ? fillPct + 20 : fillPct}%, var(--surface))`,
                            border: dragging ? `1.5px solid ${color}` : l.state === "needs_shaping" ? `1.5px solid ${color}` : "none",
                            color: `color-mix(in srgb, ${color} 72%, var(--ink))`,
                            boxShadow: dragging ? "var(--shadow-lift)" : beyond ? `4px 0 0 -1px ${color}` : "none",
                            opacity: l.state === "parked" ? 0.5 : 1,
                          }}
                        >
                          <span data-resize="start" className="absolute inset-y-0 left-0 flex w-2.5 cursor-ew-resize items-center justify-center" style={{ pointerEvents: "auto" }} aria-hidden>
                            <span className="h-3.5 w-[3px] rounded-full opacity-0 transition-opacity group-hover:opacity-50" style={{ background: "currentColor" }} />
                          </span>
                          {label}
                          <span data-resize="end" className="absolute inset-y-0 right-0 flex w-2.5 cursor-ew-resize items-center justify-center" style={{ pointerEvents: "auto" }} aria-hidden>
                            <span className="h-3.5 w-[3px] rounded-full opacity-0 transition-opacity group-hover:opacity-50" style={{ background: "currentColor" }} />
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            {/* per-week load — more than OVERLOAD_LIMIT projects in a week is a problem */}
            {effGeom.length > 0 && (
              <div className="grid border-t border-line" style={{ gridTemplateColumns: cols }}>
                <div className="section-label !p-0 self-center px-3.5 py-2">projects / week</div>
                {board.weeks.map((w) => {
                  const n = weekLoad[w.idx];
                  const over = n > OVERLOAD_LIMIT;
                  return (
                    <div
                      key={w.idx}
                      data-week={w.idx}
                      className="flex items-center justify-center border-l border-line py-2"
                      style={{ background: dropWeek === w.idx ? "var(--accent-soft)" : over ? OVERLOAD_TINT : undefined }}
                    >
                      <span className="mono text-caption" style={{ color: over ? CAUTION : n > 0 ? "var(--ink)" : "var(--muted)" }}>
                        {n}{over && " ⚠"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-micro text-muted">Drag onto a week to time-box · drag an edge to resize · click to edit · {board.coverageWeeks} weeks stocked</span>
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

      {/* ── the inbox rail ────────────────────────────────────────────────── */}
      <aside
        data-pool-drop
        className="fast w-64 shrink-0 self-start rounded-xl border p-2.5"
        style={{
          borderColor: overInbox ? "var(--accent)" : "var(--line)",
          background: overInbox ? "var(--accent-soft)" : "transparent",
        }}
      >
        <div className="section-label px-1.5 pb-1.5">Needs a week · {inbox.length}</div>
        {inbox.length === 0 ? (
          <p className="px-1.5 py-6 text-center text-caption text-muted">Every project has a week. Drag one here to shelve it.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {inbox.map((p) => {
              const dot = domainById(data, p.domainId)?.color ?? "var(--accent)";
              const flight = isProjectInFlight(p.status);
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
                  <div className="mono mt-0.5 pl-4 text-micro text-muted">{flight ? "no finish line" : "shelved"}</div>
                </div>
              );
            })}
          </div>
        )}
      </aside>

      {/* drag ghost — inbox projects only (placed bars preview in place) */}
      {drag && (
        <div
          className="pointer-events-none fixed z-[60] rounded-lg border border-line bg-surface px-3 py-1.5 text-caption text-ink shadow-[var(--shadow-lift)]"
          style={{ left: drag.x + 12, top: drag.y + 12 }}
        >
          {drag.name}
        </div>
      )}
    </div>
  );
}
