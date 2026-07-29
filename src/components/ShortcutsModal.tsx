import { Keycap, Modal } from "./ui";

// A single shortcut: one label, and one-or-more key renderings. A string is a
// keycap; nested arrays render as a combo with a "then/or" separator passed in.
type Combo = string[];
type Shortcut = { keys: Combo[]; sep?: string; label: string };
type Group = { title: string; items: Shortcut[] };

const GROUPS: Group[] = [
  {
    title: "Schedule",
    items: [
      { keys: [["S"]], label: "Spread (week board)" },
      { keys: [["W"]], label: "Week" },
      { keys: [["D"]], label: "Day" },
      { keys: [["M"]], label: "Month" },
      { keys: [["="], ["⌘", "→"]], sep: "or", label: "Next period" },
      { keys: [["−"], ["⌘", "←"]], sep: "or", label: "Previous period" },
      { keys: [["⌘", "T"]], label: "Today" },
      { keys: [["⌘", "."]], label: "Focus (hide panels)" },
      { keys: [["⌘", "\\"]], label: "Collapse the spine to icons" },
      { keys: [["⌘", "["]], label: "Back" },
    ],
  },
  {
    title: "Floors",
    items: [
      { keys: [["⌘", "1"], ["⌘", "4"]], sep: "–", label: "Jump to a floor" },
      { keys: [["⌘", "↑"], ["⌘", "↓"]], sep: "/", label: "Travel the ladder" },
    ],
  },
  {
    title: "Create & tools",
    items: [
      { keys: [["C"]], label: "Capture to inbox" },
      { keys: [["⌘", "K"]], label: "Command bar" },
      { keys: [["⌘", "J"]], label: "Toggle Nuvo" },
      { keys: [["⌘", ","]], label: "Settings" },
      { keys: [["⌘", "+"], ["⌘", "−"]], sep: "/", label: "Zoom in / out" },
      { keys: [["⌘", "0"]], label: "Reset zoom" },
      { keys: [["P"]], label: "New project" },
      { keys: [["I"]], label: "New initiative" },
      { keys: [["?"]], label: "This panel" },
    ],
  },
  {
    title: "Inbox & tasks",
    items: [
      { keys: [["J"], ["K"]], sep: "/", label: "Move cursor" },
      { keys: [["↵"]], label: "Open task" },
      { keys: [["E"]], label: "Plan for today" },
      { keys: [["T"]], label: "Plan for tomorrow" },
      { keys: [["N"]], label: "Plan for next week" },
      { keys: [["F"]], label: "Mark done / reopen" },
      { keys: [["R"]], label: "Reschedule (pick date)" },
      { keys: [["I"]], label: "Back to inbox" },
      { keys: [["X"]], label: "Move to trash" },
      { keys: [["#"]], label: "Label" },
      { keys: [["1"], ["2"]], sep: "/", label: "Inbox / Today tab" },
    ],
  },
];

function Row({ keys, sep, label }: Shortcut) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-caption text-muted">{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        {keys.map((combo, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="px-0.5 text-micro text-muted">{sep ?? "or"}</span>}
            {combo.map((k, j) => (
              <Keycap key={j}>{k}</Keycap>
            ))}
          </span>
        ))}
      </span>
    </div>
  );
}

export default function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} width="max-w-2xl">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div>
          <h2 className="text-head font-semibold text-ink">Keyboard shortcuts</h2>
          <p className="mt-0.5 text-caption leading-snug text-muted">
            The Schedule is your home — letters switch the view, the rest moves you around.
          </p>
        </div>
        <button
          onClick={onClose}
          className="fast -mr-1 flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Two masonry-ish columns on desktop; a single column on a phone. */}
      <div className="grid gap-x-8 gap-y-5 px-5 py-4 sm:grid-cols-2">
        {GROUPS.map((g) => (
          <section key={g.title} className="break-inside-avoid">
            <div className="section-label pb-1">{g.title}</div>
            <div className="divide-y divide-line/60">
              {g.items.map((s) => (
                <Row key={s.label} {...s} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}
