// Selection's visible parts for a list (D-190): the marquee box, the bulk bar
// that rides the filter row, the row's checkbox, and the select states. The
// behaviour is `useCollectionSelection`; this file only draws it — in kit
// terms: a kit box for the checkbox, the accent wash for a selected row.

import type { CollectionSelection } from "../../hooks/useCollectionSelection";
import { Button } from "../kit";

export function MarqueeOverlay({ style }: { style: { left: number; top: number; width: number; height: number } | null }) {
  if (!style || (style.width < 2 && style.height < 2)) return null;
  return <div className="fl-marquee" style={style} />;
}

export function SelectionBulkBar({
  selection,
  onBulkDelete,
}: {
  selection: CollectionSelection;
  onBulkDelete?: (ids: string[]) => void;
  /** @deprecated the bar always rides the filter row now — kept for call-site compat. */
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

  return (
    <div className="fl-bulk" role="toolbar" aria-label="Selection">
      <span>{label}</span>
      {onBulkDelete && selection.count > 0 && (
        <Button
          size="xs"
          kind={selection.deleteArmed ? "danger-solid" : "danger"}
          onClick={selection.bulkDelete}
          shortcut={selection.deleteArmed ? "⌫" : undefined}
        >
          {selection.deleteArmed ? "Delete them" : "Delete"}
        </Button>
      )}
      <Button
        size="xs"
        kind="ghost"
        shortcut="esc"
        onClick={() => {
          selection.clear();
          selection.setDeleteArmed(false);
        }}
      >
        Clear
      </Button>
    </div>
  );
}

/** The row's checkbox — the kit box, with a third state while a marquee is
 *  over the row (it will be selected when you let go). */
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
      role="checkbox"
      data-no-select
      aria-checked={checked}
      data-preview={!checked && preview ? "" : undefined}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-label={checked ? "Deselect" : preview ? "Will select" : "Select"}
      className={`k-box ${className}`}
    />
  );
}

export type ItemSelectVisual = "none" | "selected" | "preview";

export function itemSelectVisual(selection: CollectionSelection, id: string): ItemSelectVisual {
  if (selection.isSelected(id)) return "selected";
  if (selection.isPreviewSelected(id)) return "preview";
  return "none";
}

/** A selected card takes the kit's selection: an accent ring + lift (its
 *  `aria-selected`); a card under the marquee reads a dashed accent hint. */
export function itemSelectClass(selection: CollectionSelection, id: string) {
  const v = itemSelectVisual(selection, id);
  if (v === "selected") return "glass-lift relative z-10";
  if (v === "preview") return "outline outline-1 outline-dashed outline-[var(--accent-ring)] -outline-offset-1";
  return "";
}

/** A selected row takes the accent wash (`.glass-lift-row` renders it). */
export function itemSelectRowClass(selection: CollectionSelection, id: string) {
  const v = itemSelectVisual(selection, id);
  if (v === "selected") return "glass-lift-row relative z-10";
  if (v === "preview") return "outline outline-1 outline-dashed outline-[var(--accent-ring)] -outline-offset-1";
  return "row-hover";
}
