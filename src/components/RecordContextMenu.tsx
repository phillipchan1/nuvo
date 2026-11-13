import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useMemo, useState } from "react";
import { Button, Menu, MenuItem, MenuSeparator } from "./kit";
import { keycaps } from "./PopoverParts";
import { useVertical } from "../hooks/useVertical";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { useRecordWeekActs } from "../hooks/useProjectTime";
import { ProjectShipAssess } from "./record/ShipAssess";
import {
  buildRecordActions,
  type RecordAction,
  type RecordKind,
} from "../lib/recordActions";

/**
 * One right-click menu for the vertical's records (projects · initiatives), shared
 * across every surface they appear on — On Deck planner, Collection table, and the
 * Groom walls. The actions mirror what a card already exposes (open · complete ·
 * park) plus the one thing no card offered before: a quick, guarded **Delete**.
 *
 * Delete is a *hard* delete (see useVertical.deleteProject / deleteInitiative) with
 * no undo, so the menu switches to an in-place confirm step rather than firing on a
 * single click.
 *
 * Usage — call the hook once in a view, spread the handler on each card/row, and
 * render `{menu}` once anywhere in the subtree:
 *
 *   const { onContextMenu, menu } = useRecordContextMenu();
 *   <div onContextMenu={onContextMenu("project", p.id)} … />
 *   {menu}
 */

// The acts themselves live in `lib/recordActions` — shared with the phone's
// long-press sheet (`mobile/MobileRecordActions`). This file is only the
// right-click *presentation* of them.
type Kind = RecordKind;

interface OpenState {
  kind: Kind;
  id: string;
  x: number;
  y: number;
}

type Item = RecordAction;

export function useRecordContextMenu() {
  const [state, setState] = useState<OpenState | null>(null);
  // Shipping a project asks first, from here too — same moment as the record, the
  // deck and the groom wall. Lives on the hook (not the menu) so it survives the
  // menu closing underneath it.
  const [shipId, setShipId] = useState<string | null>(null);

  const onContextMenu = useCallback(
    (kind: Kind, id: string) => (e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setState({ kind, id, x: e.clientX, y: e.clientY });
    },
    [],
  );

  const close = useCallback(() => setState(null), []);

  const menu = (
    <>
      {state && <RecordMenu state={state} onClose={close} onShip={setShipId} />}
      {shipId && <ProjectShipAssess id={shipId} onClose={() => setShipId(null)} />}
    </>
  );

  return { onContextMenu, menu, closeMenu: close };
}

function RecordMenu({ state, onClose, onShip }: { state: OpenState; onClose: () => void; onShip: (id: string) => void }) {
  const { data, updateProject, deleteProject, updateInitiative, deleteInitiative } = useVertical();
  const { openRecord } = useAppNavigation();
  const [confirm, setConfirm] = useState<Item | null>(null);
  const week = useRecordWeekActs(state.kind, state.id);

  const items = buildRecordActions(state.kind, state.id, data, {
    openRecord,
    updateProject,
    deleteProject,
    updateInitiative,
    deleteInitiative,
    onShip,
    onClose,
    week,
  });

  // Anchored at the pointer and FLIPPED by its measured size (the kit's
  // placement), the way an NSMenu opens up/left near a screen edge. A new
  // anchor when the confirm step swaps in re-measures the taller face.
  const anchor = useMemo(() => ({ x: state.x, y: state.y }), [state.x, state.y, confirm]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = (item: Item) => {
    if (item.kind !== "action") return;
    if (item.confirm) {
      setConfirm(item);
      return;
    }
    item.action();
  };

  // The kit popover: Escape and a press outside close it, arrows and
  // type-ahead walk it (useMenuFocus), focus goes back to the row on close.
  // Lists behind it stand down while it owns the keys (data-nested-surface).
  return (
    <Menu
      anchor={anchor}
      open
      onClose={onClose}
      label={state.kind === "project" ? "Project actions" : "Initiative actions"}
      className="w-[220px]"
    >
      <div onContextMenu={(e) => e.preventDefault()}>
        {confirm && confirm.kind === "action" ? (
          <div className="k-mconfirm">
            <p>{confirm.confirm}</p>
            <p className="k-mconfirm-sub">
              {confirm.undoable ? "The work stays in the project. You can undo this." : "This can't be undone."}
            </p>
            <div className="k-mconfirm-acts">
              <Button onClick={() => setConfirm(null)}>Cancel</Button>
              <Button kind={confirm.danger ? "danger-solid" : "primary"} onClick={confirm.action}>
                {confirm.confirmLabel ?? "Delete"}
              </Button>
            </div>
          </div>
        ) : (
          items.map((item, i) =>
            item.kind === "sep" ? (
              <MenuSeparator key={i} />
            ) : (
              <MenuItem
                key={i}
                danger={item.danger}
                shortcut={item.key ? keycaps(item.key) : undefined}
                keepOpen={Boolean(item.confirm)}
                onSelect={() => run(item)}
              >
                {item.label}
              </MenuItem>
            ),
          )
        )}
      </div>
    </Menu>
  );
}
