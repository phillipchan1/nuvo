// New initiative — the focused "moment" for starting a bet. Pick the domain
// (its color tints the whole moment), name the bet, say what done looks like,
// draw the finish line. Create it bare here, or hand what you've typed to Nuvo
// to shape the whole subtree (Blueprint). Nothing lands until you commit.

import { useMemo, useRef, useState } from "react";
import { addDays, endOfQuarter, format } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import { ASSISTANT_NAME } from "../../lib/assistant";
import { fmtDate } from "./parts";
import { Field, MomentHeader, Pill } from "./createParts";
import { Modal } from "../ui";
import type { BlueprintSeed } from "../rituals/BlueprintFlow";

export default function NewInitiative({
  onClose,
  onCreated,
  initialDomainId,
  initialName,
  onBlueprint,
}: {
  onClose: () => void;
  onCreated: (initiativeId: string) => void;
  /** The domain to pre-select (e.g. the active filter on the floor). */
  initialDomainId?: string | null;
  /** Carried over when expanding from the fast composer. */
  initialName?: string;
  /** Hand the half-typed bet to the AI Blueprint flow instead. */
  onBlueprint?: (seed: BlueprintSeed) => void;
}) {
  const { data, addInitiative, addDomain } = useVertical();
  const domains = useMemo(() => [...data.domains].sort((a, b) => a.sort - b.sort), [data.domains]);

  const [domainId, setDomainId] = useState(initialDomainId || domains[0]?.id || "");
  const [name, setName] = useState(initialName ?? "");
  const [outcome, setOutcome] = useState("");
  const [description, setDescription] = useState("");
  // default the finish line to quarter end — nudge every bet toward a deadline
  const [finishLine, setFinishLine] = useState<string | null>(() =>
    format(endOfQuarter(new Date()), "yyyy-MM-dd"),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  const domain = domains.find((d) => d.id === domainId);
  const accent = domain?.color ?? "var(--accent)";
  const canCreate = Boolean(domainId && name.trim());

  const today = useMemo(() => new Date(), []);
  const presets = useMemo(
    () => [
      { label: "Quarter end", iso: format(endOfQuarter(today), "yyyy-MM-dd") },
      { label: "30 days", iso: format(addDays(today, 30), "yyyy-MM-dd") },
      { label: "90 days", iso: format(addDays(today, 90), "yyyy-MM-dd") },
    ],
    [today],
  );
  const isCustom = finishLine != null && !presets.some((p) => p.iso === finishLine);

  const submit = async () => {
    if (!canCreate || busy) return;
    setBusy(true);
    setError(null);
    try {
      const init = await addInitiative(domainId, {
        name: name.trim(),
        outcome: outcome.trim(),
        description: description.trim(),
        // anchor the timeline at today so the bet reads as a span, not a point
        startDate: format(today, "yyyy-MM-dd"),
        targetDate: finishLine,
      });
      onCreated(init.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the initiative.");
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || e.currentTarget.tagName === "INPUT")) {
      e.preventDefault();
      void submit();
    }
  };

  // No domains yet — the button can't be dead. Point the way to a domain first.
  if (domains.length === 0) {
    return (
      <Modal onClose={onClose} width="max-w-[460px]">
        <div className="p-7 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-line text-[18px] text-muted">◇</div>
          <h2 className="text-[17px] font-semibold tracking-tight">Start with a domain</h2>
          <p className="mx-auto mt-1.5 max-w-[320px] text-[13px] leading-relaxed text-muted">
            Initiatives are bets you place inside a life domain — Health, Craft, Family.
            Create your first domain, then the bets have somewhere to live.
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
      <MomentHeader accent={accent} icon={domain?.icon ?? "◆"} eyebrow="New initiative" title="A bet with a finish line" onClose={onClose} />

      <div className="px-6 py-5">
        {/* domain — pick where the bet lives; its color carries the moment */}
        <Field label="Domain">
          <div className="flex flex-wrap gap-1.5">
            {domains.map((d) => (
              <Pill key={d.id} active={d.id === domainId} accent={d.color} onClick={() => setDomainId(d.id)}>
                <span style={{ color: d.color }}>{d.icon}</span>
                {d.name}
              </Pill>
            ))}
          </div>
        </Field>

        {/* the bet, named */}
        <div className="mt-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Name the bet…"
            autoFocus
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-[16px] font-semibold outline-none transition placeholder:font-normal placeholder:text-muted/55 focus:border-transparent"
            style={{ boxShadow: `inset 0 0 0 1px transparent` }}
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

        {/* finish line — the thing that makes it an initiative, not a wish */}
        <Field label="Finish line" className="mt-4">
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
              <button onClick={() => setFinishLine(null)} className="fast mono text-[11px] text-muted hover:text-signal" title="Clear the finish line">
                clear
              </button>
            )}
          </div>
        </Field>

        {/* context — the why and the shape, optional */}
        <Field label="Context" className="mt-4">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Optional — the why, the shape, the constraints…"
            rows={2}
            className="w-full resize-y rounded-md border border-line bg-surface px-3 py-2 text-[12px] leading-relaxed text-muted outline-none transition placeholder:text-muted/50 focus:border-line-strong"
          />
        </Field>

        {error && <div className="mt-3 text-[12px] text-signal">{error}</div>}
      </div>

      {/* footer — bare create, or hand it to Nuvo */}
      <div className="flex items-center gap-2 border-t border-line bg-bg/40 px-6 py-3.5">
        {onBlueprint && (
          <button
            onClick={() => onBlueprint({ domainId, name: name.trim(), outcome: outcome.trim(), description: description.trim() })}
            className="fast group flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted hover:text-ink"
            title={`Let ${ASSISTANT_NAME} draft key results, projects, and first tasks`}
          >
            <span style={{ color: accent }}>✦</span>
            Shape it with {ASSISTANT_NAME}
          </button>
        )}
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
          {busy ? "Creating…" : "Create initiative →"}
        </button>
      </div>
    </Modal>
  );
}
