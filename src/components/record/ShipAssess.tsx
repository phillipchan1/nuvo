// Ship this project? — the assessment moment.
//
// Shipping is the one thing in Nuvo the machine must never do for you. A task
// done is a fact; a project shipped is a JUDGMENT, and the two come apart all
// the time — every task done and it still isn't shipped (they were the wrong
// tasks), or it ships with work open (you found the shorter path). So the app's
// job is only to notice and ask; this is where it asks.
//
// The question you answer here is the OUTCOME, not the checklist — so the
// outcome line is the hero and the task tally is demoted to evidence beneath it.
// That ordering is the whole point: a checklist can't tell you whether the thing
// you wanted actually happened.
//
// Two rules govern the leftovers, and they pull in opposite directions:
//
//  1. Shipping CLOSES every open task. A shipped project must never leave live
//     tasks behind — they'd keep surfacing in the rail's Overdue group and on the
//     schedule, so the project reads finished while its work still nags. That's
//     a false signal, and it's the one thing worse than an untidy count.
//  2. The app never GUESSES what closing meant. "Done" (you did it — it counts
//     as work you did, and Reflect/the evidence layer read those completions
//     back to you as facts about your life) and "dropped" (you didn't need it
//     after all) are different truths, and only you know which.
//
// So closure is forced and the meaning is chosen: mark them done (the default —
// the usual case is the work happened) or drop them. There is deliberately no
// "leave them open": that was the false signal.

import { useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "../ui";
import { useVertical } from "../../hooks/useVertical";
import { domainById, openTasksOf, projectById, tasksOf, type VTask } from "../../lib/vertical";

export type LeftoverVerdict = "done" | "drop";

/** Ship a project from ANY surface — the record, the deck, the groom wall.
 *
 *  A container, not a second implementation: shipping is the biggest verb in the
 *  app, so every path to it gets the same moment to assess. (The deck's card
 *  checkbox used to ship in one silent click, which is exactly where a project
 *  with four open tasks would get sealed by accident.) Reopening and parking
 *  stay instant — they're reversible and they aren't judgments. */
export function ProjectShipAssess({
  id,
  onClose,
  onShipped,
}: {
  id: string;
  onClose: () => void;
  /** told what happened, for the surface's own note/animation */
  onShipped?: (verdict: LeftoverVerdict | null, openCount: number) => void;
}) {
  const { data, updateProject, deleteTask, toggleTask } = useVertical();
  const project = projectById(data, id);
  if (!project) return null;
  const tasks = tasksOf(data, project.id);
  const openTasks = openTasksOf(data, project.id);
  const accent = domainById(data, project.domainId)?.color ?? "var(--accent)";

  // Either way the task CLOSES — shipping never leaves live work behind it. The
  // verdict only decides what the closing meant: done stamps completed_at (it
  // counts as work you did), dropped trashes it (it doesn't). Every openTask is
  // not-done by construction, so toggleTask can only mark done here.
  const ship = (verdict: LeftoverVerdict | null) => {
    if (verdict === "done") openTasks.forEach((t) => toggleTask(t.id));
    else if (verdict === "drop") openTasks.forEach((t) => deleteTask(t.id));
    updateProject(project.id, { status: "complete" });
    onShipped?.(verdict, openTasks.length);
    onClose();
  };

  // Portal to <body>. Modal is `position: fixed`, which is only relative to the
  // viewport while NO ancestor has a transform/filter/opacity — and this mounts
  // inside six different containers now (the rail, a groom-wall card, the deck,
  // a floor mid-transition…), any of which can create a containing block and
  // trap it invisibly. The record modal already portals for the same reason.
  return createPortal(
    <ShipAssess
      name={project.name}
      outcome={project.outcome}
      accent={accent}
      done={tasks.filter((t) => t.status === "done").length}
      total={tasks.length}
      openTasks={openTasks}
      onCancel={onClose}
      onShip={ship}
    />,
    document.body,
  );
}

export default function ShipAssess({
  name,
  outcome,
  accent,
  done,
  total,
  openTasks,
  onCancel,
  onShip,
}: {
  name: string;
  outcome: string;
  accent: string;
  done: number;
  total: number;
  openTasks: VTask[];
  onCancel: () => void;
  /** Ship it. `verdict` is null when nothing was left open. */
  onShip: (verdict: LeftoverVerdict | null) => void;
}) {
  const [verdict, setVerdict] = useState<LeftoverVerdict>("done");
  const clean = openTasks.length === 0;
  const n = openTasks.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    // Above RecordScrim (z-81) and FloatingMenu (z-83). Shipping from the
    // record used the default Modal z-70 — under the sheet — so "Ship it"
    // opened a dialog nobody could reach. Settings stays at 70 on purpose.
    <Modal onClose={onCancel} width="max-w-md" zClass="z-[90]">
      <div className="px-6 pb-5 pt-6">
        <div className="section-label !px-0 !pb-2" style={{ color: accent }}>
          Ship
        </div>

        {/* The hero is the OUTCOME — the thing you're judging. The name is the
            label above it; a checklist never gets to be the hero here. */}
        <h2 className="masthead text-head leading-snug text-ink">{name}</h2>
        {outcome ? (
          <p className="mt-2 text-body leading-relaxed text-muted">
            <span className="text-ink">{outcome}</span>
          </p>
        ) : (
          <p className="mt-2 text-body italic leading-relaxed text-muted">
            No outcome was ever written down — so this one's on memory alone.
          </p>
        )}
        <p className="mt-3 text-caption leading-relaxed text-muted">
          {total === 0
            ? // Nothing was ever broken down, so the tasks can't vouch for this one
              // — which is exactly why a task-less project never completes itself.
              "This one never had any tasks, so nothing here can vouch for it. Your call alone."
            : clean
              ? "Every task is done. Did that actually get you the outcome?"
              : "Only you can call this one — the work isn't finished, but the outcome might be."}
        </p>

        {/* Evidence — demoted beneath the question it can't answer. */}
        {total > 0 && (
          <div className="mt-4 flex items-center gap-2.5 border-t border-line pt-3">
            <span className="block h-1 flex-1 overflow-hidden rounded-full bg-line">
              <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: accent }} />
            </span>
            <span className="mono shrink-0 text-micro text-muted">
              {done}/{total} done
            </span>
          </div>
        )}

        {/* The leftovers — the warning. Shipping closes them either way (a shipped
            project can't leave live tasks nagging from the rail's Overdue group);
            you say what the closing meant, because only you know. */}
        {!clean && (
          <div className="mt-4">
            <div className="section-label !px-0 !pb-1.5" style={{ color: "var(--signal)" }}>
              {n} task{n === 1 ? "" : "s"} still open
            </div>
            <div className="max-h-28 overflow-y-auto">
              {openTasks.map((t) => (
                <div key={t.id} className="flex items-center gap-2 py-1">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ border: "1.5px solid var(--line-strong)" }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-caption text-muted">{t.title}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-caption leading-relaxed text-muted">
              Shipping closes {n === 1 ? "it" : "them"} — nothing stays open under a shipped project.
              What {n === 1 ? "was it" : "were they"}?
            </p>
            <div className="mt-2 flex flex-col gap-1.5">
              <Choice
                on={verdict === "done"}
                accent={accent}
                label={n === 1 ? "Mark it done" : "Mark them done"}
                hint="You did the work. It counts — completed today, and it shows up in what you built."
                onPick={() => setVerdict("done")}
              />
              <Choice
                on={verdict === "drop"}
                accent={accent}
                label={n === 1 ? "Drop it" : "Drop them"}
                hint="Turned out not to be needed. Off the list, and never counted as work you did."
                onPick={() => setVerdict("drop")}
              />
            </div>
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onCancel} className="fast tap rounded-full px-3 py-1.5 text-label font-medium text-muted hover:text-ink">
            Not yet
          </button>
          <button
            onClick={() => onShip(clean ? null : verdict)}
            className="fast tap rounded-full px-4 py-1.5 text-label font-medium text-white hover:brightness-110"
            style={{ background: accent }}
          >
            Ship it
          </button>
        </div>
      </div>
    </Modal>
  );
}

// A verdict option — dissolved onto the paper, lifting when chosen. No ring.
function Choice({
  on,
  accent,
  label,
  hint,
  onPick,
}: {
  on: boolean;
  accent: string;
  label: string;
  hint: string;
  onPick: () => void;
}) {
  return (
    <button
      onClick={onPick}
      className={`fast tap flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left ${on ? "glass-lift" : "hover:bg-surface-2"}`}
      aria-pressed={on}
      aria-label={label}
    >
      <span
        className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-micro"
        style={{ borderColor: on ? accent : "var(--line-strong)", background: on ? accent : "transparent", color: "#fff" }}
      >
        {on && <span style={{ lineHeight: 1 }}>✓</span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-label font-medium ${on ? "text-ink" : "text-muted"}`}>{label}</span>
        <span className="mt-0.5 block text-micro leading-relaxed text-muted">{hint}</span>
      </span>
    </button>
  );
}
