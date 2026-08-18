// The week's plan — the rail's crown, worn as a STACK of projects.
//
// The week's projects ARE the main event, and the rail used to draw them as the
// same size as a loose task: 13px `text-body`, a grey "all placed ▸" pill, a
// meter and an `n/m`, with their own work hanging underneath as bare <li>s you
// could neither tick nor (once placed) touch. Two grammars for one noun, and a
// hierarchy the type never stated. This is the fix, and it is deliberately the
// **deck card's** anatomy at rail density — because a project on the On Deck
// board and a project in this week's crown are the same object:
//
//   identity (3px domain spine, inset — DeckCard's `marked` variant)
//   NAME, the hero — full width, nothing to its left
//   ONE marks line: pips · weight · what's wrong
//
// The laws this surface now keeps, all of which the old crown broke:
//
//  1 · ONE TASK GRAMMAR. A project's work renders through `TaskRow` — the same
//      component the Today and Inbox lists use. Not a copy of it: the component.
//      That is what makes "I can't check these off" unfixable-by-drift.
//  2 · COMPLETE ANYWHERE, PLACE ONCE. Ticking is not a move, so it works on a
//      placed row too. *Moving* stays the calendar's act (D-084 stands) — the
//      time chip is a jump link onto the grid, not a drag handle.
//  3 · THE PROJECT'S MARK IS AN ARC, not a checkbox. A ring that fills with
//      progress and offers the ship assessment; the tasks below wear squares.
//      Round vs square is what stops a nested pair reading as one tick twice.
//      (Shipping stays a judgment — D-048 took the checkbox off the deck card
//      for the same reason.)
//  4 · NUMBERS BECOME MARKS. `3/5` → five pips in the domain's hue; `all placed`
//      → silence (P9 — only homeless work has news). `wk N` survives: carrying
//      is a fact you must not hide. Every phrase removed is still in the
//      `aria-label` and the `title`.
//  5 · MASS, NOT FRAMES. The name is `text-head`; a loose task is `text-caption`.
//      Never a serif, never a tinted card — D-049 settled that twice.
//
// The header IS the week door: identity left, the state's verb right. The
// toolbar keeps a door only in focus mode, where this rail is slid shut.

import { useState } from "react";
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


/** Past this many pieces, pips stop being countable at a glance and become the
 *  meter they stood in for — the same ceiling the phone's crown uses (D-110). */
const PIP_CEILING = 10;

export default function WeekPanel({
  door,
  renderTask,
}: {
  door?: WeekDoor;
  renderTask: RenderCrownTask;
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
  // The week's slate, read once and shared with the phone's crown — the
  // priorities ARE the projects On Deck committed to this week, derived, so this
  // rail can never drift from the board (or from Set-the-week). The stored rock,
  // when one exists, carries only the verdict.
  const crown = useWeekCrown();
  if (!data || !crown) return null;

  const { rows, landed, looseCount } = crown;
  // The label follows the sprint the way it always has: no sprint row, no span.
  const weekLabel = data.sprint?.week_start ? crown.weekLabel : "";

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
  // The verb the door is offering, right-aligned: identity left, action right.
  // One door shape, one position, three verbs — the state changes the word,
  // never the weight.
  const action = mode === "review" ? "Review" : mode === "plan" ? "Plan the week" : "The plan ▸";

  // Ticking a priority SHIPS its project — one completion act, not two. The
  // circle opens the same assessment every other ship path uses: you see what's
  // still open before anything is written. (A legacy landed-but-not-shipped
  // verdict can still be tapped to reopen; shipped rows are inert.)
  const onTick = (row: WeekCrownRow) => {
    if (row.state === "shipped") return;
    if (row.rock.done_at) return togglePushLanded(row.projectId);
    setShipId(row.projectId);
  };

  // The scoreboard, kept as WORDS for anyone who can't read the pips — the
  // drawing is for the eye, this is for the screen reader and the tooltip.
  const slateSentence =
    rows.length === 0
      ? "No projects on this week yet"
      : `${landed} of ${rows.length} landed` +
        (looseCount > 0 ? ` · ${looseCount} piece${looseCount === 1 ? "" : "s"} with no time` : "");

  return (
    <div className="shrink-0 border-b border-line-strong">
      {/* The crown — identity + the week DRAWN, not written. The old header
          spent six text objects on this (span, "0 of 4 landed", a meter, a door)
          above a stack that is itself dense; the pips carry count, progress and
          which domains are carrying the week in one line and no sentence. The
          sentence survives in `aria-label` and `title`. */}
      <button
        onClick={openWeekPlan}
        title={door?.title ?? `The week's plan — ${slateSentence}`}
        aria-label={`The week's plan. ${slateSentence}.`}
        className="fast tap group flex w-full items-center gap-2 px-3 pb-2.5 pt-3.5 text-left"
      >
        <span className="section-label !px-0 !pb-0 shrink-0" style={{ color: "var(--accent)" }}>
          This week{weekLabel ? ` · ${weekLabel}` : ""}
        </span>
        {rows.length > 0 && (
          <span className="flex min-w-0 items-center gap-2" aria-hidden>
            <SlatePips rows={rows} />
            {looseCount > 0 && <AmberMark count={looseCount} />}
          </span>
        )}
        <span className="flex-1" />
        <span
          className="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-medium"
          style={
            mode === "review"
              ? { color: "var(--signal)", background: "color-mix(in srgb, var(--signal) 12%, transparent)" }
              : { color: "var(--accent)", background: "var(--accent-soft)" }
          }
        >
          {door?.glow && <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--signal)" }} aria-hidden />}
          {action}
        </span>
      </button>

      {rows.length > 0 ? (
        <div className="border-t border-line" data-tauri-drag-region="false">
          {rows.map((row) => (
            <ProjectStackRow
              key={row.rock.id}
              row={row}
              renderTask={renderTask}
              onToggle={() => onTick(row)}
              // Open a priority where its work lives: its Record.
              onOpen={() => openRecord("project", row.projectId)}
              canPlace={canPlaceProjects}
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
      ) : (
        <button
          onClick={() => openFlow("sunday")}
          className="fast tap flex w-full items-center gap-1.5 px-3 pb-3 text-label text-muted hover:text-accent"
        >
          ＋ Name this week's priorities
        </button>
      )}

      {shipId && <ProjectShipAssess id={shipId} onClose={() => setShipId(null)} />}
    </div>
  );
}

// ── the marks ────────────────────────────────────────────────────────────────

/** The week itself: one pip per project in its domain's hue, filled when it
 *  landed. Count, progress and which domains are carrying the week, in one line
 *  and no words — the phone's crown language (D-110), brought to the desk. */
function SlatePips({ rows }: { rows: WeekCrownRow[] }) {
  if (rows.length > PIP_CEILING) {
    const pct = Math.round((rows.filter((r) => r.state === "landed" || r.state === "shipped").length / rows.length) * 100);
    return (
      <span className="block h-1 w-16 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: "var(--accent)" }} />
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1">
      {rows.map((r) => {
        const on = r.state === "landed" || r.state === "shipped";
        return (
          <span
            key={r.rock.id}
            className="block h-[7px] w-[7px] shrink-0 rounded-full"
            style={{
              background: on ? r.color : "transparent",
              boxShadow: on ? undefined : `inset 0 0 0 1.5px color-mix(in srgb, ${r.color} 55%, transparent)`,
            }}
          />
        );
      })}
    </span>
  );
}

/** One pip per piece of a project's work, filled when it's done. Past the
 *  ceiling it becomes the meter it stood in for. */
function WorkPips({ done, total, color }: { done: number; total: number; color: string }) {
  if (total === 0) return null;
  if (total > PIP_CEILING) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="block h-1 w-12 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
          <span className="block h-full rounded-full" style={{ width: `${(done / total) * 100}%`, background: color }} />
        </span>
        <span className="mono text-micro text-muted">{done}/{total}</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-[3px]">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className="block h-[5px] w-[5px] shrink-0 rounded-full"
          style={{
            background: i < done ? color : "transparent",
            boxShadow: i < done ? undefined : `inset 0 0 0 1.25px color-mix(in srgb, ${color} 50%, transparent)`,
          }}
        />
      ))}
    </span>
  );
}

/** The one thing that must never be missable: work with no time. Amber only
 *  when something is actually homeless — a fully-placed project is not a
 *  warning (P9), it is silence.
 *
 *  Two sizes of the same mark: a counted one on a project's marks line, and the
 *  bare dot a single homeless row wears (the row IS the one, so a "1" beside it
 *  is a number counting to itself). `count = 0` means the dot alone — it must
 *  never render as the digit 0. */
function AmberMark({ count, words }: { count: number; words?: boolean }) {
  return (
    <span className="mono flex shrink-0 items-center gap-1 text-micro font-medium" style={{ color: "var(--signal)" }}>
      <span className="block h-[5px] w-[5px] rounded-full" style={{ background: "var(--signal)" }} />
      {count > 0 ? `${count}${words ? " with no time" : ""}` : ""}
    </span>
  );
}

/** The project's mark: an ARC, never a checkbox (law 3). Fills with the work
 *  that's done; goes solid with a ✓ only when the row is finished or earned. */
function ProgressRing({ pct, color, filled }: { pct: number; color: string; filled: boolean }) {
  const C = 2 * Math.PI * 8;
  if (filled) {
    return (
      <span
        className="flex h-[17px] w-[17px] items-center justify-center rounded-full text-micro"
        style={{ background: color, color: "#fff" }}
      >
        <span style={{ lineHeight: 1 }}>✓</span>
      </span>
    );
  }
  return (
    <svg width="17" height="17" viewBox="0 0 20 20" aria-hidden className="shrink-0">
      <circle cx="10" cy="10" r="8" fill="none" stroke={color} strokeOpacity={0.22} strokeWidth="3" />
      {pct > 0 && (
        <circle
          cx="10"
          cy="10"
          r="8"
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * C} ${C}`}
          transform="rotate(-90 10 10)"
        />
      )}
    </svg>
  );
}

// ── one project on the week — the deck card's anatomy at rail density ────────
// identity (spine) · NAME (hero) · one marks line · its work, on request.
//
// The name opens the project's Record. The ring opens the ship assessment. The
// chevron opens its work — and its work is `TaskRow`, the same row the day list
// below is built from, so "why can't I tick this one" has no way back in.
function ProjectStackRow({
  row,
  renderTask,
  onToggle,
  onOpen,
  canPlace,
  expanded,
  onExpand,
}: {
  /** the week's read model — this row computes nothing (see useWeekCrown) */
  row: WeekCrownRow;
  renderTask: RenderCrownTask;
  onToggle: () => void;
  onOpen: () => void;
  /** the Schedule is showing a time grid, so a sitting has somewhere to land */
  canPlace: boolean;
  expanded: boolean;
  onExpand: () => void;
}) {
  const { rock, work, color, placed, loose, open, pct, rolls, continues, canExpand, weightMins, placedLabel } = row;
  const shipped = row.state === "shipped";
  const done = shipped || row.state === "landed";
  const looksDone = row.state === "ready-to-ship";
  const weight = done ? null : deckWeight(weightMins);

  // ── the project itself is draggable ──────────────────────────────────────
  // The crown offers a project's *pieces* one at a time; the whole point of the
  // row is that they're one push, so the row places as one too. The payload is
  // DOM-only on purpose: `CalendarPane` mounts a single FullCalendar `Draggable`
  // over the rail and reads what it needs off the element, so this needs no new
  // drag machinery and no second drop path. `data-project-placed` is what makes
  // the drop honest — the sitting takes the loose work, and what already has a
  // time is *offered*, never moved silently.
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
    <div className="relative border-b border-line last:border-b-0">
      {/* The altitude tell, and the group's thread: a 3px rounded domain spine,
          inset from the row's ends — DeckCard's `marked` variant, the bar this
          project occupies on the grid. It runs the whole group when open, so a
          project's work reads as hanging off it. Never a border, never a tinted
          card: scope reads as mass (D-049). */}
      <span
        className="pointer-events-none absolute"
        style={{ top: 12, bottom: 12, left: 7, width: 3, background: color, borderRadius: 999 }}
        aria-hidden
      />

      <div
        {...dragProps}
        title={
          canDrag
            ? loose.length > 0
              ? `Drag onto the calendar to sit ${row.title} — ${loose.length} piece${loose.length === 1 ? "" : "s"} with no time yet`
              : `Drag onto the calendar to give ${row.title} a sitting`
            : undefined
        }
        className={`group/row py-2 pl-[22px] pr-2.5 ${canDrag ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        {/* the hero — full width, nothing to its left (DeckCard's rule 1) */}
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={onOpen}
            title={`${row.title} — open`}
            className="tap-desk-h fast min-w-0 flex-1 truncate text-left"
          >
            <span
              className={`text-head font-semibold leading-snug ${done ? "text-muted line-through" : "text-ink"}`}
            >
              {rock.title}
            </span>
          </button>

          {/* Carrying isn't *now* — the number tells it, a border would shout it. */}
          {!done && rolls > 0 && (
            <span className="mono shrink-0 text-micro text-muted" title={carryMark(rolls).title}>
              {carryMark(rolls).text}
            </span>
          )}

          <button
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
            className="tap-desk-bloom fast shrink-0"
          >
            <ProgressRing pct={pct} color={color} filled={done} />
          </button>

          {canExpand ? (
            // The chevron is the surface's primary new affordance — the door to
            // a project's work — so it is a real 14px glyph, not a `text-micro`
            // triangle. The first draft was 9.5px muted text and read as a
            // speck of dust beside the ring; an affordance you can't see is the
            // same defect as one that can't land (D-084).
            <button
              onClick={onExpand}
              title={expanded ? "Hide this project's work" : `Open this project's work — ${marksLabel}`}
              aria-expanded={expanded}
              aria-label={expanded ? `Hide ${row.title}'s work` : `Show ${row.title}'s work`}
              className="tap-desk-h fast flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-ink"
            >
              <Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} />
            </button>
          ) : (
            <span className="w-5 shrink-0" aria-hidden />
          )}
        </div>

        {/* ONE marks line — pips · weight · what's wrong. Every number here is a
            picture unless the picture can't say it (P9, D-110). */}
        <div className="mt-1.5 flex min-w-0 items-center gap-2.5 pr-4" aria-label={marksLabel}>
          <WorkPips done={work.done} total={work.total} color={color} />
          {weight && <span className="mono shrink-0 text-micro text-muted">{weight} left</span>}
          {!done && loose.length > 0 && <AmberMark count={loose.length} words />}

          {shipped ? (
            // The week's win, crowned in the domain's own hue — never a vanished row.
            <span
              className="mono shrink-0 rounded-full px-1.5 py-0.5 text-micro font-medium"
              style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
            >
              shipped
            </span>
          ) : done ? (
            // "landed" itself is gone: the filled ring and the struck name say it.
            // `continues` survives — it's the part the drawing can't say.
            continues && <span className="mono shrink-0 text-micro text-muted">continues</span>
          ) : looksDone ? (
            <button
              onClick={onToggle}
              title="Every task is done — ship it"
              className="fast mono shrink-0 rounded-full border border-accent/50 px-2 py-0.5 text-micro font-medium text-accent hover:bg-accent-soft"
            >
              ship ✓
            </button>
          ) : null}

          {work.total === 0 && (
            // The stranger's account, and every honest new project: nothing to
            // draw yet, so say the fact rather than render an empty line (P7).
            <span className="text-micro text-muted">nothing shaped yet</span>
          )}
        </div>
      </div>

      {/* Its work — ONE grammar. These are `TaskRow`s: the same component, the
          same checkbox, the same context menu, the same drag as the day list
          below. Placed pieces come first (the clock orders them), then what has
          no time. No "has a time" / "loose" headers: each row says which it is,
          and a label above an unlabelled sibling list over-claims. */}
      {expanded && canExpand && (
        <div className="pb-1 pl-[22px]">
          {placed.map((p) => (
            <div key={p.task.id}>
              {renderTask(p.task, {
                draggable: false,
                whenShown: true,
                action: <TimeChip startISO={p.startISO} slotTitle={p.slotTitle} color={color} />,
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
                    className="shrink-0"
                    title="No time this week yet — drag it onto the calendar"
                    aria-label="No time this week yet"
                  >
                    <AmberMark count={0} />
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
function TimeChip({
  startISO,
  slotTitle,
  color,
}: {
  startISO: string;
  slotTitle: string | null;
  color: string;
}) {
  const label = fmtDayTime(startISO);
  return (
    <button
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
      className="mono fast tap-desk-h flex shrink-0 items-center gap-0.5 text-micro"
      style={{ color }}
    >
      {label}
      <span className="opacity-55" aria-hidden>↗</span>
    </button>
  );
}
