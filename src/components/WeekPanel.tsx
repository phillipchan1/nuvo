// The pool's crown — the planner's ONE hero, and the week's projects under it.
//
// Instrument (D-190, "The frame"): the crown carries the surface's one loud
// line — the week's span as `text-display masthead` — and under it the week as
// ONE track (D-206): a piece per task, done toward an initiative · done, other
// · placed · no time, the week's pace tick, and one number ("13/17 done"). The
// door ("Get ready ›", or the old "Plan the week" when the host has no Get
// ready mode) rides the hero's line as a quiet button. Below, the
// week's projects as a kit section (name · count · disclosure), each one the
// deck card's anatomy at rail density, because a project on the On Deck board
// and a project in this week's crown are the same object:
//
//   identity — the ring, in the domain's hue (an ARC that fills, not a box)
//   NAME     — the row's title; its weight left on the right
//   marks    — the work as a PaceTrack with the pace tick, then what's wrong
//
// The laws this surface keeps:
//
//  1 · ONE TASK GRAMMAR. A project's work renders through `TaskRow` — the same
//      component the Today and Inbox lists use (`renderTask`). Not a copy.
//  2 · COMPLETE ANYWHERE, PLACE ONCE. Ticking is not a move, so it works on a
//      placed row too. *Moving* stays the calendar's act (D-084) — the time
//      chip is a jump link onto the grid, not a drag handle.
//  3 · THE PROJECT'S MARK IS AN ARC, not a checkbox. A ring that fills with
//      progress and offers the ship assessment; the tasks below wear the round
//      TaskCheck at a smaller size and sit indented under the name.
//  4 · NUMBERS BECOME MARKS where a mark can say it — pieces are a track, the
//      pace is a tick; `wk N` survives (carrying is a fact you must not hide).
//      Every phrase removed is still in the `aria-label` and the `title`.
//  5 · SAY IT ONCE. The sidebar already lists the week's projects with their
//      counts on every page; here they are the POOL — draggable onto the grid,
//      open to their loose work — so the row says what the sidebar can't:
//      weight left, pace, and what has no time.

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useThinPaths } from "../hooks/useThinPaths";
import { PathOffer, pathCandidates } from "./nuvo/RailOffers";
import type { RailOfferCandidate } from "../lib/railOffers";
import type { ThinPath } from "../lib/thinPath";
import { useRecordContextMenu } from "./RecordContextMenu";
import { Icon } from "./Icon";
import { useVertical } from "../hooks/useVertical";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { useWeekCrown, type RenderCrownTask, type WeekCrownRow } from "../hooks/useWeekCrown";
import { carryMark } from "../lib/priorities";
import { fmtDayTime, toDateISO } from "../lib/dates";
import { revealOnCalendar } from "../lib/calendarReveal";
import { MARQUEE_OPEN_EVENT } from "../lib/marquee";
import { deckWeight } from "../lib/pace";
import { ProjectShipAssess } from "./record/ShipAssess";
import type { EmblemSpec } from "../lib/weekEmblem";
import { PaceTrack, WeekTrack } from "./progress/PaceTrack";
import { Button, Chip, IconButton, SectionHeader } from "./kit";

/** The week door's lifecycle, owned by Planner and worn by this header. */
export interface WeekDoor {
  /** plan — not composed · view — composed · review — the Friday reveal landed. */
  mode: "plan" | "view" | "review";
  title: string;
  /** The reveal is waiting: the door should call, quietly. */
  glow: boolean;
  glyph: EmblemSpec | null;
  onOpen: () => void;
}

const OPEN_KEY = "nuvo-rail-week-open";
function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

export default function WeekPanel({
  door,
  renderTask,
  crownLine,
  offers,
  onPathCandidates,
  onGetReady,
}: {
  door?: WeekDoor;
  renderTask: RenderCrownTask;
  /** A line under the week's track (D-204 §3) — a repair ("Tue 10am broke… ·
   *  Repair ›") passes its own. Omitted or `null`, nothing: the track's
   *  outlined pieces already say what has no time (D-206). */
  crownLine?: ReactNode;
  /** The one door (D-206): when given, the header's button is **Get ready ›**
   *  and opens the Get ready rail mode. Omitted, the old week door stays. */
  onGetReady?: () => void;
  /** The rail's offer budget (D-205): a project row whose id is here carries
   *  Draft the path. The host decides the budget; this only draws it. */
  offers?: ReadonlyMap<string, RailOfferCandidate>;
  /** Which open rows COULD carry Draft the path — reported up so the host can
   *  rank them against the day's offers. Empty while the list is folded: the
   *  shut crown never carries a chip. */
  onPathCandidates?: (cands: RailOfferCandidate[]) => void;
}) {
  const { data, togglePushLanded } = useVertical();
  const { openFlow, openRecord, nav } = useAppNavigation();
  // A project places onto a TIME grid — that's what a sitting is. The board and
  // the Year have no hours, and the floors have no calendar at all, so the row
  // doesn't wear a grab cursor there: an affordance that can't land is the exact
  // defect the crown's own drag shipped with once (D-084).
  const canPlaceProjects =
    nav.rung === "day" && (nav.calView === "timeGridWeek" || nav.calView === "timeGridDay");
  const [shipId, setShipId] = useState<string | null>(null);
  // Which project rows are open to their work. Collapsed by default — the
  // crown's job is the glance; the depth is there when the glance isn't enough.
  // It also keeps the cost honest: an open project mounts real `TaskRow`s.
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  // The section itself folds to one line — a per-viewer convenience.
  const [listOpen, setListOpen] = useState(readOpen);
  // The week's slate, read once and shared with the phone's crown — the
  // priorities ARE the projects On Deck committed to this week, derived, so this
  // rail can never drift from the board (or from Set-the-week).
  const crown = useWeekCrown();
  // Right-click a project for its lifecycle acts — the same menu every other
  // surface wears.
  const recordMenu = useRecordContextMenu();
  // Draft the path's candidates (D-205): open, unlanded rows with a thin path.
  // Reported up; the rail's budget decides which, if any, show.
  const thin = useThinPaths();
  const pathCands =
    onPathCandidates && crown && listOpen
      ? pathCandidates(
          crown.rows.map((r) => ({ projectId: r.projectId, done: r.state === "shipped" || r.state === "landed" })),
          thin,
        )
      : [];
  const pathSig = pathCands.map((c) => c.key).join("|");
  const reportRef = useRef(onPathCandidates);
  reportRef.current = onPathCandidates;
  const candsRef = useRef(pathCands);
  candsRef.current = pathCands;
  useEffect(() => {
    reportRef.current?.(candsRef.current);
  }, [pathSig]);
  useEffect(() => () => reportRef.current?.([]), []);
  if (!data || !crown) return null;

  const { rows, landed } = crown;
  // The hero follows the sprint the way the label always has: no sprint row,
  // no span — the week is then simply "This week".
  const hero = data.sprint?.week_start ? crown.weekLabel : "This week";

  // The panel is the ambient face of the Week's Plan: composed → open the
  // surface (view), not yet → the compose ritual (plan). Planner owns the real
  // lifecycle (it alone knows the Friday reveal); this stands in when the door
  // isn't wired, so the panel is never a dead end.
  const openWeekPlan =
    door?.onOpen ??
    (() => {
      if (crown.composed) window.dispatchEvent(new CustomEvent(MARQUEE_OPEN_EVENT, { detail: { surface: "week-plan" } }));
      else openFlow("sunday");
    });
  const mode = door?.mode ?? (crown.composed ? "view" : "plan");
  // One door, one position, three verbs — the state changes the word.
  const action = mode === "review" ? "Review" : mode === "plan" ? "Plan the week" : "The plan";

  // Ticking a priority SHIPS its project — one completion act, not two. The
  // ring opens the same assessment every other ship path uses: you see what's
  // still open before anything is written. (A legacy landed-but-not-shipped
  // verdict can still be tapped to reopen; shipped rows are inert.)
  const onTick = (row: WeekCrownRow) => {
    if (row.state === "shipped") return;
    if (row.rock.done_at) return togglePushLanded(row.projectId);
    setShipId(row.projectId);
  };

  // The scoreboard, kept as WORDS for anyone who can't read the marks.
  const slateSentence =
    rows.length === 0 ? "No projects on this week yet" : `${landed} of ${rows.length} landed · ${crown.track.label}`;

  // Under the track, only a line someone hands in (the repair) — the "N with no
  // time · Plan the week ›" line retired into the track's outlined pieces.
  const line = crownLine ?? null;

  const toggleList = () =>
    setListOpen((v) => {
      try {
        localStorage.setItem(OPEN_KEY, v ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !v;
    });

  return (
    <div className="crown">
      <div className="crown-hero">
        <div className="crown-hero-line">
          <h2 className="crown-title text-display masthead">{hero}</h2>
          {onGetReady ? (
            // The one door (D-206): Get ready opens the rail's card stack for
            // this screen. Plan and Repair stay modes its cards can open.
            <Button
              size="xs"
              kind="ghost"
              onClick={onGetReady}
              title={`Get this week ready — ${slateSentence}`}
              aria-label={`Get ready. ${slateSentence}.`}
              icon={door?.glow ? <span className="crown-door-dot" aria-hidden /> : undefined}
              trailing={<Icon name="chevron-right" size={12} />}
              data-get-ready=""
            >
              Get ready
            </Button>
          ) : (
            <Button
              size="xs"
              kind={mode === "view" ? "ghost" : "secondary"}
              onClick={openWeekPlan}
              title={door?.title ?? `The week's plan — ${slateSentence}`}
              aria-label={`${action}. ${slateSentence}.`}
              icon={door?.glow ? <span className="crown-door-dot" aria-hidden /> : undefined}
              trailing={mode === "view" ? <Icon name="chevron-right" size={12} /> : undefined}
            >
              {action}
            </Button>
          )}
        </div>
        {rows.length > 0 && crown.track.total > 0 ? (
          // The week as ONE track (D-206) and one number — the drawing each
          // project row makes of its project, made of the week.
          <div className="crown-track">
            <WeekTrack track={crown.track} />
            <span className="crown-track-num">
              <b>
                {crown.track.done}/{crown.track.total}
              </b>{" "}
              done
            </span>
          </div>
        ) : (
          <p className="crown-fact">
            {rows.length > 0 ? "Nothing shaped yet" : "No projects yet"}
            {rows.length === 0 && mode !== "plan" && !onGetReady && (
              <>
                {" · "}
                <button type="button" className="crown-fact-link" onClick={() => openFlow("sunday")}>
                  Add
                </button>
              </>
            )}
          </p>
        )}
        {line}
      </div>

      {rows.length > 0 && (
        <>
          {/* A count, like every section — how many have landed is the
              sidebar's to say (This week · n/m), on every page. */}
          <SectionHeader title="Projects" count={rows.length} collapsed={!listOpen} onToggle={toggleList} />
          {listOpen && (
            <div className="crown-projects" data-tauri-drag-region="false">
              {rows.map((row) => (
                <ProjectStackRow
                  key={row.rock.id}
                  row={row}
                  renderTask={renderTask}
                  onToggle={() => onTick(row)}
                  // Open a priority where its work lives: its Record.
                  onOpen={() => openRecord("project", row.projectId)}
                  onContextMenu={recordMenu.onContextMenu("project", row.projectId)}
                  canPlace={canPlaceProjects}
                  pathOffer={offers?.get(row.projectId)?.kind === "path" ? thin.get(row.projectId) ?? null : null}
                  onOpenProject={(id) => openRecord("project", id)}
                  expanded={openIds.has(row.rock.id)}
                  onExpand={() =>
                    setOpenIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(row.rock.id)) next.delete(row.rock.id);
                      else next.add(row.rock.id);
                      return next;
                    })
                  }
                />
              ))}
            </div>
          )}
        </>
      )}

      {shipId && <ProjectShipAssess id={shipId} onClose={() => setShipId(null)} />}
      {recordMenu.menu}
    </div>
  );
}

// ── the marks ────────────────────────────────────────────────────────────────

/** The one thing that must never be missable: work with no time. `--warn`
 *  only when something is actually homeless — a fully-placed project is
 *  silence (P9). `count = 0` is the bare dot a single homeless row wears (the
 *  row IS the one, so a "1" beside it would count to itself). */
function NoTime({ count, title }: { count: number; title?: string }) {
  return (
    <span className="no-time" title={title}>
      {count > 0 ? count : null}
    </span>
  );
}

/** The project's mark: an ARC, never a checkbox (law 3). Fills with the work
 *  that's done; goes solid with a ✓ only when the row is finished or earned. */
function ProgressRing({ pct, color, filled }: { pct: number; color: string; filled: boolean }) {
  const r = 5.25;
  const C = 2 * Math.PI * r;
  if (filled) {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
        <circle cx="7" cy="7" r="7" fill={color} />
        <path d="M4.3 7.2l1.8 1.8 3.6-3.9" fill="none" stroke="var(--on-accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <circle cx="7" cy="7" r={r} fill="none" stroke={color} strokeOpacity={0.28} strokeWidth="2.5" />
      {pct > 0 && (
        <circle
          cx="7"
          cy="7"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeDasharray={`${(pct / 100) * C} ${C}`}
          transform="rotate(-90 7 7)"
        />
      )}
    </svg>
  );
}

// ── one project on the week ─────────────────────────────────────────────────
// The ring opens the ship assessment. The name opens the project's Record. The
// chevron opens its work — `TaskRow`s, the same row the day list is built from.
function ProjectStackRow({
  row,
  renderTask,
  onToggle,
  onOpen,
  onContextMenu,
  canPlace,
  pathOffer,
  onOpenProject,
  expanded,
  onExpand,
}: {
  /** the week's read model — this row computes nothing (see useWeekCrown) */
  row: WeekCrownRow;
  renderTask: RenderCrownTask;
  onToggle: () => void;
  onOpen: () => void;
  onContextMenu: (e: ReactMouseEvent) => void;
  /** the Schedule is showing a time grid, so a sitting has somewhere to land */
  canPlace: boolean;
  /** Draft the path, when the rail's budget gave this row the offer (D-205). */
  pathOffer: ThinPath | null;
  onOpenProject: (projectId: string) => void;
  expanded: boolean;
  onExpand: () => void;
}) {
  const { rock, work, color, placed, loose, open, pct, rolls, continues, canExpand, weightMins, placedLabel } = row;
  const shipped = row.state === "shipped";
  const done = shipped || row.state === "landed";
  const looksDone = row.state === "ready-to-ship";
  const weight = done ? null : deckWeight(weightMins);

  // ── the project itself is draggable ──────────────────────────────────────
  // The row places as one push. The payload is DOM-only on purpose:
  // `CalendarPane` mounts a single FullCalendar `Draggable` over the rail and
  // reads what it needs off the element, so this needs no new drag machinery
  // and no second drop path. `data-project-placed` is what makes the drop
  // honest — the sitting takes the loose work, and what already has a time is
  // *offered*, never moved silently.
  const canDrag = canPlace && !done && open > 0;
  const dragProps = canDrag
    ? {
        "data-project-drag": row.projectId,
        "data-project-title": row.title,
        "data-project-color": color,
        "data-project-domain": row.domainId ?? "",
        "data-project-tasks": loose.map((t) => t.id).join(","),
        "data-project-placed": placed.map((p) => p.task.id).join(","),
      }
    : {};

  // The visible amber mark is the loose half, and D-060 forbids letting only
  // that half be the answer ("2 loose" reads as "and the rest is fine"). So the
  // SPLIT — the read model's own `placedLabel` — is what the words carry.
  const marksLabel =
    `${work.done} of ${work.total} done` +
    (weight ? ` · ${weight} left` : "") +
    (open > 0 ? ` · ${placedLabel}` : "");

  return (
    <div
      className="crown-proj"
      data-done={done ? "" : undefined}
      // Where the Reach lands (D-202): `reachToCrown` finds this row's track.
      data-crown-project={row.projectId}
      data-crown-color={color}
    >
      <div
        {...dragProps}
        data-drag={canDrag ? "" : undefined}
        onContextMenu={onContextMenu}
        title={
          canDrag
            ? loose.length > 0
              ? `Drag onto the calendar to sit ${row.title} — ${loose.length} piece${loose.length === 1 ? "" : "s"} with no time yet`
              : `Drag onto the calendar to give ${row.title} a sitting`
            : undefined
        }
        className="crown-proj-row"
      >
        <div className="crown-proj-top">
          <button
            type="button"
            onClick={onToggle}
            disabled={shipped}
            title={
              shipped
                ? "Shipped this week"
                : done
                  ? "Landed — tap to reopen"
                  : looksDone
                    ? "Every task is done — ship it"
                    : "Ship it — you'll see what's still open first"
            }
            aria-label={shipped ? "Shipped" : done ? "Reopen push" : `Ship ${row.title}`}
            className="crown-ring"
          >
            <ProgressRing pct={pct} color={color} filled={done} />
          </button>

          <button type="button" onClick={onOpen} title={`${row.title} — open`} className="crown-name">
            {rock.title}
          </button>

          {shipped ? (
            // The week's win — never a vanished row.
            <Chip tone="ok">Shipped</Chip>
          ) : done ? (
            // "landed" itself is gone: the filled ring and the faint name say
            // it. `continues` survives — it's the part the drawing can't say.
            continues && <span className="crown-meta">Continues</span>
          ) : looksDone ? (
            <Button
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              title="Every task is done — ship it"
            >
              Ship
            </Button>
          ) : pathOffer ? (
            // The offer takes the weight's place — never a second mark (D-205).
            <PathOffer thin={pathOffer} onOpenProject={onOpenProject} />
          ) : (
            weight && <span className="crown-meta" title={`${weight} of work left`}>{weight}</span>
          )}

          {canExpand ? (
            <IconButton
              size="xs"
              label={expanded ? `Hide ${row.title}'s work` : `Show ${row.title}'s work — ${marksLabel}`}
              aria-expanded={expanded}
              icon={<Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} />}
              onClick={onExpand}
            />
          ) : (
            <span className="crown-chev-spacer" aria-hidden />
          )}
        </div>

        {/* The marks — the work as a TRACK of its pieces, with the pace tick
            where the project's span stands today (progress/PaceTrack, D-187).
            A piece ticked below lands here. Then what's wrong, if anything. */}
        <div className="crown-proj-marks" aria-label={marksLabel}>
          {work.total > 0 ? (
            <PaceTrack
              done={work.done}
              total={work.total}
              placed={done ? 0 : placed.length}
              color={color}
              elapsed={row.elapsed}
              width={120}
              reachKey={row.projectId}
            />
          ) : (
            // The stranger's account, and every honest new project: nothing to
            // draw yet, so say the fact rather than an empty line (P7).
            <span className="crown-meta">Nothing shaped</span>
          )}
          {!done && loose.length > 0 && <NoTime count={loose.length} title={`${loose.length} with no time — ${placedLabel}`} />}
          {!done && rolls > 0 && (
            // Carrying isn't *now* — the number tells it, a colour would shout it.
            <span className="crown-meta" title={carryMark(rolls).title}>
              {carryMark(rolls).text}
            </span>
          )}
        </div>
      </div>

      {/* Its work — ONE grammar. These are `TaskRow`s: the same check, the
          same context menu, the same drag as the day list below. Placed pieces
          first (the clock orders them), then what has no time. Each row says
          which it is — a time chip, or the no-time mark. */}
      {expanded && canExpand && (
        <div className="crown-proj-work">
          {placed.map((p) => (
            <div key={p.task.id}>
              {renderTask(p.task, {
                draggable: false,
                whenShown: true,
                action: <TimeChip startISO={p.startISO} slotTitle={p.slotTitle} />,
              })}
            </div>
          ))}
          {loose.map((t) => (
            <div key={t.id}>
              {renderTask(t, {
                draggable: true,
                // Project work placed by hand lands in the project's SITTING,
                // never as a bare block — one piece or five, project time on the
                // grid wears one shape. `data-task-week` commits it to the sprint
                // too, so placing one never writes a day without a week (P2).
                dragData: { "data-task-week": "1", "data-task-project": t.project_id ?? "" },
                action: (
                  <span
                    className="flex shrink-0"
                    title="No time this week yet — drag it onto the calendar"
                    aria-label="No time this week yet"
                  >
                    <NoTime count={0} />
                  </span>
                ),
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A placed piece's time — and the way back to it. Law 2: you may *complete* a
 *  placed row from here, but you may not *move* it; moving is the calendar's
 *  act (D-084). So the chip is a jump link, riding the reveal bus search
 *  already uses, rather than a drag handle that would be a second answer to one
 *  question (P8). */
function TimeChip({ startISO, slotTitle }: { startISO: string; slotTitle: string | null }) {
  const label = fmtDayTime(startISO);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        const at = new Date(startISO);
        revealOnCalendar({
          dateISO: toDateISO(at),
          // A shade earlier than the block, so it lands with its lead-in visible
          // rather than flush against the top edge.
          scrollToTime: `${String(Math.max(0, at.getHours() - 1)).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}:00`,
        });
      }}
      title={slotTitle ? `${label} — inside ${slotTitle}. Show it on the calendar` : `${label} — show it on the calendar`}
      className="crown-time"
    >
      {label}
      <span aria-hidden>↗</span>
    </button>
  );
}
