// The deck walk's parts (D-216, docs/offer-rules.md §4) — Plan projects and
// Plan initiatives are the same walk at two clock speeds, so they share the
// shell (the rail's own bar, the counter, Esc), the drafted lines, and the
// span chooser. Every part is built from the kit; the look of a drafted line is
// Draft the path's (a faint accent wash, a dashed check, D-193).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, ChipButton, Dest, IconButton, Input, OfferChip, Row } from "../kit";
import { Icon } from "../Icon";
import { fmtMins } from "../../lib/now";
import { commitLabel, lineMins, readyCounter, sizesSaid, type PlanLine } from "../../lib/planProjects";
import type { PlanDraft } from "./usePlanDraft";

/** The walk's rail: its own bar (what you're doing · Ready n of m · close), a
 *  body that scrolls. Esc leaves — unless a field has it, which it blurs first. */
export function WalkShell({
  title,
  ready,
  total,
  width,
  onClose,
  children,
}: {
  title: string;
  ready: number;
  total: number;
  width?: string | number;
  onClose: () => void;
  children: ReactNode;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t?.closest("[data-nested-surface]")) return;
      if (t && (t.matches("input, textarea") || t.isContentEditable)) {
        t.blur();
        return;
      }
      e.preventDefault();
      close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div
      data-plan-walk=""
      className="titlebar-pad relative z-40 flex h-full shrink-0 flex-col"
      style={{ width: width ?? 340, borderRight: "1px solid var(--line-1)", ["--titlebar-pad-y" as string]: "0px" }}
    >
      <div className="flex h-12 shrink-0 items-center gap-1.5 pl-4 pr-2" style={{ boxShadow: "inset 0 -1px 0 var(--line-1)" }}>
        <span className="f-title min-w-0 flex-1 truncate">{title}</span>
        <span className="shrink-0 text-caption tabular-nums text-muted" data-walk-counter="">
          {readyCounter(ready, total)}
        </span>
        <IconButton label="Leave the walk" shortcut="Esc" icon={<Icon name="close" size={14} />} onClick={onClose} />
      </div>
      <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-4 pb-5 pt-5">{children}</div>
    </div>
  );
}

/** The walk is over: the deck's state, once, and the way back. */
export function WalkFinished({ ready, total, onClose }: { ready: number; total: number; onClose: () => void }) {
  return (
    <div className="grid gap-3 py-4" role="status">
      <p className="f-title">{readyCounter(ready, total)}.</p>
      <Button kind="primary" size="md" full onClick={onClose}>
        Back to the deck
      </Button>
    </div>
  );
}

/** One drafted (or typed) line — not a task yet. Its name renames in place,
 *  its length cycles on a press, ✕ removes it (with Undo below). */
function PlanLineRow({ line, draft }: { line: PlanLine; draft: PlanDraft }) {
  const [editing, setEditing] = useState(false);
  return (
    <Row
      className="pw-line"
      data-draft={line.from === "nuvo" && !line.touched ? "" : undefined}
      data-pinned={line.from === "you" || line.touched ? "" : undefined}
      leading={<span className="pw-check" aria-hidden />}
      title={
        editing ? (
          <Input
            size="sm"
            autoFocus
            defaultValue={line.title}
            aria-label="Rename the task"
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => {
              draft.rename(line.key, e.currentTarget.value);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setEditing(false);
              }
            }}
          />
        ) : (
          <button type="button" className="pw-line-name" title={`${line.title} — rename`} onClick={() => setEditing(true)}>
            {line.title}
          </button>
        )
      }
      trailing={
        <span className="flex shrink-0 items-center gap-0.5">
          <ChipButton title="Change the length" aria-label={`${fmtMins(line.mins)} — change the length`} onClick={() => draft.resize(line.key)}>
            <span className="f-num">{fmtMins(line.mins)}</span>
          </ChipButton>
          <IconButton size="xs" label={`Remove ${line.title}`} icon={<Icon name="close" size={12} />} onClick={() => draft.remove(line.key)} />
        </span>
      }
    />
  );
}

/** The tasks phase: what's already there, the draft, your own line, the steer,
 *  and the one press that writes it all. */
export function TasksPhase({
  projectName,
  domainName,
  noHistory,
  existing,
  draft,
  outcome,
  onCommit,
  onLater,
}: {
  projectName: string;
  domainName: string;
  noHistory: boolean;
  existing: { id: string; title: string; mins: number }[];
  draft: PlanDraft;
  /** the outcome line, when the project has none (it can't be Ready without) */
  outcome?: {
    value: string;
    set: (v: string) => void;
    onDraft: () => void;
    /** Nuvo's proposed outcome line (the agent's `draftOutcome`), shown under
     *  an empty field — one press puts it in the field, where it stays yours to
     *  edit; nothing is written until the commit (P3). */
    suggested?: string | null;
  } | null;
  onCommit: (from: HTMLElement | null) => void;
  onLater: () => void;
}) {
  const addRef = useRef<HTMLInputElement | null>(null);
  const steerRef = useRef<HTMLInputElement | null>(null);
  const n = draft.lines.length;
  const label = commitLabel(n, projectName);
  const said = sizesSaid(draft.lines, domainName, noHistory);
  const canSteer = draft.lines.some((l) => l.from === "nuvo" && !l.touched) && draft.phase !== "drafting";
  return (
    <>
      {outcome && (
        <div className="grid gap-1.5">
          <span className="text-label font-semibold text-[var(--faint)]">Outcome</span>
          <Input
            size="sm"
            placeholder="What's true when it's done?"
            aria-label="The outcome"
            value={outcome.value}
            onChange={(e) => outcome.set(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && outcome.value.trim()) outcome.onDraft();
            }}
          />
          {!outcome.value.trim() && outcome.suggested && (
            <div className="pw-suggest">
              <OfferChip verb="Use" name={`“${outcome.suggested}”`} dest title="Nuvo's draft of the outcome — it lands in the field for you to edit" onPress={() => outcome.set(outcome.suggested!)} />
            </div>
          )}
          {draft.phase === "none" && outcome.value.trim() && (
            <div>
              <Button size="xs" kind="ghost" icon={<Icon name="sparkles" size={12} />} onClick={outcome.onDraft}>
                Draft tasks from this
              </Button>
            </div>
          )}
        </div>
      )}

      {existing.length > 0 && (
        <section className="f-section" aria-label="Already on it">
          <span className="text-label font-semibold text-[var(--faint)]">Already on it</span>
          {existing.map((t) => (
            <Row key={t.id} className="pw-have" leading={<span className="pw-check" data-real="" aria-hidden />} title={t.title} meta={fmtMins(t.mins)} />
          ))}
        </section>
      )}

      <section className="f-section" aria-label="Drafted tasks">
        {draft.phase === "drafting" ? (
          <p className="pw-said" role="status">
            Nuvo is reading the outcome and drafting…
          </p>
        ) : draft.phase === "none" && !outcome ? (
          <p className="pw-said">No outcome and nothing finished to go on — add the tasks yourself.</p>
        ) : null}
        {draft.lines.map((l) => (
          <PlanLineRow key={l.key} line={l} draft={draft} />
        ))}
        {draft.removed && (
          <div className="pw-removed">
            <span className="min-w-0 flex-1 truncate">Removed “{draft.removed.line.title}”</span>
            <Button size="xs" kind="ghost" onClick={draft.undo}>
              Undo
            </Button>
          </div>
        )}
        <Input
          ref={addRef}
          size="sm"
          frameClassName="pw-add"
          placeholder="Add your own — “Call Ana 45m”"
          aria-label="Add a task of your own"
          icon={<Icon name="plus" size={13} />}
          autoComplete="off"
          enterKeyHint="done"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              draft.add(e.currentTarget.value);
              e.currentTarget.value = "";
            }
          }}
        />
        {said && <p className="pw-said">{said}</p>}
        {draft.message && <p className="pw-said" role="status">{draft.message}</p>}
      </section>

      {canSteer && (
        <Input
          ref={steerRef}
          size="sm"
          placeholder="Tell Nuvo what to change"
          aria-label="Tell Nuvo what to change in its draft"
          icon={<Icon name="sparkles" size={13} />}
          autoComplete="off"
          enterKeyHint="send"
          title="Fewer · smaller pieces · start with a call. What you renamed, resized or typed stays."
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.currentTarget.value.trim()) {
              e.preventDefault();
              void draft.steer(e.currentTarget.value);
              e.currentTarget.value = "";
            }
          }}
        />
      )}

      <div className="grid gap-1.5">
        {n > 0 ? (
          <Button
            kind="primary"
            size="md"
            full
            disabled={draft.phase === "drafting"}
            onClick={(e) => onCommit(e.currentTarget)}
            title={`${label.verb} ${label.name} · ${fmtMins(lineMins(draft.lines))} in all. Nothing goes on a week.`}
          >
            <Dest verb={label.verb} name={label.name} />
          </Button>
        ) : (
          <Button size="md" full disabled={draft.phase === "drafting"} onClick={(e) => onCommit(e.currentTarget)}>
            On to the weeks
          </Button>
        )}
        <Button size="sm" kind="ghost" full onClick={onLater} shortcut="J">
          Look at it last
        </Button>
      </div>
    </>
  );
}

/** One span (or quarter) to choose: the destination on the button, its cost
 *  under it in --warn (R5), or the reason it's the second answer (R13).
 *  Pointing at it draws it on the deck (R3). */
export function SpanChoice({
  verb,
  name,
  cost,
  reason,
  primary,
  shortcut,
  onPick,
  onPoint,
}: {
  verb: string;
  name: string;
  cost: string | null;
  reason: string | null;
  primary?: boolean;
  shortcut?: string;
  onPick: (from: HTMLElement) => void;
  onPoint: (on: boolean) => void;
}) {
  return (
    <div className="grid gap-1" onPointerEnter={() => onPoint(true)} onPointerLeave={() => onPoint(false)} onFocus={() => onPoint(true)} onBlur={() => onPoint(false)}>
      <Button kind={primary ? "primary" : "secondary"} size="md" full shortcut={shortcut} onClick={(e) => onPick(e.currentTarget)}>
        <Dest verb={verb} name={name} />
      </Button>
      <p className="pw-said pw-caption" data-cost={cost ? "" : undefined} title={cost ?? reason ?? undefined}>
        {cost ?? reason ?? "Clear weeks"}
      </p>
    </div>
  );
}
