// Initiative On Deck — the bets, grouped by the quarter they land in. The sibling
// of OnDeckPlanner (projects → weeks); here a bet time-boxes onto a QUARTER. A
// kanban, not a Gantt: each column is a quarter, each card an initiative, and you
// drag a card between columns to move its finish line. An inbox rail on the left
// holds bets with no quarter yet (mirrors the project planner's "needs a week").
//
// Every card leads with its OKR health — attainment, KR count, coverage — because
// that is what grooming a bet is *for*: making the outcome measurable and sound.
// Unlinked bets (no domain) surface a one-tap auto-link to the "main" they belong
// under (suggestDomainForInitiative), so the tree stays connected without a form.
//
// Pointer-events drag (HTML5 DnD is swallowed by Tauri) — the same idiom as
// OnDeckPlanner / WeekBoard: one document-level capture pointerdown, a 5px move
// threshold to tell a drag from a click, elementFromPoint hit-testing.

import { useEffect, useMemo, useRef, useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import {
  domainById,
  isProjectComplete,
  isProjectInFlight,
  type Initiative,
  type VerticalData,
} from "../../lib/vertical";
import {
  quarterEndISO,
  readInitiativeDeck,
  suggestDomainForInitiative,
  type InitiativeLane,
  type InitiativeLaneState,
} from "../../lib/initiativeDeck";
import { DomainPicker, MomentumChip, PROJECT_STATUS_COLORS } from "../floors/parts";
import { READY } from "../floors/ReadinessBanner";
import NewInitiative from "../floors/NewInitiative";

const CAUTION = PROJECT_STATUS_COLORS.waiting;
const COL_PX = 248;

const STATE_COLOR: Record<InitiativeLaneState, string> = {
  on_track: READY,
  at_risk: "var(--signal)",
  needs_okrs: CAUTION,
  needs_shaping: CAUTION,
  idea: "var(--line-strong)",
  parked: "var(--muted)",
};
const STATE_LABEL: Record<InitiativeLaneState, string> = {
  on_track: "on track",
  at_risk: "at risk",
  needs_okrs: "needs OKRs",
  needs_shaping: "needs shaping",
  idea: "no finish line",
  parked: "parked",
};

export default function InitiativeDeck() {
  const { data, updateInitiative, updateProject } = useVertical();
  const { openRecord, openFlow, openFloorModal } = useAppNavigation();
  const now = useMemo(() => new Date(), []);
  const board = useMemo(() => readInitiativeDeck(data, now), [data, now]);

  // group placed lanes by their quarter column
  const byColumn = useMemo(() => {
    const m = new Map<number, InitiativeLane[]>();
    for (const l of board.lanes) {
      const idx = l.quarterIdx ?? 0;
      const arr = m.get(idx) ?? [];
      arr.push(l);
      m.set(idx, arr);
    }
    // most urgent first inside a column: at risk / overdue, then needs work
    const order: Record<InitiativeLaneState, number> = {
      at_risk: 0, needs_okrs: 1, needs_shaping: 2, on_track: 3, idea: 4, parked: 5,
    };
    for (const arr of m.values()) arr.sort((a, b) => order[a.state] - order[b.state]);
    return m;
  }, [board.lanes]);

  const needShaping = board.lanes.filter((l) => l.gaps.length > 0 || l.state === "needs_okrs").length;
  const shapeable = needShaping > 0;

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
  // click an empty column → create an initiative placed in that quarter
  const [createCol, setCreateCol] = useState<number | null>(null);
  const createInCol = (i: number) => (id: string) => {
    const col = board.quarters[i];
    if (col) updateInitiative(id, { targetDate: quarterEndISO(col.start), status: "in_progress" });
    setCreateCol(null);
    openRecord("initiative", id);
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

  const inFlight = data.initiatives.filter((i) => isProjectInFlight(i.status) && !isProjectComplete(i.status)).length;

  return (
    <div className="mx-auto flex min-h-full max-w-[1600px] flex-col">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-display masthead leading-none">On deck</h1>
          <p className="mt-1.5 text-body text-muted">
            The bets with finish lines, grouped by the quarter they land in — drag one onto a quarter to commit it. {board.inbox.length > 0 && <span className="text-ink">{board.inbox.length} still {board.inbox.length === 1 ? "needs" : "need"} a quarter.</span>}
          </p>
        </div>
        <span className="shrink-0 text-caption text-muted">{inFlight} in flight{needShaping > 0 && <> · {needShaping} need grooming</>}</span>
      </div>

      <div className="flex min-h-0 gap-5">
        {/* ── inbox — bets with no quarter yet ─────────────────────────────── */}
        <aside
          data-inbox-drop
          className="fast w-72 shrink-0 self-start rounded-xl border p-3"
          style={{
            borderColor: overInbox ? "var(--accent)" : "var(--line)",
            background: overInbox ? "var(--accent-soft)" : "var(--surface-2)",
          }}
        >
          <div className="flex items-center justify-between gap-2 px-1.5 pb-2">
            <span className="section-label !p-0">Needs a quarter · {board.inbox.length}</span>
            <button
              onClick={() => openFloorModal("new-initiative")}
              className="tap fast rounded-md px-1.5 py-0.5 text-caption font-medium text-muted hover:text-ink"
              title="New initiative"
            >
              + bet
            </button>
          </div>
          {board.inbox.length === 0 ? (
            <p className="px-1.5 py-6 text-center text-caption text-muted">
              Every bet has a quarter. <button onClick={() => openFloorModal("new-initiative")} className="fast underline hover:text-ink">Add one</button> or drag a bet here to shelve it.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
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
                  compact
                />
              ))}
            </div>
          )}
        </aside>

        {/* ── the quarter columns ──────────────────────────────────────────── */}
        <div className="min-w-0 flex-1 overflow-x-auto pb-2">
          <div className="flex gap-3" style={{ minWidth: board.quarters.length * (COL_PX + 12) }}>
            {board.quarters.map((q) => {
              const lanes = byColumn.get(q.idx) ?? [];
              const risky = lanes.filter((l) => l.atRisk.atRisk).length;
              const dropping = dropCol === q.idx;
              return (
                <div
                  key={q.key}
                  data-quarter={q.later ? undefined : q.idx}
                  onClick={() => !q.later && lanes.length === 0 && setCreateCol(q.idx)}
                  className="fast flex shrink-0 flex-col rounded-xl border p-2.5"
                  style={{
                    width: COL_PX,
                    borderColor: dropping ? "var(--accent)" : "var(--line)",
                    background: dropping ? "var(--accent-soft)" : q.later ? "transparent" : "var(--surface-2)",
                    opacity: q.later ? 0.85 : 1,
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2 px-1 pb-2">
                    <span className="text-caption font-semibold text-ink">{q.label}</span>
                    <span className="mono text-micro text-muted">
                      {lanes.length}{risky > 0 && <span style={{ color: "var(--signal)" }}> · {risky}⚠</span>}
                    </span>
                  </div>
                  {q.idx !== 0 && !q.later && (
                    <div className="mono px-1 pb-1.5 text-micro text-muted">{q.shortLabel}</div>
                  )}

                  <div className="flex min-h-[60px] flex-col gap-2">
                    {lanes.length === 0 ? (
                      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-line px-2 py-6 text-center text-micro text-muted">
                        {q.later ? "Nothing this far out" : "Drop a bet here"}
                      </div>
                    ) : (
                      lanes.map((l) => (
                        <InitiativeCard
                          key={l.initiative.id}
                          lane={l}
                          data={data}
                          onSetDomain={setDomain}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <span className="text-micro text-muted">Drag onto a quarter to commit a finish line · drag to the rail to shelve · click to open</span>
        {shapeable && (
          <button
            onClick={() => openFlow("refine", { pass: "initiative" })}
            className="tap fast rounded-xl px-5 py-2.5 text-body font-medium text-white active:scale-[.98]"
            style={{ background: "var(--accent)" }}
          >
            Groom the {needShaping} that need it →
          </button>
        )}
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

      {createCol != null && (
        <NewInitiative onClose={() => setCreateCol(null)} onCreated={createInCol(createCol)} />
      )}
    </div>
  );
}

// ── one bet card — OKR health up front, domain auto-link when unlinked ────────
function InitiativeCard({
  lane,
  data,
  onSetDomain,
  compact = false,
}: {
  lane: InitiativeLane;
  data: VerticalData;
  onSetDomain: (i: Initiative, domainId: string) => void;
  compact?: boolean;
}) {
  const { updateInitiative } = useVertical();
  const i = lane.initiative;
  const domain = domainById(data, i.domainId);
  const dot = domain?.color ?? "var(--line-strong)";
  const color = STATE_COLOR[lane.state];
  const suggestion = lane.needsDomain ? suggestDomainForInitiative(data, i) : null;

  return (
    <div
      data-init-drag={i.id}
      className="group/card fast cursor-grab select-none rounded-lg border border-line bg-surface px-3 py-2.5 hover:border-line-strong active:cursor-grabbing"
      style={{ boxShadow: lane.overdue ? `inset 3px 0 0 var(--signal)` : undefined }}
    >
      <div className="flex items-start gap-2">
        <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-caption font-semibold text-ink">{i.name}</div>
          {i.outcome.trim() && <div className="mt-0.5 line-clamp-1 text-micro text-muted">{i.outcome}</div>}
        </div>
      </div>

      {/* OKR line — the reason this surface exists */}
      <div className="mono mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-4 text-micro">
        <span style={{ color }}>
          {lane.overdue && lane.state !== "parked" ? "⚠ overdue · " : ""}{STATE_LABEL[lane.state]}
        </span>
        {lane.krCount > 0 ? (
          <>
            <span className="text-muted">·</span>
            <span className="text-ink">{lane.attainment ?? 0}%</span>
            <span className="text-muted">{lane.krCount} KR{lane.krCount === 1 ? "" : "s"}</span>
            {lane.uncovered > 0 && <span style={{ color: CAUTION }}>{lane.uncovered} uncovered</span>}
          </>
        ) : (
          !compact && <span className="text-muted">· no key results</span>
        )}
      </div>

      {/* at-risk reasons — named, not just a dot */}
      {lane.atRisk.reasons.length > 0 && (
        <div className="mono mt-1 pl-4 text-micro" style={{ color: "var(--signal)" }}>
          {lane.atRisk.reasons.join(" · ")}
        </div>
      )}

      {/* the "main" this bet belongs under — a control, not a drag handle */}
      <div data-card-control className="mt-2 flex items-center gap-2 pl-4" onPointerDown={(e) => e.stopPropagation()}>
        {lane.needsDomain ? (
          suggestion ? (
            <button
              onClick={() => onSetDomain(i, suggestion.domain.id)}
              className="tap fast flex items-center gap-1 rounded-full border px-2 py-0.5 text-micro font-medium"
              style={{ color: suggestion.domain.color, borderColor: `${suggestion.domain.color}66`, background: `${suggestion.domain.color}12` }}
              title="Link this bet to its domain"
            >
              <span>{suggestion.domain.icon}</span>
              <span>Link → {suggestion.domain.name}</span>
            </button>
          ) : (
            <DomainPicker
              domains={data.domains}
              value=""
              onChange={(id) => onSetDomain(i, id)}
            />
          )
        ) : (
          <span className="mono text-micro text-muted">{domain?.icon} {domain?.name}</span>
        )}
        {!compact && <div className="flex-1" />}
        {!compact && <MomentumChip value={i.momentum} onChange={(m) => updateInitiative(i.id, { momentum: m })} />}
      </div>
    </div>
  );
}
