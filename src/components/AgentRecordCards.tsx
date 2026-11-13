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
//
// Drawn with the kit (D-190): a record is a kit Card, its facts are kit Chips,
// its undo a ghost Button.
import { useState } from "react";
import { useAgentUndo, useEventRecord, useSlotRecord, useTaskRecord } from "../hooks/useAgentRecords";
import { useCalendarAccounts, useExternalEventMutations } from "../hooks/useCalendar";
import { useSettings } from "../hooks/useSettings";
import { useSlotTasks } from "../hooks/useSlots";
import { useVertical } from "../hooks/useVertical";
import { isWritableAccount, providerLabel, writableCalendarTargets } from "../lib/calendarWrite";
import { fmtDayLabel, fmtDuration, fmtTime } from "../lib/dates";
import type { AgentAction, AgentVerb } from "../lib/agentTypes";
import type { ExternalEvent, Task } from "../lib/types";
import { useIsMobile } from "../hooks/useIsMobile";
import Sheet from "./mobile/Sheet";
import { Icon } from "./Icon";
import { Button, Chip, Dot as KitDot, Menu, MenuItem, MenuLabel } from "./kit";

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

/** A chip is a fact, unless the fact is worth acting on — then it's a control
 *  that renders in the same pill. Keyed explicitly since a node has no text. */
type Chip = string | null | undefined | { key: string; node: React.ReactNode };

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
    <div className="agent-cards">
      {[...groups.entries()].map(([verb, group]) =>
        group.length >= STACK_AT ? (
          <ActionStack key={verb} verb={verb as AgentVerb} actions={group} />
        ) : (
          group.map((a) => <Record key={a.ref!.id + a.tool} action={a} variant="card" />)
        ),
      )}

      {plain.length > 0 && (
        <ul className="agent-plain" data-after={cards.length ? "" : undefined}>
          {plain.map((a) => (
            <li key={a.summary}>
              <Icon name="check" size={12} />
              {a.summary}
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
  if (action.ref?.kind === "slot") return <SlotRecord action={action} variant={variant} />;
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

/** A block of time the agent held. Its chips say what a block IS — when it
 *  starts, how long it holds, and how much work is inside — because that is the
 *  question a user asks about a block, not what the individual items are. */
function SlotRecord({ action, variant }: { action: AgentAction; variant: Variant }) {
  const slot = useSlotRecord(action.ref?.id);
  const { data: vertical } = useVertical();
  const inside = useSlotTasks(slot ? [slot.id] : []);
  if (!slot) return <SummaryFallback action={action} />;

  const domain = vertical.domains.find((d) => d.id === slot.domain_id);
  const project = vertical.projects.find((p) => p.id === slot.project_id);
  const count = inside.data?.filter((t) => t.status !== "trashed").length ?? 0;

  return (
    <Shell
      action={action}
      variant={variant}
      tint={slot.color ?? domain?.color ?? null}
      title={slot.title || "Untitled block"}
      verb={action.verb}
      chips={[
        fmtDayLabel(slot.do_date),
        `${fmtTime(slot.start_time)} · ${fmtDuration(slot.duration_minutes)}`,
        count ? `${count} inside` : "empty",
        project ? project.name : domain?.name ?? null,
      ]}
    />
  );
}

function EventRecord({ action, variant }: { action: AgentAction; variant: Variant }) {
  const event = useEventRecord(action.ref?.id);
  const { data: accounts } = useCalendarAccounts();
  if (!event) return <SummaryFallback action={action} />;

  const mins = Math.round(
    (new Date(event.end_at).getTime() - new Date(event.start_at).getTime()) / 60000,
  );
  const account = accounts?.find((a) => a.id === event.account_id);
  const calName = account?.calendars?.find((c) => c.id === event.calendar_id)?.summary;

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
        // The calendar is where this went — the one fact most likely to be
        // wrong, so it's a control, not a caption. Reading it and fixing it are
        // the same gesture. (Row variant keeps its plain label; a stack row has
        // no room, and the card underneath it does.)
        variant === "card"
          ? { key: "calendar", node: <CalendarChip event={event} label={calName} /> }
          : calName,
        event.location,
      ]}
    />
  );
}

/** Which calendar the event landed on — and one tap to put it somewhere else.
 *  Only the calendars still on the user's board are offered: the same rule the
 *  agent now follows, so the fix can't land the event back out of sight. A
 *  kit Menu at a desk; a bottom Sheet on a phone (golden rule 3). */
function CalendarChip({ event, label }: { event: ExternalEvent; label?: string }) {
  const [open, setOpen] = useState(false);
  const [btn, setBtn] = useState<HTMLButtonElement | null>(null);
  const isMobile = useIsMobile();
  const { data: accounts } = useCalendarAccounts();
  const { settings } = useSettings();
  const { moveEventToCalendar } = useExternalEventMutations();

  const hidden = new Set(settings?.hidden_calendar_ids ?? []);
  const groups = writableCalendarTargets(accounts ?? [], event.calendar_id)
    .map((g) => ({
      ...g,
      calendars: g.calendars.filter((c) => !hidden.has(c.id) || c.id === event.calendar_id),
    }))
    .filter((g) => g.calendars.length > 0);
  const count = groups.reduce((n, g) => n + g.calendars.length, 0);
  const writable = isWritableAccount(accounts?.find((a) => a.id === event.account_id));

  // Nowhere else to put it — the calendar is just a fact again.
  if (!label || !writable || count < 2) {
    return label ? <Chip>{label}</Chip> : null;
  }

  const pick = (accountId: string, calendarId: string, current: boolean) => {
    setOpen(false);
    if (current) return;
    moveEventToCalendar({ id: event.id, targetAccountId: accountId, targetCalendarId: calendarId });
  };

  return (
    <>
      {/* the kit chip's own markup — ChipButton takes no ref, and the menu
          needs its anchor */}
      <button
        ref={setBtn}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="k-chip tap-h"
        data-open={open || undefined}
      >
        <span>{label}</span>
        <Icon name="chevron-down" size={11} />
      </button>

      {isMobile ? (
        open && (
          <Sheet onClose={() => setOpen(false)} title="Move to calendar">
            <div className="agent-sheet-list pb-safe">
              {groups.map((g) => (
                <div key={g.accountId}>
                  <div className="k-mlabel">
                    {g.accountLabel} · {providerLabel(g.provider)}
                  </div>
                  {g.calendars.map((c) => {
                    const current = g.accountId === event.account_id && c.id === event.calendar_id;
                    return (
                      <button
                        key={`${g.accountId}:${c.id}`}
                        type="button"
                        className="agent-sheet-row"
                        aria-pressed={current}
                        onClick={() => pick(g.accountId, c.id, current)}
                      >
                        <KitDot color={c.color ?? "var(--muted)"} shape="round" />
                        <span>{c.summary}</span>
                        {current && <Icon name="check" size={16} />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </Sheet>
        )
      ) : (
        <Menu anchor={btn} open={open} onClose={() => setOpen(false)} label="Move to calendar">
          {groups.map((g) => (
            <div key={g.accountId}>
              <MenuLabel>
                {g.accountLabel} · {providerLabel(g.provider)}
              </MenuLabel>
              {g.calendars.map((c) => {
                const current = g.accountId === event.account_id && c.id === event.calendar_id;
                return (
                  <MenuItem
                    key={`${g.accountId}:${c.id}`}
                    icon={<KitDot color={c.color ?? "var(--muted)"} shape="round" />}
                    checked={current}
                    onSelect={() => pick(g.accountId, c.id, current)}
                  >
                    {c.summary}
                  </MenuItem>
                );
              })}
            </div>
          ))}
        </Menu>
      )}
    </>
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
      <div className="agent-card-row" data-gone="">
        <Icon name="trash" size={12} />
        <span>{title}</span>
      </div>
    );
  }

  return (
    <div className="k-card agent-card" data-gone="">
      <div className="agent-card-top">
        <Icon name="trash" size={14} />
        <div className="agent-card-main">
          <div className="agent-card-title">{title}</div>
          <div className="agent-card-sub">Trashed · recoverable</div>
        </div>
        {canRestore(action) && <UndoButton onClick={() => undo(action)} disabled={undoing} label="Restore" />}
      </div>
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
  // Releasing a block is always a real move — there's no "already released"
  // state a tombstone could be sitting in.
  if (undo.kind === "slot-delete") return true;
  return undo.patch.status !== "trashed";
}

function SummaryFallback({ action }: { action: AgentAction }) {
  return (
    <div className="agent-plain-one">
      <Icon name="check" size={12} />
      {action.summary}
    </div>
  );
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
    <div className="k-card agent-card">
      <div className="agent-card-top">
        <span className="agent-card-title">
          {actions.length} {actions.length === 1 ? "record" : "records"} {(VERB_LABEL[verb] ?? "changed").toLowerCase()}
        </span>
        {actions.length > FOLDED_ROWS && (
          <Button kind="ghost" size="xs" className="tap ml-auto" onClick={() => setOpen((o) => !o)}>
            {open ? "Fold" : "Expand"}
          </Button>
        )}
      </div>

      <div className="agent-card-rows">
        {shown.map((a) => (
          <Record key={a.ref!.id + a.tool} action={a} variant="row" />
        ))}
        {!open && actions.length > shown.length && <div className="agent-card-sub">{actions.length - shown.length} more</div>}
      </div>

      {reversible.length > 0 && (
        <div className="agent-card-foot">
          {reversed ? (
            <span className="agent-card-sub ml-auto">Undone</span>
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
// A kit Card, because a record is a thing that floats; the domain's Dot and kit
// Chips, because that's how a record reads everywhere else in the app.

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
  chips: Chip[];
  verb: AgentVerb | undefined;
  done?: boolean;
}) {
  const live = chips.filter(Boolean) as Exclude<Chip, null | undefined>[];

  if (variant === "row") {
    // A row is one line of proof inside a stack — text only, no controls.
    const first = live.find((c) => typeof c === "string") as string | undefined;
    return (
      <div className="agent-card-row" data-done={done || undefined}>
        <Dot color={tint} done={done} />
        <span>{title}</span>
        {first && <small>{first}</small>}
      </div>
    );
  }

  return (
    <div className="k-card agent-card">
      <div className="agent-card-top">
        <Dot color={tint} done={done} />
        <div className="agent-card-main">
          <div className="agent-card-title" data-done={done || undefined}>
            {title}
          </div>
          <div className="agent-card-chips">
            {live.map((c) => (typeof c === "string" ? <Chip key={c}>{c}</Chip> : <span key={c.key}>{c.node}</span>))}
          </div>
        </div>
        {verb && <span className="agent-card-verb">{VERB_LABEL[verb]}</span>}
      </div>
      <Footer action={action} />
    </div>
  );
}

/** The record's identity — its domain's hue as the kit Dot; spent once done. */
function Dot({ color, done }: { color: string | null; done?: boolean }) {
  return <KitDot color={done ? "var(--line-2)" : (color ?? "var(--line-2)")} />;
}

function Footer({ action }: { action: AgentAction }) {
  const { undo, undoing } = useAgentUndo();
  if (!action.undo) return null;
  return (
    <div className="agent-card-foot">
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
    <Button kind="ghost" size="xs" onClick={onClick} disabled={disabled} className={`tap ${className}`}>
      {label}
    </Button>
  );
}

/** Where a task rests when it has no date: the inbox, or its project's backlog. */
function restLabel(task: Task): string {
  if (task.status === "inbox") return "Inbox";
  if (task.status === "backlog") return "Backlog";
  return task.status;
}
