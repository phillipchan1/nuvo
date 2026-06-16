// The fast lane. A Todoist-quick composer for a project or an initiative:
// pick a domain, name it, then rattle off subtasks — Enter drops a new line,
// ⌘Enter saves the whole thing in one write. No AI, no ceremony; nothing
// lands until you commit. The rich "moment" (outcome, context, AI drafting)
// is one click away via "more options" for when a chunk of work earns it.

import { useMemo, useRef, useState } from "react";
import { addDays, endOfQuarter, format } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import { fmtDate } from "./parts";
import { MomentHeader, Pill } from "./createParts";
import { Modal } from "../ui";

type Kind = "project" | "initiative";

interface Line {
  id: number;
  text: string;
}

export default function QuickCreate({
  kind,
  onClose,
  onCreated,
  onExpand,
  initialDomainId,
  initialInitiativeId,
}: {
  kind: Kind;
  onClose: () => void;
  onCreated: (id: string) => void;
  /** Swap to the full "moment" (outcome, context, AI draft), keeping intent. */
  onExpand?: (seed: { domainId: string; initiativeId: string | null; name: string }) => void;
  initialDomainId?: string | null;
  initialInitiativeId?: string | null;
}) {
  const { data, addProject, addInitiative, addTasks, addDomain } = useVertical();
  const domains = useMemo(() => [...data.domains].sort((a, b) => a.sort - b.sort), [data.domains]);

  const [domainId, setDomainId] = useState(initialDomainId || domains[0]?.id || "");
  const [initiativeId, setInitiativeId] = useState<string | null>(initialInitiativeId ?? null);
  const [name, setName] = useState("");
  // a project's target is optional; an initiative wants a finish line — default
  // it to quarter end so a fast bet still reads as a span, not a wish.
  const [target, setTarget] = useState<string | null>(
    kind === "initiative" ? format(endOfQuarter(new Date()), "yyyy-MM-dd") : null,
  );
  const [lines, setLines] = useState<Line[]>([{ id: 0, text: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextId = useRef(1);
  const nameRef = useRef<HTMLInputElement>(null);
  const lineRefs = useRef(new Map<number, HTMLInputElement>());
  const dateRef = useRef<HTMLInputElement>(null);

  const domain = domains.find((d) => d.id === domainId);
  const accent = domain?.color ?? "var(--accent)";
  const canCreate = Boolean(domainId && name.trim());
  const noun = kind === "project" ? "project" : "initiative";

  // initiatives in the chosen domain that can still take a project under them
  const inits = useMemo(
    () =>
      data.initiatives.filter(
        (i) => i.domainId === domainId && i.status !== "shipped" && i.status !== "dropped",
      ),
    [data.initiatives, domainId],
  );

  const today = useMemo(() => new Date(), []);
  const presets = useMemo(
    () =>
      kind === "initiative"
        ? [
            { label: "Quarter end", iso: format(endOfQuarter(today), "yyyy-MM-dd") },
            { label: "30 days", iso: format(addDays(today, 30), "yyyy-MM-dd") },
            { label: "90 days", iso: format(addDays(today, 90), "yyyy-MM-dd") },
          ]
        : [
            { label: "2 weeks", iso: format(addDays(today, 14), "yyyy-MM-dd") },
            { label: "30 days", iso: format(addDays(today, 30), "yyyy-MM-dd") },
            { label: "Quarter end", iso: format(endOfQuarter(today), "yyyy-MM-dd") },
          ],
    [kind, today],
  );
  const isCustom = target != null && !presets.some((p) => p.iso === target);

  const filledLines = lines.filter((l) => l.text.trim());

  // ── focus plumbing — the subtask rows behave like one continuous field ──────
  const focusLine = (id: number) =>
    requestAnimationFrame(() => lineRefs.current.get(id)?.focus());

  const addLineAfter = (id: number) => {
    const fresh = { id: nextId.current++, text: "" };
    setLines((ls) => {
      const i = ls.findIndex((l) => l.id === id);
      const next = [...ls];
      next.splice(i + 1, 0, fresh);
      return next;
    });
    focusLine(fresh.id);
  };

  const removeLine = (id: number) => {
    if (lines.length <= 1) return; // always keep one line to type into
    const i = lines.findIndex((l) => l.id === id);
    const prev = lines[i - 1] ?? lines[i + 1];
    setLines((ls) => ls.filter((l) => l.id !== id));
    if (prev) focusLine(prev.id);
    else requestAnimationFrame(() => nameRef.current?.focus());
  };

  const setLineText = (id: number, text: string) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, text } : l)));

  const pickDomain = (id: string) => {
    setDomainId(id);
    if (kind === "project") setInitiativeId(null); // an initiative belongs to a domain
  };

  const submit = async () => {
    if (!canCreate || busy) return;
    setBusy(true);
    setError(null);
    try {
      let parentId: string;
      if (kind === "project") {
        const p = await addProject(domainId, initiativeId, {
          name: name.trim(),
          startDate: format(today, "yyyy-MM-dd"),
          targetDate: target,
        });
        parentId = p.id;
        if (filledLines.length) {
          await addTasks(
            { projectId: p.id, initiativeId, domainId },
            filledLines.map((l) => ({ title: l.text.trim(), energy: null, durationMins: 20 })),
          );
        }
      } else {
        const init = await addInitiative(domainId, {
          name: name.trim(),
          startDate: format(today, "yyyy-MM-dd"),
          targetDate: target,
        });
        parentId = init.id;
        if (filledLines.length) {
          await addTasks(
            { initiativeId: init.id, domainId },
            filledLines.map((l) => ({ title: l.text.trim(), energy: null, durationMins: 20 })),
          );
        }
      }
      onCreated(parentId);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Couldn't create the ${noun}.`);
      setBusy(false);
    }
  };

  const saveChord = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
      return true;
    }
    return false;
  };

  const onNameKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (saveChord(e)) return;
    // plain Enter drops out of the title and into the first subtask
    if (e.key === "Enter") {
      e.preventDefault();
      if (!name.trim()) return;
      focusLine(lines[0].id);
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusLine(lines[0].id);
    }
  };

  const onLineKey = (e: React.KeyboardEvent<HTMLInputElement>, line: Line, idx: number) => {
    if (saveChord(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      addLineAfter(line.id);
      return;
    }
    // backspace on an empty row folds it into the one above (Todoist-style)
    if (e.key === "Backspace" && line.text === "") {
      e.preventDefault();
      if (lines.length > 1) removeLine(line.id);
      else requestAnimationFrame(() => nameRef.current?.focus());
      return;
    }
    const el = e.currentTarget;
    if (e.key === "ArrowUp" && el.selectionStart === 0) {
      e.preventDefault();
      if (idx === 0) nameRef.current?.focus();
      else focusLine(lines[idx - 1].id);
    }
    if (e.key === "ArrowDown" && el.selectionStart === el.value.length && idx < lines.length - 1) {
      e.preventDefault();
      focusLine(lines[idx + 1].id);
    }
  };

  // ── no domains yet — point the way rather than show a dead button ──────────
  if (domains.length === 0) {
    return (
      <Modal onClose={onClose} width="max-w-[460px]">
        <div className="p-7 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-line text-[18px] text-muted">◇</div>
          <h2 className="text-[17px] font-semibold tracking-tight">Start with a domain</h2>
          <p className="mx-auto mt-1.5 max-w-[320px] text-[13px] leading-relaxed text-muted">
            {kind === "project" ? "Projects" : "Initiatives"} live inside a life domain. Create your
            first domain, then the work has somewhere to land.
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
      <MomentHeader
        accent={accent}
        icon={domain?.icon ?? "◆"}
        eyebrow={kind === "project" ? "New project" : "New initiative"}
        title={kind === "project" ? "Name it, then rattle off the tasks" : "Name the bet, then its first tasks"}
        onClose={onClose}
      />

      <div className="px-6 py-5">
        {/* where it lives — a single compact pill row, plus initiative for projects */}
        <div className="flex flex-wrap items-center gap-1.5">
          {domains.map((d) => (
            <Pill key={d.id} active={d.id === domainId} accent={d.color} onClick={() => pickDomain(d.id)}>
              <span style={{ color: d.color }}>{d.icon}</span>
              {d.name}
            </Pill>
          ))}
          {kind === "project" && inits.length > 0 && (
            <>
              <span className="mx-0.5 text-[11px] text-muted/50">/</span>
              <Pill active={initiativeId === null} accent={accent} onClick={() => setInitiativeId(null)}>
                No initiative
              </Pill>
              {inits.map((i) => (
                <Pill key={i.id} active={initiativeId === i.id} accent={accent} onClick={() => setInitiativeId(i.id)}>
                  {i.name}
                </Pill>
              ))}
            </>
          )}
        </div>

        {/* the name — the one field that matters, big and autofocused */}
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onNameKey}
          placeholder={kind === "project" ? "Name the project…" : "Name the bet…"}
          autoFocus
          className="mt-4 w-full rounded-md border border-line bg-surface px-3 py-2.5 text-[17px] font-semibold outline-none transition placeholder:font-normal placeholder:text-muted/55"
          style={{ boxShadow: "inset 0 0 0 1px transparent" }}
          onFocus={(e) => (e.currentTarget.style.boxShadow = `0 0 0 3px ${accent}26, inset 0 0 0 1px ${accent}`)}
          onBlur={(e) => (e.currentTarget.style.boxShadow = "inset 0 0 0 1px transparent")}
        />

        {/* the fast lane — one subtask per line, Enter drops the next */}
        <div className="mt-2.5 rounded-md border border-line bg-bg/40 px-2 py-1.5">
          {lines.map((line, idx) => (
            <div key={line.id} className="group flex items-center gap-2.5 py-1">
              <span
                className="shrink-0 text-[10px] transition-colors"
                style={{ color: line.text.trim() ? accent : "var(--line-strong)" }}
              >
                ◦
              </span>
              <input
                ref={(el) => {
                  if (el) lineRefs.current.set(line.id, el);
                  else lineRefs.current.delete(line.id);
                }}
                value={line.text}
                onChange={(e) => setLineText(line.id, e.target.value)}
                onKeyDown={(e) => onLineKey(e, line, idx)}
                placeholder={idx === 0 ? "Add a task…  ⏎ for the next" : "Add a task…"}
                className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted/45"
              />
              {lines.length > 1 && (
                <button
                  onClick={() => removeLine(line.id)}
                  tabIndex={-1}
                  className="fast shrink-0 px-1 text-[12px] text-muted/50 opacity-0 transition hover:text-signal group-hover:opacity-100"
                  title="Remove this line"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        {/* target — a quiet chip row; an initiative defaults to quarter end */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="section-label mr-1">{kind === "project" ? "Target" : "Finish line"}</span>
          {presets.map((p) => (
            <Pill key={p.iso} active={target === p.iso} accent={accent} onClick={() => setTarget(p.iso)}>
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
              {isCustom ? fmtDate(target!) : "Pick a date"}
            </Pill>
            <input
              ref={dateRef}
              type="date"
              value={target ?? ""}
              onChange={(e) => setTarget(e.target.value || null)}
              className="pointer-events-none absolute left-0 h-0 w-0 opacity-0"
            />
          </span>
          {target && (
            <button onClick={() => setTarget(null)} className="fast mono text-[11px] text-muted hover:text-signal" title="Clear">
              clear
            </button>
          )}
        </div>

        {error && <div className="mt-3 text-[12px] text-signal">{error}</div>}
      </div>

      {/* footer — keyboard cheat-sheet on the left, commit on the right */}
      <div className="flex items-center gap-3 border-t border-line bg-bg/40 px-6 py-3.5">
        <div className="mono hidden items-center gap-2 text-[10px] text-muted sm:flex">
          <span><kbd className="keycap">⏎</kbd> task</span>
          <span><kbd className="keycap">⌘⏎</kbd> create</span>
        </div>
        {onExpand && (
          <button
            onClick={() => onExpand({ domainId, initiativeId, name: name.trim() })}
            className="fast text-[11px] text-muted hover:text-ink"
            title="Outcome, context, and an AI-drafted backlog"
          >
            more options…
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
          {busy
            ? "Creating…"
            : filledLines.length > 0
              ? `Create + ${filledLines.length} task${filledLines.length === 1 ? "" : "s"} →`
              : `Create ${noun} →`}
        </button>
      </div>
    </Modal>
  );
}
