// The agent's work, shown as records instead of described in a sentence.
//
// An action used to render as one grey "✓ Created …" line — a receipt, printed
// once and wrong the moment anything changed. These cards read the row LIVE
// (see useAgentRecords) and carry the action's inverse, so the transcript stays
// an honest index of what Nuvo did to your data: reschedule the task on the
// Schedule and its card follows; undo from the card and the card re-renders as
// whatever the record now is. Nothing here is snapshot state.
//
// Everything degrades: an action with no ref (a Google write, a pure query)
// falls back to the summary line it always was.
import { useState } from "react";
import { useAgentUndo, useEventRecord, useTaskRecord } from "../hooks/useAgentRecords";
import { useVertical } from "../hooks/useVertical";
import { fmtDayLabel, fmtDuration, fmtTime } from "../lib/dates";
import type { AgentAction, AgentVerb } from "../lib/agentTypes";
import type { Task } from "../lib/types";

const VERB_LABEL: Record<AgentVerb, string> = {
  created: "Added",
  slotted: "Slotted",
  moved: "Moved",
  updated: "Updated",
  done: "Done",
  trashed: "Trashed",
  unslotted: "Unslotted",
};

/** A batch is a stack, not a wall of cards: "clear my inbox" fires a dozen
 *  actions, and twelve cards bury the reply they're supposed to support. */
const STACK_AT = 3;

/** How many rows a folded stack shows before it just says how many are left. */
const FOLDED_ROWS = 3;

/** A card floats on its own; a row rides inside a stack, where the stack owns
 *  the framing and the undo — so the row is just the record, one line. */
type Variant = "card" | "row";

export default function AgentActions({ actions }: { actions: AgentAction[] }) {
  if (!actions.length) return null;

  // Actions the edge could point at get cards; the rest keep their summary line.
  const cards = actions.filter((a) => a.ref);
  const plain = actions.filter((a) => !a.ref);

  // Group by verb so a stack can say what it DID ("3 slotted"), not just "3 things".
  const groups = new Map<string, AgentAction[]>();
  for (const a of cards) {
    const key = a.verb ?? "updated";
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }

  return (
    <div className="mt-2 space-y-1.5">
      {[...groups.entries()].map(([verb, group]) =>
        group.length >= STACK_AT ? (
          <ActionStack key={verb} verb={verb as AgentVerb} actions={group} />
        ) : (
          group.map((a) => <Record key={a.ref!.id + a.tool} action={a} variant="card" />)
        ),
      )}

      {plain.length > 0 && (
        <ul className={cards.length ? "space-y-1 border-t border-line/50 pt-2" : "space-y-1"}>
          {plain.map((a) => (
            <li key={a.summary} className="mono text-meta text-muted">
              ✓ {a.summary}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One record, as it stands right now. */
function Record({ action, variant }: { action: AgentAction; variant: Variant }) {
  if (action.ref?.kind === "task") return <TaskRecord action={action} variant={variant} />;
  if (action.ref?.kind === "event") return <EventRecord action={action} variant={variant} />;
  if (action.ref?.kind === "priority") return <PriorityRecord action={action} variant={variant} />;
  return <SummaryFallback action={action} />;
}

function TaskRecord({ action, variant }: { action: AgentAction; variant: Variant }) {
  const task = useTaskRecord(action.ref?.id);
  const { data: vertical } = useVertical();

  // Still loading, or the row is genuinely gone (a hard delete elsewhere) — the
  // summary is what we always had, and it still tells the truth about the act.
  if (!task) return <SummaryFallback action={action} />;

  const domain = vertical.domains.find((d) => d.id === task.domain_id);
  const project = vertical.projects.find((p) => p.id === task.project_id);

  // The record's CURRENT state outranks the verb: undo a create and the card
  // becomes a tombstone on its own, with no local state to keep in sync.
  if (task.status === "trashed") {
    return <Tombstone action={action} title={task.title} variant={variant} />;
  }

  return (
    <Shell
      action={action}
      variant={variant}
      tint={domain?.color ?? null}
      title={task.title}
      done={task.status === "done"}
      verb={task.status === "done" ? "done" : action.verb}
      chips={[
        task.do_date ? fmtDayLabel(task.do_date) : null,
        task.start_time ? `${fmtTime(task.start_time)} · ${fmtDuration(task.duration_minutes)}` : null,
        !task.start_time && !task.do_date ? restLabel(task) : null,
        project ? project.name : domain?.name ?? null,
      ]}
    />
  );
}

function EventRecord({ action, variant }: { action: AgentAction; variant: Variant }) {
  const event = useEventRecord(action.ref?.id);
  if (!event) return <SummaryFallback action={action} />;

  const mins = Math.round(
    (new Date(event.end_at).getTime() - new Date(event.start_at).getTime()) / 60000,
  );

  return (
    <Shell
      action={action}
      variant={variant}
      tint={null}
      title={event.title}
      verb={action.verb}
      chips={[
        fmtDayLabel(localDateISO(event.start_at)),
        event.all_day ? "All day" : `${fmtTime(event.start_at)} · ${fmtDuration(mins)}`,
        event.location,
      ]}
    />
  );
}

/** The calendar date an instant falls on, in the viewer's zone — the same zone
 *  `fmtTime` renders in, so the day chip and the time chip can't disagree. */
function localDateISO(iso: string): string {
  const d = new Date(iso);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** A priority lives in the sprint's jsonb, so a removed one has no row left to
 *  read — the action's own `restore` copy is the last record of it. */
function PriorityRecord({ action, variant }: { action: AgentAction; variant: Variant }) {
  const { data: vertical } = useVertical();
  const rock = vertical.bigRocks.find((r) => r.id === action.ref?.id);

  if (!rock) {
    const gone = action.undo?.kind === "priority" ? action.undo.restore : null;
    if (gone) return <Tombstone action={action} title={gone.title} variant={variant} />;
    return <SummaryFallback action={action} />;
  }

  const project = vertical.projects.find((p) => p.id === rock.project_id);
  const domain = vertical.domains.find((d) => d.id === project?.domainId);
  const done = Boolean(rock.done_at);

  return (
    <Shell
      action={action}
      variant={variant}
      tint={domain?.color ?? null}
      title={rock.title}
      done={done}
      verb={done ? "done" : action.verb}
      chips={["Priority", project?.name ?? null, rock.win || null]}
    />
  );
}

/** What's left of a record the agent removed — and the only place its undo can
 *  live, since it's gone from every other surface in the app. */
function Tombstone({
  action,
  title,
  variant,
}: {
  action: AgentAction;
  title: string;
  variant: Variant;
}) {
  const { undo, undoing } = useAgentUndo();

  if (variant === "row") {
    return (
      <div className="flex items-center gap-2 py-1">
        <span className="text-micro text-muted">✕</span>
        <span className="min-w-0 flex-1 truncate text-caption text-muted line-through">{title}</span>
      </div>
    );
  }

  return (
    <div className="glass-card flex items-center gap-2.5 rounded-lg border border-line/60 px-3 py-2">
      <span className="text-meta text-muted">✕</span>
      <div className="min-w-0 flex-1">
        <div className="text-caption text-muted line-through">{title}</div>
        <div className="text-micro text-muted">Trashed · recoverable</div>
      </div>
      {canRestore(action) && (
        <UndoButton onClick={() => undo(action)} disabled={undoing} label="Restore" />
      )}
    </div>
  );
}

/** A tombstone gets a Restore button only when the undo would actually move the
 *  record. Undoing a `created` action IS "trash it" — running that same patch
 *  again from the tombstone it produced would just re-trash a trashed task and
 *  report success. Undo is not redo: once the record is where the undo wanted
 *  it, the button has nothing left to do and shouldn't pretend otherwise. */
function canRestore(action: AgentAction): boolean {
  const undo = action.undo;
  if (!undo) return false;
  if (undo.kind === "priority") return Boolean(undo.restore);
  return undo.patch.status !== "trashed";
}

function SummaryFallback({ action }: { action: AgentAction }) {
  return <div className="mono text-meta text-muted">✓ {action.summary}</div>;
}

/** A batch, folded: the count carries the scale, a few rows prove it's real,
 *  and one Undo reverses the whole sweep. */
function ActionStack({ verb, actions }: { verb: AgentVerb; actions: AgentAction[] }) {
  const [open, setOpen] = useState(false);
  // Whether the sweep has been reversed is about this button, not about the
  // records — the rows below already show their own live truth. Without it the
  // stack keeps offering an undo that has nothing left to reverse.
  const [reversed, setReversed] = useState(false);
  const { undo, undoing } = useAgentUndo();
  const reversible = actions.filter((a) => a.undo);
  const shown = open ? actions : actions.slice(0, FOLDED_ROWS);

  return (
    <div className="glass-card rounded-lg border border-line/60 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-caption">
          {actions.length} {actions.length === 1 ? "record" : "records"}{" "}
          {(VERB_LABEL[verb] ?? "changed").toLowerCase()}
        </span>
        {actions.length > FOLDED_ROWS && (
          <button
            onClick={() => setOpen((o) => !o)}
            className="fast tap ml-auto rounded-full border border-line px-2.5 py-1 text-label text-muted hover:border-accent hover:text-accent"
          >
            {open ? "Fold" : "Expand"}
          </button>
        )}
      </div>

      <div className="mt-1 border-t border-line/50 pt-1">
        {shown.map((a) => (
          <Record key={a.ref!.id + a.tool} action={a} variant="row" />
        ))}
        {!open && actions.length > shown.length && (
          <div className="pt-1 text-micro text-muted">+ {actions.length - shown.length} more</div>
        )}
      </div>

      {reversible.length > 0 && (
        <div className="mt-1 flex items-center border-t border-line/50 pt-1.5">
          {reversed ? (
            <span className="ml-auto text-micro text-muted">Undone</span>
          ) : (
            <UndoButton
              onClick={() => {
                reversible.forEach((a) => undo(a));
                setReversed(true);
              }}
              disabled={undoing}
              label={`Undo all ${reversible.length}`}
              className="ml-auto"
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── the shared skin ──────────────────────────────────────────────────────────
// Glass, because a card is a thing that floats; hairlines and a domain-hue dot,
// because that's how a record reads everywhere else in the app.

function Shell({
  action,
  variant,
  tint,
  title,
  chips,
  verb,
  done,
}: {
  action: AgentAction;
  variant: Variant;
  tint: string | null;
  title: string;
  chips: (string | null | undefined)[];
  verb: AgentVerb | undefined;
  done?: boolean;
}) {
  const live = chips.filter(Boolean) as string[];

  if (variant === "row") {
    return (
      <div className="flex items-center gap-2 py-1">
        <Dot color={tint} done={done} row />
        <span className={`min-w-0 flex-1 truncate text-caption ${done ? "text-muted line-through" : ""}`}>
          {title}
        </span>
        {live[0] && <span className="shrink-0 text-micro text-muted">{live[0]}</span>}
      </div>
    );
  }

  return (
    <div
      className={`${tint ? "glass-tint" : "glass-card"} rounded-lg border border-line/60 px-3 py-2.5`}
      style={tint ? ({ "--tint": tint } as React.CSSProperties) : undefined}
    >
      <div className="flex items-start gap-2.5">
        <Dot color={tint} done={done} />
        <div className="min-w-0 flex-1">
          <div className={`text-body ${done ? "text-muted line-through" : ""}`}>{title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {live.map((c) => (
              <span
                key={c}
                className="truncate rounded-full border border-line/70 px-2 py-0.5 text-micro text-muted"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
        {verb && <span className="section-label shrink-0 text-micro text-muted">{VERB_LABEL[verb]}</span>}
      </div>
      <Footer action={action} />
    </div>
  );
}

function Dot({ color, done, row }: { color: string | null; done?: boolean; row?: boolean }) {
  return (
    <span
      aria-hidden
      className={`shrink-0 rounded-full ${row ? "size-1.5" : "mt-1.5 size-2"}`}
      style={{ background: done ? "var(--line-strong)" : (color ?? "var(--line-strong)") }}
    />
  );
}

function Footer({ action }: { action: AgentAction }) {
  const { undo, undoing } = useAgentUndo();
  if (!action.undo) return null;
  return (
    <div className="mt-2 flex border-t border-line/50 pt-1.5">
      <UndoButton onClick={() => undo(action)} disabled={undoing} label="Undo" className="ml-auto" />
    </div>
  );
}

function UndoButton({
  onClick,
  disabled,
  label,
  className = "",
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`fast tap rounded-full border border-line px-2.5 py-1 text-label text-muted hover:border-accent hover:text-accent disabled:opacity-50 ${className}`}
    >
      {label}
    </button>
  );
}

/** Where a task rests when it has no date: the inbox, or its project's backlog. */
function restLabel(task: Task): string {
  if (task.status === "inbox") return "Inbox";
  if (task.status === "backlog") return "Backlog";
  return task.status;
}
