import type { CollectionSelection } from "../../hooks/useCollectionSelection";

export function MarqueeOverlay({ style }: { style: { left: number; top: number; width: number; height: number } | null }) {
  if (!style || (style.width < 2 && style.height < 2)) return null;
  return (
    <div
      className="pointer-events-none fixed z-[200] rounded-sm border-2 border-accent bg-accent/15 shadow-sm"
      style={style}
    />
  );
}

export function SelectionBulkBar({
  selection,
  onBulkDelete,
  inline = false,
}: {
  selection: CollectionSelection;
  onBulkDelete?: (ids: string[]) => void;
  /** Renders in the toolbar row — no extra layout height. */
  inline?: boolean;
}) {
  if (!selection.enabled) return null;

  const preview = selection.isMarqueeActive && selection.previewCount > 0;
  const show = selection.count > 0 || preview;
  if (!show) return null;

  const label =
    preview && selection.count === 0
      ? `${selection.previewCount} in box`
      : preview
        ? `${selection.count} selected · ${selection.previewCount} in box`
        : `${selection.count} selected`;

  const shell = inline
    ? "flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-accent-soft px-2"
    : "rise elev-3 flex flex-wrap items-center gap-2 rounded-full border border-accent/40 bg-surface/95 px-4 py-2 shadow-lg backdrop-blur-sm";

  return (
    <div className={shell}>
      <span className="mono text-meta font-medium leading-none text-accent">{label}</span>
      {onBulkDelete && selection.count > 0 && (
        <button
          onClick={selection.bulkDelete}
          className={`fast flex h-5 items-center rounded border px-1.5 text-meta leading-none ${
            selection.deleteArmed
              ? "border-signal bg-signal text-white"
              : "border-signal/30 text-signal hover:bg-signal-soft"
          }`}
        >
          {selection.deleteArmed ? "Confirm (Delete)" : "Delete"}
        </button>
      )}
      <button
        onClick={() => {
          selection.clear();
          selection.setDeleteArmed(false);
        }}
        className="fast flex h-5 items-center rounded border border-line px-1.5 text-meta leading-none text-muted hover:text-ink"
      >
        Clear
      </button>
    </div>
  );
}

export function SelectCheckbox({
  checked,
  preview,
  onToggle,
  className = "",
}: {
  checked: boolean;
  preview?: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-no-select
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-label={checked ? "Deselect" : preview ? "Will select" : "Select"}
      className={`fast flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
        checked
          ? "border-accent bg-accent text-on-accent"
          : preview
            ? "border-accent/70 bg-accent-soft text-accent"
            : "border-line bg-surface hover:border-accent"
      } ${className}`}
    >
      {(checked || preview) && <span className="text-meta">{checked ? "✓" : "◦"}</span>}
    </button>
  );
}

export function SelectionHint({ enabled, count, recordCount, previewCount }: {
  enabled: boolean;
  count: number;
  recordCount: number;
  previewCount?: number;
}) {
  if (!enabled || recordCount === 0) return null;
  if (count > 0 || (previewCount ?? 0) > 0) return null;
  return (
    <p className="mono mt-2 text-meta text-muted">
      Table/Timeline: click or drag to select · Board/Calendar: drag cards to move · checkboxes · ⌘/⇧+click · Delete to remove · double-click to open
    </p>
  );
}

export type ItemSelectVisual = "none" | "selected" | "preview";

export function itemSelectVisual(selection: CollectionSelection, id: string): ItemSelectVisual {
  if (selection.isSelected(id)) return "selected";
  if (selection.isPreviewSelected(id)) return "preview";
  return "none";
}

export function itemSelectClass(selection: CollectionSelection, id: string) {
  const v = itemSelectVisual(selection, id);
  // The focal element lifts — frosted glass + shadow + rise — instead of a flat
  // outline. Preview (will-select) stays a light dashed hint, not a full lift.
  if (v === "selected") return "glass-lift relative z-10";
  if (v === "preview") return "outline outline-2 outline-dashed outline-accent/70 bg-accent-soft/45 -outline-offset-2";
  return "";
}

export function itemSelectRowClass(selection: CollectionSelection, id: string) {
  const v = itemSelectVisual(selection, id);
  // Same focal lift as a card, in a row variant — so a selected table/timeline row
  // reads identically to a selected board card (glass + shadow, no flat tint).
  if (v === "selected") return "glass-lift-row relative z-10";
  if (v === "preview") return "bg-accent-soft/45 outline outline-1 outline-dashed outline-accent/70 -outline-offset-1";
  return "hover:bg-accent-soft/60";
}
