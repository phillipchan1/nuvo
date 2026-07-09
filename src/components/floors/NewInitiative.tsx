// New initiative — a composer, not a form. Type the initiative name, pick the domain,
// set a finish line, create. Shaping it (key results, projects, first tasks) is
// the ◇ Tending ritual's job — create the initiative bare here, ripen it there.
// ⏎ moves focus through name → outcome → creates.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { endOfQuarter, format } from "date-fns";
import * as chrono from "chrono-node";
import { useVertical } from "../../hooks/useVertical";
import { fmtDate } from "./parts";
import { Modal } from "../ui";

export default function NewInitiative({
  onClose,
  onCreated,
  initialDomainId,
  initialName,
}: {
  onClose: () => void;
  onCreated: (initiativeId: string) => void;
  initialDomainId?: string | null;
  /** Carried over when expanding from the fast composer. */
  initialName?: string;
}) {
  const { data, addInitiative, addDomain } = useVertical();
  const domains = useMemo(() => [...data.domains].sort((a, b) => a.sort - b.sort), [data.domains]);

  const [domainId, setDomainId] = useState(initialDomainId || domains[0]?.id || "");
  const [name, setName] = useState(initialName ?? "");
  const [outcome, setOutcome] = useState("");
  const [finishLine, setFinishLine] = useState<string | null>(() =>
    format(endOfQuarter(new Date()), "yyyy-MM-dd"),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanding, setExpanding] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const outcomeRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  const domain = domains.find((d) => d.id === domainId);
  const accent = domain?.color ?? "var(--accent)";
  const canCreate = Boolean(domainId && name.trim());
  const today = useMemo(() => new Date(), []);

  // Extract a target date from whatever the user typed in the name.
  const sniffDate = useCallback((text: string) => {
    const results = chrono.parse(text, new Date(), { forwardDate: true });
    if (results.length > 0) {
      setFinishLine(format(results[0].start.date(), "yyyy-MM-dd"));
    }
  }, []);

  // Collapse domain picker on outside click
  useEffect(() => {
    if (!expanding) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-chip-picker]")) setExpanding(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [expanding]);

  const submit = async () => {
    if (!canCreate || busy) return;
    setBusy(true);
    setError(null);
    try {
      const init = await addInitiative(domainId, {
        name: name.trim(),
        outcome: outcome.trim(),
        startDate: format(today, "yyyy-MM-dd"),
        targetDate: finishLine,
      });
      onCreated(init.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the initiative.");
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
            Initiatives are the moves you place inside a life domain — Health, Craft, Family.
            Create your first domain, then the initiatives have somewhere to live.
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
    <Modal onClose={onClose} width="max-w-[560px]">
      {/* Accent edge */}
      <div className="h-[3px] w-full shrink-0 rounded-t-[inherit]" style={{ background: `linear-gradient(90deg, ${accent}, ${accent}55 60%, transparent)` }} />

      {/* ── Composer ── */}
      <div className="px-6 pt-5 pb-4">
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => { setName(e.target.value); sniffDate(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); outcomeRef.current?.focus(); }
            if (e.key === "Escape") onClose();
          }}
          placeholder="Name this initiative…"
          autoFocus
          className="w-full bg-transparent text-display font-semibold tracking-tight text-ink outline-none placeholder:font-normal placeholder:text-muted/35"
        />
        <input
          ref={outcomeRef}
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
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
              onClick={() => setExpanding(!expanding)}
              className="fast flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-label"
              style={{ color: accent, borderColor: `${accent}55`, background: `${accent}12` }}
            >
              <span>{domain?.icon ?? "◆"}</span>
              <span className="font-medium">{domain?.name ?? "Domain"}</span>
              <span className="opacity-40">▾</span>
            </button>
            {expanding && (
              <div className="elev-3 absolute top-full mt-1.5 left-0 z-50 flex flex-col gap-0.5 rounded-lg border border-line bg-surface p-1.5 min-w-[140px]">
                {domains.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => { setDomainId(d.id); setExpanding(false); }}
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

          {/* Finish-line chip */}
          <div className="relative inline-flex">
            <button
              onClick={() => { try { dateRef.current?.showPicker(); } catch { dateRef.current?.focus(); } }}
              className="fast flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-label text-muted hover:border-line-strong hover:text-ink"
              style={finishLine ? { color: accent, borderColor: `${accent}40`, background: `${accent}0d` } : {}}
            >
              <span className="opacity-50">⬡</span>
              {finishLine ? fmtDate(finishLine) : "no finish line"}
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

          {/* NLP hint */}
          {!finishLine && name.length === 0 && (
            <span className="text-meta text-muted/40 italic">— type "by Dec" to set a date</span>
          )}
        </div>
      </div>

      {error && <div className="px-6 pb-3 text-caption text-signal">{error}</div>}

      {/* ── Footer ── */}
      <div className="flex items-center gap-2 border-t border-line bg-bg/40 px-6 py-3.5">
        <span className="hidden text-meta text-muted/70 sm:inline">Shape it later in ◇ Groom</span>
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
          {busy ? "Creating…" : "Create initiative →"}
        </button>
      </div>
    </Modal>
  );
}
