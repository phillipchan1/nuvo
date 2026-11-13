// Bulk actions — one bar, both shells.
//
// The audit found four verbs (today · inbox · done · trash), desktop-only. This
// adds the four it named as missing — label, priority, schedule, project-move —
// and gives the phone the bar it never had, over the same component.
//
// Two things it is careful about:
//
// 1 · **Filing carries the whole chain.** Moving tasks to a project writes the
//     project's initiative and domain alongside `project_id`. Writing the
//     project alone and leaving the denormalized copies stale is precisely
//     D-088 — four projects' hours credited to the wrong domains. The rule is
//     the same one `update_task` uses in the agent.
//
// 2 · **Every bulk act is one undoable step**, not N. A bulk mutation that
//     needed eight ⌘Z presses to reverse would be a worse trap than no bulk
//     action at all, so the whole set rides a single `recordUndo` entry.
//
// Instrument (D-190): a raised strip of kit buttons. Choosing one of many
// opens the kit's Menu beside the button on a desk and a PickSheet on a phone
// (never a cursor-anchored popover on a thumb, never a wall of chips).

import { useState } from "react";
import { Icon } from "./Icon";
import { PickSheet } from "./mobile/sheetKit";
import { useIsMobile } from "../hooks/useIsMobile";
import { nextWeekISO, todayISO, tomorrowISO } from "../lib/dates";
import type { Label, Task, TaskPriority } from "../lib/types";
import type { VerticalData } from "../lib/vertical";
import { Button, Dot, IconButton, Menu, MenuItem, MenuSeparator } from "./kit";

export interface BulkOps {
  /** Patch every selected task, as ONE undo entry. */
  patchAll: (patch: Partial<Task>, verb: string) => void;
  /** Add these labels to every selected task (never removes — a bulk clear
   *  wearing the same control is how people lose labels they didn't look at). */
  addLabels: (labelIds: string[]) => void;
  planFor: (dateISO: string) => void;
  complete: () => void;
  backToInbox: () => void;
  trash: () => void;
  clear: () => void;
}

const PRIORITIES: TaskPriority[] = ["high", "medium", "low", "none"];
const PRIORITY_WORD: Record<TaskPriority, string> = { high: "High", medium: "Medium", low: "Low", none: "No priority" };

/** One choice: what it says, its identity mark, what it does. */
type Choice = { id: string; name: string; color?: string | null; act: () => void; separated?: boolean };

// ── one menu that behaves on both shells ───────────────────────────────────

function BulkMenu({ label, title, choices }: { label: string; title: string; choices: Choice[] }) {
  const isMobile = useIsMobile();
  const [btn, setBtn] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        ref={setBtn}
        size="xs"
       
        aria-haspopup={isMobile ? "dialog" : "menu"}
        aria-expanded={open}
        trailing={<Icon name="chevron-down" size={12} />}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </Button>
      {open &&
        (isMobile ? (
          <PickSheet
            title={title}
            rows={choices.map((c) => ({ id: c.id, name: c.name, color: c.color ?? undefined }))}
            value={null}
            onPick={(id) => choices.find((c) => c.id === id)?.act()}
            onClose={() => setOpen(false)}
          />
        ) : (
          <Menu anchor={btn} open onClose={() => setOpen(false)} label={title} placement="top-start">
            {choices.map((c) => (
              <BulkMenuItem key={c.id} choice={c} />
            ))}
          </Menu>
        ))}
    </>
  );
}

function BulkMenuItem({ choice }: { choice: Choice }) {
  return (
    <>
      {choice.separated && <MenuSeparator />}
      <MenuItem icon={choice.color ? <Dot color={choice.color} shape="round" /> : undefined} onSelect={choice.act}>
        {choice.name}
      </MenuItem>
    </>
  );
}

// ── the bar ────────────────────────────────────────────────────────────────

export default function BulkBar({
  count,
  ops,
  labels,
  vertical,
  onTrash = true as boolean | undefined,
  total,
  onSelectAll,
}: {
  count: number;
  ops: BulkOps;
  labels: Label[];
  vertical: VerticalData | undefined;
  /** Trash is offered by default; a surface where delete makes no sense hides it. */
  onTrash?: boolean;
  /** How many rows the list is showing — with `onSelectAll`, the bar offers to
   *  take the rest, so a bulk act never needs the count tapped out row by row. */
  total?: number;
  onSelectAll?: () => void;
}) {
  const projects = (vertical?.projects ?? []).filter((p) => p.status !== "complete" && p.status !== "cancelled");

  const when: Choice[] = [
    { id: "today", name: "Today", act: () => ops.planFor(todayISO()) },
    { id: "tomorrow", name: "Tomorrow", act: () => ops.planFor(tomorrowISO()) },
    { id: "next-week", name: "Next week", act: () => ops.planFor(nextWeekISO()) },
    {
      id: "clear",
      name: "Clear the date",
      separated: true,
      act: () => ops.patchAll({ do_date: null, start_time: null, slot_id: null }, "unscheduled"),
    },
  ];
  const priority: Choice[] = PRIORITIES.map((p) => ({
    id: p,
    name: PRIORITY_WORD[p],
    act: () => ops.patchAll({ priority: p }, `set to ${p} priority`),
  }));
  const label: Choice[] = labels.map((l) => ({ id: l.id, name: l.name, color: l.color, act: () => ops.addLabels([l.id]) }));
  const move: Choice[] = [
    ...projects.slice(0, 40).map((p) => ({
      id: p.id,
      name: p.name,
      // The whole chain, together — see the header (D-088).
      act: () =>
        ops.patchAll(
          { project_id: p.id, initiative_id: p.initiativeId ?? null, domain_id: p.domainId ?? null },
          `filed under ${p.name}`,
        ),
    })),
    {
      id: "__none",
      name: "No project",
      separated: true,
      act: () => ops.patchAll({ project_id: null, initiative_id: null }, "unfiled"),
    },
  ];

  return (
    <div className="bulk-bar shrink-0">
      <span className="bulk-count" role="status" aria-live="polite">
        {count} selected
      </span>
      {onSelectAll && total != null && count < total && (
        <Button size="xs" kind="ghost" onClick={onSelectAll}>
          Select all {total}
        </Button>
      )}
      <span className="bulk-grow" />

      <BulkMenu label="When" title="Plan these for" choices={when} />
      <BulkMenu label="Priority" title="Set priority" choices={priority} />
      {labels.length > 0 && <BulkMenu label="Label" title="Add a label" choices={label} />}
      {projects.length > 0 && <BulkMenu label="Move" title="File under a project" choices={move} />}

      <Button size="xs" icon={<Icon name="check" size={12} />} onClick={ops.complete}>
        Done
      </Button>
      <Button size="xs" onClick={ops.backToInbox}>
        Inbox
      </Button>
      {onTrash && (
        <Button size="xs" kind="danger" onClick={ops.trash}>
          Trash
        </Button>
      )}
      {/* The way out is the one control that must always be reachable by thumb. */}
      <IconButton size="xs" label="Clear selection" shortcut="Esc" icon={<Icon name="close" size={12} />} onClick={ops.clear} />
    </div>
  );
}
