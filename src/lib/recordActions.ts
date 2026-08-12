// The lifecycle acts a project / initiative offers wherever it appears — open it,
// finish it, park it, delete it.
//
// This is the *vocabulary*, not a menu. The desktop reaches it by right-click
// (`RecordContextMenu`) and the phone by long-press (`MobileRecordActions`); both
// build their list here, so the two shells can never disagree about what you can
// do to a record — or about the wording, the order, or which act asks first.
// Writing it twice is exactly how "you can delete a project at a desk but not on
// the phone" happened in the first place.
//
// Pure: it takes the snapshot and the writes as arguments and returns a
// description of the acts. It renders nothing and knows nothing about pointers.

import {
  initiativeById,
  projectById,
  type Initiative,
  type Project,
  type ProjectStatus,
  type VerticalData,
} from "./vertical";

export type RecordKind = "project" | "initiative";

export type RecordAction =
  | {
      kind: "action";
      label: string;
      /** the desktop's keyboard hint, printed dim on the right of the row. */
      key?: string;
      danger?: boolean;
      /** When set, the act swaps its surface to a confirm step with this prompt. */
      confirm?: string;
      action: () => void;
    }
  | { kind: "sep" };

export interface RecordActionDeps {
  openRecord: (kind: RecordKind, id: string) => void;
  updateProject: (id: string, patch: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  updateInitiative: (id: string, patch: Partial<Initiative>) => void;
  deleteInitiative: (id: string) => void;
  /** projects only — hand off to the ship assessment instead of writing */
  onShip: (id: string) => void;
  onClose: () => void;
}

/** The acts available on one record, in the order both shells present them.
 *  Empty when the record is gone (deleted underneath an open menu). */
export function buildRecordActions(
  kind: RecordKind,
  id: string,
  data: VerticalData,
  a: RecordActionDeps,
): RecordAction[] {
  const record = kind === "project" ? projectById(data, id) : initiativeById(data, id);
  if (!record) return [];

  const done = record.status === "complete";
  const parked = record.status === "waiting";
  const noun = kind === "project" ? "project" : "initiative";

  const setStatus = (status: ProjectStatus) =>
    kind === "project" ? a.updateProject(id, { status }) : a.updateInitiative(id, { status });
  const del = () => (kind === "project" ? a.deleteProject(id) : a.deleteInitiative(id));

  const act = (fn: () => void) => () => {
    fn();
    a.onClose();
  };

  return [
    { kind: "action", label: "Open", key: "↵", action: act(() => a.openRecord(kind, id)) },
    { kind: "sep" },
    // Reopening is instant (reversible, not a judgment); shipping a project opens
    // the assessment — the "…" says a moment follows rather than a silent seal.
    {
      kind: "action",
      label: done ? "Reopen" : kind === "project" ? "Ship it…" : "Mark complete",
      action: act(() =>
        done ? setStatus("in_progress") : kind === "project" ? a.onShip(id) : setStatus("complete"),
      ),
    },
    {
      kind: "action",
      label: parked ? "Resume" : "Park (waiting)",
      action: act(() => setStatus(parked ? "in_progress" : "waiting")),
    },
    { kind: "sep" },
    {
      kind: "action",
      label: `Delete ${noun}`,
      danger: true,
      confirm: `Delete "${record.name}"?`,
      action: act(del),
    },
  ];
}
