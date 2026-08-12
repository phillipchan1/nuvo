import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useVertical } from "../hooks/useVertical";
import { useAppNavigation } from "../hooks/useAppNavigation";
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const items = buildRecordActions(state.kind, state.id, data, {
    openRecord,
    updateProject,
    deleteProject,
    updateInitiative,
    deleteInitiative,
    onShip,
    onClose,
  });

  // Clamp to the viewport — mirrors TaskContextMenu.
  const POP_W = 210;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = state.x + POP_W > vw - 8 ? vw - POP_W - 8 : state.x;
  const top = state.y + 280 > vh - 8 ? vh - 280 - 8 : state.y;

  const run = (item: Item) => {
    if (item.kind !== "action") return;
    if (item.confirm) {
      setConfirm(item);
      return;
    }
    item.action();
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        className="rise elev-3 fixed z-50 overflow-hidden rounded-[var(--radius)] border border-line bg-surface py-1"
        style={{ top, left, width: POP_W }}
      >
        {confirm && confirm.kind === "action" ? (
          <div className="px-3 py-2">
            <p className="text-caption text-ink">{confirm.confirm}</p>
            <p className="mt-0.5 text-meta text-muted">This can't be undone.</p>
            <div className="mt-2.5 flex items-center gap-1.5">
              <button
                onClick={confirm.action}
                className="fast flex-1 rounded-[var(--radius-sm)] px-2 py-1 text-center text-caption font-medium text-white"
                style={{ background: "var(--signal)" }}
              >
                Delete
              </button>
              <button
                onClick={() => setConfirm(null)}
                className="fast flex-1 rounded-[var(--radius-sm)] border border-line px-2 py-1 text-center text-caption text-muted hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          items.map((item, i) =>
            item.kind === "sep" ? (
              <div key={i} className="my-1 border-t border-line" />
            ) : (
              <MenuButton key={i} item={item} onRun={run} />
            ),
          )
        )}
      </div>
    </>,
    document.body,
  );
}

function MenuButton({ item, onRun }: { item: Extract<Item, { kind: "action" }>; onRun: (item: Item) => void }): ReactNode {
  return (
    <button
      onClick={() => onRun(item)}
      className={`fast flex w-full items-center gap-2 px-3 py-1.5 text-left text-caption hover:bg-bg ${
        item.danger ? "text-signal" : "text-text"
      }`}
    >
      <span className="flex-1">{item.label}</span>
      {item.key && <span className="mono text-meta text-muted">{item.key}</span>}
    </button>
  );
}
