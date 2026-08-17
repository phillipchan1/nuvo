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
//   · It collapses, and shut it is ONE line: "This week · 2 of 6 landed", the
//     amber loose count if anything is homeless, a chevron. Nothing else. The
//     month grid is the screen's subject and the crown is its header; a header
//     carrying six marks over a dense grid is a surface arguing with itself.
//     The choice is remembered. Shut hides depth, never the fact — which is why
//     the loose count is the one detail that survives.
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
import { carryMark } from "../../lib/priorities";
import { useWeekCrown, type WeekCrownRow } from "../../hooks/useWeekCrown";
import { WeekPlanSheet } from "./WeekPlanCard";

const OPEN_KEY = "nuvo-mobile-weekcrown-open";

function readOpen(): boolean {
  try {
    // Default SHUT. It shipped open, because a closed crown that said nothing
    // would have been the same silence with an extra tap in front of it — but
    // the shut line isn't silent any more: "This week · 2 of 6 landed · 3
    // loose" is the glance, and the rows are the detail you ask for. Opening
    // six projects over a month grid by default is the surface arguing with
    // itself, which is exactly how it read on a real phone.
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
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

  // ── shut: a picture, not a sentence ──────────────────────────────────────
  // "2 of 6 landed · 3 loose" is still six words to read, at the top of a page
  // already saying a great deal. So the slate is DRAWN: one pip per project in
  // its domain's hue, filled when it landed, hollow while it's open — the count
  // and the progress in one glance, no counting words. The amber light on the
  // right is the only other mark, and it means what it has always meant: some
  // work has no time yet. Two words of text remain ("This week"), because an
  // unlabelled row of dots is a puzzle to a stranger (P16). Everything the
  // words used to say is one tap below, and the screen reader still gets the
  // full sentence through `aria-label`.
  if (!open) {
    const openIt = () => (total === 0 ? openDoor() : setOpen(true));
    return (
      <section className="border-b border-line">
        <button
          onClick={openIt}
          aria-expanded={false}
          aria-label={
            total === 0
              ? "This week — nothing on it yet. Plan the week"
              : `This week — ${landed} of ${total} landed${
                  looseCount > 0 ? `, ${looseCount} piece${looseCount === 1 ? "" : "s"} with no time yet` : ""
                }. Show this week's projects`
          }
          className="tap-h fast flex w-full items-center gap-2.5 px-4 py-2 text-left active:bg-surface-2"
        >
          <span className="section-label !p-0 shrink-0">This week</span>
          {total === 0 ? (
            <span className="truncate text-body text-muted">nothing on it yet</span>
          ) : (
            <SlatePips rows={rows} landed={landed} />
          )}
          <span className="flex-1" />
          {/* The one light on the strip. Not a count — a state: something in
              this week has nowhere to happen. The number is one tap away. */}
          {looseCount > 0 && (
            <span
              className="h-[7px] w-[7px] shrink-0 rounded-full"
              style={{ background: "var(--signal)" }}
              aria-hidden
            />
          )}
          {/* Pointing right: the one gesture this row offers is "open me" —
              into the rows, or into the ritual when the week is empty. */}
          <Icon name="chevron-down" size={13} className="-rotate-90 shrink-0 text-muted" />
        </button>
      </section>
    );
  }

  return (
    <section className="border-b border-line px-4 pb-2 pt-3">
      <div className="flex items-start gap-2">
        {/* Open: the span it covers, and the door. No scoreboard sentence — the
            rows ARE the scoreboard once you can see them, and a header that
            restates them in words is the page talking over itself. */}
        <button
          onClick={() => setOpen(false)}
          aria-expanded
          aria-label={`This week, ${landed} of ${total} landed. Hide this week's projects`}
          className="tap-h fast -ml-1 flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1 py-1 text-left active:bg-surface-2"
        >
          <span className="section-label !p-0 truncate" style={{ color: "var(--accent)" }}>
            This week · {weekLabel}
          </span>
          <Icon name="chevron-down" size={14} className="fast shrink-0 text-muted" />
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

// ── the slate, drawn ─────────────────────────────────────────────────────────
// One pip per project, in its domain's own hue: filled = it landed (or shipped),
// hollow = still open. Reading it costs no words — how many, how far, and which
// domains are carrying the week, in about 60px.
//
// Past ten it stops being countable at a glance, so it becomes the meter the
// pips were standing in for. Neither form is ever a number: the count belongs to
// the rows, which are one tap below.
const PIP_LIMIT = 10;

function SlatePips({ rows, landed }: { rows: WeekCrownRow[]; landed: number }) {
  if (rows.length > PIP_LIMIT) {
    return (
      <span className="h-1 w-16 shrink-0 overflow-hidden rounded-full" style={{ background: "var(--line)" }} aria-hidden>
        <span
          className="block h-full rounded-full"
          style={{ width: `${(landed / rows.length) * 100}%`, background: "var(--accent)" }}
        />
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1" aria-hidden>
      {rows.map((r) => {
        const done = r.state === "landed" || r.state === "shipped";
        return (
          <span
            key={r.rock.id}
            className="h-[7px] w-[7px] rounded-full"
            style={
              done
                ? { background: r.color }
                : // A ring, drawn with inset shadow so a hollow pip and a filled
                  // one occupy exactly the same 7px — a border would nudge the row.
                  { boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${r.color} 60%, transparent)` }
            }
          />
        );
      })}
    </span>
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
            // "landed" is already drawn — filled pip, struck title. The only
            // thing the drawing can't say is that the PROJECT rolls on past the
            // week's verdict, so that is the only word left.
            continues ? <span className="mono shrink-0 text-micro text-muted">continues</span> : null
          ) : row.state === "ready-to-ship" ? (
            // A statement, not a button: shipping is the record sheet's act, and
            // a second ship path is how the two shells drift.
            <span className="mono shrink-0 text-micro font-medium text-accent">ready to ship</span>
          ) : (
            <span className="flex shrink-0 items-center gap-1.5">
              {/* Carried — the same words the rail crown uses (D-108), because
                  the phone inherited the carry the moment the slate became a
                  read model. */}
              {rolls > 0 && (
                <span className="mono text-micro text-muted" aria-label={carryMark(rolls).title}>
                  {carryMark(rolls).text}
                </span>
              )}
              {/* The bar and "1/4" were one fact told twice. The bar is the
                  faster read on a phone, so the numbers go; they are on the
                  record, one tap away, and in this row's aria-label. */}
              {work.total > 0 && (
                <span
                  className="block h-1 w-10 overflow-hidden rounded-full bg-line"
                  aria-label={`${work.done} of ${work.total} done`}
                >
                  <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                </span>
              )}
            </span>
          )}
        </button>

        {canExpand && (
          <button
            onClick={onExpand}
            aria-expanded={expanded}
            aria-label={`${row.title} — ${placedLabel}`}
            title={placedLabel}
            // The TARGET is 44px and transparent; the MARK is the small tinted
            // pill inside it. Putting `tap-h` on the tinted element itself
            // inflated a two-character pill into an amber blob — the loudest
            // thing on the surface, for the quietest fact. And a `tap-bloom`
            // pseudo-element isn't enough here: it overlaps the row's own
            // button, which wins the tap, so the hit area has to be real.
            className="tap-h fast flex shrink-0 items-center px-1"
          >
            {/* "2 of 3 placed" → "2/3". Both numbers survive, because stating
                only the loose half is the read that let work go missing (D-060);
                it is the WORD that goes. The full phrase is the aria-label and
                the title. */}
            <span
              className="mono flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-micro"
              style={
                // Amber only when something is genuinely homeless (P9) — a
                // fully-placed project is a fact, not a warning.
                loose.length === 0
                  ? { color: "var(--muted)", background: "var(--surface-2)" }
                  : { color: "var(--signal)", background: "color-mix(in srgb, var(--signal) 12%, transparent)" }
              }
            >
              {loose.length === 0 ? "all" : `${placed.length}/${row.open}`} {expanded ? "▾" : "▸"}
            </span>
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
