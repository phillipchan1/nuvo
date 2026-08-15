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

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import Sheet from "./mobile/Sheet";
import { useIsMobile } from "../hooks/useIsMobile";
import { nextWeekISO, todayISO, tomorrowISO } from "../lib/dates";
import type { Label, Task, TaskPriority } from "../lib/types";
import type { VerticalData } from "../lib/vertical";

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

// ── a small menu that behaves on both shells ───────────────────────────────

function Menu({
  label,
  children,
  title,
}: {
  label: React.ReactNode;
  title: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);

  useEffect(() => {
    if (!open || isMobile) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 240)), bottom: window.innerHeight - r.top + 6 });
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, isMobile]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="tap-bloom fast shrink-0 rounded border border-line px-2 py-0.5 text-label text-muted hover:border-accent hover:text-accent"
      >
        {label}
      </button>
      {open &&
        (isMobile ? (
          <Sheet onClose={() => setOpen(false)} title={title}>
            <div className="flex flex-wrap gap-1.5">{children(() => setOpen(false))}</div>
          </Sheet>
        ) : (
          pos &&
          createPortal(
            <div
              ref={popRef}
              className="glass-card fixed z-[70] max-h-[50vh] w-[220px] overflow-y-auto rounded-xl p-2"
              style={{ left: pos.left, bottom: pos.bottom, boxShadow: "var(--shadow-lift)" }}
            >
              <div className="section-label mb-1.5 !p-0">{title}</div>
              <div className="flex flex-wrap gap-1.5">{children(() => setOpen(false))}</div>
            </div>,
            document.body,
          )
        ))}
    </>
  );
}

function Opt({ onClick, children, color }: { onClick: () => void; children: React.ReactNode; color?: string | null }) {
  return (
    <button
      onClick={onClick}
      className="tap-bloom fast inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-line px-2.5 text-label font-medium text-muted hover:border-accent hover:text-accent"
    >
      {color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />}
      {children}
    </button>
  );
}

// ── the bar ────────────────────────────────────────────────────────────────

export default function BulkBar({
  count,
  ops,
  labels,
  vertical,
  onTrash = true as boolean | undefined,
}: {
  count: number;
  ops: BulkOps;
  labels: Label[];
  vertical: VerticalData | undefined;
  /** Trash is offered by default; a surface where delete makes no sense hides it. */
  onTrash?: boolean;
}) {
  const projects = (vertical?.projects ?? []).filter((p) => p.status !== "complete" && p.status !== "cancelled");

  return (
    <div className="rise flex shrink-0 flex-wrap items-center gap-1.5 border-t border-accent/30 bg-accent-soft px-3 py-2">
      <span className="mono shrink-0 text-label font-semibold text-accent">{count} selected</span>
      <div className="hidden flex-1 sm:block" />

      <Menu label="When ▾" title="Plan these for">
        {(close) => (
          <>
            <Opt onClick={() => (ops.planFor(todayISO()), close())}>Today</Opt>
            <Opt onClick={() => (ops.planFor(tomorrowISO()), close())}>Tomorrow</Opt>
            <Opt onClick={() => (ops.planFor(nextWeekISO()), close())}>Next week</Opt>
            <Opt onClick={() => (ops.patchAll({ do_date: null, start_time: null, slot_id: null }, "unscheduled"), close())}>
              Clear the date
            </Opt>
          </>
        )}
      </Menu>

      <Menu label="Priority ▾" title="Set priority">
        {(close) =>
          PRIORITIES.map((p) => (
            <Opt key={p} onClick={() => (ops.patchAll({ priority: p }, `set to ${p} priority`), close())}>
              {p === "none" ? "No priority" : p}
            </Opt>
          ))
        }
      </Menu>

      {labels.length > 0 && (
        <Menu label="Label ▾" title="Add a label">
          {(close) =>
            labels.map((l) => (
              <Opt key={l.id} color={l.color} onClick={() => (ops.addLabels([l.id]), close())}>
                {l.name}
              </Opt>
            ))
          }
        </Menu>
      )}

      {projects.length > 0 && (
        <Menu label="Move ▾" title="File under a project">
          {(close) => (
            <>
              {projects.slice(0, 40).map((p) => (
                <Opt
                  key={p.id}
                  onClick={() => {
                    // The whole chain, together — see the header (D-088).
                    ops.patchAll(
                      { project_id: p.id, initiative_id: p.initiativeId ?? null, domain_id: p.domainId ?? null },
                      `filed under ${p.name}`,
                    );
                    close();
                  }}
                >
                  {p.name}
                </Opt>
              ))}
              <Opt
                onClick={() => (
                  ops.patchAll({ project_id: null, initiative_id: null }, "unfiled"), close()
                )}
              >
                No project
              </Opt>
            </>
          )}
        </Menu>
      )}

      <button
        onClick={ops.complete}
        className="tap-bloom fast shrink-0 rounded border border-line px-2 py-0.5 text-label text-muted hover:border-accent hover:text-accent"
      >
        ✓ Done
      </button>
      <button
        onClick={ops.backToInbox}
        className="tap-bloom fast shrink-0 rounded border border-line px-2 py-0.5 text-label text-muted hover:border-accent hover:text-accent"
      >
        → Inbox
      </button>
      {onTrash && (
        <button
          onClick={ops.trash}
          className="tap-bloom fast shrink-0 rounded border border-signal/30 px-2 py-0.5 text-label text-signal hover:bg-signal-soft"
        >
          Trash
        </button>
      )}
      <button
        onClick={ops.clear}
        className="tap-bloom ml-1 shrink-0 text-label text-muted hover:text-ink"
        aria-label="Clear selection"
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
