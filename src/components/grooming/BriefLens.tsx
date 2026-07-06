// The Brief lens — grooming the WHAT as a document, not cards
// (docs/grooming-lenses.md §5). One item's scope / non-goals / acceptance as
// calm prose on the paper: AI drafts every section (via lib/draftBrief — the
// deployed chat endpoint, no new edge), then interrogates; the human only
// adjudicates — Accept (1 tap) · edit inline · dismiss. Closes the DEFINED
// axis: outcome + scope + done-when + a finish line.
//
// Warm Paper: masthead item name, hairline-separated section rows, proposals as
// dashed accent rows, the interrogation as a soft tonal block. Single column at
// every width; every action is a ≥44px tap.

import { useEffect, useRef, useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import { ASSISTANT_NAME } from "../../lib/assistant";
import { draftBrief, type BriefAnswer } from "../../lib/draftBrief";
import { proposeDueISO } from "../../lib/refine";
import { briefHasSubstance } from "../../lib/lenses";
import {
  domainById,
  EMPTY_BRIEF,
  type Initiative,
  type ItemBrief,
  type Project,
  type SoundnessVerdict,
  type VerticalData,
} from "../../lib/vertical";

type Kind = "project" | "initiative";
type Section = "scope" | "nonGoals" | "doneWhen" | "constraints";

const SECTIONS: { key: Section; label: string; hint: string }[] = [
  { key: "scope", label: "In scope", hint: "what this includes" },
  { key: "nonGoals", label: "Out of scope", hint: "explicitly not this time" },
  { key: "doneWhen", label: "Done when", hint: "how you'll know it's finished" },
  { key: "constraints", label: "Constraints", hint: "what bounds the work" },
];

const norm = (s: string) => s.trim().toLowerCase();

export default function BriefLens({
  data, kind, item, verdict, onDone, doneLabel,
}: {
  data: VerticalData;
  kind: Kind;
  item: Project | Initiative;
  verdict: SoundnessVerdict | null;
  onDone: () => void;
  doneLabel: string;
}) {
  const store = useVertical();
  const accent = domainById(data, item.domainId)?.color ?? "var(--accent)";
  const update = (patch: Partial<Project> & Partial<Initiative>) =>
    kind === "project" ? store.updateProject(item.id, patch) : store.updateInitiative(item.id, patch);

  // ── the document (accepted) + the AI's pending proposal ─────────────────────
  const [brief, setBrief] = useState<ItemBrief>(item.brief ?? EMPTY_BRIEF);
  const briefRef = useRef(brief);
  briefRef.current = brief;
  const persist = (next: ItemBrief) => {
    setBrief(next);
    update({ brief: next });
  };

  const [proposal, setProposal] = useState<ItemBrief | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const answers = useRef<BriefAnswer[]>([]);
  const dismissedQs = useRef<Set<string>>(new Set());

  const [outcome, setOutcome] = useState(item.outcome);
  const [proposedOutcome, setProposedOutcome] = useState<string | null>(
    verdict?.outcome.suggestion?.trim() && verdict.outcome.suggestion.trim() !== item.outcome.trim()
      ? verdict.outcome.suggestion.trim()
      : null,
  );
  const [due, setDueState] = useState(item.targetDate ?? "");
  const setDue = (v: string) => {
    setDueState(v);
    update({ targetDate: v || null });
  };

  const runDraft = async (withAnswers: boolean) => {
    setDrafting(true);
    setAiNote(null);
    try {
      const res = await draftBrief({
        d: data, kind, item,
        current: withAnswers ? briefRef.current : item.brief,
        answers: withAnswers ? answers.current : [],
      });
      const cur = briefRef.current;
      const have = (sec: Section) => new Set(cur[sec].map(norm));
      const fresh: ItemBrief = {
        scope: res.brief.scope.filter((l) => !have("scope").has(norm(l))),
        nonGoals: res.brief.nonGoals.filter((l) => !have("nonGoals").has(norm(l))),
        doneWhen: res.brief.doneWhen.filter((l) => !have("doneWhen").has(norm(l))),
        constraints: res.brief.constraints.filter((l) => !have("constraints").has(norm(l))),
        openQuestions: res.brief.openQuestions.filter(
          (q) =>
            !dismissedQs.current.has(norm(q)) &&
            !answers.current.some((a) => norm(a.question) === norm(q)),
        ),
      };
      setProposal(fresh);
      // open questions live on the document so a half-done interrogation survives
      persist({ ...briefRef.current, openQuestions: fresh.openQuestions });
      if (res.outcome && !outcome.trim()) setProposedOutcome(res.outcome);
    } catch (e) {
      console.warn("[brief] draft failed", e);
      setAiNote(`Couldn't reach ${ASSISTANT_NAME} — the brief still works by hand.`);
    } finally {
      setDrafting(false);
    }
  };

  // Opens pre-filled: one draft per item visit.
  const drafted = useRef(false);
  useEffect(() => {
    if (drafted.current) return;
    drafted.current = true;
    void runDraft(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // ── adjudication ────────────────────────────────────────────────────────────
  const acceptLine = (sec: Section, idx: number) => {
    if (!proposal) return;
    const line = proposal[sec][idx];
    setProposal({ ...proposal, [sec]: proposal[sec].filter((_, i) => i !== idx) });
    persist({ ...brief, [sec]: [...brief[sec], line] });
  };
  const dismissLine = (sec: Section, idx: number) => {
    if (!proposal) return;
    setProposal({ ...proposal, [sec]: proposal[sec].filter((_, i) => i !== idx) });
  };
  const acceptAll = () => {
    if (!proposal) return;
    persist({
      ...brief,
      scope: [...brief.scope, ...proposal.scope],
      nonGoals: [...brief.nonGoals, ...proposal.nonGoals],
      doneWhen: [...brief.doneWhen, ...proposal.doneWhen],
      constraints: [...brief.constraints, ...proposal.constraints],
    });
    setProposal({ ...EMPTY_BRIEF, openQuestions: proposal.openQuestions });
  };
  const editLine = (sec: Section, idx: number, text: string) => {
    const v = text.trim();
    const next = v
      ? brief[sec].map((l, i) => (i === idx ? v : l))
      : brief[sec].filter((_, i) => i !== idx);
    persist({ ...brief, [sec]: next });
  };
  const addLine = (sec: Section, text: string) => {
    const v = text.trim();
    if (!v) return;
    persist({ ...brief, [sec]: [...brief[sec], v] });
  };

  const openQuestions = proposal?.openQuestions ?? brief.openQuestions;
  const answerQuestion = (q: string, a: string) => {
    answers.current = [...answers.current, { question: q, answer: a.trim() }];
    const left = openQuestions.filter((x) => x !== q);
    if (proposal) setProposal({ ...proposal, openQuestions: left });
    persist({ ...briefRef.current, openQuestions: left });
    void runDraft(true); // the answer→brief loop: revise, don't silently mutate
  };
  const dismissQuestion = (q: string) => {
    dismissedQs.current.add(norm(q));
    const left = openQuestions.filter((x) => x !== q);
    if (proposal) setProposal({ ...proposal, openQuestions: left });
    persist({ ...briefRef.current, openQuestions: left });
  };

  // ── the Defined axis, live ──────────────────────────────────────────────────
  const checks = [
    { label: "Outcome", ok: outcome.trim() !== "" },
    { label: "Scope", ok: brief.scope.length > 0 },
    { label: "Done when", ok: brief.doneWhen.length > 0 },
    { label: "Finish line", ok: due !== "" },
  ];
  const defined = outcome.trim() !== "" && briefHasSubstance(brief) && due !== "";

  const pendingCount = proposal
    ? proposal.scope.length + proposal.nonGoals.length + proposal.doneWhen.length + proposal.constraints.length
    : 0;

  return (
    <div className="pt-3 pb-8">
      {/* masthead — the item, then the axis it closes */}
      <div className="section-label" style={{ color: "var(--accent)" }}>The Brief · what &amp; when done</div>
      <div className="mt-1 flex items-center gap-2.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent }} />
        <h1 className="min-w-0 text-lead masthead leading-tight">{item.name}</h1>
      </div>

      {/* Defined checklist — the axis, inspectable */}
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
        {defined && <span className="text-meta font-medium" style={{ color: "var(--accent)" }}>— defined</span>}
      </div>

      {/* outcome — the one-liner the document hangs off */}
      <div className="mt-5">
        <div className="section-label !px-0 !pb-1">Outcome</div>
        <textarea
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          onBlur={() => { if (outcome.trim() !== item.outcome.trim()) update({ outcome: outcome.trim() }); }}
          rows={2}
          placeholder="What does done look like, in one line?"
          className="w-full resize-none rounded-md border border-line bg-bg/40 px-3 py-2 text-body leading-relaxed outline-none focus:border-accent placeholder:text-muted/50"
        />
        {proposedOutcome && proposedOutcome !== outcome.trim() && (
          <ProposalRow
            accent={accent}
            text={proposedOutcome}
            onAccept={() => {
              setOutcome(proposedOutcome);
              update({ outcome: proposedOutcome });
              setProposedOutcome(null);
            }}
            onDismiss={() => setProposedOutcome(null)}
          />
        )}
      </div>

      {/* finish line */}
      <div className="mt-4">
        <div className="section-label !px-0 !pb-1">Finish line</div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="tap rounded-md border border-line bg-bg/40 px-3 py-2 text-body outline-none focus:border-accent"
          />
          {!due && (
            <button
              onClick={() => setDue(proposeDueISO())}
              className="tap fast rounded-md border border-dashed px-3 py-2 text-caption text-muted hover:text-ink"
              style={{ borderColor: `color-mix(in srgb, ${accent} 45%, var(--line))` }}
            >
              ✦ suggest {fmtDate(proposeDueISO())}
            </button>
          )}
        </div>
      </div>

      {/* drafting state / accept-all */}
      <div className="mt-6 flex items-center justify-between gap-3">
        <div className="text-caption text-muted">
          {drafting
            ? <span>✦ {ASSISTANT_NAME} is drafting…</span>
            : aiNote ?? (pendingCount > 0 ? `${pendingCount} suggested line${pendingCount === 1 ? "" : "s"} to adjudicate` : null)}
        </div>
        {pendingCount > 0 && !drafting && (
          <button onClick={acceptAll} className="tap fast shrink-0 rounded-md border border-line px-3 py-1.5 text-caption font-medium hover:border-line-strong" style={{ color: accent }}>
            Accept all
          </button>
        )}
      </div>

      {/* the document */}
      <div className="mt-2 space-y-5">
        {SECTIONS.map(({ key, label, hint }) => (
          <BriefSection
            key={key}
            label={label}
            hint={hint}
            accent={accent}
            accepted={brief[key]}
            proposed={proposal?.[key] ?? []}
            onAccept={(i) => acceptLine(key, i)}
            onDismiss={(i) => dismissLine(key, i)}
            onEdit={(i, v) => editLine(key, i, v)}
            onAdd={(v) => addLine(key, v)}
          />
        ))}
      </div>

      {/* the interrogation — Nuvo asks, you answer in plain text */}
      {openQuestions.length > 0 && (
        <div className="mt-6 rounded-lg px-4 py-3" style={{ background: "var(--accent-soft)" }}>
          <div className="section-label !p-0" style={{ color: "var(--accent)" }}>✦ {ASSISTANT_NAME} asks</div>
          <div className="mt-1 space-y-3">
            {openQuestions.map((q) => (
              <QuestionRow key={q} q={q} busy={drafting} onAnswer={(a) => answerQuestion(q, a)} onDismiss={() => dismissQuestion(q)} />
            ))}
          </div>
          <p className="mt-2 text-meta text-muted">Answering re-drafts the sections above — you accept the revisions.</p>
        </div>
      )}

      {/* the handoff */}
      <button
        onClick={onDone}
        className="tap fast mt-7 w-full rounded-xl py-3 text-body font-medium text-white active:scale-[.98]"
        style={{ background: "var(--accent)" }}
      >
        {doneLabel}
      </button>
    </div>
  );
}

// ── one section: accepted prose rows + proposed dashed rows + an add line ─────
function BriefSection({
  label, hint, accent, accepted, proposed, onAccept, onDismiss, onEdit, onAdd,
}: {
  label: string; hint: string; accent: string;
  accepted: string[]; proposed: string[];
  onAccept: (idx: number) => void; onDismiss: (idx: number) => void;
  onEdit: (idx: number, text: string) => void; onAdd: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <section>
      <div className="section-label flex items-baseline justify-between !px-0 !pb-1">
        <span>{label}</span>
        <span className="text-micro normal-case tracking-normal text-muted/70">{hint}</span>
      </div>
      <div>
        {accepted.map((line, i) => (
          <AcceptedLine key={`${i}:${line}`} text={line} onEdit={(v) => onEdit(i, v)} />
        ))}
        {proposed.map((line, i) => (
          <ProposalRow key={`p${i}:${line}`} accent={accent} text={line} onAccept={() => onAccept(i)} onDismiss={() => onDismiss(i)} />
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { onAdd(draft); setDraft(""); }
          }}
          onBlur={() => { if (draft.trim()) { onAdd(draft); setDraft(""); } }}
          placeholder={accepted.length || proposed.length ? "add a line…" : `write ${label.toLowerCase()}…`}
          className="w-full bg-transparent py-1.5 text-body outline-none placeholder:text-muted/40"
        />
      </div>
    </section>
  );
}

/** An accepted line — calm prose on a hairline; tap to edit in place. */
function AcceptedLine({ text, onEdit }: { text: string; onEdit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);
  const commit = () => { setEditing(false); if (value.trim() !== text) onEdit(value); };
  if (editing) {
    return (
      <div className="border-b border-line py-1">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setValue(text); setEditing(false); } }}
          autoFocus
          className="w-full bg-transparent py-1 text-body outline-none"
        />
      </div>
    );
  }
  return (
    <div className="group flex items-center gap-2 border-b border-line">
      <button onClick={() => { setValue(text); setEditing(true); }} className="tap fast min-w-0 flex-1 py-2 text-left text-body leading-relaxed text-ink/90">
        {text}
      </button>
      <button onClick={() => onEdit("")} className="tap fast shrink-0 px-1.5 text-meta text-muted/60 hover:text-signal" title="Remove">✕</button>
    </div>
  );
}

/** A drafted line awaiting the verdict — Accept (1 tap) or dismiss. */
function ProposalRow({ accent, text, onAccept, onDismiss }: { accent: string; text: string; onAccept: () => void; onDismiss: () => void }) {
  return (
    <div
      className="mt-1 flex items-center gap-2 rounded-md border border-dashed px-2.5 py-1"
      style={{ borderColor: `color-mix(in srgb, ${accent} 45%, var(--line))` }}
    >
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

function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
