// The phone's translation of the desktop right-click menu.
//
// A record (project · initiative) has a small set of lifecycle acts — open,
// ship, park, delete. At a desk they hang off right-click; a phone has no right
// button, so they hang off **long-press**, and off a visible **⋯** in the
// record's own title row so nothing here is discoverable only by holding a
// finger down and hoping. Both routes open the same bottom Sheet, and both read
// the same vocabulary the desktop menu reads (`lib/recordActions`) — the two
// shells cannot drift about what you may do to a project.
//
// Why this file exists at all: Delete was **desktop-only**. A project started on
// the phone could be renamed, shipped, parked and re-homed there, but never
// removed — the phone could make a mess it could not clean up. That is the exact
// shape of gap the golden rule is meant to catch.

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useVertical } from "../../hooks/useVertical";
import { ProjectShipAssess } from "../record/ShipAssess";
import { buildRecordActions, type RecordAction, type RecordKind } from "../../lib/recordActions";
import Sheet from "./Sheet";

/** Matches the deck's pick-up hold (MobileDeck) — one "held" feel across the app. */
const LONG_PRESS_MS = 450;
/** Past this the finger is scrolling, not holding. */
const MOVE_TOL_PX = 10;

/**
 * Long-press acts for records.
 *
 *   const { actionProps, openActions, sheet } = useRecordActions(openDetail);
 *   <Row {...actionProps("project", p.id)} onClick={…} />
 *   {sheet}
 *
 * `onOpen` is what "Open" means on the calling surface — on the phone that is
 * the detail Sheet, not the desktop record modal.
 */
export function useRecordActions(onOpen: (kind: RecordKind, id: string) => void) {
  const [state, setState] = useState<{ kind: RecordKind; id: string } | null>(null);
  // Shipping asks first, and the assessment outlives the sheet that launched it.
  const [shipId, setShipId] = useState<string | null>(null);

  const timer = useRef(0);
  const origin = useRef({ x: 0, y: 0 });
  // A long-press is followed by a click on the same element. Without this the
  // menu would open and the row would ALSO navigate underneath it.
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = 0;
  }, []);

  const actionProps = useCallback(
    (kind: RecordKind, id: string) => ({
      // Android long-press raises the browser's own menu on top of ours; a
      // right-click in the desktop harness would do the same.
      onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
      onPointerDown: (e: ReactPointerEvent) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        fired.current = false;
        origin.current = { x: e.clientX, y: e.clientY };
        cancel();
        timer.current = window.setTimeout(() => {
          timer.current = 0;
          fired.current = true;
          navigator.vibrate?.(8);
          setState({ kind, id });
        }, LONG_PRESS_MS);
      },
      onPointerMove: (e: ReactPointerEvent) => {
        if (!timer.current) return;
        if (Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > MOVE_TOL_PX) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onClickCapture: (e: { preventDefault: () => void; stopPropagation: () => void }) => {
        if (!fired.current) return;
        fired.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
    }),
    [cancel],
  );

  const openActions = useCallback((kind: RecordKind, id: string) => setState({ kind, id }), []);
  const close = useCallback(() => setState(null), []);

  const sheet = (
    <>
      {state && <RecordActionSheet state={state} onOpen={onOpen} onClose={close} onShip={setShipId} />}
      {shipId && <ProjectShipAssess id={shipId} onClose={() => setShipId(null)} />}
    </>
  );

  return { actionProps, openActions, sheet };
}

function RecordActionSheet({
  state,
  onOpen,
  onClose,
  onShip,
}: {
  state: { kind: RecordKind; id: string };
  onOpen: (kind: RecordKind, id: string) => void;
  onClose: () => void;
  onShip: (id: string) => void;
}) {
  const { data, updateProject, deleteProject, updateInitiative, deleteInitiative } = useVertical();
  const [confirm, setConfirm] = useState<Extract<RecordAction, { kind: "action" }> | null>(null);

  const record =
    state.kind === "project"
      ? data.projects.find((p) => p.id === state.id)
      : data.initiatives.find((i) => i.id === state.id);

  const items = buildRecordActions(state.kind, state.id, data, {
    openRecord: onOpen,
    updateProject,
    deleteProject,
    updateInitiative,
    deleteInitiative,
    onShip,
    onClose,
  });

  const run = (item: Extract<RecordAction, { kind: "action" }>) => {
    // Delete is hard (no undo — see useVertical), so it asks in place rather
    // than firing on the first tap. Same guard the desktop menu keeps.
    if (item.confirm) {
      setConfirm(item);
      return;
    }
    item.action();
  };

  return (
    <Sheet title={record?.name ?? "Record"} onClose={onClose}>
      {confirm ? (
        <div className="px-5 pb-6 pt-1">
          <p className="text-head text-ink">{confirm.confirm}</p>
          <p className="mt-1 text-caption text-muted">This can't be undone.</p>
          <div className="mt-4 flex flex-col gap-2">
            <button
              onClick={confirm.action}
              className="tap fast w-full rounded-xl px-4 py-3 text-center text-body font-semibold text-white"
              style={{ background: "var(--signal)" }}
            >
              Delete
            </button>
            <button
              onClick={() => setConfirm(null)}
              className="tap fast w-full rounded-xl border border-line px-4 py-3 text-center text-body font-medium text-muted active:bg-surface-2"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="px-3 pb-6 pt-1">
          {items.map((item, i) =>
            item.kind === "sep" ? (
              <div key={i} className="my-1.5 border-t border-line" />
            ) : (
              <button
                key={i}
                onClick={() => run(item)}
                className={`tap fast flex w-full items-center rounded-xl px-3 py-3 text-left text-body font-medium active:bg-surface-2 ${
                  item.danger ? "text-signal" : "text-ink"
                }`}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </Sheet>
  );
}
