// The Week's Plan / Review — one surface, two states, one question asked at two
// points on the arc. Forming (this week, still changeable): **is the week I
// committed to still true?** Sealed (a past week): **did anything move?** It
// slides over the Schedule calendar; you reach past weeks by walking ‹ ›.
//
// The rail crown already answers "what am I on this week?" in a glance, so this
// surface earns its full screen by going *deeper*, not wider: the week's
// projects with their outcome, their open work, and the honest arithmetic of how
// much of what's left actually has a time — each row carrying the acts that
// resolve it (another week / move out / take off). D-039 put those remedies on
// the Sunday step while you're still choosing; this is where you reach for them
// on a Wednesday.
//
// What used to live here and doesn't any more: two free-text capture boxes that
// minted project-less rocks and wrote into a next week nothing reads, and a
// Highlights list that described the past and handed nothing forward. The
// receipts behind that list now expand under each domain in the weave.

import { useState, useEffect, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fmtHours } from "../../lib/dates";
import { weekSpan } from "../../lib/week";
import { fmtMins } from "../../lib/now";
import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { projectById } from "../../lib/vertical";
import { pushToNextWeekPatch, spanAnotherWeekPatch, takeOffWeekPatch } from "../../../supabase/functions/_shared/planningRules.ts";
import type { WeekReport, WeekPriority } from "../../lib/composeWeek";
import { useWeekVerdicts } from "../../hooks/useWeekVerdicts";
import { useWeekReviewActions, useWeekReviewRow } from "../../hooks/useWeekReview";
import { ProjectShipAssess } from "../record/ShipAssess";
import WeekEmblem from "./WeekEmblem";
import WeekStory from "./WeekStory";
import { WhatYouBuilt } from "./WhatYouBuilt";
import { WeekFindCard } from "./WeekFind";
import { WeekProjectRow } from "./WeekProjectRow";
import { DomainEvidenceList } from "./WeekEvidence";
import { Bar } from "./parts";


/** Where the hours went — capacity + the per-domain weave, with expandable receipts. */
function HoursWeave({ report, onCorrected }: { report: WeekReport; onCorrected?: () => void }) {
  const { capacity, domains, evidence } = report;
  const [openId, setOpenId] = useState<string | null>(null);
  const busyPct = capacity.workMins > 0 ? (capacity.busyMins / capacity.workMins) * 100 : 0;
  const maxH = Math.max(1, ...domains.map((d) => Math.max(d.hours, d.target)));
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-meta text-muted">Committed</span>
          <span className="mono text-meta text-muted">
            {fmtMins(capacity.busyMins)} of {fmtMins(capacity.workMins)} · {fmtMins(capacity.openMins)} open
          </span>
        </div>
        <Bar pct={busyPct} color="var(--accent)" h={2} />
      </div>
      <div className="flex flex-col gap-2.5">
        {domains.map((d) => {
          const expanded = openId === d.id;
          const hasReceipts = (evidence?.domains.find((e) => e.domainId === d.id)?.receipts.length ?? 0) > 0;
          return (
            <div key={d.id}>
              <button
                type="button"
                onClick={() => hasReceipts && setOpenId(expanded ? null : d.id)}
                className={`flex w-full items-center gap-3 text-left ${hasReceipts ? "tap cursor-pointer" : "cursor-default"}`}
                aria-expanded={expanded}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: d.quiet ? "var(--line-strong)" : d.color, opacity: d.quiet ? 0.5 : 1 }} />
                <span className="w-24 shrink-0 truncate text-meta text-ink">{d.name}</span>
                <div className="min-w-0 flex-1">
                  <Bar pct={(d.hours / maxH) * 100} color={d.quiet ? "var(--line-strong)" : d.color} baseline={d.target > 0 ? (d.target / maxH) * 100 : undefined} h={1.5} />
                </div>
                <span className="mono w-14 shrink-0 text-right text-micro text-muted">{fmtHours(d.hours * 60)}h</span>
              </button>
              {expanded && evidence && (
                <div className="mb-1 ml-5 mt-1 border-l border-line pl-3">
                  <DomainEvidenceList evidence={evidence} domainId={d.id} onCorrected={onCorrected} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The conscience read — one sentence, on a week that can still change.
 *
 *  This resolves the grace-vs-audit dial that `docs/weekly-review.md` left open,
 *  and it resolves it on the forward-folding rule rather than on tone: mid-week
 *  a quiet domain is *actionable*, so naming it hands something forward. Once
 *  the week is sealed nothing can be done about it, so the sentence would be
 *  pure audit and the ember carries it alone (P4 — never present undone things
 *  as debt, and never shame a quiet domain; sometimes weighting elsewhere was
 *  right).
 *
 *  It is deliberately actless. A "flag it for next week" button has nowhere
 *  honest to write — and this repo already has that receipt: `note_to_monday`
 *  has been written since migration 33 and is read by nothing. If the act
 *  arrives it ships with its reader, or not at all. */
function ConscienceRead({ report, tense }: { report: WeekReport; tense: "ahead" | "current" | "past" }) {
  const withHours = report.domains.filter((d) => d.hours > 0);
  const quiet = report.domains.filter((d) => d.quiet);
  const openH = report.capacity.openMins > 0 ? `${fmtHours(report.capacity.openMins)}h` : null;
  const yet = tense === "ahead" ? "" : " yet";

  // Day one: every domain is quiet because the account is new, not because
  // anything was neglected. Naming five of them on someone's first Tuesday is
  // the app inventing a failure (P7/P16).
  if (withHours.length === 0) {
    return <p className="text-body text-muted">Nothing has landed against a domain{yet} this week.</p>;
  }
  if (quiet.length === 0) return null;

  // One em-dash per sentence: the earlier draft read "…quiet so far — SCE has
  // the hours — there's 6.5h still open", which parses as an aside inside an
  // aside.
  const room = openH ? `, and there's ${openH} still open.` : ".";
  const line =
    quiet.length > 2
      ? `Most of your domains are quiet so far — ${withHours[0].name} has the hours${room}`
      : `${quiet.map((d) => d.name).join(" and ")} ${quiet.length === 1 ? "hasn't" : "haven't"} had time${yet} this week${room}`;

  return <p className="text-body text-ink">{line}</p>;
}

function Col({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <div className="section-label mb-3">{label}</div>
      {children}
    </section>
  );
}

/** The scrollable content — shared by the desktop floor and the mobile Plan tab.
 *  `header` lets each shell supply its own title/close treatment. */
export function WeekPlanBody({
  report,
  state,
  tense = "current",
  viewedWeekISO,
  header,
  onCompose,
  composeLabel,
  onOpenProject,
}: {
  report: WeekReport;
  state: "forming" | "sealed";
  /** "ahead" = planning a not-yet-started week · "current" = the lived week · "past" = sealed. */
  tense?: "ahead" | "current" | "past";
  viewedWeekISO: string;
  header?: ReactNode;
  /** Launch the compose + time-block ritual. Omitted on surfaces where the
   *  ritual isn't mounted (e.g. mobile) — the CTA then hides itself. */
  onCompose?: () => void;
  /** CTA wording — "Plan the week" when fresh, "Re-plan the week" once planned. */
  composeLabel?: string;
  /** Open a project's record. Omitted on mobile — MobileShell doesn't mount the
   *  record overlay, so a button there would be a dead end (the row then states
   *  the gap without offering an act). */
  onOpenProject?: (projectId: string) => void;
}) {
  const forming = state === "forming";
  const ahead = tense === "ahead";
  // Where time-sections sit on the arc: a week not yet lived shows *planned*
  // allocation; the lived week shows it *filling*; a sealed week, where it *went*.
  const hoursLabel = tense === "ahead" ? "Where the hours will go" : tense === "current" ? "Where the hours are going" : "Where the hours went";
  const total = report.priorityTotal;
  const { data: vertical, updateProject } = useVertical();
  const verdicts = useWeekVerdicts(viewedWeekISO);
  const reviewActions = useWeekReviewActions(viewedWeekISO);
  const sealedRow = useWeekReviewRow(viewedWeekISO);
  const qc = useQueryClient();
  const [shipId, setShipId] = useState<string | null>(null);

  // Snapshot the week for its future Review. A week still RUNNING has no final
  // shape, so re-snapshot on every open while it's live; a week that's over is
  // sealed once and then never rewritten (it's the historical record). Sealing
  // once on first open — which is what this used to do — meant that opening the
  // plan on Monday made Monday's slate the permanent Review of that week.
  useEffect(() => {
    if (ahead) return;
    if (sealedRow.isLoading) return;
    const hasFull = sealedRow.data?.report && typeof sealedRow.data.report === "object" && "emblem" in sealedRow.data.report;
    if (tense === "past" && hasFull) return;
    void reviewActions.seal.mutateAsync(report).catch(() => {});
    // Only on first open / week change — not on every report tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewedWeekISO, ahead, tense, sealedRow.isLoading, sealedRow.data?.id]);

  const reseal = () => {
    void qc.invalidateQueries({ queryKey: ["vertical"] });
    void qc.invalidateQueries({ queryKey: ["event_domain_routing"] });
    window.setTimeout(() => {
      void reviewActions.reseal(report).catch(() => {});
    }, 400);
  };

  // Every act on a row is a span write through the kernel — the same act as
  // dragging the project's card on On Deck, so the deck and the plan cannot
  // disagree about where a project lives. (The old "Carry to next week" appended
  // a rock to next week's big_rocks, which nothing renders: the toast was a lie.)
  const proj = (p: WeekPriority) => (p.projectId ? projectById(vertical, p.projectId) : null);
  const span = (p: WeekPriority) => {
    const project = proj(p);
    if (project) updateProject(project.id, spanAnotherWeekPatch(project, viewedWeekISO));
  };
  const pushOut = (p: WeekPriority) => {
    const project = proj(p);
    if (project) updateProject(project.id, pushToNextWeekPatch(project, viewedWeekISO));
  };
  const takeOff = (p: WeekPriority) => {
    if (p.projectId) updateProject(p.projectId, takeOffWeekPatch());
  };
  // Ticking a row SHIPS its project — one completion act, not two. Writing
  // `done_at` directly reads as "complete" while finalizing nothing, which let a
  // priority go struck-through with five tasks still live underneath. The
  // assessment shows what's open before anything is written.
  const ship = (p: WeekPriority) => {
    if (p.projectId && !p.shipped) setShipId(p.projectId);
  };
  const reopen = (p: WeekPriority) => {
    if (p.projectId) verdicts.setLanded(p.projectId, false);
  };

  return (
    <>
      {header}

      {/* HERO — emblem + the warm brief, side by side (uses the width) */}
      <div className="mb-12 grid items-center gap-8 md:grid-cols-[240px_1fr]">
        <div className="flex justify-center">
          <WeekEmblem spec={report.emblem} state={state} size={220} />
        </div>
        <div>
          {total > 0 && (
            <div className="mb-3">
              {ahead ? (
                <>
                  <span className="mono text-head text-ink">{total}</span>
                  <span className="ml-2 text-meta text-muted">project{total === 1 ? "" : "s"} on the week</span>
                </>
              ) : (
                <>
                  <span className="mono text-head text-ink">{report.landedCount} of {total}</span>
                  <span className="ml-2 text-meta text-muted">landed</span>
                </>
              )}
            </div>
          )}
          {/* The deterministic brief narrates the week that *was* — skip it for a
              week you're planning (nothing has happened yet). */}
          {report.brief && !ahead && <p className="serif text-lead leading-relaxed text-ink">{report.brief}</p>}
          {ahead && (
            <p className="serif text-lead leading-relaxed text-ink">
              {total > 0
                ? `Here's the week ahead. ${total} project${total === 1 ? "" : "s"} on it so far.`
                : "Here's the week ahead. Bring the projects in, then compose them into time."}
            </p>
          )}

          {/* The ritual is the act only when there's no week yet to fix — an
              empty slate, or a week you're planning. Mid-week you reach for one
              project's remedy, not a re-run, so the door demotes to a quiet link
              at the foot of the projects column. */}
          {forming && onCompose && (ahead || total === 0) && (
            <div className="mt-5">
              <button
                onClick={onCompose}
                className="fast inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-label font-medium text-white shadow-sm hover:brightness-110 hover:shadow-[0_6px_16px_-6px_var(--accent-glow)] active:translate-y-px"
              >
                {composeLabel ?? "Plan the week"}
                <span aria-hidden>→</span>
              </button>
              <p className="mt-2 text-meta text-muted">Projects, leftovers and the inbox — placed against your real calendar.</p>
            </div>
          )}
        </div>
      </div>

      {/* Forming: the conscience is one sentence, so it rides ABOVE as a band —
          given a column of its own it left half the screen dead, and it made the
          projects (this surface's actual hero) share the stage with a sentence.
          Sealed: the weave is the moment's content and fills its column. */}
      {forming && (
        <div className="mb-10 min-w-0" data-marquee="hours">
          <Col label={hoursLabel}>
            <div className="flex flex-col gap-2">
              <ConscienceRead report={report} tense={tense} />
              <details className="group">
                <summary className="tap fast cursor-pointer list-none text-meta text-muted hover:text-accent">
                  <span className="mr-1 inline-block transition-transform group-open:rotate-90" aria-hidden>▸</span>
                  {hoursLabel}
                </summary>
                <div className="mt-3 max-w-xl">
                  <HoursWeave report={report} onCorrected={reseal} />
                </div>
              </details>
            </div>
          </Col>
        </div>
      )}

      {/* MAIN — the week's projects at depth | (sealed) where the time went */}
      {/* `min-w-0` on the grid items is load-bearing: a grid child defaults to
          min-width:auto, so without it the row's long outcome line sets the
          track width and `truncate` never engages — the text just runs off the
          side of a phone. */}
      <div className={`grid gap-x-14 gap-y-10 ${forming ? "" : "md:grid-cols-2"}`}>
        <div className="min-w-0" data-marquee="priorities">
        <Col label={forming ? "The week's projects" : "How they landed"}>
          {report.priorities.length > 0 ? (
            // A readable measure, not the full bleed: at 1440px an unconstrained
            // row strands the progress chip a screen away from the name it
            // belongs to, and the remedy panel becomes a banner.
            <div className="flex max-w-3xl flex-col">
              {report.priorities.map((p) => (
                <WeekProjectRow
                  key={p.rock.id}
                  p={p}
                  editable={forming}
                  onShip={() => ship(p)}
                  onReopen={() => reopen(p)}
                  onSpan={() => span(p)}
                  onPushOut={() => pushOut(p)}
                  onTakeOff={() => takeOff(p)}
                  onOpenProject={onOpenProject && p.projectId ? () => onOpenProject(p.projectId!) : undefined}
                />
              ))}
            </div>
          ) : forming ? (
            // Adding is the ritual's job, not a fifth editor's — say what's true
            // and point at the one door that does it.
            <p className="text-body text-muted">
              {report.brief.startsWith("No projects yet")
                ? "No projects yet. The week is genuinely empty — that's a fine place to start."
                : "Nothing's on this week yet — bring a project in and the week has a shape."}
            </p>
          ) : (
            <p className="text-body text-muted">Nothing was on this week.</p>
          )}

          {/* The ritual, demoted: mid-week you fix one project, you don't re-run
              the week. It stays the loud pill in the hero when the slate is empty. */}
          {forming && onCompose && !ahead && total > 0 && (
            <button onClick={onCompose} className="fast tap mt-3 text-label text-muted hover:text-accent">
              {composeLabel ?? "Plan the week"} →
            </button>
          )}
        </Col>
        </div>

        {!forming && (
          <div className="min-w-0" data-marquee="hours">
            <Col label={hoursLabel}>
              <HoursWeave report={report} onCorrected={reseal} />
            </Col>
          </div>
        )}

        {/* The Find — one discovery; self-hides when nothing notable / ahead week. */}
        {!ahead && report.find && (
          <div className={forming ? "" : "md:col-span-2"}>
            <WeekFindCard find={report.find} weekStartISO={viewedWeekISO} sealed={state === "sealed"} onReseal={reseal} />
          </div>
        )}

        {/* What you built — merged PRs as shipped work (self-hides if none). */}
        {!ahead && <WhatYouBuilt weekStartISO={viewedWeekISO} />}
      </div>

      {shipId && <ProjectShipAssess id={shipId} onClose={() => setShipId(null)} />}
    </>
  );
}

export interface WeekPlanFloorProps {
  report: WeekReport;
  state: "forming" | "sealed";
  /** "ahead" = a week you're planning · "current" = the lived week · "past" = sealed. */
  tense?: "ahead" | "current" | "past";
  /** "Jun 15 – 21" — the week's span. */
  weekLabel: string;
  viewedWeekISO: string;
  onClose: () => void;
  /** time-walk to the previous/next week (sealed archive ‹ ›). */
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
  canGoNext?: boolean;
  /** Launch the compose + time-block ritual from the forming hero. */
  onCompose?: () => void;
  /** CTA wording — "Plan the week" when fresh, "Re-plan the week" once planned. */
  composeLabel?: string;
  /** Play the paced recap animation on open — the Review's reveal moment only.
   *  A check-in / plan view opens straight to the static detail. */
  story?: boolean;
}

/** The desktop floor — slides over the Schedule work area (full-width, rail hidden).
 *  Opens as a paced story (the received moment); "See the full week" → the detail. */
export default function WeekPlanFloor({ report, state, tense = "current", weekLabel, viewedWeekISO, onClose, onPrevWeek, onNextWeek, canGoNext, onCompose, composeLabel, story }: WeekPlanFloorProps) {
  const [mode, setMode] = useState<"story" | "detail">(story ? "story" : "detail");
  // Desktop only — a project's definition gets fixed where the project lives.
  const { openRecord } = useAppNavigation();

  // Esc dismisses the surface (story or detail) — same gesture as every other overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  if (mode === "story") {
    return (
      <WeekStory
        report={report}
        state={state}
        weekLabel={`${weekSpan(viewedWeekISO)} · ${weekLabel}`}
        onClose={onClose}
        onSeeDetail={() => setMode("detail")}
      />
    );
  }

  const eyebrow = tense === "ahead" ? "The week ahead" : tense === "current" ? "This week" : "The Review";
  const header = (
    <div className="mb-8 flex items-start gap-4">
      <div className="flex items-center gap-1.5 pt-1">
        {onPrevWeek && (
          <button onClick={onPrevWeek} className="fast flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink" aria-label="Previous week">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {onNextWeek && (
          <button onClick={canGoNext ? onNextWeek : undefined} disabled={!canGoNext} className="fast flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30" aria-label="Next week">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="section-label mb-1"><span style={{ color: "var(--accent)" }}>{weekSpan(viewedWeekISO)}</span> · {eyebrow}</div>
        <h1 className="masthead text-display leading-tight text-ink">{weekLabel}</h1>
      </div>
      <button onClick={onClose} className="tap fast flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );

  return (
    <div
      className="absolute inset-0 z-[45] overflow-y-auto"
      style={{
        // Match mobile WeekPlanCard / MobilePlanWeek (96%) — 88% left the
        // Schedule calendar readable through the surface and washed the copy out.
        background: "color-mix(in srgb, var(--bg) 96%, transparent)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      <div className="mx-auto w-full max-w-5xl px-8 py-10 pb-28 md:px-12">
        <WeekPlanBody report={report} state={state} tense={tense} viewedWeekISO={viewedWeekISO} header={header} onCompose={onCompose} composeLabel={composeLabel} onOpenProject={(id) => openRecord("project", id)} />
      </div>
    </div>
  );
}
