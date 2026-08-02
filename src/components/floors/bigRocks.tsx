// Priorities — the week's named outcomes (stored internally as `big_rocks`; the
// user-facing name is "Priorities").
//
// A priority IS a project you brought into the week. The project definition is the
// project's — Sunday doesn't re-author it, it just brings it in. So this surface
// asks one question ("what are you moving this week?") and answers it with two
// moves: bring a project in, or drop one. Anything wrong with a project gets fixed
// where the project lives (the record / the Groom deck) — not patched here at
// commit time. That's why there's no inline groomer, no readiness pip, no work
// breakdown, and no free-text box anymore: each was this screen re-implementing a
// funnel surface that now exists on its own.
//
//   BigRocks         — the editor (the Schedule bar + the Sunday ritual)
//   BigRocksRibbon   — the held presence on Today (read + check off)
//   BigRocksBar      — the collapsible plan on the Schedule rung
//   BigRocksReckoning — the look-back in the Gain (Standback)

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { domainById, initiativeById, projectById, type Project, type VerticalData } from "../../lib/vertical";
import { priorityWork, projectsOnDeck, weekPushes } from "../../lib/priorities";
import { lensGaps } from "../../lib/lenses";
import { parseDateISO, planningWeekStartISO } from "../../lib/dates";
import { bringIntoWeekPatch, takeOffWeekPatch } from "../../../supabase/functions/_shared/planningRules.ts";
import type { BigRock } from "../../lib/types";

/** The color a rock inherits from the initiative/project it's anchored to. */
function rockColor(data: VerticalData, rock: BigRock): string | null {
  const init = initiativeById(data, rock.initiative_id);
  if (init) return domainById(data, init.domainId)?.color ?? null;
  const proj = projectById(data, rock.project_id ?? null);
  if (proj) return domainById(data, proj.domainId)?.color ?? null;
  return null;
}

// ("what moves this?" — priorityWork/RockWork now live in src/lib/priorities.ts,
//  shared with the Week's Plan / Review.)

// ── the editor — the week's pushes, read straight off the On Deck board ──────
export function BigRocks({ weekStartISO }: { weekStartISO?: string } = {}) {
  const { data, updateProject } = useVertical();
  const { openRecord } = useAppNavigation();
  const weekISO = weekStartISO ?? planningWeekStartISO();

  // Derived, never stored — this list IS the On Deck column for this week.
  const pushes = useMemo(() => weekPushes(data, weekISO), [data, weekISO]);

  // Bringing a project in IS placing it on this week — the same act as dragging
  // it onto this week's column in On Deck, and the same act as the agent's
  // create_priority. All three apply the kernel's patch, so they cannot diverge.
  const bringIn = (p: Project) => {
    const patch = bringIntoWeekPatch(p, weekISO);
    if (patch) updateProject(p.id, patch);
  };

  // …and taking it off un-commits it back to "needs a week", same as dragging it
  // off the board onto the inbox rail.
  const takeOff = (p: Project) => updateProject(p.id, takeOffWeekPatch());

  return (
    <section>
      <h2 className="text-head masthead mb-1">What are you moving this week?</h2>

      {pushes.length > 0 ? (
        <div className="mt-3 border-t border-line">
          {pushes.map(({ project }) => (
            <PushRow
              key={project.id}
              project={project}
              data={data}
              onOpen={() => openRecord("project", project.id)}
              onRemove={() => takeOff(project)}
            />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-caption text-muted">Nothing on deck for this week — bring a project in below.</p>
      )}

      <OnDeck data={data} weekISO={weekISO} onBringIn={bringIn} />
    </section>
  );
}

// ── a push — the project, its own outcome, and whether it can be slotted ──────
//    Tap it to open the project record; that's where a definition gets fixed.
function PushRow({
  project,
  data,
  onOpen,
  onRemove,
}: {
  project: Project;
  data: VerticalData;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const color = domainById(data, project.domainId)?.color ?? "var(--accent)";
  const gaps = lensGaps(data, "project", project, new Date());
  const ready = gaps.length === 0;
  // the project's definition, verbatim — Sunday shows it, never authors it
  const outcome = project.outcome?.trim() || "";
  const state = ready ? "ready to slot" : gaps.map((g) => g.label).join(" · ");

  return (
    <div className="group flex items-start gap-3 border-b border-line py-3.5">
      <span
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
        style={ready ? { background: color } : { border: "1.5px solid var(--line-strong)" }}
        aria-hidden
      />
      <button onClick={onOpen} className="fast min-w-0 flex-1 text-left" title={`Open ${project.name}`}>
        <div className="truncate text-body">{project.name}</div>
        <div className="truncate text-caption text-muted">{outcome || "no outcome yet"}</div>
      </button>
      <span className="mono mt-0.5 shrink-0 text-meta" style={{ color: ready ? color : "var(--muted)" }}>
        {state}
      </span>
      <button
        onClick={onRemove}
        title="Take it off this week"
        className="fast mt-0.5 shrink-0 text-caption text-muted opacity-0 hover:text-signal group-hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}

// ── on deck — the candidates, one tap to bring in. Recognition, not recall:
//    your projects already exist, so this is the front door and free text is gone.
function OnDeck({
  data,
  weekISO,
  onBringIn,
}: {
  data: VerticalData;
  weekISO: string;
  onBringIn: (p: Project) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  const onDeckIds = new Set(projectsOnDeck(data, weekISO).map((p) => p.id));
  const open = data.projects.filter(
    (p) => p.status !== "complete" && p.status !== "cancelled" && !onDeckIds.has(p.id),
  );
  // Projects with no week yet are the natural candidates; ones parked on another
  // week stay a tap away, labelled with where they currently sit — bringing one
  // in MOVES it, so the board and this list can never disagree.
  const needsWeek = open.filter((p) => !p.targetDate);
  const elsewhere = open.filter((p) => p.targetDate);

  if (needsWeek.length === 0 && elsewhere.length === 0) return null;

  const chip = (p: Project, reason: string) => {
    const color = domainById(data, p.domainId)?.color ?? "var(--accent)";
    return (
      <button
        key={p.id}
        onClick={() => onBringIn(p)}
        title={`Move "${p.name}" to this week`}
        className="tap fast flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-label hover:border-line-strong hover:bg-surface-2"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
        <span className="text-ink">{p.name}</span>
        <span className="mono text-micro text-muted">{reason}</span>
      </button>
    );
  };

  return (
    <div className="mt-5">
      <div className="section-label mb-2">Slot a project</div>
      <div className="flex flex-wrap gap-2">
        {needsWeek.map((p) => chip(p, "needs a week"))}
        {showAll &&
          elsewhere.map((p) =>
            chip(p, `week of ${format(parseDateISO(p.targetDate!), "MMM d")}`),
          )}
        {elsewhere.length > 0 && (
          <button
            onClick={() => setShowAll((s) => !s)}
            className="tap fast rounded-full px-2.5 py-1.5 text-label text-muted hover:text-accent"
          >
            {showAll ? "less" : "＋ a project from another week"}
          </button>
        )}
      </div>
    </div>
  );
}

/** The week's pushes as rock-shaped rows for the read-only surfaces: derived
 *  membership (On Deck), joined to the stored verdict when one exists. Keeps the
 *  ribbon / bar / reckoning honest without reshaping them. */
function derivedRocks(data: VerticalData, weekISO: string): BigRock[] {
  return weekPushes(data, weekISO).map(
    ({ project, rock }) =>
      rock ?? {
        id: `derived:${project.id}`,
        title: project.name,
        win: project.outcome ?? "",
        initiative_id: null,
        project_id: project.id,
        done_at: null,
        roll_count: 0,
      },
  );
}

// ── a single rock chip — shared by the Today ribbon and the Schedule bar ─────
function RockChip({ rock, data, onToggle }: { rock: BigRock; data: VerticalData; onToggle: () => void }) {
  const done = Boolean(rock.done_at);
  const accent = rockColor(data, rock);
  const work = priorityWork(data, rock);
  return (
    <button
      onClick={onToggle}
      title={rock.win ? `win = ${rock.win}` : done ? "Moved — click to reopen" : "Mark moved"}
      className="fast flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-label"
      style={{ borderColor: done ? "var(--line)" : accent ?? "var(--line-strong)", opacity: done ? 0.55 : 1 }}
    >
      <span
        className="mono flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-micro"
        style={{ borderColor: done ? "var(--accent)" : "var(--line)", background: done ? "var(--accent)" : "transparent", color: "var(--on-accent)" }}
      >
        {done ? "✓" : ""}
      </span>
      <span className={done ? "text-muted line-through" : "text-ink"}>{rock.title}</span>
      {!done && work.total > 0 && <span className="mono text-micro text-muted">{work.done}/{work.total}</span>}
    </button>
  );
}

// ── the ribbon — held on Today all week ──────────────────────────────────────
export function BigRocksRibbon() {
  const { data, togglePushLanded } = useVertical();
  const rocks = derivedRocks(data, data.sprint?.week_start ?? planningWeekStartISO());
  if (rocks.length === 0) return null;

  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line pb-4">
      <span className="section-label shrink-0">This week</span>
      {rocks.map((rock) => (
        <RockChip key={rock.id} rock={rock} data={data} onToggle={() => rock.project_id && togglePushLanded(rock.project_id)} />
      ))}
    </div>
  );
}

// ── the Schedule bar — the week's plan, docked above the calendar ────────────
const BAR_KEY = "nuvo.schedule.bigrocks.open";

export function BigRocksBar() {
  const { data, togglePushLanded } = useVertical();
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(BAR_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(BAR_KEY, open ? "1" : "0"); } catch { /* ignore */ }
  }, [open]);

  const rocks = derivedRocks(data, data.sprint?.week_start ?? planningWeekStartISO());

  return (
    <div className="shrink-0 border-b border-line bg-surface px-6 py-2.5">
      <div className="mx-auto max-w-[1100px]">
        {open ? (
          <>
            <BigRocks />
            <button onClick={() => setOpen(false)} className="fast mono mt-2 text-meta text-muted hover:text-ink">▴ hide</button>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="section-label shrink-0">Priorities</span>
            {rocks.length === 0 ? (
              <button onClick={() => setOpen(true)} className="fast mono text-label text-muted hover:text-accent">
                ＋ set this week's priorities
              </button>
            ) : (
              <>
                {rocks.map((rock) => (
                  <RockChip key={rock.id} rock={rock} data={data} onToggle={() => rock.project_id && togglePushLanded(rock.project_id)} />
                ))}
                <button onClick={() => setOpen(true)} className="fast mono ml-auto shrink-0 text-meta text-muted hover:text-accent">edit ▾</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── the reckoning — the priorities, read back in the Gain ────────────────────
export function BigRocksReckoning({ data }: { data: VerticalData }) {
  const rocks = derivedRocks(data, data.sprint?.week_start ?? planningWeekStartISO());
  if (rocks.length === 0) return null;
  const moved = rocks.filter((r) => r.done_at).length;

  return (
    <div className="mt-7 border-t border-line pt-4">
      <div className="section-label mb-2.5">
        Priorities · this week <span className="mono ml-1 font-normal normal-case tracking-normal text-accent">{moved}/{rocks.length} moved</span>
      </div>
      <div className="space-y-2">
        {rocks.map((rock) => {
          const done = Boolean(rock.done_at);
          const work = priorityWork(data, rock);
          const accent = rockColor(data, rock) ?? "var(--accent)";
          return (
            <div key={rock.id} className="flex items-start gap-3 rounded-lg border border-line bg-surface p-3.5">
              <span className="mt-0.5 w-4 shrink-0 text-center text-body" style={{ color: done ? accent : "var(--line-strong)" }}>
                {done ? "✓" : "○"}
              </span>
              <div className="min-w-0 flex-1">
                <div className={`text-head font-medium leading-snug ${done ? "" : "text-ink/90"}`}>{rock.title}</div>
                <div className="mono mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-muted">
                  <span style={{ color: done ? accent : "var(--muted)" }}>
                    {done ? "moved this week" : work.total > 0 ? `${work.done}/${work.total} done` : rock.roll_count > 0 ? `still in flight · carried ${rock.roll_count}w` : "still in flight"}
                  </span>
                  {work.label && <><span className="text-line">·</span><span>{work.label}</span></>}
                  {rock.win && <><span className="text-line">·</span><span>win = {rock.win}</span></>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
