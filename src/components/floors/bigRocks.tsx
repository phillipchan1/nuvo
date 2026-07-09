// Priorities — the week's named outcomes (stored internally as `big_rocks`; the
// user-facing name is "Priorities"). A small, varying set that sit above the
// task funnel. A priority OWNS its work directly via tasks.big_rock_id, so it
// tracks progress (done / scheduled) without needing any initiative or project
// — and can optionally link an existing initiative/project to spotlight its work, or
// stay a loose one-off. Authored here (free-text brain-dump), held on Today as
// a ribbon, read back in the Gain. See src/lib/types.ts BigRock.
//
//   BigRocks         — the editor (the Schedule bar + the Sunday ritual)
//   BigRocksRibbon   — the held presence on Today (read + check off)
//   BigRocksBar      — the collapsible plan on the Schedule rung
//   BigRocksReckoning — the look-back in the Gain (Standback)

import { useEffect, useMemo, useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import { domainById, initiativeById, isOpenStatus, projectById, type ItemBrief, type Project, type VerticalData } from "../../lib/vertical";
import { priorityWork, proposedPriorities, type ProposedPriority, type RockWork } from "../../lib/priorities";
import { projectReadinessAxes, lensGaps, type ReadinessAxes } from "../../lib/lenses";
import type { BigRock } from "../../lib/types";
import { ENERGY_META, type Energy } from "../../lib/energy";
import { supabase } from "../../lib/supabase";
import { ASSISTANT_NAME } from "../../lib/assistant";
import { fmtHours as hrs, parseDateISO, toDateISO, todayISO } from "../../lib/dates";
import { InlineText } from "./parts";
import { Btn } from "../ui";

type ParsedTask = { title: string; energy: Energy; durationMins: number; deadline: string | null };
type ParsedPriority = { title: string; win: string; initiativeId: string | null; projectId: string | null; tasks: ParsedTask[] };

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

/** A priority bound to a project is a PUSH (a project moves this week). Everything
 *  else — loose or initiative-linked — is an AIM. A Push reads the project's
 *  readiness (Defined · Planned · Fits) so Sunday can gate it: ready → an execution
 *  slice; not ready → groom it on the spot or push it out. */
type PushRead =
  | { isPush: false }
  | { isPush: true; proj: Project; axes: ReadinessAxes; gaps: ReturnType<typeof lensGaps>; ready: boolean };

function pushReadiness(data: VerticalData, rock: BigRock, now: Date): PushRead {
  const proj = projectById(data, rock.project_id ?? null);
  if (!proj) return { isPush: false };
  const axes = projectReadinessAxes(data, proj, now);
  const gaps = lensGaps(data, "project", proj, now);
  return { isPush: true, proj, axes, gaps, ready: gaps.length === 0 };
}

function ordinalWeek(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]} week`;
}

const EMPTY_BRIEF: ItemBrief = { scope: [], nonGoals: [], doneWhen: [], openQuestions: [], constraints: [] };

// A 3-segment readiness pip — Defined · Planned · Fits. Filled = met.
function ReadinessPip({ axes, accent }: { axes: ReadinessAxes; accent: string }) {
  const seg = (on: boolean | null, key: string) => (
    <span key={key} className="h-1 w-4 rounded-full" title={key} style={{ background: on ? accent : "var(--line)" }} />
  );
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      {seg(axes.defined, "defined")}
      {seg(axes.planned, "planned")}
      {seg(axes.fits, "fits")}
    </span>
  );
}

// ── the editor — author the week's priorities ────────────────────────────────
export function BigRocks() {
  const { data, addBigRock, addBigRocks, addTasksToWeek, updateBigRock, removeBigRock, toggleBigRockDone } = useVertical();
  const rocks = data.bigRocks;
  const [text, setText] = useState("");
  const [shaping, setShaping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Free text in, structure out — and the generated work is tagged to the
  // priority it serves (big_rock_id) so it tracks. (nuvo-low-data-entry.)
  const shape = async () => {
    const t = text.trim();
    if (!t || shaping) return;
    setShaping(true);
    setError(null);
    try {
      const { data: res, error: fnErr } = await supabase.functions.invoke("agent", {
        body: { priorities: { text: t, today: todayISO() } },
      });
      if (fnErr) throw fnErr;
      const priorities = (res?.priorities ?? []) as ParsedPriority[];
      const looseTasks = (res?.tasks ?? []) as ParsedTask[];
      if (!priorities.length && !looseTasks.length) {
        setError("Couldn't find anything to shape — try naming what you want to happen.");
        return;
      }
      // outcomes — with stable ids so their work can link back to them
      const withIds = priorities.map((p) => ({ id: crypto.randomUUID(), p }));
      if (withIds.length) {
        addBigRocks(withIds.map(({ id, p }) => ({
          id,
          title: p.title,
          win: p.win,
          initiative_id: p.initiativeId ?? null,
          project_id: p.projectId ?? null,
        })));
      }
      // each outcome's work → into the week, tagged to the rock, with deadlines.
      // When the priority bound to standing work, home its work there too (most
      // specific wins) so the generated tasks live where the priority points.
      for (const { id, p } of withIds) {
        if (!p.tasks?.length) continue;
        const proj = projectById(data, p.projectId);
        const init = initiativeById(data, p.initiativeId);
        await addTasksToWeek(
          { projectId: p.projectId ?? null, initiativeId: p.initiativeId ?? null, domainId: proj?.domainId ?? init?.domainId ?? null },
          p.tasks.map((x) => ({ title: x.title, energy: x.energy, durationMins: x.durationMins, deadline: x.deadline, bigRockId: id })),
        );
      }
      // standalone one-offs → into the week, loose
      if (looseTasks.length) {
        await addTasksToWeek({}, looseTasks.map((x) => ({ title: x.title, energy: x.energy, durationMins: x.durationMins, deadline: x.deadline })));
      }
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "shaping failed");
    } finally {
      setShaping(false);
    }
  };

  // Bottom-up: groomed projects that are slipping or due to start, proposed as
  // priorities beside the blank line — never pre-filling it. (nuvo-priority-project-binding)
  const { groomed, ungroomed } = useMemo(() => {
    const bound = new Set(rocks.map((r) => r.project_id).filter((id): id is string => Boolean(id)));
    return proposedPriorities(data, new Date(), bound);
  }, [data, rocks]);

  const bringIn = (p: ProposedPriority) =>
    addBigRocks([{ title: p.project.name, win: p.win, project_id: p.project.id }]);

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-head font-semibold tracking-tight">
          Priorities{rocks.length > 0 && <span className="mono text-meta font-normal text-muted"> {rocks.length} this week</span>}
        </h2>
      </div>

      <div className="glass-card rounded-lg border border-line p-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void shape(); }}
          rows={3}
          placeholder="What needs to happen this week? Dump it however it comes out — Nuvo sorts priorities from tasks, reads deadlines, and generates the work."
          className="w-full resize-y bg-transparent text-body leading-relaxed outline-none placeholder:text-muted/60"
        />
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Btn kind="primary" onClick={() => void shape()} disabled={!text.trim() || shaping}>
            {shaping ? "✦ shaping…" : `✦ shape it with ${ASSISTANT_NAME}`}
          </Btn>
          <button onClick={addBigRock} className="fast mono text-meta text-muted hover:text-accent">
            or add by hand
          </button>
          {error && <span className="text-label text-signal">{error}</span>}
        </div>
      </div>

      {(groomed.length > 0 || ungroomed.length > 0) && (
        <ProjectsAskingForYou data={data} groomed={groomed} ungroomed={ungroomed} onBringIn={bringIn} />
      )}

      {rocks.length > 0 && (
        <div className="mt-4 space-y-3">
          {(() => {
            const pushes = rocks.filter((r) => r.project_id);
            const aims = rocks.filter((r) => !r.project_id);
            const card = (rock: BigRock) => (
              <RockCard
                key={rock.id}
                rock={rock}
                index={rocks.indexOf(rock)}
                data={data}
                onUpdate={(patch) => updateBigRock(rock.id, patch)}
                onRemove={() => removeBigRock(rock.id)}
                onToggleDone={() => toggleBigRockDone(rock.id)}
              />
            );
            return (
              <>
                {pushes.length > 0 && aims.length > 0 && (
                  <div className="section-label flex items-center gap-1.5 pt-0.5">Pushes <span className="mono font-normal normal-case tracking-normal text-muted">a project moves</span></div>
                )}
                {pushes.map(card)}
                {pushes.length > 0 && aims.length > 0 && (
                  <div className="section-label flex items-center gap-1.5 pt-2">Aims <span className="mono font-normal normal-case tracking-normal text-muted">outcomes of your own</span></div>
                )}
                {aims.map(card)}
              </>
            );
          })()}
        </div>
      )}
    </section>
  );
}

// ── "Projects asking for you" — groomed, slipping projects proposed as
//    priorities. A proposal rail beside the blank line; one tap brings a project
//    in as a priority born already bound to it. (nuvo-priority-project-binding) ─
function ProjectsAskingForYou({
  data,
  groomed,
  ungroomed,
  onBringIn,
}: {
  data: VerticalData;
  groomed: ProposedPriority[];
  ungroomed: ProposedPriority[];
  onBringIn: (p: ProposedPriority) => void;
}) {
  const row = (p: ProposedPriority, ready: boolean) => {
    const color = domainById(data, p.project.domainId)?.color ?? "var(--accent)";
    return (
      <button
        key={p.project.id}
        onClick={() => onBringIn(p)}
        title={ready ? `Push "${p.project.name}" this week` : `Bring "${p.project.name}" in and groom it here`}
        className="fast tap group/row flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-surface-2"
      >
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ready ? color : "var(--line-strong)" }} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body">{p.project.name}</span>
          <span className="mono block truncate text-micro text-muted">
            {p.reason}
            {!ready && " · needs grooming"}
          </span>
        </span>
        <span className="mono shrink-0 text-meta text-muted transition-colors group-hover/row:text-accent">
          {ready ? "＋ push" : "＋ groom"}
        </span>
      </button>
    );
  };
  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="section-label">Projects asking for you</span>
        <span className="mono text-micro text-muted">slipping or due to start</span>
      </div>
      <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
        {groomed.map((p) => row(p, true))}
        {ungroomed.map((p) => row(p, false))}
      </div>
    </div>
  );
}

// ── a priority as a tracked object — title, win, its work beneath, a progress
//    gauge, and an optional (de-emphasized) anchor to an initiative/project ───────────
function RockCard({
  rock,
  index,
  data,
  onUpdate,
  onRemove,
  onToggleDone,
}: {
  rock: BigRock;
  index: number;
  data: VerticalData;
  onUpdate: (patch: Partial<Omit<BigRock, "id">>) => void;
  onRemove: () => void;
  onToggleDone: () => void;
}) {
  const done = Boolean(rock.done_at);
  const accent = rockColor(data, rock) ?? "var(--accent)";
  const work = priorityWork(data, rock);
  const push = pushReadiness(data, rock, new Date());
  const rolls = rock.roll_count ?? 0;
  const carried = !done && rolls > 0;
  // The Push's weekly verdict is NOT the project's finish line: landing this
  // week's slice while open work remains means the project simply continues.
  const projContinues = done && push.isPush && work.tasks.some((t) => t.status !== "done");
  const gated = push.isPush && !push.ready && !done;

  return (
    <div
      className="group glass-card rounded-lg border px-4 py-3.5"
      style={{ borderColor: "var(--line)", borderLeft: `3px solid ${done ? "var(--line-strong)" : accent}`, opacity: done ? 0.62 : 1 }}
    >
      <div className="flex items-start gap-3">
        <button
          onClick={onToggleDone}
          title={done ? "Push landed — click to reopen" : push.isPush ? "Mark this week's push landed" : "Mark moved"}
          className="fast mono mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-meta"
          style={{ borderColor: done ? "var(--accent)" : accent, background: done ? "var(--accent)" : "transparent", color: done ? "#fff" : "var(--muted)" }}
        >
          {done ? "✓" : index + 1}
        </button>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className="rounded-full px-1.5 py-0.5 text-micro font-medium tracking-wide"
              style={push.isPush ? { background: "var(--accent-soft)", color: "var(--accent)" } : { border: "1px solid var(--line)", color: "var(--muted)" }}
            >
              {push.isPush ? "PUSH" : "AIM"}
            </span>
            {push.isPush && !done && (
              <span className="inline-flex items-center gap-1.5">
                <ReadinessPip axes={push.axes} accent={accent} />
                <span className="mono text-micro" style={{ color: push.ready ? accent : "var(--muted)" }}>
                  {push.ready ? "Ready" : !push.axes.planned ? "Not ready" : "Almost"}
                </span>
              </span>
            )}
            {carried && (
              <span className="mono rounded-full px-1.5 py-0.5 text-micro" style={{ border: "1px solid var(--signal)", color: "var(--signal)" }}>
                carried · {ordinalWeek(rolls + 1)}
              </span>
            )}
            {projContinues && <span className="mono text-micro text-muted">project continues →</span>}
          </div>

          <InlineText
            value={rock.title}
            onChange={(title) => onUpdate({ title })}
            placeholder="Name a priority — the outcome you want…"
            className={`text-lead font-medium leading-snug ${done ? "text-muted line-through" : ""}`}
            autoFocusEmpty
          />
          <div className="mt-1 flex min-w-0 items-baseline gap-1.5">
            <span className="mono shrink-0 text-micro text-muted">win —</span>
            <InlineText
              value={rock.win}
              onChange={(win) => onUpdate({ win })}
              placeholder="what does winning look like?"
              className="text-caption text-muted"
            />
          </div>
          {work.label && !push.isPush && (
            <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: accent }} aria-hidden />
              <span className="mono truncate text-micro text-muted">serves {work.label}</span>
            </div>
          )}
          {carried && rolls >= 2 && (
            <div className="mono mt-1.5 text-micro" style={{ color: "var(--signal)" }}>
              Carried {rolls} weeks — is the slice too big, or the project stuck?
            </div>
          )}
        </div>

        <button
          onClick={onRemove}
          title="Remove this priority"
          className="fast shrink-0 text-caption text-muted opacity-0 hover:text-signal group-hover:opacity-100"
        >
          ×
        </button>
      </div>

      {gated && <PushGate rock={rock} proj={push.proj} gaps={push.gaps} accent={accent} onRemove={onRemove} />}
      {rock.title.trim() && (!gated || work.total > 0) && (
        <PriorityWork rock={rock} data={data} work={work} accent={accent} onUpdate={onUpdate} />
      )}
    </div>
  );
}

// ── the readiness gate — a not-ready Push can't fake execution, so Sunday offers
//    three honest moves: groom it on the spot, or push the project out to a later
//    week. (The passive fallback is a groom slot — the "Shape it" step below.) ────
function PushGate({
  rock,
  proj,
  gaps,
  accent,
  onRemove,
}: {
  rock: BigRock;
  proj: Project;
  gaps: ReturnType<typeof lensGaps>;
  accent: string;
  onRemove: () => void;
}) {
  const { updateProject, addTasksToWeek } = useVertical();
  const [grooming, setGrooming] = useState(false);
  const [deferring, setDeferring] = useState(false);
  const [proposed, setProposed] = useState<ProposedTask[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsOutcome = gaps.some((g) => g.label === "no outcome");
  const needsScope = gaps.some((g) => g.label === "scope unclear");
  const needsFinish = gaps.some((g) => g.label === "no finish line");
  const needsSteps = gaps.some((g) => g.lens === "path");
  const gapText = gaps.map((g) => g.label).join(" · ");

  const scaffold = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data: res, error: fnErr } = await supabase.functions.invoke("agent", {
        body: { scaffoldDraft: { name: proj.name, outcome: proj.outcome, initiativeId: proj.initiativeId ?? null, domainId: proj.domainId } },
      });
      if (fnErr) throw fnErr;
      const tasks = (res?.tasks ?? []) as { title: string; energy: Energy; durationMins: number }[];
      if (!tasks.length) { setError("Couldn't suggest steps — add one by hand below."); return; }
      setProposed(tasks.map((t) => ({ ...t, included: true })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "couldn't scaffold");
    } finally {
      setBusy(false);
    }
  };

  const acceptSteps = async () => {
    const chosen = (proposed ?? []).filter((t) => t.included);
    if (!chosen.length) { setProposed(null); return; }
    await addTasksToWeek(
      { projectId: proj.id, initiativeId: proj.initiativeId ?? null, domainId: proj.domainId },
      chosen.map((t) => ({ title: t.title, energy: t.energy, durationMins: t.durationMins, bigRockId: rock.id })),
    );
    setProposed(null);
  };

  // The passive fallback — keep it in the week, but the only thing it earns is a
  // groom slot: a small task whose job is to make the project ready.
  const addGroomSlot = () =>
    void addTasksToWeek(
      { projectId: proj.id, initiativeId: proj.initiativeId ?? null, domainId: proj.domainId },
      [{ title: `Shape "${proj.name}" — outcome, finish line, first steps`, energy: "decide", durationMins: 20, bigRockId: rock.id }],
    );

  // Push it out — shift the project's window to a later week and drop the Push.
  const defer = (weeks: number) => {
    const shift = (iso: string | null) => (iso ? toDateISO(new Date(parseDateISO(iso).getTime() + weeks * 7 * 86_400_000)) : null);
    updateProject(proj.id, { startDate: shift(proj.startDate), targetDate: shift(proj.targetDate) });
    onRemove();
  };

  const setBrief = (scope: string, doneWhen: string) =>
    updateProject(proj.id, {
      brief: {
        ...(proj.brief ?? EMPTY_BRIEF),
        scope: scope.trim() ? [scope.trim()] : (proj.brief?.scope ?? []),
        doneWhen: doneWhen.trim() ? [doneWhen.trim()] : (proj.brief?.doneWhen ?? []),
      },
    });

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-caption text-muted">
          Not ready — {gapText}. It can earn a{" "}
          <button onClick={addGroomSlot} className="fast text-accent hover:underline">groom slot</button>, or:
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button onClick={() => setGrooming((g) => !g)} className="fast mono text-meta text-accent hover:underline">
          {grooming ? "▾ close groomer" : "✦ Groom now"}
        </button>
        <button onClick={() => setDeferring((d) => !d)} className="fast mono text-meta text-muted hover:text-accent">
          Push it out ▾
        </button>
        {error && <span className="text-micro text-signal">{error}</span>}
      </div>

      {deferring && (
        <div className="mt-2 flex items-center gap-2">
          <span className="mono text-micro text-muted">move the project to:</span>
          <button onClick={() => defer(1)} className="fast mono rounded-md border border-line px-2 py-1 text-micro text-muted hover:border-line-strong hover:text-accent">next week</button>
          <button onClick={() => defer(2)} className="fast mono rounded-md border border-line px-2 py-1 text-micro text-muted hover:border-line-strong hover:text-accent">in 2 weeks</button>
        </div>
      )}

      {grooming && (
        <div className="mt-2.5 space-y-2.5 rounded-md border border-line bg-surface-2 p-3">
          {needsOutcome && (
            <label className="block">
              <span className="mono text-micro text-muted">Outcome — one line, "done" looks like…</span>
              <input
                defaultValue={proj.outcome}
                onBlur={(e) => e.target.value.trim() && updateProject(proj.id, { outcome: e.target.value.trim() })}
                placeholder="a new user reaches their first plan"
                className="mt-1 w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-body outline-none focus:border-accent"
              />
            </label>
          )}
          {needsScope && (
            <BriefFields brief={proj.brief} onCommit={setBrief} />
          )}
          {needsFinish && (
            <label className="block">
              <span className="mono text-micro text-muted">Finish line</span>
              <input
                type="date"
                defaultValue={proj.targetDate ?? ""}
                onChange={(e) => e.target.value && updateProject(proj.id, { targetDate: e.target.value })}
                className="mt-1 w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-body outline-none focus:border-accent"
              />
            </label>
          )}
          {needsSteps && !proposed && (
            <button onClick={() => void scaffold()} disabled={busy} className="fast mono text-meta text-accent hover:underline disabled:opacity-50">
              {busy ? "✦ scaffolding…" : "✦ Scaffold the first steps"}
            </button>
          )}
          {proposed && (
            <div className="space-y-1">
              {proposed.map((t, i) => (
                <button
                  key={i}
                  onClick={() => setProposed((p) => p!.map((x, j) => (j === i ? { ...x, included: !x.included } : x)))}
                  className="fast flex w-full items-center gap-2 text-left text-label"
                >
                  <span
                    className="mono flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border text-micro"
                    style={{ borderColor: t.included ? "var(--accent)" : "var(--line)", background: t.included ? "var(--accent)" : "transparent", color: "#fff" }}
                  >
                    {t.included ? "✓" : ""}
                  </span>
                  <span className={`min-w-0 flex-1 truncate ${t.included ? "" : "text-muted line-through"}`}>{t.title}</span>
                  <span className="mono shrink-0 text-micro text-muted">{ENERGY_META[t.energy]?.icon ?? "·"} {t.durationMins}m</span>
                </button>
              ))}
              <div className="flex items-center gap-2 pt-1">
                <Btn kind="primary" onClick={() => void acceptSteps()}>add these steps</Btn>
                <button onClick={() => setProposed(null)} className="fast mono text-meta text-muted hover:text-ink">discard</button>
              </div>
            </div>
          )}
          <p className="text-micro text-muted" style={{ color: accent }}>Fill the gaps and this becomes an execution Push.</p>
        </div>
      )}
    </div>
  );
}

// Scope + acceptance — the two lines that make a brief adjudicable (briefHasSubstance).
function BriefFields({ brief, onCommit }: { brief: ItemBrief | null | undefined; onCommit: (scope: string, doneWhen: string) => void }) {
  const [scope, setScope] = useState(brief?.scope?.[0] ?? "");
  const [doneWhen, setDoneWhen] = useState(brief?.doneWhen?.[0] ?? "");
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="mono text-micro text-muted">In scope — what this covers</span>
        <input
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          onBlur={() => onCommit(scope, doneWhen)}
          placeholder="the empty-state onboarding checklist"
          className="mt-1 w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-body outline-none focus:border-accent"
        />
      </label>
      <label className="block">
        <span className="mono text-micro text-muted">Done when — how you'll know it's finished</span>
        <input
          value={doneWhen}
          onChange={(e) => setDoneWhen(e.target.value)}
          onBlur={() => onCommit(scope, doneWhen)}
          placeholder="a fresh account hits the plan screen"
          className="mt-1 w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-body outline-none focus:border-accent"
        />
      </label>
    </div>
  );
}

type ProposedTask = { title: string; energy: Energy; durationMins: number; included: boolean };

function PriorityWork({
  rock,
  data,
  work,
  accent,
  onUpdate,
}: {
  rock: BigRock;
  data: VerticalData;
  work: RockWork;
  accent: string;
  onUpdate: (patch: Partial<Omit<BigRock, "id">>) => void;
}) {
  const { commitTasksToSprint, addTasksToWeek, toggleTask } = useVertical();
  const [proposed, setProposed] = useState<ProposedTask[] | null>(null);
  const [breaking, setBreaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pct = work.total > 0 ? Math.round((work.done / work.total) * 100) : 0;

  const breakDown = async () => {
    if (breaking) return;
    setBreaking(true);
    setError(null);
    try {
      const { data: res, error: fnErr } = await supabase.functions.invoke("agent", {
        body: { breakdown: { title: rock.title, win: rock.win, initiativeId: rock.initiative_id, projectId: rock.project_id ?? null } },
      });
      if (fnErr) throw fnErr;
      const tasks = (res?.tasks ?? []) as { title: string; energy: Energy; durationMins: number }[];
      if (!tasks.length) {
        setError("Couldn't suggest steps — add one by hand.");
        return;
      }
      setProposed(tasks.map((t) => ({ ...t, included: true })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "couldn't break it down");
    } finally {
      setBreaking(false);
    }
  };

  const addProposed = async () => {
    const chosen = (proposed ?? []).filter((t) => t.included);
    if (!chosen.length) { setProposed(null); return; }
    const proj = projectById(data, rock.project_id ?? null);
    const init = initiativeById(data, rock.initiative_id);
    await addTasksToWeek(
      { projectId: rock.project_id ?? null, initiativeId: rock.initiative_id ?? null, domainId: proj?.domainId ?? init?.domainId ?? null },
      chosen.map((t) => ({ title: t.title, energy: t.energy, durationMins: t.durationMins, bigRockId: rock.id })),
    );
    setProposed(null);
  };

  return (
    <div className="mt-3 border-t border-line pt-3">
      {work.total > 0 ? (
        <>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <span className="section-label">The work</span>
            <span className="mono text-meta text-muted">
              {work.done} of {work.total} done{work.scheduledMins > 0 ? ` · ${hrs(work.scheduledMins)}h scheduled` : ""}
            </span>
          </div>
          <div className="mb-2 h-1 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: accent }} />
          </div>
          <div className="space-y-1">
            {work.tasks.slice(0, 6).map((t) => {
              const tdone = t.status === "done";
              return (
                <button key={t.id} onClick={() => toggleTask(t.id)} className="fast flex w-full items-center gap-2 text-left text-label">
                  <span className="shrink-0 text-meta" style={{ color: tdone ? accent : "var(--line-strong)" }}>{tdone ? "✓" : "○"}</span>
                  <span className={`min-w-0 flex-1 truncate ${tdone ? "text-muted line-through" : "text-ink"}`}>{t.title || "untitled"}</span>
                  <span className="mono shrink-0 text-micro text-muted">
                    {t.energy ? ENERGY_META[t.energy].icon : "·"} {t.durationMins}m{t.status === "scheduled" ? " · set" : ""}
                  </span>
                </button>
              );
            })}
            {work.tasks.length > 6 && <div className="mono text-micro text-muted">+{work.tasks.length - 6} more</div>}
          </div>
        </>
      ) : (
        <div className="text-caption text-muted">No work yet — what would move this?</div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {work.pullable.length > 0 && (
          <button
            onClick={() => commitTasksToSprint(work.pullable.map((t) => t.id))}
            className="fast mono text-meta text-accent hover:underline"
            title={`Pull ready work from ${work.label} into the week`}
          >
            ↳ pull {work.pullable.length} ready from {work.label} →
          </button>
        )}
        <button onClick={() => void breakDown()} disabled={breaking} className="fast mono text-meta text-muted hover:text-accent disabled:opacity-50">
          {breaking ? "✦ thinking…" : work.total > 0 ? "✦ add more steps" : "✦ break it down"}
        </button>
        <AnchorPicker data={data} rock={rock} onUpdate={onUpdate} />
        {error && <span className="text-micro text-signal">{error}</span>}
      </div>

      {proposed && (
        <div className="mt-2 space-y-1 rounded-md border border-line bg-surface-2 p-2">
          {proposed.map((t, i) => (
            <button
              key={i}
              onClick={() => setProposed((p) => p!.map((x, j) => (j === i ? { ...x, included: !x.included } : x)))}
              className="fast flex w-full items-center gap-2 text-left text-label"
            >
              <span
                className="mono flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border text-micro"
                style={{ borderColor: t.included ? "var(--accent)" : "var(--line)", background: t.included ? "var(--accent)" : "transparent", color: "#fff" }}
              >
                {t.included ? "✓" : ""}
              </span>
              <span className={`min-w-0 flex-1 truncate ${t.included ? "" : "text-muted line-through"}`}>{t.title}</span>
              <span className="mono shrink-0 text-micro text-muted">{ENERGY_META[t.energy]?.icon ?? "·"} {t.durationMins}m</span>
            </button>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <Btn kind="primary" onClick={() => void addProposed()}>add to the week</Btn>
            <button onClick={() => setProposed(null)} className="fast mono text-meta text-muted hover:text-ink">discard</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Optional anchor — link an EXISTING initiative or project (its work counts toward
 *  the rock). Defaults to none: a wrong tie is worse than no tie. */
function AnchorPicker({ data, rock, onUpdate }: { data: VerticalData; rock: BigRock; onUpdate: (patch: Partial<Omit<BigRock, "id">>) => void }) {
  const inits = data.initiatives.filter((i) => isOpenStatus(i.status));
  const projs = data.projects.filter((p) => p.status !== "complete" && p.status !== "cancelled");
  const value = rock.project_id ? `p:${rock.project_id}` : rock.initiative_id ? `i:${rock.initiative_id}` : "";
  const onChange = (v: string) => {
    if (!v) onUpdate({ initiative_id: null, project_id: null });
    else if (v.startsWith("p:")) onUpdate({ project_id: v.slice(2), initiative_id: null });
    else onUpdate({ initiative_id: v.slice(2), project_id: null });
  };
  const color = rockColor(data, rock);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color ?? "var(--line)" }} />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-[200px] cursor-pointer truncate rounded-md border border-line bg-surface px-2.5 py-1.5 text-body text-muted outline-none hover:border-line-strong focus:border-accent"
        title="Link an existing initiative or project (optional)"
      >
        <option value="">not linked</option>
        {inits.length > 0 && (
          <optgroup label="Initiatives">
            {inits.map((i) => <option key={i.id} value={`i:${i.id}`}>{i.name}</option>)}
          </optgroup>
        )}
        {projs.length > 0 && (
          <optgroup label="Projects">
            {projs.map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}
          </optgroup>
        )}
      </select>
    </span>
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
        style={{ borderColor: done ? "var(--accent)" : "var(--line)", background: done ? "var(--accent)" : "transparent", color: "#fff" }}
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
  const { data, toggleBigRockDone } = useVertical();
  const rocks = data.bigRocks.filter((r) => r.title.trim());
  if (rocks.length === 0) return null;

  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line pb-4">
      <span className="section-label shrink-0">This week</span>
      {rocks.map((rock) => (
        <RockChip key={rock.id} rock={rock} data={data} onToggle={() => toggleBigRockDone(rock.id)} />
      ))}
    </div>
  );
}

// ── the Schedule bar — the week's plan, docked above the calendar ────────────
const BAR_KEY = "nuvo.schedule.bigrocks.open";

export function BigRocksBar() {
  const { data, toggleBigRockDone } = useVertical();
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(BAR_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(BAR_KEY, open ? "1" : "0"); } catch { /* ignore */ }
  }, [open]);

  const rocks = data.bigRocks.filter((r) => r.title.trim());

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
                  <RockChip key={rock.id} rock={rock} data={data} onToggle={() => toggleBigRockDone(rock.id)} />
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
  const rocks = data.bigRocks.filter((r) => r.title.trim());
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
