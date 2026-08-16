// The week's crown, on the phone — the Schedule rail's crown, reflowed.
//
// The desktop Schedule has never *not* shown this: the rail's top third is the
// week's projects, what each is tracking, and how much of each still has no
// time. The phone's Calendar showed the month and nothing about the week's
// slate, so "what am I carrying this week" was a question you could only ask at
// a desk (P13) — and W2 ("if I only get three real hours, where do they go?")
// was answered on one shell out of two.
//
// It computes NOTHING. `useWeekCrown` is the read model both shells wear, so a
// project's progress, its verdict and its placed/loose split cannot say one
// thing here and another on the rail.
//
// Three deliberate differences from the desktop crown, all because this is a
// phone:
//   · The rows collapse. The month grid is the screen's subject; the crown is
//     its header, and a five-project slate would push the grid off-screen. The
//     choice is remembered, and the header keeps the *whole* honest summary
//     (landed + loose) while shut, so collapsing hides depth, never the fact.
//   · No ship circle. Shipping lives in one vocabulary (`recordActions`) reached
//     from the record sheet's ⋯ — a tick here would be a second ship path, which
//     is exactly how Delete ended up desktop-only. A finished-looking row says
//     "ready to ship" and the row opens the record.
//   · Loose work TAPS instead of dragging. The desktop's answer to a homeless
//     piece is to drag it onto the grid; there is no drag on a phone, so the
//     piece opens its sheet, where the date and time already live. Same act, the
//     phone's gesture (never a hover-only affordance).

import { useState } from "react";
import { Icon } from "../Icon";
import { fmtDayTime } from "../../lib/dates";
import { useWeekCrown, type WeekCrownRow } from "../../hooks/useWeekCrown";
import { WeekPlanSheet } from "./WeekPlanCard";

const OPEN_KEY = "nuvo-mobile-weekcrown-open";

function readOpen(): boolean {
  try {
    // Default OPEN: the whole point of this surface is that the week's projects
    // are *visible* from the Calendar. A closed default would ship the same
    // silence with an extra tap in front of it.
    return localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

export default function MobileWeekCrown({
  now,
  onOpenProject,
  onOpenTask,
  onOpenDay,
  onPlanWeek,
}: {
  now: Date;
  /** the row's work lives in its record — the phone's project detail sheet */
  onOpenProject: (id: string) => void;
  /** a loose piece opens its own sheet, where it can be given a time */
  onOpenTask: (id: string) => void;
  /** a placed piece takes you to the day it actually happens */
  onOpenDay: (d: Date) => void;
  /** the ritual — Plan the week */
  onPlanWeek: () => void;
}) {
  const crown = useWeekCrown();
  const [open, setOpenState] = useState(readOpen);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [planOpen, setPlanOpen] = useState(false);

  if (!crown) return null;
  const { rows, landed, total, looseCount, composed, weekLabel, weekISO } = crown;

  const setOpen = (v: boolean) => {
    setOpenState(v);
    try {
      localStorage.setItem(OPEN_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  // One door, two verbs — the same lifecycle the rail's crown wears: not
  // composed → the ritual; composed → the week's plan.
  const planned = composed || total > 0;
  const action = planned ? "The plan ›" : "Plan the week";
  const openDoor = () => (planned ? setPlanOpen(true) : onPlanWeek());

  return (
    <section className="border-b border-line px-4 pb-2 pt-3">
      <div className="flex items-start gap-2">
        {/* Identity + scoreboard, and the disclosure. Tapping the summary opens
            the depth; it never navigates, so the one place that *leaves* this
            screen is the door on the right. */}
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={open ? "Hide this week's projects" : "Show this week's projects"}
          className="tap-h fast -ml-1 flex min-w-0 flex-1 items-start gap-1.5 rounded-lg px-1 py-1 text-left active:bg-surface-2"
        >
          <div className="min-w-0 flex-1">
            <div className="section-label !p-0" style={{ color: "var(--accent)" }}>
              This week · {weekLabel}
            </div>
            {total === 0 ? (
              <div className="mt-1 text-body text-muted">No projects on this week yet</div>
            ) : (
              <>
                <div className="mt-1.5 flex items-center gap-2.5">
                  <span className="shrink-0 text-body">
                    <span className="mono font-medium text-ink">{landed}</span>
                    <span className="text-muted"> of </span>
                    <span className="mono font-medium text-ink">{total}</span>
                    <span className="text-muted"> landed</span>
                  </span>
                  <span className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${(landed / total) * 100}%`, background: "var(--accent)" }}
                    />
                  </span>
                </div>
                {/* The fact that has to survive a collapsed crown: what has no
                    time yet. Amber only when something is genuinely homeless
                    (P9) — a fully-placed week says nothing at all. */}
                {looseCount > 0 && (
                  <div className="mono mt-1 text-micro" style={{ color: "var(--signal)" }}>
                    {looseCount} piece{looseCount === 1 ? "" : "s"} with no time yet
                  </div>
                )}
              </>
            )}
          </div>
          <Icon
            name="chevron-down"
            size={14}
            className={`fast mt-1 shrink-0 text-muted ${open ? "" : "-rotate-90"}`}
          />
        </button>

        <button
          onClick={openDoor}
          className="tap-h fast mt-0.5 flex shrink-0 items-center rounded-full px-3 py-1.5 text-caption font-medium"
          style={{ color: "var(--accent)", background: "var(--accent-soft)" }}
        >
          {action}
        </button>
      </div>

      {open && total > 0 && (
        <ul className="mt-1.5 flex flex-col">
          {rows.map((row) => (
            <CrownRow
              key={row.rock.id}
              row={row}
              expanded={openIds.has(row.rock.id)}
              onExpand={() =>
                setOpenIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(row.rock.id)) next.delete(row.rock.id);
                  else next.add(row.rock.id);
                  return next;
                })
              }
              onOpen={() => onOpenProject(row.projectId)}
              onOpenTask={onOpenTask}
              onOpenDay={onOpenDay}
            />
          ))}
        </ul>
      )}

      {planOpen && (
        <WeekPlanSheet currentWeekISO={weekISO} now={now} onClose={() => setPlanOpen(false)} storyFirst={false} />
      )}
    </section>
  );
}

// ── one project on the week ──────────────────────────────────────────────────
// Row = the glance (name · state · progress). Pill = the depth (which pieces
// have a time, and which don't). Two tap targets, never one that does both.
function CrownRow({
  row,
  expanded,
  onExpand,
  onOpen,
  onOpenTask,
  onOpenDay,
}: {
  row: WeekCrownRow;
  expanded: boolean;
  onExpand: () => void;
  onOpen: () => void;
  onOpenTask: (id: string) => void;
  onOpenDay: (d: Date) => void;
}) {
  const { color, work, placed, loose, pct, rolls, continues, canExpand, placedLabel } = row;
  const shipped = row.state === "shipped";
  const done = shipped || row.state === "landed";

  return (
    <li className="border-t border-line first:border-t-0">
      <div className="flex items-center gap-1">
        <button
          onClick={onOpen}
          className="tap-h fast flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left active:opacity-60"
        >
          {/* The domain's hue — identity, filled once the week has a verdict. */}
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full border"
            style={{ borderColor: color, background: done ? color : "transparent" }}
            aria-hidden
          />
          <span className={`min-w-0 flex-1 truncate text-body ${done ? "text-muted line-through" : "text-ink"}`}>
            {row.title}
          </span>

          {shipped ? (
            <span
              className="mono shrink-0 rounded-full px-1.5 py-0.5 text-micro font-medium"
              style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
            >
              shipped
            </span>
          ) : done ? (
            <span className="mono shrink-0 text-micro text-muted">{continues ? "landed · continues" : "landed"}</span>
          ) : row.state === "ready-to-ship" ? (
            // A statement, not a button: shipping is the record sheet's act, and
            // a second ship path is how the two shells drift.
            <span className="mono shrink-0 text-micro font-medium text-accent">ready to ship</span>
          ) : (
            <span className="flex shrink-0 items-center gap-1.5">
              {rolls > 0 && (
                <span className="mono text-micro text-muted" aria-label={`Carried into week ${rolls + 1}`}>
                  wk {rolls + 1}
                </span>
              )}
              {work.total > 0 && (
                <>
                  <span className="block h-1 w-8 overflow-hidden rounded-full bg-line">
                    <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                  </span>
                  <span className="mono text-micro text-muted">
                    {work.done}/{work.total}
                  </span>
                </>
              )}
            </span>
          )}
        </button>

        {canExpand && (
          <button
            onClick={onExpand}
            aria-expanded={expanded}
            aria-label={`${row.title} — ${placedLabel}`}
            className="tap-h tap-bloom fast mono flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-micro"
            style={
              loose.length === 0
                ? { color: "var(--muted)", background: "var(--surface-2)" }
                : { color: "var(--signal)", background: "color-mix(in srgb, var(--signal) 12%, transparent)" }
            }
          >
            {placedLabel} {expanded ? "▾" : "▸"}
          </button>
        )}
      </div>

      {expanded && canExpand && (
        <div className="mb-1.5 ml-4 border-l border-line pl-3">
          {/* What HAS a time, and when — tap to land on that day. */}
          {placed.length > 0 && (
            <>
              <div className="section-label !p-0 !pt-1">has a time</div>
              <ul className="flex flex-col">
                {placed.map((p) => (
                  <li key={p.task.id}>
                    <button
                      onClick={() => onOpenDay(new Date(p.startISO))}
                      className="tap-h fast flex w-full items-baseline gap-2 py-1 pr-1 text-left active:opacity-60"
                    >
                      <span className="mono shrink-0 text-micro" style={{ color }}>
                        {fmtDayTime(p.startISO)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-label text-muted">{p.task.title}</span>
                      {/* A slot child has no block of its own — name what holds
                          it, so "why has this one no time" has an answer here
                          instead of looking like a bug. */}
                      {p.slotTitle && (
                        <span className="shrink-0 truncate text-micro text-muted">in {p.slotTitle}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {loose.length > 0 && (
            <>
              <div className="section-label !p-0 !pt-1.5">loose</div>
              <div className="pb-0.5 text-micro text-muted">Tap one to give it a time.</div>
              <ul className="flex flex-col">
                {loose.map((t) => (
                  <li key={t.id}>
                    <button
                      onClick={() => onOpenTask(t.id)}
                      className="tap-h fast flex w-full items-center gap-2 py-1 pr-1 text-left active:opacity-60"
                    >
                      <span className="min-w-0 flex-1 truncate text-label text-muted">{t.title}</span>
                      {t.duration_minutes ? (
                        <span className="mono shrink-0 text-micro text-muted">{t.duration_minutes}m</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </li>
  );
}
