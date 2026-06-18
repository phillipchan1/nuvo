// Tending — the grooming ritual. One altitude-aware session that ripens the
// few projects / initiatives most worth attention: Nuvo DRAFTS, you REACT
// (take · reshape · rest). It unifies the old Blueprint + Scaffold flows behind
// one contract — keep your work groomed and the time layer takes it from there.
//
// Three stations on the FlowShell canvas (the Summit/Sunday idiom):
//   1 · The Reading — the survey: readiness + the ~3 to tend + the two failure
//       modes (raw, silent).
//   2 · Tending — the queue, one card at a time. The advance per stage:
//       raw → draft the outcome · shaped → scaffold a path · scaffolded → set a
//       finish line / pull to the week.
//   3 · The Yield — the payoff: stages advanced, the readiness meter rising, and
//       the unlock into the time layer.

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useVertical, type InitiativeSubtree } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { supabase } from "../../lib/supabase";
import { ASSISTANT_NAME } from "../../lib/assistant";
import { ENERGY_META, type Energy } from "../../lib/energy";
import {
  domainById,
  initiativeById,
  projectById,
  type VerticalData,
} from "../../lib/vertical";
import {
  RIPENESS_ADVANCE,
  RIPENESS_HINT,
  RIPENESS_LABEL,
  portfolioReadiness,
  readTending,
  ripenessOfInitiative,
  ripenessOfProject,
  type GroomCandidate,
  type RipenessRead,
} from "../../lib/tending";
import { InlineDate, RipenessPip } from "../floors/parts";
import FlowShell, { type FlowStage } from "./FlowShell";
import { Btn } from "../ui";

// ── live ripeness of a candidate, re-read from the (changing) store ──────────
function liveRipeness(data: VerticalData, c: GroomCandidate): RipenessRead | null {
  if (c.kind === "project") {
    const p = projectById(data, c.id);
    return p ? ripenessOfProject(data, p) : null;
  }
  const i = initiativeById(data, c.id);
  return i ? ripenessOfInitiative(data, i) : null;
}

const accentOf = (data: VerticalData, c: GroomCandidate) =>
  domainById(data, c.domainId)?.color ?? "var(--accent)";

// ── draft shapes (the reviewable diffs, with an include toggle) ──────────────
type TaskDraft = { title: string; energy: Energy | null; durationMins: number; rationale?: string; on: boolean };
type KrDraft = { name: string; baseline: number; target: number; unit: string; on: boolean };
type ProjDraft = { name: string; outcome: string; tasks: { title: string; energy: Energy | null; durationMins: number }[]; on: boolean };

export default function TendingFlow({
  step,
  setStep,
  onClose,
  onOpenSunday,
  onStepBack,
}: {
  step: number;
  setStep: (s: number) => void;
  onClose: () => void;
  onOpenSunday: () => void;
  onStepBack?: () => void;
}) {
  const { data } = useVertical();

  // Freeze the walk-list + the starting picture once, so items don't fall out of
  // the queue as they ripen and the Yield can measure real movement.
  const [reading] = useState(() => readTending(data));
  const [startReadiness] = useState(() => reading.readiness);
  const [startScores] = useState<Record<string, number>>(() =>
    Object.fromEntries(reading.queue.map((c) => [c.id, c.ripeness.score])),
  );
  const [idx, setIdx] = useState(0);

  const queue = reading.queue;
  const total = queue.length;
  const done = idx >= total;

  // session yield, measured live against the frozen start
  const advances = queue
    .map((c) => {
      const now = liveRipeness(data, c)?.score ?? startScores[c.id];
      return { c, from: startScores[c.id], to: now };
    })
    .filter((a) => a.to > a.from);
  const stagesAdvanced = advances.reduce((s, a) => s + (a.to - a.from), 0);
  const liveReadiness = portfolioReadiness(data);

  const stages: FlowStage[] = [
    {
      id: "reading",
      label: "The Reading",
      value: total ? `${total} to tend` : "all tended",
      body: <ReadingStep data={data} reading={reading} onBegin={() => setStep(1)} />,
    },
    {
      id: "tending",
      label: "Tending",
      value: total ? `${Math.min(idx + (done ? 0 : 1), total)}/${total}` : "—",
      body: (
        <TendingStep
          data={data}
          queue={queue}
          idx={idx}
          onAdvance={() => setIdx((i) => i + 1)}
          onJumpYield={() => setStep(2)}
        />
      ),
    },
    {
      id: "yield",
      label: "The Yield",
      value: `+${stagesAdvanced}`,
      body: (
        <YieldStep
          data={data}
          advances={advances}
          stagesAdvanced={stagesAdvanced}
          fromReadiness={startReadiness}
          toReadiness={liveReadiness}
        />
      ),
    },
  ];

  const openCount = data.projects.length + data.initiatives.length;

  return (
    <FlowShell
      title="Tending"
      sub="ripen what's ready"
      inputs={{ label: "the portfolio", value: `${openCount} items` }}
      output={{
        label: "ready for time",
        value: step === 2 ? `+${stagesAdvanced} stages` : `${liveReadiness}%`,
        reached: step === 2,
      }}
      stages={stages}
      step={step}
      setStep={setStep}
      onStepBack={onStepBack}
      lastCta={{ label: "Plan the week →", onClick: () => { onClose(); onOpenSunday(); } }}
      onClose={onClose}
    />
  );
}

// ── 1 · The Reading ──────────────────────────────────────────────────────────
function ReadingStep({
  data,
  reading,
  onBegin,
}: {
  data: VerticalData;
  reading: ReturnType<typeof readTending>;
  onBegin: () => void;
}) {
  const { queue, silent, raw, readiness } = reading;
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-display masthead">What's ready to ripen</h1>
        <p className="mt-1 max-w-[680px] text-body text-muted">
          Not the whole backlog — just the few that most warrant a moment. {ASSISTANT_NAME} drafts,
          you react. Take it, reshape it, or let it rest.
        </p>
      </div>

      {/* readiness meter */}
      <div className="mb-7 max-w-[520px]">
        <div className="flex items-baseline justify-between">
          <span className="section-label">Portfolio readiness</span>
          <span className="mono text-label" style={{ color: "var(--accent)" }}>{readiness}%</span>
        </div>
        <div className="relative mt-1.5 h-2.5 rounded-full" style={{ background: "var(--line)" }}>
          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${readiness}%`, background: "var(--accent)" }} />
        </div>
      </div>

      {/* the ~3 to tend */}
      <section className="mb-7">
        <div className="section-label mb-2">Up for tending · {queue.length}</div>
        {queue.length === 0 ? (
          <div className="rounded-md border border-dashed border-line p-6 text-center text-caption text-muted">
            Nothing needs grooming right now — every open item has an outcome and a path. Come back when you've captured something new.
          </div>
        ) : (
          <div className="space-y-1.5">
            {queue.map((c) => <ReadingRow key={c.id} data={data} c={c} />)}
          </div>
        )}
      </section>

      {(raw.length > 0 || silent.length > 0) && (
        <section className="mb-7 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {raw.length > 0 && (
            <div>
              <div className="section-label mb-2">Raw · {raw.length} need an outcome</div>
              <div className="space-y-1.5">{raw.slice(0, 5).map((c) => <ReadingRow key={c.id} data={data} c={c} quiet />)}</div>
            </div>
          )}
          {silent.length > 0 && (
            <div>
              <div className="section-label mb-2">Silent · {silent.length} gone quiet</div>
              <div className="space-y-1.5">{silent.slice(0, 5).map((c) => <ReadingRow key={c.id} data={data} c={c} quiet />)}</div>
            </div>
          )}
        </section>
      )}

      {queue.length > 0 && <Btn kind="primary" onClick={onBegin}>Begin tending →</Btn>}
    </div>
  );
}

function ReadingRow({ data, c, quiet }: { data: VerticalData; c: GroomCandidate; quiet?: boolean }) {
  const accent = accentOf(data, c);
  return (
    <div className="flex items-center gap-3 rounded-md border border-line bg-surface px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent }} />
      <RipenessPip stage={c.ripeness.stage} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-body font-medium">{c.name}</div>
        <div className="mono truncate text-micro text-muted">
          {c.kind} · {RIPENESS_ADVANCE[c.ripeness.stage]}
        </div>
      </div>
      {!quiet && c.reasons.length > 0 && (
        <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
          {c.reasons.slice(0, 2).map((r, i) => (
            <span key={i} className="mono rounded-full border border-line px-1.5 py-0.5 text-micro text-muted">{r}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 2 · Tending — the queue, one card at a time ──────────────────────────────
function TendingStep({
  data,
  queue,
  idx,
  onAdvance,
  onJumpYield,
}: {
  data: VerticalData;
  queue: GroomCandidate[];
  idx: number;
  onAdvance: () => void;
  onJumpYield: () => void;
}) {
  if (queue.length === 0) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-center">
        <div className="max-w-[420px] text-body text-muted">Nothing in the queue — head to the yield to see where the portfolio stands.</div>
      </div>
    );
  }
  if (idx >= queue.length) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center text-center">
        <div className="text-display masthead">All tended.</div>
        <p className="mt-2 max-w-[420px] text-body text-muted">You've worked through everything up for grooming this session.</p>
        <div className="mt-6"><Btn kind="primary" onClick={onJumpYield}>See your yield →</Btn></div>
      </div>
    );
  }
  const c = queue[idx];
  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <span className="section-label">Tending · {idx + 1} of {queue.length}</span>
        <div className="flex gap-1">
          {queue.map((_, i) => (
            <span key={i} className="h-1.5 w-6 rounded-full" style={{ background: i < idx ? "var(--accent)" : i === idx ? "var(--accent-soft)" : "var(--line)" }} />
          ))}
        </div>
      </div>
      {/* key by id so each item gets a fresh card (its own draft state) */}
      <TendCard key={c.id} data={data} c={c} onAdvance={onAdvance} onJumpYield={onJumpYield} last={idx === queue.length - 1} />
    </div>
  );
}

function TendCard({
  data,
  c,
  onAdvance,
  onJumpYield,
  last,
}: {
  data: VerticalData;
  c: GroomCandidate;
  onAdvance: () => void;
  onJumpYield: () => void;
  last: boolean;
}) {
  const store = useVertical();
  const { toggleAgent } = useAppNavigation();
  const accent = accentOf(data, c);
  const ripe = liveRipeness(data, c) ?? c.ripeness;

  const project = c.kind === "project" ? projectById(data, c.id) : null;
  const initiative = c.kind === "initiative" ? initiativeById(data, c.id) : null;
  const name = project?.name ?? initiative?.name ?? c.name;
  const outcome = project?.outcome ?? initiative?.outcome ?? "";

  // shared draft machinery
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [guidance, setGuidance] = useState("");

  // raw → shaped: an outcome draft
  const [outcomeDraft, setOutcomeDraft] = useState("");

  // shaped → scaffolded: a task / subtree proposal
  const [tasks, setTasks] = useState<TaskDraft[] | null>(null);
  const [krs, setKrs] = useState<KrDraft[] | null>(null);
  const [projs, setProjs] = useState<ProjDraft[] | null>(null);

  const fail = (e: unknown) => {
    console.warn("[tending] draft failed", e);
    setNote(`${ASSISTANT_NAME} couldn't draft that just now — write it yourself below, or try again.`);
  };

  const rest = async () => { await store.tend(c.kind, c.id, { rest: true }); onAdvance(); };
  const advanceTended = async () => { await store.tend(c.kind, c.id); onAdvance(); };

  // ── drafters ───────────────────────────────────────────────────────────────
  const draftOutcome = async () => {
    setBusy(true); setNote(null);
    try {
      const { data: res, error } = await supabase.functions.invoke("agent", {
        body: { draftOutcome: { kind: c.kind, id: c.id, guidance: guidance.trim() || undefined } },
      });
      if (error) throw error;
      setOutcomeDraft(String(res?.outcome ?? "").trim());
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const scaffold = async () => {
    setBusy(true); setNote(null);
    try {
      if (c.kind === "project") {
        const { data: res, error } = await supabase.functions.invoke("agent", {
          body: { scaffold: { projectId: c.id, guidance: guidance.trim() || undefined } },
        });
        if (error) throw error;
        const drafts = (res?.tasks ?? []) as { title: string; energy: Energy | null; durationMins: number; rationale?: string }[];
        if (!drafts.length) setNote("Nothing to add — this one already has a path.");
        setTasks(drafts.map((d) => ({ ...d, on: true })));
      } else {
        const { data: res, error } = await supabase.functions.invoke("agent", {
          body: { blueprint: { name, outcome, domainId: c.domainId, guidance: guidance.trim() || undefined } },
        });
        if (error) throw error;
        setKrs((res?.keyResults ?? []).map((k: { name: string; baseline: number; target: number; unit: string }) => ({ ...k, on: true })));
        setProjs((res?.projects ?? []).map((p: { name: string; outcome: string; tasks: { title: string; energy: Energy | null; durationMins: number }[] }) => ({ ...p, on: true })));
      }
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  // ── takers ──────────────────────────────────────────────────────────────────
  const takeOutcome = async () => {
    const v = outcomeDraft.trim();
    if (!v) return;
    if (c.kind === "project") store.updateProject(c.id, { outcome: v });
    else store.updateInitiative(c.id, { outcome: v });
    await store.tend(c.kind, c.id);
    setNote("Outcome set — it's Shaped now.");
    onAdvance();
  };

  const takeScaffold = async () => {
    setBusy(true);
    try {
      if (c.kind === "project" && tasks) {
        const accepted = tasks.filter((t) => t.on);
        await store.addTasks(
          { projectId: c.id, initiativeId: project?.initiativeId ?? null, domainId: c.domainId },
          accepted.map((t) => ({ title: t.title, energy: t.energy, durationMins: t.durationMins })),
        );
      } else if (c.kind === "initiative") {
        const tree: InitiativeSubtree = {
          keyResults: (krs ?? []).filter((k) => k.on).map((k) => ({ name: k.name, baseline: k.baseline, target: k.target, unit: k.unit })),
          projects: (projs ?? []).filter((p) => p.on).map((p) => ({ name: p.name, outcome: p.outcome, tasks: p.tasks })),
        };
        await store.addInitiativeSubtree(c.id, tree);
      }
      await store.tend(c.kind, c.id);
      onAdvance();
    } catch (e) { fail(e); setBusy(false); }
  };

  const advanceCount =
    (tasks?.filter((t) => t.on).length ?? 0) +
    (krs?.filter((k) => k.on).length ?? 0) +
    (projs?.filter((p) => p.on).reduce((s, p) => s + 1 + p.tasks.length, 0) ?? 0);

  const NextLabel = last ? "Finish → the yield" : "Skip · next ↓";
  const onSkip = () => (last ? onJumpYield() : onAdvance());

  return (
    <div className="rounded-lg border bg-surface" style={{ borderColor: accent }}>
      {/* head */}
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: accent }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <RipenessPip stage={ripe.stage} />
            <span className="mono text-meta text-muted">{RIPENESS_LABEL[ripe.stage]} · {c.kind}</span>
          </div>
          <h2 className="mt-0.5 text-head font-semibold leading-snug">{name}</h2>
          {outcome && <div className="mt-0.5 text-caption text-muted">{outcome}</div>}
        </div>
        <span className="mono shrink-0 rounded-full border border-line px-2 py-0.5 text-micro text-muted" title={RIPENESS_HINT[ripe.stage]}>
          {RIPENESS_ADVANCE[ripe.stage]}
        </span>
      </div>

      {/* body — the advance for this stage */}
      <div className="px-5 py-4">
        {ripe.stage === "raw" && (
          <RawBody
            busy={busy}
            draft={outcomeDraft}
            setDraft={setOutcomeDraft}
            onDraft={draftOutcome}
            onTake={takeOutcome}
          />
        )}

        {ripe.stage === "shaped" && (
          <ShapedBody
            kind={c.kind}
            accent={accent}
            busy={busy}
            tasks={tasks}
            setTasks={setTasks}
            krs={krs}
            setKrs={setKrs}
            projs={projs}
            setProjs={setProjs}
            onScaffold={scaffold}
            onTake={takeScaffold}
            count={advanceCount}
          />
        )}

        {ripe.stage === "scaffolded" && (
          <ScaffoldedBody
            kind={c.kind}
            targetDate={project?.targetDate ?? initiative?.targetDate ?? null}
            onSetDate={(v) => (c.kind === "project" ? store.updateProject(c.id, { targetDate: v }) : store.updateInitiative(c.id, { targetDate: v }))}
            onPullToWeek={c.kind === "project" ? () => { store.addProjectReadyToSprint(c.id); setNote("Pulled this project's open tasks into the week."); } : undefined}
            onDone={advanceTended}
          />
        )}

        {(ripe.stage === "active" || ripe.stage === "resting") && (
          <div className="text-caption text-muted">
            {ripe.stage === "active" ? "This one's moving — handed to the time layer." : "Resting."}
            <div className="mt-3"><Btn kind="primary" onClick={advanceTended}>Next ↓</Btn></div>
          </div>
        )}

        {note && <div className="mt-3 text-label text-muted">{note}</div>}

        {/* reshape — a one-line redirect, only meaningful once a draft exists */}
        {(ripe.stage === "raw" || ripe.stage === "shaped") && (
          <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
            <input
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && guidance.trim()) (ripe.stage === "raw" ? draftOutcome() : scaffold()); }}
              placeholder={`Reshape — tell ${ASSISTANT_NAME} what to change…`}
              className="min-w-0 flex-1 rounded-md border border-line bg-bg px-2.5 py-1.5 text-label outline-none placeholder:text-muted/60 focus:border-accent"
            />
            <Btn onClick={() => (ripe.stage === "raw" ? draftOutcome() : scaffold())} disabled={busy || !guidance.trim()}>↻ reshape</Btn>
          </div>
        )}
      </div>

      {/* foot — the universal reactions */}
      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        <button onClick={() => void rest()} className="fast mono text-label text-muted hover:text-ink" title="Park it as someday — out of the ladder until the Summit">
          ☾ not now · rest
        </button>
        <button onClick={toggleAgent} className="fast mono text-label text-muted hover:text-accent" title="Open Nuvo for a real back-and-forth">
          ✦ open in {ASSISTANT_NAME}
        </button>
        <div className="flex-1" />
        <button onClick={onSkip} className="fast mono text-label text-muted hover:text-ink">{NextLabel}</button>
      </div>
    </div>
  );
}

// ── stage bodies ─────────────────────────────────────────────────────────────
function RawBody({ busy, draft, setDraft, onDraft, onTake }: {
  busy: boolean; draft: string; setDraft: (v: string) => void; onDraft: () => void; onTake: () => void;
}) {
  return (
    <div>
      <div className="section-label mb-1.5">The outcome — what "done" looks like</div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Draft it with Nuvo, or write it yourself in one line…"
        rows={2}
        className="w-full resize-y rounded-md border border-line bg-bg px-3 py-2 text-body outline-none placeholder:text-muted/50 focus:border-accent"
      />
      <div className="mt-2.5 flex items-center gap-2">
        <Btn kind="signal" onClick={onDraft} disabled={busy}>{busy ? "✦ thinking…" : `✦ draft with ${ASSISTANT_NAME}`}</Btn>
        <Btn kind="primary" onClick={onTake} disabled={!draft.trim()}>Take it →</Btn>
      </div>
    </div>
  );
}

function ShapedBody({
  kind, accent, busy, tasks, setTasks, krs, setKrs, projs, setProjs, onScaffold, onTake, count,
}: {
  kind: "project" | "initiative";
  accent: string;
  busy: boolean;
  tasks: TaskDraft[] | null;
  setTasks: Dispatch<SetStateAction<TaskDraft[] | null>>;
  krs: KrDraft[] | null;
  setKrs: Dispatch<SetStateAction<KrDraft[] | null>>;
  projs: ProjDraft[] | null;
  setProjs: Dispatch<SetStateAction<ProjDraft[] | null>>;
  onScaffold: () => void;
  onTake: () => void;
  count: number;
}) {
  const drafted = tasks !== null || krs !== null || projs !== null;
  return (
    <div>
      {!drafted && (
        <div className="text-caption text-muted">
          {kind === "project"
            ? "An outcome with no path. Let Nuvo propose the ordered steps."
            : "A bet with no structure. Let Nuvo propose key results and the projects under it."}
        </div>
      )}

      {tasks && (
        <div className="space-y-1">
          {tasks.map((t, i) => (
            <ProposalRow key={i} accent={accent} on={t.on} onToggle={() => setTasks((p) => (p ?? []).map((x, j) => j === i ? { ...x, on: !x.on } : x))}
              icon={t.energy ? ENERGY_META[t.energy].icon : "·"} title={t.title} aside={`${t.durationMins}m`} sub={t.rationale} />
          ))}
          {tasks.length === 0 && <div className="text-caption text-muted italic">No tasks proposed.</div>}
        </div>
      )}

      {(krs || projs) && (
        <div className="space-y-4">
          {krs && krs.length > 0 && (
            <div>
              <div className="section-label mb-1.5">Key results</div>
              <div className="space-y-1">
                {krs.map((k, i) => (
                  <ProposalRow key={i} accent={accent} on={k.on} onToggle={() => setKrs((p) => (p ?? []).map((x, j) => j === i ? { ...x, on: !x.on } : x))}
                    title={k.name} aside={`${k.baseline} → ${k.target}${k.unit}`} />
                ))}
              </div>
            </div>
          )}
          {projs && projs.length > 0 && (
            <div>
              <div className="section-label mb-1.5">Projects, in order</div>
              <div className="space-y-2">
                {projs.map((p, i) => (
                  <div key={i} className="rounded-md border border-line" style={{ opacity: p.on ? 1 : 0.5 }}>
                    <div className="flex items-center gap-2.5 border-b border-line px-2.5 py-1.5">
                      <Include on={p.on} accent={accent} onToggle={() => setProjs((prev) => (prev ?? []).map((x, j) => j === i ? { ...x, on: !x.on } : x))} />
                      <span className="text-caption font-medium">{p.name}</span>
                      <span className="mono ml-auto hidden truncate text-micro text-muted sm:inline" style={{ maxWidth: 280 }}>{p.outcome}</span>
                    </div>
                    <div className="px-2.5 py-1">
                      {p.tasks.map((t, ti) => (
                        <div key={ti} className="flex items-center gap-2 border-b border-line py-1 text-label last:border-0">
                          <span className="mono w-4 shrink-0 text-right text-micro text-muted">{String.fromCharCode(97 + ti)}</span>
                          <span className="shrink-0" style={{ color: accent }}>{t.energy ? ENERGY_META[t.energy].icon : "·"}</span>
                          <span className="min-w-0 flex-1 truncate">{t.title}</span>
                          <span className="mono shrink-0 text-micro text-muted">{t.durationMins}m</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Btn kind="signal" onClick={onScaffold} disabled={busy}>{busy ? "✦ thinking…" : drafted ? "✦ redraft" : `✦ scaffold with ${ASSISTANT_NAME}`}</Btn>
        {drafted && <Btn kind="primary" onClick={onTake} disabled={busy || count === 0}>Take {count} →</Btn>}
      </div>
    </div>
  );
}

function ScaffoldedBody({ kind, targetDate, onSetDate, onPullToWeek, onDone }: {
  kind: "project" | "initiative";
  targetDate: string | null;
  onSetDate: (v: string | null) => void;
  onPullToWeek?: () => void;
  onDone: () => void;
}) {
  return (
    <div>
      <div className="text-caption text-muted">
        It has a next action — give it a finish line {kind === "project" ? "or pull it into the week" : ""} so the time layer can watch it.
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="mono flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-label">
          finish line <InlineDate value={targetDate} onChange={onSetDate} />
        </span>
        {onPullToWeek && <Btn onClick={onPullToWeek}>★ pull to week</Btn>}
        <Btn kind="primary" onClick={onDone}>Done →</Btn>
      </div>
    </div>
  );
}

function ProposalRow({ accent, on, onToggle, icon, title, aside, sub }: {
  accent: string; on: boolean; onToggle: () => void; icon?: string; title: string; aside?: string; sub?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 border-b border-line py-1.5 last:border-0">
      <Include on={on} accent={accent} onToggle={onToggle} />
      {icon && <span className="shrink-0 text-label" style={{ color: accent }}>{icon}</span>}
      <span className={`min-w-0 flex-1 truncate text-caption ${on ? "" : "text-muted line-through"}`}>{title}</span>
      {sub && <span className="mono hidden max-w-[220px] shrink-0 truncate text-micro text-muted lg:inline" title={sub}>{sub}</span>}
      {aside && <span className="mono shrink-0 text-meta text-muted">{aside}</span>}
    </div>
  );
}

function Include({ on, accent, onToggle }: { on: boolean; accent: string; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="fast flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border text-micro"
      style={{ borderColor: on ? accent : "var(--line)", background: on ? accent : "transparent", color: "#fff" }}
    >
      {on ? "✓" : ""}
    </button>
  );
}

// ── 3 · The Yield ────────────────────────────────────────────────────────────
function YieldStep({
  data,
  advances,
  stagesAdvanced,
  fromReadiness,
  toReadiness,
}: {
  data: VerticalData;
  advances: { c: GroomCandidate; from: number; to: number }[];
  stagesAdvanced: number;
  fromReadiness: number;
  toReadiness: number;
}) {
  // items that reached a time-ready stage this session — the unlock
  const unlocked = advances.filter((a) => a.to >= 2);
  const items = advances.length;

  return (
    <div>
      <div className="mb-6">
        <span className="wordmark wordmark-grad text-body">{ASSISTANT_NAME}</span>
        <span className="mono ml-2 text-meta text-muted">the yield</span>
        <h1 className="mt-2 text-display masthead">
          {stagesAdvanced > 0 ? `You ripened ${items} ${items === 1 ? "item" : "items"}.` : "Nothing moved — and that's a fine call."}
        </h1>
        <p className="mt-1 max-w-[640px] text-head leading-relaxed text-ink/90">
          {stagesAdvanced > 0
            ? `+${stagesAdvanced} ${stagesAdvanced === 1 ? "stage" : "stages"} across ${items} ${items === 1 ? "item" : "items"}. The ones that crossed the line are ready for the time layer.`
            : "You looked, and decided to leave things where they are. The portfolio's still yours to come back to."}
        </p>
      </div>

      {/* the meter rising */}
      <div className="mb-8 max-w-[520px]">
        <div className="flex items-baseline justify-between">
          <span className="section-label">Portfolio readiness</span>
          <span className="mono text-label" style={{ color: "var(--accent)" }}>
            {fromReadiness}% → {toReadiness}%
          </span>
        </div>
        <ReadinessMeter from={fromReadiness} to={toReadiness} />
      </div>

      {/* the unlock */}
      {unlocked.length > 0 && (
        <section>
          <div className="section-label mb-2">Ready to place on the timeline · {unlocked.length}</div>
          <div className="space-y-1.5">
            {unlocked.map((a) => <UnlockRow key={a.c.id} data={data} c={a.c} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function UnlockRow({ data, c }: { data: VerticalData; c: GroomCandidate }) {
  const store = useVertical();
  const accent = accentOf(data, c);
  const project = c.kind === "project" ? projectById(data, c.id) : null;
  const initiative = c.kind === "initiative" ? initiativeById(data, c.id) : null;
  const targetDate = project?.targetDate ?? initiative?.targetDate ?? null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent }} />
      <span className="min-w-0 flex-1 truncate text-body font-medium">{project?.name ?? initiative?.name ?? c.name}</span>
      <span className="mono flex items-center gap-1.5 text-label text-muted">
        finish line <InlineDate value={targetDate} onChange={(v) => (c.kind === "project" ? store.updateProject(c.id, { targetDate: v }) : store.updateInitiative(c.id, { targetDate: v }))} />
      </span>
      {c.kind === "project" && <Btn onClick={() => store.addProjectReadyToSprint(c.id)}>★ pull to week</Btn>}
    </div>
  );
}

function ReadinessMeter({ from, to }: { from: number; to: number }) {
  const [w, setW] = useState(from);
  useEffect(() => {
    const t = setTimeout(() => setW(to), 150);
    return () => clearTimeout(t);
  }, [to]);
  return (
    <div className="relative mt-1.5 h-2.5 rounded-full" style={{ background: "var(--line)" }}>
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${w}%`, background: "var(--accent)", transition: "width 1.1s var(--ease-out)" }} />
    </div>
  );
}
