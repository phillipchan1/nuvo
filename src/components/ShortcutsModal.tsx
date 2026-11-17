import { isMac } from "../lib/platform";
import { DialogHead, Modal } from "./ui";
import { Kbd, SectionHeader } from "./kit";

// A single shortcut: one label, and one-or-more key renderings. A string is a
// keycap; nested arrays render as a combo with a "then/or" separator passed in.
type Combo = string[];
type Shortcut = { keys: Combo[]; sep?: string; label: string };
type Group = { title: string; items: Shortcut[] };

const GROUPS: Group[] = [
  {
    title: "Schedule",
    items: [
      { keys: [["W"]], label: "Week" },
      { keys: [["D"]], label: "Day" },
      { keys: [["M"]], label: "Month" },
      { keys: [["Y"]], label: "Year" },
      { keys: [["S"]], label: "Spread (week board)" },
      { keys: [["="], ["⌘", "→"]], sep: "or", label: "Next period" },
      { keys: [["−"], ["⌘", "←"]], sep: "or", label: "Previous period" },
      { keys: [["⌘", "T"]], label: "Today" },
      { keys: [["⌘", "."]], label: "Focus on the block you're in" },
      { keys: [["⌘", "\\"]], label: "Collapse the spine to icons" },
      { keys: [["⌘", "["]], label: "Back" },
    ],
  },
  {
    title: "Floors",
    items: [
      { keys: [["⌘", "1"], ["⌘", "4"]], sep: "–", label: "Jump to a floor" },
      { keys: [["⌘", "↑"], ["⌘", "↓"]], sep: "/", label: "Travel the ladder" },
      { keys: [["1"], ["5"]], sep: "–", label: "The page's views — 1 is home (Week / On Deck)" },
      { keys: [["["], ["]"]], sep: "/", label: "A list's tabs — previous / next (Today · Inbox, the Table's views)" },
    ],
  },
  {
    title: "Create & tools",
    items: [
      { keys: [["A"], ["C"]], sep: "or", label: "Add a task (the rail's box)" },
      { keys: [["/"]], label: "Search — tasks, projects, domains, meetings, a date" },
      { keys: [["⌘", "K"]], label: "Quick add — a task, event or slot" },
      { keys: [["⌘", "1"], ["⌘", "3"]], sep: "–", label: "In quick add: Task · Event · Slot" },
      { keys: [["⌘", ","]], label: "Settings" },
      { keys: [["⇧", "⌘", "L"]], label: "Switch light / dark" },
      { keys: [["⌘", "+"], ["⌘", "−"]], sep: "/", label: "Zoom in / out" },
      { keys: [["⌘", "0"]], label: "Reset zoom" },
      { keys: [["P"]], label: "New project" },
      { keys: [["I"]], label: "New initiative" },
      { keys: [["⌘", "Z"]], label: "Undo" },
      { keys: [["⇧", "⌘", "Z"]], label: "Redo" },
      { keys: [["?"]], label: "This panel" },
    ],
  },
  {
    // One grammar for every task list — the rail, a record, a slot
    // (components/tasks/useTaskListKeys). The panel says only what they bind.
    title: "Task lists",
    items: [
      { keys: [["J"], ["K"]], sep: "/", label: "Move cursor" },
      { keys: [["↵"]], label: "Open task" },
      { keys: [["E"]], label: "Mark done / reopen" },
      { keys: [["T"]], label: "When… (type a day or a time)" },
      { keys: [["V"]], label: "Move to… (project, initiative, domain, out of a slot)" },
      { keys: [["X"]], label: "Select — then any key acts on all" },
      { keys: [["⌫"]], label: "Move to trash" },
      { keys: [["⌘", "E"]], label: "Rename in place" },
      { keys: [["⌥", "↑"], ["⌥", "↓"]], sep: "/", label: "Move task up / down" },
      { keys: [["A"], ["⇧", "A"]], sep: "/", label: "Add below / above" },
      { keys: [["."]], label: "The row's menu" },
      { keys: [["Esc"]], label: "Clear selection, then cursor" },
    ],
  },
  {
    // The same grammar on the calendar (D-158): a click selects a block, ⇧/⌘-click
    // adds to it, and the keys belong to whichever pane you pressed in last.
    title: "Calendar blocks",
    items: [
      { keys: [["J"], ["K"]], sep: "/", label: "Next / previous block, by time" },
      { keys: [["⇧", "click"], ["⌘", "click"]], sep: "or", label: "Add a block to the selection" },
      { keys: [["E"], ["T"], ["V"]], sep: "·", label: "Done · When… · Move to… (tasks)" },
      { keys: [["↵"], ["."]], sep: "/", label: "Open / its menu" },
      { keys: [["⌫"]], label: "Delete — a series or an invite asks first" },
      { keys: [["⌘", "E"], ["⌘", "D"]], sep: "/", label: "Rename / duplicate (selects the copy)" },
      { keys: [["⌥", "↑"], ["⌥", "↓"]], sep: "/", label: "15 minutes earlier / later" },
      { keys: [["⌥", "←"], ["⌥", "→"]], sep: "/", label: "A day earlier / later" },
      { keys: [["⌥", "⇧", "↑"], ["⌥", "⇧", "↓"]], sep: "/", label: "15 minutes shorter / longer" },
      { keys: [["Esc"]], label: "Mid-drag: release to cancel" },
      { keys: [["↑"], ["↓"]], sep: "/", label: "In a new draft: nudge it (⇧ its end)" },
    ],
  },
  {
    // The rail is one walk (D-222): the week's projects, an open project's
    // tasks, then Today & Inbox — the Table's keys, on the Schedule.
    title: "The week's projects (rail)",
    items: [
      { keys: [["↑"], ["↓"]], sep: "/", label: "Walk projects and their tasks — on into Today & Inbox" },
      { keys: [["→"]], label: "Open a project, then step into its tasks" },
      { keys: [["←"]], label: "Close the project (from anywhere inside it)" },
      { keys: [["↵"]], label: "Open the project, or the task" },
      { keys: [["E"]], label: "Done (a task) · Ship (a project)" },
      { keys: [["⌫"], ["."]], sep: "/", label: "Delete / the row's menu" },
      { keys: [["Esc"]], label: "Step out of a project's tasks" },
    ],
  },
  {
    title: "Today & Inbox",
    items: [
      { keys: [["N"]], label: "Plan for next week" },
      { keys: [["I"]], label: "Back to inbox" },
      { keys: [["R"]], label: "Pick a date and time" },
      { keys: [["#"]], label: "Label" },
      { keys: [["B"]], label: "Remind (a scheduled task or a deadline)" },
      { keys: [["F"]], label: "Filter the list (Esc clears it)" },
      { keys: [["U"]], label: "Restore (on the Trash tab)" },
      { keys: [["["], ["]"]], sep: "/", label: "Today · Inbox · Trash — previous / next (opens the tray)" },
    ],
  },
  {
    // Not bindings so much as promises: these hold on every surface, so the
    // panel is where they stop being folklore.
    title: "Everywhere",
    items: [
      { keys: [["Tab"], ["⇧", "Tab"]], sep: "/", label: "Next / previous control" },
      { keys: [["↵"], ["Space"]], sep: "or", label: "Activate what's focused" },
      { keys: [["Esc"]], label: "Close a menu, modal or picker" },
    ],
  },
];

// Keycaps in the platform's spelling: ⌘ ⌥ ⇧ on a Mac, Ctrl / Alt / Shift elsewhere.
const MAC = isMac();
const glyph = (k: string) => (MAC ? k : ({ "⌘": "Ctrl", "⌃": "Ctrl", "⌥": "Alt", "⇧": "Shift" } as Record<string, string>)[k] ?? k);

function Row({ keys, sep, label }: Shortcut) {
  return (
    <div className="sc-row">
      <span>{label}</span>
      <span className="sc-keys">
        {keys.map((combo, i) => (
          <span key={i} className="sc-combo">
            {i > 0 && <span className="sc-sep">{sep ?? "or"}</span>}
            <Kbd keys={combo.map(glyph)} />
          </span>
        ))}
      </span>
    </div>
  );
}

/** The groups themselves — the `?` panel wraps them in a dialog, and Settings →
 *  Shortcuts is the same list in a pane (the spine no longer carries a `?`). */
export function ShortcutGroups({ className = "" }: { className?: string }) {
  return (
    <div className={`sc-grid ${className}`}>
      {GROUPS.map((g) => (
        <section key={g.title}>
          <SectionHeader title={g.title} className="!px-0" />
          {g.items.map((s) => (
            <Row key={s.label} {...s} />
          ))}
        </section>
      ))}
    </div>
  );
}

export default function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    // Centered and bounded, with the body owning the scroll: this dialog is
    // taller than a laptop window, so the head stays and the groups scroll.
    <Modal onClose={onClose} width="max-w-2xl" align="center">
      <DialogHead title="Keyboard shortcuts" onClose={onClose} />
      {/* Two columns on desktop; a single column on a phone. */}
      <ShortcutGroups className="dlg-body" />
    </Modal>
  );
}
