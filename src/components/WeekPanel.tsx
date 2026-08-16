// The week's plan — the rail's crown. The week's priorities held in view all
// week (glance, don't re-open the Review), each row tracking its OWN work, so a
// priority reads honest even when you never tap it: progress derives from the
// linked project's tasks, and a fully-worked priority *invites* the seal instead
// of sitting at a silent 0. Replaces the buried WeekReadiness footer — intent
// on top; the crown's "Plan the week" door is the only CTA (no second "loose
// ends" strip that restates the same invite).
//
// The header IS the week door (the toolbar's copy is gone — it sat in the
// calendar's control cluster, which acts on the *canvas*, while the door acts on
// the *plan* that lives right here). It takes the lifecycle from Planner so the
// door on top of the priorities is the same one, not a weaker twin: identity on
// the left, the state's verb on the right. The toolbar keeps a door only in
// focus mode, where this rail is slid shut.

import { useState } from "react";
import { useVertical } from "../hooks/useVertical";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { useWeekCrown, type WeekCrownRow } from "../hooks/useWeekCrown";
import { fmtDayTime } from "../lib/dates";
import { MARQUEE_OPEN_EVENT } from "../lib/marquee";
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

export default function WeekPanel({ door }: { door?: WeekDoor }) {
  const { data, togglePushLanded } = useVertical();
  const { openFlow, openRecord } = useAppNavigation();
  const [shipId, setShipId] = useState<string | null>(null);
  // Which project rows are open to their loose work. Collapsed by default — the
  // crown's job is the glance; the depth is there when the glance isn't enough.
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  // The week's slate, read once and shared with the phone's crown — the
  // priorities ARE the projects On Deck committed to this week, derived, so this
  // rail can never drift from the board (or from Set-the-week). The stored rock,
  // when one exists, carries only the verdict.
  const crown = useWeekCrown();
  if (!data || !crown) return null;

  const { rows, landed, composed } = crown;
  // The label follows the sprint the way it always has: no sprint row, no span.
  const weekLabel = data.sprint?.week_start ? crown.weekLabel : "";

  // The panel is the ambient face of the Week's Plan: composed → open the
  // surface (view), not yet → the compose ritual (plan). Planner owns the real
  // lifecycle (it alone knows the Friday reveal); this stands in when the door
  // isn't wired, so the panel is never a dead end.
  const openWeekPlan =
    door?.onOpen ??
    (() => {
      if (composed) window.dispatchEvent(new CustomEvent(MARQUEE_OPEN_EVENT, { detail: { surface: "week-plan" } }));
      else openFlow("sunday");
    });
  const mode = door?.mode ?? (composed ? "view" : "plan");
  // The verb the door is offering, right-aligned: identity left, action right.
  // "Plan the week" is the product name for the ritual — keep it spelled out so
  // the crown CTA reads as the major act it is, not a quiet chip. And `view` gets
  // the SAME pill: the week's plan is what guides the week, so its door can't be
  // the quietest thing in the rail (it was 9.5px muted "open ▸"). One door shape,
  // one position, three verbs — the state changes the word, never the weight.
  const action = mode === "review" ? "Review" : mode === "plan" ? "Plan the week" : "The plan ▸";

  // Ticking a priority SHIPS its project — one completion act, not two. The
  // circle used to write only the week's verdict (done_at), which read as
  // "complete" and finalized nothing, so a priority could go struck-through
  // while five tasks stayed live underneath. Now it opens the same assessment
  // every other ship path uses: you see what's still open before anything is
  // written. (A legacy landed-but-not-shipped verdict can still be tapped to
  // reopen; shipped rows are inert — reopen from the record.)
  const onTick = (row: WeekCrownRow) => {
    if (row.state === "shipped") return;
    if (row.rock.done_at) return togglePushLanded(row.projectId);
    setShipId(row.projectId);
  };

  return (
    <div className="shrink-0 border-b border-line-strong px-3 pb-3 pt-3.5">
      {/* The crown — the rail's anchor, in an EXECUTION voice, not ceremony: a
          tracked-caps eyebrow (identity) over a functional scoreboard (numbers in
          mono, words quiet) + a thin landed meter — the same meter idiom the spine
          and Standing gauges use. NOT a Fraunces headline: a serif scoreboard read
          like a marketing stat; a floor's NAME earns serif, a count does not. */}
      <button
        onClick={openWeekPlan}
        title={door?.title ?? "The week's plan"}
        className="fast tap group mb-3 flex w-full items-start gap-2 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="section-label !px-0 !pb-0" style={{ color: "var(--accent)" }}>
            This week{weekLabel ? ` · ${weekLabel}` : ""}
          </div>
          {rows.length === 0 ? (
            <div className="mt-1 text-body text-muted">No priorities named yet</div>
          ) : (
            <div className="mt-1.5 flex items-center gap-2.5">
              <span className="shrink-0 text-body">
                <span className="mono font-medium text-ink">{landed}</span>
                <span className="text-muted"> of </span>
                <span className="mono font-medium text-ink">{rows.length}</span>
                <span className="text-muted"> landed</span>
              </span>
              <span className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${(landed / rows.length) * 100}%`, background: "var(--accent)" }}
                />
              </span>
            </div>
          )}
        </div>
        <span
          className="mt-0.5 flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-medium"
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

      {/* priorities — directly under the crown; the crown states the count, so
          there's no repeated "Priorities" label. */}
      {rows.length > 0 ? (
        <div className="flex flex-col gap-0.5">
            {rows.map((row) => (
              <PriorityRow
                key={row.rock.id}
                row={row}
                onToggle={() => onTick(row)}
                // Open a priority where its work lives: its Record, to manage
                // and close its tasks.
                onOpen={() => openRecord("project", row.projectId)}
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
          className="fast tap flex w-full items-center gap-1.5 py-1 text-label text-muted hover:text-accent"
        >
          ＋ Name this week's priorities
        </button>
      )}

      {shipId && <ProjectShipAssess id={shipId} onClose={() => setShipId(null)} />}
    </div>
  );
}

// ── one priority row — derived progress, one completion act ───────────────────
// The leading dot is a domain-colored ring: tap it to SHIP the project this
// priority is. Every priority here IS a project (weekPushes derives the slate
// from the board), so there's one completion act, not two — the circle opens the
// ship assessment, which shows what's still open before anything is written.
// It's quiet (hover-revealed ✓) on partial rows so it doesn't invite a premature
// ship; loud only when earned. The title opens the project's work.
//  shipped  → shipped this week → the crown; the circle is inert (reopen in the record)
//  landed   → a legacy week-verdict (done_at, no ship); struck, tap to reopen
//  ship     → every task done → a loud `ship ✓` invite (the earned path)
//  motion   → mini progress bar + done/total from priorityWork; hover to ship
//  carrying → unfinished + rolled from a prior week → a quiet "wk N" nag
function PriorityRow({
  row,
  onToggle,
  onOpen,
  expanded,
  onExpand,
}: {
  /** the week's read model — this row computes nothing (see useWeekCrown) */
  row: WeekCrownRow;
  onToggle: () => void;
  onOpen: () => void;
  expanded: boolean;
  onExpand: () => void;
}) {
  const { rock, work, color, placed, loose, pct, rolls, continues, canExpand, placedLabel: pill } = row;
  const shipped = row.state === "shipped";
  const done = shipped || row.state === "landed";
  const looksDone = row.state === "ready-to-ship";

  return (
    <>
    <div className="group/row flex items-center gap-2 py-1">
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
        aria-label={shipped ? "Shipped" : done ? "Reopen push" : "Ship project"}
        className="tap-desk-bloom fast flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-micro"
        style={{ borderColor: color, background: done ? color : "transparent", color: done ? "#fff" : color }}
      >
        <span className={done ? "" : "opacity-0 group-hover/row:opacity-100"} style={{ lineHeight: 1 }}>✓</span>
      </button>

      <button
        onClick={onOpen}
        title="Open"
        className="tap-desk-h fast flex min-w-0 flex-1 items-center truncate text-left"
      >
        <span className={`text-body ${done ? "text-muted line-through" : "text-ink"}`}>{rock.title}</span>
      </button>

      {/* The one thing the crown could never say: how much of this project has
          no time yet. Opening it puts that work in the rail, where the calendar's
          drag already reaches — the manual act the weekly plan automated. */}
      {canExpand && (
        <button
          onClick={onExpand}
          title={
            expanded
              ? "Hide this project's work"
              : loose.length === 0
                ? "Every piece has a time this week — open to see when"
                : `${loose.length} piece${loose.length === 1 ? "" : "s"} with no time this week — open to place them`
          }
          aria-expanded={expanded}
          aria-label={pill}
          className="fast mono shrink-0 rounded-full px-1.5 py-0.5 text-micro"
          style={
            // Amber only when something is actually homeless. A fully-placed
            // project is not a warning (P9 — quiet by default).
            loose.length === 0
              ? { color: "var(--muted)", background: "var(--surface-2)" }
              : { color: "var(--signal)", background: "color-mix(in srgb, var(--signal) 12%, transparent)" }
          }
        >
          {pill} {expanded ? "▾" : "▸"}
        </button>
      )}

      {shipped ? (
        // The week's win, crowned in the domain's own hue — never a vanished row.
        <span
          className="mono shrink-0 rounded-full px-1.5 py-0.5 text-micro font-medium"
          style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
        >
          shipped
        </span>
      ) : done ? (
        <span className="mono shrink-0 text-micro text-muted">{continues ? "landed · continues" : "landed"}</span>
      ) : looksDone ? (
        <button
          onClick={onToggle}
          title="Every task is done — ship it"
          className="fast mono shrink-0 rounded-full border border-accent/50 px-2 py-0.5 text-micro font-medium text-accent hover:bg-accent-soft"
        >
          ship ✓
        </button>
      ) : (
        <span className="flex shrink-0 items-center gap-1.5">
          {/* Carrying isn't *now* — the number tells it, the border shouted it. */}
          {rolls > 0 && (
            <span className="mono text-micro text-muted" title={`Carried into week ${rolls + 1}`}>
              wk {rolls + 1}
            </span>
          )}
          {work.total > 0 && (
            <>
              <span className="block h-1 w-10 overflow-hidden rounded-full bg-line">
                <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
              </span>
              <span className="mono text-micro text-muted">{work.done}/{work.total}</span>
            </>
          )}
        </span>
      )}
    </div>

    {/* `data-task-drag` is all this needs: CalendarPane mounts one FullCalendar
        Draggable over the whole rail (railRef), so these rows drop onto the grid
        — or into an existing sitting — through the same handlers the Today and
        Inbox rows already use. Pointer-based, never HTML5 DnD (Tauri swallows it).
        `data-task-week` marks them as week work: the drop commits them to the
        sprint too, so placing one never writes a day without a week (P2). */}
    {expanded && canExpand && (
      <div
        className="mb-1 ml-6 border-l border-line pl-2"
        // The crown sits inside the rail's `data-tauri-drag-region="deep"` zone,
        // so without this opt-out dragging one of these rows drags the macOS
        // WINDOW and the task never moves — the row looks draggable and does
        // nothing. Same guard `TaskRow` and the rail's own task list already
        // carry; the crown never needed it until it started offering rows to drag.
        data-tauri-drag-region="false"
      >
        {/* What HAS a time, and when. Not draggable: these are already on the
            grid, and the calendar is where you move a block — a second place to
            drag the same thing is a second answer to one question (P8). */}
        {placed.length > 0 && (
          <>
            <div className="section-label !px-0 !pb-0 !pt-1">has a time</div>
            <ul className="flex flex-col gap-0.5">
              {placed.map((p) => (
                <li key={p.task.id} className="flex items-baseline gap-2 py-0.5 pr-1">
                  <span className="mono shrink-0 text-micro" style={{ color }}>
                    {fmtDayTime(p.startISO)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-label text-muted">{p.task.title}</span>
                  {/* A slot child has no block of its own — say what holds it,
                      so "why does this one have no time of its own" has an
                      answer on the row instead of looking like a bug. */}
                  {p.slotTitle && (
                    <span className="shrink-0 truncate text-micro text-muted" title={`Inside ${p.slotTitle}`}>
                      in {p.slotTitle}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {loose.length > 0 && (
          <>
            {placed.length > 0 && <div className="section-label !px-0 !pb-0 !pt-1.5">loose</div>}
            <ul className="flex flex-col gap-0.5">
              {loose.map((t) => (
                <li
                  key={t.id}
                  data-task-drag={t.id}
                  data-task-title={t.title}
                  data-task-duration={t.duration_minutes ?? ""}
                  data-task-week="1"
                  title="Drag onto the calendar to give it a time"
                  className="fast flex cursor-grab items-center gap-2 rounded py-0.5 pr-1 hover:bg-surface-2 active:cursor-grabbing"
                >
                  <span className="min-w-0 flex-1 truncate text-label text-muted">{t.title}</span>
                  {t.duration_minutes ? (
                    <span className="mono shrink-0 text-micro text-muted">{t.duration_minutes}m</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    )}
    </>
  );
}
