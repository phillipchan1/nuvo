// The week's slate as ONE read model — the projects committed to this week, each
// with its verdict, its progress, and where its remaining pieces sit in time.
//
// The Schedule's rail crown (desktop, `WeekPanel`) and the Calendar's week crown
// (phone, `MobileWeekCrown`) are two layouts over this. Neither re-derives it:
// the read lived only inside `WeekPanel` for a while, which is exactly why the
// phone couldn't answer "what am I carrying this week, and does it have a time"
// at all — the answer wasn't a model, it was a component.
//
// Row ORDER is the kernel's too (`slateOrder`, via `weekPushes`): what you chose
// for this week first, then what carried into it, longest-carrying first — so a
// surface can render the list as it comes and still be right.
//
// Nothing here is new logic. `weekPushes` derives membership from the spans,
// `priorityWork` says what a push owns, `useLooseWork.splitFor` cuts the open
// work by whether it has a time this week, `pushState` names the row's state.
// This is the shape those four make together, computed once.

import { useMemo } from "react";
import { useVertical } from "./useVertical";
import { useLooseWork, type PlacedPiece } from "./useFindTime";
import {
  priorityWork,
  pushAsRock,
  pushState,
  rockDomainColor,
  weekPushes,
  type PushState,
  type RockWork,
} from "../lib/priorities";
import { projectPace } from "../lib/pace";
import { planningWeekStartISO, weekRangeLabel } from "../lib/dates";
import type { ReactNode } from "react";
import type { BigRock, Task } from "../lib/types";

/** How a crown renders one piece of a project's work.
 *
 *  It lives beside the read model because BOTH crowns take it, and neither owns
 *  it: the surface that mounts the crown (the rail on the desktop, `MobileShell`
 *  on the phone) already owns selection, opening a record and complete/undo, so
 *  the crown borrows that wiring rather than growing a second copy. That copy is
 *  exactly what a project's work used to be — a bare `<li>` you could neither
 *  tick nor touch, on both shells (D-111).
 *
 *  The crown says *which* task, what rides on its right, and — desktop only —
 *  whether it may be dragged. */
export type RenderCrownTask = (
  task: Task,
  opts: {
    /** the row's trailing mark — its time, or its "no time yet" */
    action: ReactNode;
    /** loose work drags onto the grid; placed work does not (D-084). The phone
     *  passes neither: there is no drag on a phone, a loose piece taps to its
     *  sheet (D-110), so the row is never draggable there. */
    draggable?: boolean;
    /** the crown's mark already carries this row's when — don't restate it */
    whenShown?: boolean;
    /** stamped on the row ROOT — the drop reads it off the dragged element */
    dragData?: Record<string, string>;
  },
) => ReactNode;

export interface WeekCrownRow {
  /** the stored verdict record, or a stand-in built from the live project */
  rock: BigRock;
  /** every row on the week IS a project — the slate is derived from spans */
  projectId: string;
  title: string;
  /** the domain's own hue, or `--accent` when there's nothing to inherit */
  color: string;
  /** the domain it belongs to — the rail's drag payload hands this to the
   *  sitting it creates, so the block is attributed the moment it lands */
  domainId: string | null;
  state: PushState;
  work: RockWork;
  /** 0–100, derived from the project's own tasks */
  pct: number;
  /** Remaining effort in minutes — the project's WEIGHT, the currency the pinch
   *  math runs on. Taken from `projectPace` rather than re-summed here, so the
   *  rail row and the On Deck card can never quote different hours for the same
   *  project. Format it with `deckWeight` (0 → null → say nothing). */
  weightMins: number;
  /** weeks it has been carrying past the week it was committed to — 0 when this
   *  is the week you actually chose it for. Derived (D-108), not stored; render
   *  it through `carryMark` so both shells say the same thing. */
  rolls: number;
  /** open pieces that HAVE a time this week, earliest first */
  placed: PlacedPiece[];
  /** open pieces with no time this week — including work timed into another
   *  week, which is honest: it is not happening here */
  loose: Task[];
  /** placed + loose */
  open: number;
  /** the split, never the flattering half: "all placed" · "3 of 5 placed" */
  placedLabel: string;
  /** landed as a WEEK verdict while the project itself rolls on */
  continues: boolean;
  /** the row has time to disclose and isn't finished */
  canExpand: boolean;
}

export interface WeekCrown {
  weekISO: string;
  /** "Aug 10 – 16" */
  weekLabel: string;
  rows: WeekCrownRow[];
  /** rows with a verdict (landed or shipped) — the scoreboard's numerator */
  landed: number;
  /** rows.length — the denominator */
  total: number;
  /** pieces with no time, across the whole slate */
  looseCount: number;
  /** the week has been composed (the ritual ran) */
  composed: boolean;
}

/** The week's crown. `null` until the vertical has loaded. */
export function useWeekCrown(): WeekCrown | null {
  const { data } = useVertical();
  const weekISO = data?.sprint?.week_start ?? planningWeekStartISO();
  const { splitFor } = useLooseWork(weekISO);

  return useMemo<WeekCrown | null>(() => {
    if (!data) return null;

    // `projectPace` wants a clock for its trailing-throughput read; the only
    // field this hook takes from it — `remainingMins` — doesn't depend on one.
    const now = new Date();

    const rows = weekPushes(data, weekISO).map<WeekCrownRow>((push) => {
      const rock = pushAsRock(push);
      const work = priorityWork(data, rock);
      const state = pushState({
        shipped: push.shipped,
        doneAt: rock.done_at,
        done: work.done,
        total: work.total,
      });
      const done = state === "shipped" || state === "landed";
      const { placed, loose } = splitFor(push.project.id);
      const open = placed.length + loose.length;
      return {
        rock,
        projectId: push.project.id,
        title: rock.title,
        color: rockDomainColor(data, rock) ?? "var(--accent)",
        domainId: push.project.domainId || null,
        state,
        work,
        pct: work.total > 0 ? Math.round((work.done / work.total) * 100) : 0,
        weightMins: projectPace(data, push.project, now).remainingMins,
        rolls: rock.roll_count ?? 0,
        placed,
        loose,
        open,
        // State the split, not the half that happens to be non-zero. "3 of 5
        // placed" and "2 loose" are the same fact, but the first one can't be
        // read as "and the rest is fine" — the read that let work go missing.
        placedLabel: loose.length === 0 ? "all placed" : `${placed.length} of ${open} placed`,
        // Sealing a push lands the WEEK, not the project. Say so, so "landed"
        // never reads as "closed the project". Shipped is the exception — there
        // the project really did finish.
        continues: done && state !== "shipped" && work.tasks.some((t) => t.status !== "done"),
        canExpand: !done && open > 0,
      };
    });

    return {
      weekISO,
      weekLabel: weekRangeLabel(weekISO),
      rows,
      // `landed` folds in "shipped inside this week" — a shipped project must
      // count on the scoreboard, not vanish from it.
      landed: rows.filter((r) => r.state === "landed" || r.state === "shipped").length,
      total: rows.length,
      looseCount: rows.reduce((n, r) => n + r.loose.length, 0),
      composed: Boolean(data.sprint?.reviewed_at),
    };
  }, [data, weekISO, splitFor]);
}
