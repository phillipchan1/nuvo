// The OKR lens — grooming a bet's PRIME property: its Objective (the outcome, one
// crisp line) and measurable Key Results. The sibling of the Brief lens: Nuvo
// drafts the objective + 2–4 results (via lib/draftOKRs — the deployed chat
// endpoint, no new edge), then interrogates whether they're the RIGHT measures;
// the human only adjudicates — Accept (1 tap) · edit inline · dismiss. Closes the
// MEASURED axis: an initiative isn't planned until it carries a number to move.
//
// Warm Paper: masthead item name, hairline-separated result rows, proposals as
// dashed accent rows, each KR framed baseline → current → target so you read the
// Gain. Single column at every width; every action is a ≥44px tap.

import { useEffect, useRef, useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import { ASSISTANT_NAME } from "../../lib/assistant";
import { draftOKRs, type DraftKR, type OKRAnswer } from "../../lib/draftOKRs";
import { proposeDueISO } from "../../lib/refine";
import {
  domainById,
  krCoverage,
  krPct,
  krStaleDays,
  KR_STALE_DAYS,
  type Initiative,
  type VerticalData,
} from "../../lib/vertical";
import { Bar, DeleteBtn, InlineNumber, InlineText } from "../floors/parts";

const norm = (s: string) => s.trim().toLowerCase();

export default function OKRLens({
  data, item, onDone, doneLabel,
}: {
  data: VerticalData;
  item: Initiative;
  onDone: () => void;
  doneLabel: string;
}) {
  const store = useVertical();
  const accent = domainById(data, item.domainId)?.color ?? "var(--accent)";
  const keyResults = item.keyResults; // live via props — reflects accepts/edits

  // objective (the O) — the outcome line, framed here as the bet's headline
  const [objective, setObjective] = useState(item.outcome);
  const [proposedObjective, setProposedObjective] = useState<string | null>(null);
  const commitObjective = () => {
    if (objective.trim() !== item.outcome.trim()) store.updateInitiative(item.id, { outcome: objective.trim() });
  };

  // finish line — an OKR with no deadline is a wish; offer to set one inline
  const [due, setDueState] = useState(item.targetDate ?? "");
  const setDue = (v: string) => { setDueState(v); store.updateInitiative(item.id, { targetDate: v || null }); };

  // ── the AI's pending key-result proposals + interrogation ───────────────────
  const [proposed, setProposed] = useState<DraftKR[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const answers = useRef<OKRAnswer[]>([]);
  const dismissedQs = useRef<Set<string>>(new Set());

  const liveItem = useRef(item);
  liveItem.current = item;

  const runDraft = async (withAnswers: boolean) => {
    setDrafting(true);
    setAiNote(null);
    try {
      const res = await draftOKRs({
        d: data,
        item: liveItem.current,
        answers: withAnswers ? answers.current : [],
      });
      const have = new Set(liveItem.current.keyResults.map((k) => norm(k.name)));
      setProposed((prev) => {
        const seen = new Set([...prev.map((k) => norm(k.name)), ...have]);
        const fresh = res.keyResults.filter((k) => !seen.has(norm(k.name)));
        return [...prev, ...fresh];
      });
      const freshQs = res.openQuestions.filter(
        (q) => !dismissedQs.current.has(norm(q)) && !answers.current.some((a) => norm(a.question) === norm(q)),
      );
      setQuestions(freshQs);
      if (res.objective && !objective.trim()) setProposedObjective(res.objective);
      else if (res.objective && norm(res.objective) !== norm(objective)) setProposedObjective(res.objective);
    } catch (e) {
      console.warn("[okr] draft failed", e);
      setAiNote(`Couldn't reach ${ASSISTANT_NAME} — set the key results by hand.`);
    } finally {
      setDrafting(false);
    }
  };

  const drafted = useRef(false);
  useEffect(() => {
    if (drafted.current) return;
    drafted.current = true;
    void runDraft(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // ── adjudication ────────────────────────────────────────────────────────────
  const acceptKR = (idx: number) => {
    const kr = proposed[idx];
    if (!kr) return;
    setProposed((p) => p.filter((_, i) => i !== idx));
    store.addKeyResult(item.id, kr);
  };
  const dismissKR = (idx: number) => setProposed((p) => p.filter((_, i) => i !== idx));
  const acceptAll = () => {
    proposed.forEach((kr) => store.addKeyResult(item.id, kr));
    setProposed([]);
  };
  const addBlank = () => store.addKeyResult(item.id);

  const answerQuestion = (q: string, a: string) => {
    answers.current = [...answers.current, { question: q, answer: a.trim() }];
    setQuestions((qs) => qs.filter((x) => x !== q));
    void runDraft(true);
  };
  const dismissQuestion = (q: string) => {
    dismissedQs.current.add(norm(q));
    setQuestions((qs) => qs.filter((x) => x !== q));
  };

  // ── the Measured axis, live ─────────────────────────────────────────────────
  const targeted = keyResults.length > 0 && keyResults.every((k) => k.target !== k.baseline);
  const checks = [
    { label: "Objective", ok: objective.trim() !== "" },
    { label: "Key results", ok: keyResults.length > 0 },
    { label: "Targets set", ok: targeted },
    { label: "Finish line", ok: due !== "" },
  ];
  const measured = objective.trim() !== "" && keyResults.length > 0;

  return (
    <div className="pt-3 pb-8">
      {/* masthead — the item, then the axis it closes */}
      <div className="section-label" style={{ color: "var(--accent)" }}>The OKRs · how you'll measure success</div>
      <div className="mt-1 flex items-center gap-2.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent }} />
        <h1 className="min-w-0 text-lead masthead leading-tight">{item.name}</h1>
      </div>

      {/* Measured checklist — the axis, inspectable */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {checks.map((c) => (
          <span
            key={c.label}
            className="rounded-full px-2 py-0.5 text-meta font-medium"
            style={
              c.ok
                ? { background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)" }
                : { border: "1px solid var(--line)", color: "var(--muted)" }
            }
          >
            {c.ok ? "✓ " : ""}{c.label}
          </span>
        ))}
        {measured && <span className="text-meta font-medium" style={{ color: "var(--accent)" }}>— measured</span>}
      </div>

      {/* the Objective */}
      <div className="mt-5">
        <div className="section-label !px-0 !pb-1">Objective</div>
        <textarea
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          onBlur={commitObjective}
          rows={2}
          placeholder="The outcome, in one crisp line — what success looks like."
          className="w-full resize-none rounded-md border border-line bg-bg/40 px-3 py-2 text-body leading-relaxed outline-none focus:border-accent placeholder:text-muted/50"
        />
        {proposedObjective && norm(proposedObjective) !== norm(objective) && (
          <ProposalRow
            accent={accent}
            text={proposedObjective}
            onAccept={() => {
              setObjective(proposedObjective);
              store.updateInitiative(item.id, { outcome: proposedObjective });
              setProposedObjective(null);
            }}
            onDismiss={() => setProposedObjective(null)}
          />
        )}
      </div>

      {/* drafting state / accept-all */}
      <div className="mt-6 flex items-center justify-between gap-3">
        <div className="text-caption text-muted">
          {drafting
            ? <span>✦ {ASSISTANT_NAME} is drafting key results…</span>
            : aiNote ?? (proposed.length > 0 ? `${proposed.length} suggested result${proposed.length === 1 ? "" : "s"} to adjudicate` : null)}
        </div>
        {proposed.length > 0 && !drafting && (
          <button onClick={acceptAll} className="tap fast shrink-0 rounded-md border border-line px-3 py-1.5 text-caption font-medium hover:border-line-strong" style={{ color: accent }}>
            Accept all
          </button>
        )}
      </div>

      {/* Key results — the prime property */}
      <div className="mt-2">
        <div className="section-label flex items-baseline justify-between !px-0 !pb-1">
          <span>Key results</span>
          <span className="text-micro normal-case tracking-normal text-muted/70">measurable — framed from a baseline</span>
        </div>

        <div className="space-y-3">
          {keyResults.map((kr) => {
            const cov = krCoverage(data, kr.id);
            const stale = krStaleDays(item);
            return (
              <div key={kr.id} className="group rounded-md border border-line bg-surface p-3">
                <div className="flex items-center gap-2">
                  <InlineText value={kr.name} onChange={(v) => store.updateKeyResult(item.id, kr.id, { name: v })} className="text-caption font-medium" />
                  <div className="ml-auto opacity-0 transition-opacity group-hover:opacity-100">
                    <DeleteBtn what="result" onDelete={() => store.deleteKeyResult(item.id, kr.id)} />
                  </div>
                </div>
                <div className="mono mt-1 flex items-center gap-1 text-meta text-muted">
                  <InlineNumber value={kr.baseline} onChange={(v) => store.updateKeyResult(item.id, kr.id, { baseline: v })} />
                  <span>→</span>
                  <span style={{ color: accent }}><InlineNumber value={kr.current} onChange={(v) => store.updateKeyResult(item.id, kr.id, { current: v })} /></span>
                  <span>→</span>
                  <InlineNumber value={kr.target} onChange={(v) => store.updateKeyResult(item.id, kr.id, { target: v })} />
                  <InlineText value={kr.unit} onChange={(v) => store.updateKeyResult(item.id, kr.id, { unit: v })} placeholder="unit" className="ml-1 w-10" />
                </div>
                <Bar pct={krPct(kr)} color={accent} />
                <div className="mono mt-1.5 flex flex-wrap items-center gap-x-2 text-micro text-muted">
                  {cov.covered ? (
                    <span title="Open work pointed at this key result.">
                      {cov.projects > 0 && `${cov.projects} project${cov.projects === 1 ? "" : "s"}`}
                      {cov.projects > 0 && cov.openTasks > 0 && " · "}
                      {cov.openTasks > 0 && `${cov.openTasks} task${cov.openTasks === 1 ? "" : "s"}`}
                      {" working it"}
                    </span>
                  ) : (
                    <span style={{ color: "var(--signal)" }} title="No project or task is pointed at this number yet.">
                      ⚠ nothing is moving this yet
                    </span>
                  )}
                  {stale != null && stale >= KR_STALE_DAYS && <span>· unmeasured {stale}d</span>}
                </div>
              </div>
            );
          })}

          {/* proposed key results — dashed accent rows, accept or dismiss */}
          {proposed.map((kr, i) => (
            <KRProposal key={`p${i}:${kr.name}`} accent={accent} kr={kr} onAccept={() => acceptKR(i)} onDismiss={() => dismissKR(i)} />
          ))}

          {keyResults.length === 0 && proposed.length === 0 && !drafting && (
            <div className="rounded-md border border-dashed border-line p-4 text-center text-label text-muted">
              No key results yet. Each is a measurable outcome — framed from a baseline so you read the Gain, not just the gap.
            </div>
          )}

          <button onClick={addBlank} className="tap fast mono text-label text-muted hover:text-ink">+ add a result by hand</button>
        </div>
      </div>

      {/* finish line — an OKR needs a deadline */}
      {!due && (
        <div className="mt-5">
          <div className="section-label !px-0 !pb-1">Finish line</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="tap rounded-md border border-line bg-bg/40 px-3 py-2 text-body outline-none focus:border-accent"
            />
            <button
              onClick={() => setDue(proposeDueISO())}
              className="tap fast rounded-md border border-dashed px-3 py-2 text-caption text-muted hover:text-ink"
              style={{ borderColor: `color-mix(in srgb, ${accent} 45%, var(--line))` }}
            >
              ✦ suggest a quarter's end
            </button>
          </div>
        </div>
      )}

      {/* the interrogation — Nuvo pressure-tests the measures */}
      {questions.length > 0 && (
        <div className="mt-6 rounded-lg px-4 py-3" style={{ background: "var(--accent-soft)" }}>
          <div className="section-label !p-0" style={{ color: "var(--accent)" }}>✦ {ASSISTANT_NAME} asks</div>
          <div className="mt-1 space-y-3">
            {questions.map((q) => (
              <QuestionRow key={q} q={q} busy={drafting} onAnswer={(a) => answerQuestion(q, a)} onDismiss={() => dismissQuestion(q)} />
            ))}
          </div>
          <p className="mt-2 text-meta text-muted">Answering re-drafts the key results — you accept the revisions.</p>
        </div>
      )}

      <button
        onClick={() => { commitObjective(); onDone(); }}
        className="tap fast mt-7 w-full rounded-xl py-3 text-body font-medium text-white active:scale-[.98]"
        style={{ background: "var(--accent)" }}
      >
        {doneLabel}
      </button>
    </div>
  );
}

// ── a proposed key result awaiting the verdict — the numbers shown up front ────
function KRProposal({ accent, kr, onAccept, onDismiss }: { accent: string; kr: DraftKR; onAccept: () => void; onDismiss: () => void }) {
  return (
    <div className="rounded-md border border-dashed p-3" style={{ borderColor: `color-mix(in srgb, ${accent} 45%, var(--line))` }}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-caption font-medium text-ink/85">{kr.name}</div>
          <div className="mono mt-0.5 text-meta text-muted">{kr.baseline} → {kr.target}{kr.unit}</div>
        </div>
        <button onClick={onAccept} className="tap fast shrink-0 rounded-md px-2.5 py-1 text-caption font-medium text-white active:scale-95" style={{ background: accent }}>✓</button>
        <button onClick={onDismiss} className="tap fast shrink-0 px-1.5 text-caption text-muted/70 hover:text-ink">✕</button>
      </div>
    </div>
  );
}

/** A drafted objective awaiting the verdict — Accept (1 tap) or dismiss. */
function ProposalRow({ accent, text, onAccept, onDismiss }: { accent: string; text: string; onAccept: () => void; onDismiss: () => void }) {
  return (
    <div className="mt-1 flex items-center gap-2 rounded-md border border-dashed px-2.5 py-1" style={{ borderColor: `color-mix(in srgb, ${accent} 45%, var(--line))` }}>
      <span className="min-w-0 flex-1 py-1 text-body leading-relaxed text-ink/80">{text}</span>
      <button onClick={onAccept} className="tap fast shrink-0 rounded-md px-2.5 py-1 text-caption font-medium text-white active:scale-95" style={{ background: accent }}>✓</button>
      <button onClick={onDismiss} className="tap fast shrink-0 px-1.5 text-caption text-muted/70 hover:text-ink">✕</button>
    </div>
  );
}

/** One interrogation question with a plain-text answer path (voice works). */
function QuestionRow({ q, busy, onAnswer, onDismiss }: { q: string; busy: boolean; onAnswer: (a: string) => void; onDismiss: () => void }) {
  const [a, setA] = useState("");
  const submit = () => { if (a.trim()) onAnswer(a); };
  return (
    <div>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-body leading-relaxed text-ink/90">{q}</p>
        <button onClick={onDismiss} className="tap fast shrink-0 px-1 text-meta text-muted/60 hover:text-ink" title="Dismiss the question">✕</button>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <input
          value={a}
          onChange={(e) => setA(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="answer in plain words…"
          className="min-w-0 flex-1 rounded-md border border-line bg-bg/60 px-3 py-2 text-body outline-none focus:border-accent placeholder:text-muted/45"
        />
        <button onClick={submit} disabled={!a.trim() || busy} className="tap fast shrink-0 rounded-md border border-line px-3 py-2 text-caption font-medium text-ink disabled:opacity-40">
          Answer
        </button>
      </div>
    </div>
  );
}
