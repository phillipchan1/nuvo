// New project — a composer, not a form. Type the name; context chips for
// domain / initiative / target live below the text. The intelligence starts
// drafting tasks as soon as there's something to work with — no button needed.
// ⏎ moves focus through title → outcome → creates.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import * as chrono from "chrono-node";
import { useVertical } from "../../hooks/useVertical";
import { supabase } from "../../lib/supabase";
import { ASSISTANT_NAME } from "../../lib/assistant";
import { ENERGY_META, type Energy } from "../../lib/energy";
import { isOpenStatus } from "../../lib/vertical";
import { fmtDate } from "./parts";
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
  const [finishLine, setFinishLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<DraftTask[] | null>(null);
  const [draftPhase, setDraftPhase] = useState<"idle" | "thinking" | "ready">("idle");
  // which chip row is expanded: "domain" | "initiative" | null
  const [expanding, setExpanding] = useState<"domain" | "initiative" | null>(null);

  const titleRef = useRef<HTMLInputElement>(null);
  const outcomeRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDraftKey = useRef("");

  const domain = domains.find((d) => d.id === domainId);
  const accent = domain?.color ?? "var(--accent)";
  const canCreate = Boolean(domainId && name.trim());

  const inits = useMemo(
    () => data.initiatives.filter((i) => i.domainId === domainId && isOpenStatus(i.status)),
    [data.initiatives, domainId],
  );
  const selectedInit = inits.find((i) => i.id === initiativeId) ?? null;

  const pickDomain = (id: string) => {
    setDomainId(id);
    setInitiativeId(null);
    setExpanding(null);
  };

  // Extract a target date from whatever the user typed in the title.
  const sniffDate = useCallback((text: string) => {
    const results = chrono.parse(text, new Date(), { forwardDate: true });
    if (results.length > 0) {
      setFinishLine(format(results[0].start.date(), "yyyy-MM-dd"));
    }
  }, []);

  const scheduleDraft = useCallback((nameVal: string, outcomeVal: string) => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    if (nameVal.trim().length < 4) return;
    draftTimer.current = setTimeout(async () => {
      const key = `${nameVal.trim()}|${outcomeVal.trim()}`;
      if (key === lastDraftKey.current) return;
      lastDraftKey.current = key;
      setDraftPhase("thinking");
      try {
        const { data: res, error: fnErr } = await supabase.functions.invoke("agent", {
          body: { scaffoldDraft: { name: nameVal.trim(), outcome: outcomeVal.trim(), initiativeId, domainId } },
        });
        if (fnErr) throw fnErr;
        const drafts = (res?.tasks ?? []) as Omit<DraftTask, "included">[];
        setProposal(drafts.map((d) => ({ ...d, included: true })));
        setDraftPhase("ready");
      } catch {
        setDraftPhase("idle");
        lastDraftKey.current = "";
      }
    }, 1500);
  }, [domainId, initiativeId]);

  useEffect(() => () => { if (draftTimer.current) clearTimeout(draftTimer.current); }, []);

  // Collapse chip picker when clicking elsewhere
  useEffect(() => {
    if (!expanding) return;
    const close = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest("[data-chip-picker]")) setExpanding(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [expanding]);

  const today = useMemo(() => new Date(), []);
  const acceptCount = (proposal ?? []).filter((d) => d.included).length;

  const submit = async () => {
    if (!canCreate || busy) return;
    setBusy(true);
    setError(null);
    try {
      const p = await addProject(domainId, initiativeId, {
        name: name.trim(),
        outcome: outcome.trim(),
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

  if (domains.length === 0) {
    return (
      <Modal onClose={onClose} width="max-w-[460px]">
        <div className="p-7 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-line text-lead text-muted">◇</div>
          <h2 className="text-lead font-semibold tracking-tight">Start with a domain</h2>
          <p className="mx-auto mt-1.5 max-w-[320px] text-body leading-relaxed text-muted">
            Projects live inside a life domain. Create your first domain, then the work has somewhere to land.
          </p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <button onClick={onClose} className="fast rounded-md border border-line px-3 py-1.5 text-caption font-medium text-ink hover:border-line-strong hover:bg-surface-2">Not now</button>
            <button onClick={() => void addDomain().then(onClose)} className="fast rounded-md border border-accent bg-accent px-3 py-1.5 text-caption font-medium text-white shadow-sm hover:brightness-110">Create a domain →</button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} width="max-w-[580px]">
      {/* Accent edge */}
      <div className="h-[3px] w-full shrink-0 rounded-t-[inherit]" style={{ background: `linear-gradient(90deg, ${accent}, ${accent}55 60%, transparent)` }} />

      {/* ── Composer ── */}
      <div className="px-6 pt-5 pb-4">
        <input
          ref={titleRef}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            sniffDate(e.target.value);
            scheduleDraft(e.target.value, outcome);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); outcomeRef.current?.focus(); }
            if (e.key === "Escape") onClose();
          }}
          placeholder="Name this project…"
          autoFocus
          className="w-full bg-transparent text-display font-semibold tracking-tight text-ink outline-none placeholder:font-normal placeholder:text-muted/35"
        />
        <input
          ref={outcomeRef}
          value={outcome}
          onChange={(e) => {
            setOutcome(e.target.value);
            scheduleDraft(name, e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); if (canCreate) void submit(); }
            if (e.key === "Escape") onClose();
          }}
          placeholder="What does done look like? (optional)"
          className="mt-1.5 w-full bg-transparent text-body text-muted outline-none placeholder:text-muted/30"
        />
      </div>

      {/* ── Context chips ── */}
      <div className="relative border-t border-line px-6 py-3" data-chip-picker>
        <div className="flex flex-wrap items-center gap-2">
          {/* Domain chip */}
          <div className="relative">
            <button
              onClick={() => setExpanding(expanding === "domain" ? null : "domain")}
              className="fast flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-label"
              style={{ color: accent, borderColor: `${accent}55`, background: `${accent}12` }}
            >
              <span>{domain?.icon ?? "◆"}</span>
              <span className="font-medium">{domain?.name ?? "Domain"}</span>
              <span className="opacity-40">▾</span>
            </button>
            {expanding === "domain" && (
              <div className="elev-3 absolute top-full mt-1.5 left-0 z-50 flex flex-col gap-0.5 rounded-lg border border-line bg-surface p-1.5 min-w-[140px]">
                {domains.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => pickDomain(d.id)}
                    className="fast flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-caption hover:bg-bg"
                    style={{ color: d.id === domainId ? d.color : "var(--text)", background: d.id === domainId ? `${d.color}12` : "transparent" }}
                  >
                    <span style={{ color: d.color }}>{d.icon}</span>
                    {d.name}
                    {d.id === domainId && <span className="ml-auto text-micro opacity-60">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Initiative chip */}
          {inits.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setExpanding(expanding === "initiative" ? null : "initiative")}
                className="fast flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-label text-muted hover:border-line-strong hover:text-ink"
                style={selectedInit ? { color: accent, borderColor: `${accent}40`, background: `${accent}0d` } : {}}
              >
                <span className="opacity-50">◇</span>
                <span>{selectedInit ? selectedInit.name : "no initiative"}</span>
                <span className="opacity-40">▾</span>
              </button>
              {expanding === "initiative" && (
                <div className="elev-3 absolute top-full mt-1.5 left-0 z-50 flex flex-col gap-0.5 rounded-lg border border-line bg-surface p-1.5 min-w-[180px]">
                  <button
                    onClick={() => { setInitiativeId(null); setExpanding(null); }}
                    className="fast flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-caption hover:bg-bg"
                    style={{ color: !initiativeId ? "var(--text)" : "var(--muted)", background: !initiativeId ? "var(--bg)" : "transparent" }}
                  >
                    <span className="opacity-40">◇</span>
                    no initiative
                    {!initiativeId && <span className="ml-auto text-micro opacity-60">✓</span>}
                  </button>
                  {inits.map((i) => (
                    <button
                      key={i.id}
                      onClick={() => { setInitiativeId(i.id); setExpanding(null); }}
                      className="fast flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-caption hover:bg-bg"
                      style={{ color: i.id === initiativeId ? accent : "var(--text)", background: i.id === initiativeId ? `${accent}12` : "transparent" }}
                    >
                      <span style={{ color: accent }} className="opacity-60">◇</span>
                      <span className="min-w-0 truncate">{i.name}</span>
                      {i.id === initiativeId && <span className="ml-auto shrink-0 text-micro opacity-60">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Target date chip */}
          <div className="relative inline-flex">
            <button
              onClick={() => { try { dateRef.current?.showPicker(); } catch { dateRef.current?.focus(); } }}
              className="fast flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-label text-muted hover:border-line-strong hover:text-ink"
              style={finishLine ? { color: accent, borderColor: `${accent}40`, background: `${accent}0d` } : {}}
            >
              <span className="opacity-50">📅</span>
              {finishLine ? fmtDate(finishLine) : "no deadline"}
              {finishLine && (
                <span
                  role="button"
                  onClick={(e) => { e.stopPropagation(); setFinishLine(null); }}
                  className="ml-0.5 opacity-40 hover:opacity-100"
                >×</span>
              )}
            </button>
            <input
              ref={dateRef}
              type="date"
              value={finishLine ?? ""}
              onChange={(e) => setFinishLine(e.target.value || null)}
              className="pointer-events-none absolute left-0 h-0 w-0 opacity-0"
            />
          </div>

          {/* Hint that you can type dates naturally */}
          {!finishLine && name.length === 0 && (
            <span className="text-meta text-muted/40 italic">— type "by Dec" to set a date</span>
          )}
        </div>
      </div>

      {/* ── AI draft panel ── */}
      {draftPhase !== "idle" && (
        <div className="border-t border-line px-6 py-3">
          {draftPhase === "thinking" && (
            <div className="flex items-center gap-2">
              <span className="shimmer inline-block text-body" style={{ color: accent }}>✦</span>
              <span className="text-label text-muted">
                {ASSISTANT_NAME} is drafting first tasks…
              </span>
            </div>
          )}
          {draftPhase === "ready" && proposal && proposal.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-meta font-semibold uppercase tracking-wide" style={{ color: accent }}>
                  ✦ starter tasks
                </span>
                <span className="mono text-meta text-muted">{acceptCount}/{proposal.length} included</span>
              </div>
              <div className="space-y-0.5">
                {proposal.map((d, i) => (
                  <div key={i} className="group flex items-center gap-2.5 rounded-md px-1 py-1 hover:bg-bg">
                    <button
                      onClick={() => setProposal((p) => p!.map((x, j) => j === i ? { ...x, included: !x.included } : x))}
                      className="fast flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border text-micro text-white"
                      style={{ borderColor: d.included ? accent : "var(--line)", background: d.included ? accent : "transparent" }}
                    >
                      {d.included ? "✓" : ""}
                    </button>
                    <span className="shrink-0 text-label" style={{ color: accent }}>
                      {d.energy ? ENERGY_META[d.energy].icon : "·"}
                    </span>
                    <span className={`min-w-0 flex-1 truncate text-caption ${d.included ? "text-ink" : "text-muted line-through"}`}>
                      {d.title}
                    </span>
                    <span className="mono shrink-0 text-meta text-muted">{d.durationMins}m</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => { lastDraftKey.current = ""; scheduleDraft(name, outcome); }}
                className="fast mono mt-1.5 text-meta text-muted hover:text-ink"
              >
                ↻ reshape
              </button>
            </div>
          )}
        </div>
      )}

      {error && <div className="px-6 pb-3 text-caption text-signal">{error}</div>}

      {/* ── Footer ── */}
      <div className="flex items-center gap-2 border-t border-line bg-bg/40 px-6 py-3.5">
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="fast rounded-md border border-line px-3 py-1.5 text-caption font-medium text-ink hover:border-line-strong hover:bg-surface-2"
        >
          Cancel
        </button>
        <button
          onClick={() => void submit()}
          disabled={!canCreate || busy}
          className="fast rounded-md px-3.5 py-1.5 text-caption font-medium text-white shadow-sm transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: accent, boxShadow: canCreate ? `0 6px 16px -6px ${accent}` : "none" }}
        >
          {busy ? "Creating…" : acceptCount > 0 ? `Create + ${acceptCount} task${acceptCount === 1 ? "" : "s"} →` : "Create project →"}
        </button>
      </div>
    </Modal>
  );
}
