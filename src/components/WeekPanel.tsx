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
//   marks    — in words: done of total, then what needs a time (D-219)
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

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
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
import { Button, Chip, CrownLine, DayCrown, IconButton, MarkLabel, MarkSet, OfferChip, SectionHeader, Stop } from "./kit";
import { WEEK_REACH_KEY, reachArrivalDelay } from "../lib/motion";
import { bump } from "../lib/celebrate";
import { haptic } from "../lib/haptics";
import { marksReady, movingIds, readDay, weekMarks } from "../lib/marks";
import { useSettings } from "../hooks/useSettings";
import type { Task } from "../lib/types";
import type { CrownLineData } from "../lib/crownLine";
import { readyKey, type ReadyCard } from "../lib/readyCards";
import { notNow } from "./nuvo/offerSnooze";
import { instantAt } from "./plan/destinations";
import { OtherTimes } from "./nuvo/OtherTimes";
import { useWeekComposer } from "../hooks/useFindTime";
import { costFor } from "../lib/offerChoices";

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

const rows0 = (c: { rows: readonly unknown[] }) => c.rows.length > 0;
// Stable, so the memoized MarkSet skips a render when nothing changed.
const WEEK_PLACED_ATTRS = { "data-crown-week": "", "data-crown-color": "var(--landed)" };
const weekMarkAttrs = (k: string) => (k === "placed" ? WEEK_PLACED_ATTRS : undefined);
const weekMarkReach = (k: string) => (k === "placed" ? WEEK_REACH_KEY : undefined);
/** Monday of the current week — the crown names a later week "Next week". */
function currentWeekISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toDateISO(d);
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
  line,
  onLine,
  offers,
  onPathCandidates,
  today,
  deck,
  rowCards,
}: {
  door?: WeekDoor;
  renderTask: RenderCrownTask;
  /** The crown's line (D-207): the Get ready stack's first card, in words.
   *  `null` — nothing to say, so no line and nothing to press. */
  line?: CrownLineData | null;
  /** Pressing the line opens Get ready. Omitted (a harness), the old week door
   *  rides the eyebrow instead. */
  onLine?: () => void;
  /** The rail's offer budget (D-205): a project row whose id is here carries
   *  Draft the path. The host decides the budget; this only draws it. */
  offers?: ReadonlyMap<string, RailOfferCandidate>;
  /** Which open rows COULD carry Draft the path — reported up so the host can
   *  rank them against the day's offers. Empty while the list is folded: the
   *  shut crown never carries a chip. */
  onPathCandidates?: (cands: RailOfferCandidate[]) => void;
  /** Today's tasks as the rail lists them (slot children included) — the day's
   *  reading (D-209). Omitted (a harness), the crown draws no day. */
  today?: readonly Task[];
  /** The deck at rest (D-209): the Get ready stack's top card. When it's
   *  present it stands where the line would; the line still speaks when
   *  there's no card to show (Handle's "Nuvo moved N · Review"). */
  deck?: ReactNode;
  /** The Get ready cards. Each "loose" card — a project's work with no time
   *  this week, and the composer's fit for it — rides its project's row as a
   *  chip instead of a card above the list (D-216, R6). */
  rowCards?: readonly ReadyCard[];
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
  // The Shaped dial's list — which projects, and what each is missing.
  const [shapeOpen, setShapeOpen] = useState(false);
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
  // One time offer per project row: the first "loose" card for it (the cards
  // arrive worst first, and the composer already kept two cards off one slot).
  const timeOffers = useMemo(() => {
    const m = new Map<string, ReadyCard>();
    for (const c of rowCards ?? []) if (c.kind === "loose" && c.projectId && c.at && !m.has(c.projectId)) m.set(c.projectId, c);
    return m;
  }, [rowCards]);
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
  const { settings } = useSettings();
  const workEnd = settings?.work_end_minutes ?? 990;
  const day = useMemo(() => (today ? readDay(today, workEnd) : null), [today, workEnd]);
  // The readings (D-209): the week's three marks. Memoized on the read model —
  // Ready runs each project's pace math, and this panel re-renders on every
  // range change (week travel measured a 51ms block without it).
  const marks = useMemo(() => {
    if (!data || !crown) return [];
    const now = new Date();
    return weekMarks(crown, data, now, movingIds(data, now));
  }, [crown, data]);
  if (!data || !crown) return null;
  const shapeItems = marks[0]?.items ?? [];
  const weekReady = rows0(crown) && marksReady(marks);
  const nextTask = day && !day.closed ? day.tasks.find((t) => t.status !== "done") ?? null : null;
  const nextLine = nextTask
    ? nextTask.start_time
      ? `${nextTask.title} at ${fmtDayTime(nextTask.start_time).replace(/^[A-Z][a-z]{2} /, "")}`
      : nextTask.title
    : null;

  const { rows, landed } = crown;

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
      {/* The crown (D-207): the same part both decks wear. The eyebrow names
          the week it measures; the hero is the one number; the track is the
          week (D-206); the line is the door to Get ready. A host with no Get
          ready mode (a harness) keeps the old week door at the eyebrow's end. */}
      <div className="crown-readings" data-crown="">
        {/* The day (D-209): today's own tasks, closed the moment the last one
            is — at 3pm or whenever — with the hour you got back. The rail's
            hero; the week reads under it so a good day never waits for Friday. */}
        {day && day.total > 0 && <DayCrown day={day} next={nextLine} />}
        <div className="crown-week">
          <div className="crown-week-head">
            {/* No date range (D-219): the calendar header is the one place a
                span is written, so the two can't disagree. On a weekend the
                crown reads the week being planned — and says so. */}
            <MarkLabel k="week">{crown.weekISO > currentWeekISO() ? "Next week" : "This week"}</MarkLabel>
            <Stop on={weekReady} />
            {!onLine && (
              <span className="crown-week-act">
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
              </span>
            )}
          </div>
          {rows.length > 0 ? (
            <>
              <MarkSet
                marks={marks}
                // The Reach for an act that changes the WEEK lands on
                // Scheduled — a card that gives work a time moves that dial.
                attrsFor={weekMarkAttrs}
                reachKeyFor={weekMarkReach}
                acts={{ ready: () => setShapeOpen((v) => !v), placed: onLine }}
              />
              {shapeOpen && shapeItems.length > 0 && (
                <div className="crown-shape-list" role="list" aria-label="Projects to shape">
                  {shapeItems.map((it) => (
                    <button key={it.id} type="button" role="listitem" className="crown-shape-item" onClick={() => openRecord("project", it.id)}>
                      <span className="crown-shape-name">{it.name}</span>
                      <span className="crown-shape-why">{it.why}</span>
                      <Icon name="chevron-right" size={12} />
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="k-markset-detail">No projects on this week yet</p>
          )}
        </div>
      </div>
      {deck ??
        // The Scheduled dial already says "N need a time" and opens the same
        // stack, so the line stays quiet while that dial is open (D-219).
        (line && !(line.part === "time" && marks[1] && !marks[1].full) ? (
          <div className="crown-line-solo">
            <CrownLine line={line} onPress={onLine} />
          </div>
        ) : null)}

      {rows.length > 0 && (
        <>
          {/* A count, like every section. */}
          <SectionHeader title="Projects" count={rows.length} collapsed={!listOpen} onToggle={toggleList} />
          {listOpen && (
            <div className="crown-projects crown-oneline" data-tauri-drag-region="false">
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
                  timeOffer={timeOffers.get(row.projectId) ?? null}
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
  timeOffer,
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
  /** A time for this project's next loose piece (D-216): "Schedule Today
   *  4:15–5pm". Never beside a path offer — one offer per row (R6). */
  timeOffer: ReadyCard | null;
  onOpenProject: (projectId: string) => void;
  expanded: boolean;
  onExpand: () => void;
}) {
  const { rock, work, color, placed, loose, open, pct, rolls, continues, canExpand, weightMins, placedLabel } = row;
  // A task finished under this project swells its ring (D-219) — the click the
  // row's piece track used to give. Waits for a Reach flying to this row.
  const ringBtn = useRef<HTMLButtonElement | null>(null);
  const doneWas = useRef<number | null>(null);
  useLayoutEffect(() => {
    const was = doneWas.current;
    doneWas.current = work.done;
    if (was === null || work.done <= was) return;
    const wait = reachArrivalDelay(row.projectId);
    bump(ringBtn.current, wait, 1.25);
    setTimeout(() => haptic("light"), wait);
  }, [work.done, row.projectId]);
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
            ref={ringBtn}
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
          ) : null}

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
            where the project's span stands today (D-187; words since D-219).
            A piece ticked below lands here. Then what's wrong, if anything. */}
        <div className="crown-proj-marks" aria-label={marksLabel}>
          {/* Words, not a track (D-219): the ring before the name already
              draws the done fraction; what's left is said, once. */}
          {work.total > 0 ? (
            <span className="crown-meta crown-proj-count">
              {work.done}/{work.total}
            </span>
          ) : (
            // The stranger's account, and every honest new project: nothing to
            // draw yet, so say the fact rather than an empty line (P7).
            <span className="crown-meta">No tasks yet</span>
          )}
          {!done && loose.length > 0 && (
            <span className="crown-meta crown-proj-todo" title={`${loose.length} with no time — ${placedLabel}`}>
              {loose.length} need{loose.length === 1 ? "s" : ""} a time
            </span>
          )}
          {!done && rolls > 0 && (
            // Carrying isn't *now* — the number tells it, a colour would shout it.
            <span className="crown-meta" title={carryMark(rolls).title}>
              {carryMark(rolls).text}
            </span>
          )}
        </div>
      </div>

      {/* A project's offer (D-216 R6) — the path or a time — takes a line of its
          own under the row, never a slot inside the one-line row: there it
          squeezed the name to a few letters and spilled past the rail. */}
      {!done && !shipped && !looksDone && pathOffer && (
        <div className="crown-offer-line" data-tauri-drag-region="false">
          <PathOffer thin={pathOffer} onOpenProject={onOpenProject} />
        </div>
      )}
      {!done && !pathOffer && timeOffer && (
        <TimeOfferLine card={timeOffer} task={loose.find((t) => t.id === timeOffer.taskId) ?? null} projectName={row.title} />
      )}

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

/** A project's next loose piece and where it would go (D-216): the piece's name,
 *  then the act with its day — "Write the runbook · Schedule Today 4:15–5pm".
 *  Pointing at the chip draws the block on the Schedule and dims the rest (R3);
 *  the evidence and the project ride its tooltip. Right-click / ⌫ is Not now. */
function TimeOfferLine({ card, task, projectName }: { card: ReadyCard; task: Task | null; projectName: string }) {
  const at = card.at!;
  // What it costs (R5), read off the same busy time the composer used.
  const { busy } = useWeekComposer(new Date());
  const cost = costFor(at, busy);
  const start = instantAt(at.dayISO, at.startMin);
  const end = instantAt(at.dayISO, at.startMin + at.durationMin);
  return (
    <div className="crown-offer-line" data-tauri-drag-region="false">
      <span className="crown-offer-task" title={card.title}>
        {card.title}
      </span>
      {/* the chip and its second answer travel together — the same pair, the
          same ⋯, as a task row's offer (one look for Other times on the rail) */}
      <span className="offer-pair">
        <OfferChip
          verb={card.primary.verb}
          name={card.primary.name}
          whole
          title={`${card.title} · ${card.why}`}
          preview={{ label: card.title, start, end }}
          onPress={(el) => card.primary.run(el)}
          onDismiss={card.secondary ? () => card.secondary!.run() : undefined}
        />
        {task && card.placeAt && (
          <OtherTimes
            task={task}
            first={at}
            compact
            onHold={card.placeAt}
            noes={[
              ...(card.secondary ? [{ label: "Not now · two weeks", run: card.secondary.run }] : []),
              ...(card.projectId
                ? [{ label: `No time offers for ${projectName} · two weeks`, run: () => notNow(readyKey.times(card.projectId!)) }]
                : []),
            ]}
          />
        )}
      </span>
      {/* what the time costs (R5) stands beside the time, not the title */}
      {cost && (
        <span className="crown-offer-cost" title={cost}>
          {cost}
        </span>
      )}
    </div>
  );
}
