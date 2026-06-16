// New project — the focused "moment" for starting a chunk of work. Pick where
// it lives (a domain, optionally nested under an initiative), name it, say what
// done looks like, draw a target. Then — the intelligence — hand the typed
// context to Nuvo to draft an ordered first backlog you can prune. One commit
// writes the project AND the accepted tasks (quiet in backlog until you pull
// them into a week). Nothing lands until you create.

import { useMemo, useRef, useState } from "react";
import { addDays, endOfQuarter, format } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import { supabase } from "../../lib/supabase";
import { ASSISTANT_NAME } from "../../lib/assistant";
import { ENERGY_META, type Energy } from "../../lib/energy";
import { fmtDate } from "./parts";
import { Field, MomentHeader, Pill } from "./createParts";
import { Modal } from "../ui";

interface DraftTask {
  title: string;
  energy: Energy | null;
  durationMins: number;
  rationale?: string;
  included: boolean;
}

export default function NewProject({
  onClose,
  onCreated,
  initialDomainId,
  initialInitiativeId,
  initialName,
}: {
  onClose: () => void;
  onCreated: (projectId: string) => void;
  initialDomainId?: string | null;
  initialInitiativeId?: string | null;
  /** Carried over when expanding from the fast composer. */
  initialName?: string;
}) {
  const { data, addProject, addTasks, addDomain } = useVertical();
  const domains = useMemo(() => [...data.domains].sort((a, b) => a.sort - b.sort), [data.domains]);

  const [domainId, setDomainId] = useState(initialDomainId || domains[0]?.id || "");
  const [initiativeId, setInitiativeId] = useState<string | null>(initialInitiativeId ?? null);
  const [name, setName] = useState(initialName ?? "");
  const [outcome, setOutcome] = useState("");
  const [description, setDescription] = useState("");
  const [finishLine, setFinishLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [proposal, setProposal] = useState<DraftTask[] | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  const domain = domains.find((d) => d.id === domainId);
  const accent = domain?.color ?? "var(--accent)";
  const canCreate = Boolean(domainId && name.trim());

  // initiatives in the chosen domain that can still take work
  const inits = useMemo(
    () => data.initiatives.filter((i) => i.domainId === domainId && i.status !== "shipped" && i.status !== "dropped"),
    [data.initiatives, domainId],
  );

  const pickDomain = (id: string) => {
    setDomainId(id);
    setInitiativeId(null); // an initiative belongs to a domain — drop a stale link
  };

  const today = useMemo(() => new Date(), []);
  const presets = useMemo(
    () => [
      { label: "2 weeks", iso: format(addDays(today, 14), "yyyy-MM-dd") },
      { label: "30 days", iso: format(addDays(today, 30), "yyyy-MM-dd") },
      { label: "Quarter end", iso: format(endOfQuarter(today), "yyyy-MM-dd") },
    ],
    [today],
  );
  const isCustom = finishLine != null && !presets.some((p) => p.iso === finishLine);
  const acceptCount = (proposal ?? []).filter((d) => d.included).length;

  const draftTasks = async () => {
    if (!name.trim()) {
      setError("Name the project first.");
      return;
    }
    setDrafting(true);
    setError(null);
    setAiNote(null);
    try {
      const { data: res, error: fnErr } = await supabase.functions.invoke("agent", {
        body: {
          scaffoldDraft: {
            name: name.trim(),
            outcome: outcome.trim(),
            description: description.trim(),
            initiativeId,
            domainId,
          },
        },
      });
      if (fnErr) throw fnErr;
      const drafts = (res?.tasks ?? []) as Omit<DraftTask, "included">[];
      if (!drafts.length) setAiNote(`${ASSISTANT_NAME} had nothing to add yet — say a bit more about the outcome.`);
      setProposal(drafts.map((d) => ({ ...d, included: true })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Drafting failed.");
    } finally {
      setDrafting(false);
    }
  };

  const submit = async () => {
    if (!canCreate || busy) return;
    setBusy(true);
    setError(null);
    try {
      const p = await addProject(domainId, initiativeId, {
        name: name.trim(),
        outcome: outcome.trim(),
        description: description.trim(),
        startDate: format(today, "yyyy-MM-dd"),
        targetDate: finishLine,
      });
      const accepted = (proposal ?? []).filter((d) => d.included);
      if (accepted.length) {
        await addTasks(
          { projectId: p.id, initiativeId, domainId },
          accepted.map((d) => ({ title: d.title, energy: d.energy, durationMins: d.durationMins })),
        );
      }
      onCreated(p.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the project.");
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || e.currentTarget.tagName === "INPUT")) {
      e.preventDefault();
      void submit();
    }
  };

  if (domains.length === 0) {
    return (
      <Modal onClose={onClose} width="max-w-[460px]">
        <div className="p-7 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-line text-[18px] text-muted">◇</div>
          <h2 className="text-[17px] font-semibold tracking-tight">Start with a domain</h2>
          <p className="mx-auto mt-1.5 max-w-[320px] text-[13px] leading-relaxed text-muted">
            Projects live inside a life domain. Create your first domain, then the work has somewhere to land.
          </p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <button onClick={onClose} className="fast rounded-md border border-line px-3 py-1.5 text-[12px] font-medium text-ink hover:border-line-strong hover:bg-surface-2">
              Not now
            </button>
            <button
              onClick={() => void addDomain().then(onClose)}
              className="fast rounded-md border border-accent bg-accent px-3 py-1.5 text-[12px] font-medium text-white shadow-sm hover:brightness-110 active:translate-y-px"
            >
              Create a domain →
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} width="max-w-[560px]">
      <MomentHeader accent={accent} icon={domain?.icon ?? "◆"} eyebrow="New project" title="A chunk of work with its own tasks" onClose={onClose} />

      <div className="px-6 py-5">
        {/* where it lives — domain, then optionally an initiative within it */}
        <Field label="Domain">
          <div className="flex flex-wrap gap-1.5">
            {domains.map((d) => (
              <Pill key={d.id} active={d.id === domainId} accent={d.color} onClick={() => pickDomain(d.id)}>
                <span style={{ color: d.color }}>{d.icon}</span>
                {d.name}
              </Pill>
            ))}
          </div>
        </Field>

        <Field label="Initiative" className="mt-4">
          {inits.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              <Pill active={initiativeId === null} accent={accent} onClick={() => setInitiativeId(null)}>
                No initiative
              </Pill>
              {inits.map((i) => (
                <Pill key={i.id} active={initiativeId === i.id} accent={accent} onClick={() => setInitiativeId(i.id)}>
                  {i.name}
                </Pill>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-muted italic">
              No initiatives in {domain?.name ?? "this domain"} yet — it’ll sit loose under the domain.
            </p>
          )}
        </Field>

        {/* the project, named */}
        <div className="mt-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Name the project…"
            autoFocus
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-[16px] font-semibold outline-none transition placeholder:font-normal placeholder:text-muted/55"
            style={{ boxShadow: "inset 0 0 0 1px transparent" }}
            onFocus={(e) => (e.currentTarget.style.boxShadow = `0 0 0 3px ${accent}26, inset 0 0 0 1px ${accent}`)}
            onBlur={(e) => (e.currentTarget.style.boxShadow = "inset 0 0 0 1px transparent")}
          />
          <input
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="What does done look like, in one line?"
            className="mt-2 w-full rounded-md border border-line bg-surface px-3 py-2 text-[13px] outline-none transition placeholder:text-muted/60 focus:border-line-strong"
          />
        </div>

        {/* target — optional for a project, but a date sharpens it */}
        <Field label="Target" className="mt-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {presets.map((p) => (
              <Pill key={p.iso} active={finishLine === p.iso} accent={accent} onClick={() => setFinishLine(p.iso)}>
                {p.label}
              </Pill>
            ))}
            <span className="relative inline-flex">
              <Pill
                active={isCustom}
                accent={accent}
                onClick={() => {
                  const el = dateRef.current;
                  if (el) { try { el.showPicker(); } catch { el.focus(); } }
                }}
              >
                {isCustom ? fmtDate(finishLine!) : "Pick a date"}
              </Pill>
              <input
                ref={dateRef}
                type="date"
                value={finishLine ?? ""}
                onChange={(e) => setFinishLine(e.target.value || null)}
                className="pointer-events-none absolute left-0 h-0 w-0 opacity-0"
              />
            </span>
            {finishLine && (
              <button onClick={() => setFinishLine(null)} className="fast mono text-[11px] text-muted hover:text-signal" title="Clear the target">
                clear
              </button>
            )}
          </div>
        </Field>

        <Field label="Context" className="mt-4">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Optional — scope, what's in and out…"
            rows={2}
            className="w-full resize-y rounded-md border border-line bg-surface px-3 py-2 text-[12px] leading-relaxed text-muted outline-none transition placeholder:text-muted/50 focus:border-line-strong"
          />
        </Field>

        {/* the intelligence — draft the first tasks, prune before they land */}
        <div className="mt-4 rounded-md border border-dashed border-line p-3" style={{ borderColor: proposal ? accent : "var(--line)" }}>
          {!proposal && (
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => void draftTasks()}
                disabled={drafting || !name.trim()}
                className="fast flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium disabled:opacity-40"
                style={{ background: `${accent}1a`, color: accent }}
              >
                <span>✦</span>
                {drafting ? "drafting…" : `Draft the first tasks with ${ASSISTANT_NAME}`}
              </button>
              <span className="text-[11px] text-muted">optional — a starter backlog, yours to prune</span>
            </div>
          )}

          {proposal && (
            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="section-label" style={{ color: accent }}>✦ proposed backlog — uncheck what doesn’t fit</span>
                <span className="mono text-[10px] text-muted">{acceptCount}/{proposal.length} included</span>
              </div>
              <div>
                {proposal.map((d, i) => (
                  <div key={i} className="flex items-center gap-2.5 border-b border-line py-1.5 last:border-0">
                    <button
                      onClick={() => setProposal((p) => p!.map((x, j) => (j === i ? { ...x, included: !x.included } : x)))}
                      className="fast flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border text-[9px]"
                      style={{ borderColor: d.included ? accent : "var(--line)", background: d.included ? accent : "transparent", color: "#fff" }}
                    >
                      {d.included ? "✓" : ""}
                    </button>
                    <span className="shrink-0 text-[11px]" style={{ color: accent }}>{d.energy ? ENERGY_META[d.energy].icon : "·"}</span>
                    <span className={`min-w-0 flex-1 truncate text-[12px] ${d.included ? "" : "text-muted line-through"}`}>{d.title}</span>
                    {d.rationale && <span className="mono hidden max-w-[180px] shrink-0 truncate text-[9px] text-muted lg:inline" title={d.rationale}>{d.rationale}</span>}
                    <span className="mono shrink-0 text-[10px] text-muted">{d.durationMins}m</span>
                  </div>
                ))}
              </div>
              <button onClick={() => void draftTasks()} disabled={drafting} className="fast mono mt-2 text-[10px] text-muted hover:text-ink disabled:opacity-40">
                {drafting ? "reshaping…" : "↻ reshape"}
              </button>
            </div>
          )}
          {aiNote && <div className="mt-2 text-[11px] text-muted">{aiNote}</div>}
        </div>

        {error && <div className="mt-3 text-[12px] text-signal">{error}</div>}
      </div>

      <div className="flex items-center gap-2 border-t border-line bg-bg/40 px-6 py-3.5">
        <div className="flex-1" />
        <button onClick={onClose} className="fast rounded-md border border-line px-3 py-1.5 text-[12px] font-medium text-ink hover:border-line-strong hover:bg-surface-2">
          Cancel
        </button>
        <button
          onClick={() => void submit()}
          disabled={!canCreate || busy}
          className="fast rounded-md px-3.5 py-1.5 text-[12px] font-medium text-white shadow-sm transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: accent, boxShadow: canCreate ? `0 6px 16px -6px ${accent}` : "none" }}
        >
          {busy ? "Creating…" : acceptCount > 0 ? `Create project + ${acceptCount} task${acceptCount === 1 ? "" : "s"} →` : "Create project →"}
        </button>
      </div>
    </Modal>
  );
}
