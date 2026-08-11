import { useEffect, useRef, useState } from "react";
import { useOnline } from "../hooks/useOnline";
import { useOutbox, outboxSummary } from "../hooks/useOutbox";
import { discard, parkedOps, syncNowIfConfigured, unpark, type Op } from "../lib/sync";

/**
 * The one place the sync layer is allowed to speak.
 *
 * It stays silent when there is nothing to say — a queue that is empty, or a
 * drain that is keeping up, needs no chrome. It appears for the two states the
 * user genuinely has to know about: work held on the device, and work the
 * server refused.
 *
 * The refusal case is the important one. A parked op is a change the user made
 * that will never land on its own, and the old architecture's answer was a red
 * toast that scrolled away. Here it persists until it is either retried or
 * explicitly discarded, because silently dropping a write is the failure this
 * whole layer exists to make impossible.
 */
export default function SyncStatus() {
  const online = useOnline();
  const status = useOutbox();
  const [showParked, setShowParked] = useState(false);
  const summary = outboxSummary(status, online);

  // This bar sits above everything else in the shell, in normal flow — it
  // isn't an overlay. A plain queued write (every task/slot drag fires
  // exactly one) drains within a beat while online, so showing it live meant
  // it mounted and unmounted within a frame or two: the whole app shoved down
  // and back up, read as a jarring shift on every drag. Only a hold worth
  // telling the user about — parked, offline, or a sync still going after a
  // beat — earns the chrome; a same-beat round trip stays silent.
  const urgent = status.parked > 0 || !online || !status.durable;
  const [settled, setSettled] = useState(summary);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!summary || urgent || settled) {
      clearTimeout(timer.current);
      setSettled(summary);
      return;
    }
    timer.current = setTimeout(() => setSettled(summary), 400);
    return () => clearTimeout(timer.current);
  }, [summary, urgent, settled]);

  if (!settled && status.durable) return null;

  const tone = status.parked > 0 ? "signal" : "muted";

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        className={`flex items-center gap-2 border-b px-4 py-1.5 text-caption ${
          tone === "signal" ? "border-signal bg-signal-soft text-signal" : "border-line text-muted"
        }`}
      >
        <span className="font-medium">{settled ?? "Changes are kept in memory only"}</span>

        {!status.durable && (
          <span className="text-meta">
            — this browser blocked local storage, so unsent work won't survive a restart
          </span>
        )}

        <div className="flex-1" />

        {status.parked > 0 && (
          <button
            onClick={() => setShowParked(true)}
            className="tap fast rounded-md border border-signal px-2 py-0.5 text-label font-medium"
          >
            Review
          </button>
        )}

        {status.parked === 0 && status.pending > 0 && online && !status.syncing && (
          <button
            onClick={() => void syncNowIfConfigured()}
            className="tap fast rounded-md border border-line px-2 py-0.5 text-label font-medium"
          >
            Retry now
          </button>
        )}
      </div>

      {showParked && <ParkedSheet onClose={() => setShowParked(false)} />}
    </>
  );
}

function ParkedSheet({ onClose }: { onClose: () => void }) {
  const [ops, setOps] = useState<Op[]>([]);

  const reload = () => void parkedOps().then(setOps);
  useEffect(reload, []);

  useEffect(() => {
    if (ops.length === 0) onClose();
  }, [ops.length, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="glass-card max-h-[80vh] w-full overflow-y-auto rounded-t-2xl p-4 sm:max-w-lg sm:rounded-2xl">
        <h2 className="text-head font-semibold">Changes that couldn't be saved</h2>
        <p className="mt-1 text-caption text-muted">
          These are still on this device. Retry them, or discard them if they're no longer wanted —
          nothing is thrown away until you say so.
        </p>

        <ul className="mt-3 divide-y divide-line">
          {ops.map((op) => (
            <li key={op.seq} className="flex items-start gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-body">
                  {describe(op)}
                </p>
                <p className="mt-0.5 text-meta text-muted">{op.lastError ?? "Rejected"}</p>
              </div>
              <button
                onClick={() => void unpark([op.seq]).then(() => void syncNowIfConfigured()).then(reload)}
                className="tap fast rounded-md border border-line px-2 py-1 text-label"
              >
                Retry
              </button>
              <button
                onClick={() => void discard([op.seq]).then(reload)}
                className="tap fast rounded-md border border-line px-2 py-1 text-label text-muted"
              >
                Discard
              </button>
            </li>
          ))}
        </ul>

        <button
          onClick={onClose}
          className="tap mt-4 w-full rounded-lg border border-line py-2 text-body font-medium"
        >
          Close
        </button>
      </div>
    </div>
  );
}

/** A plain-language description — the user never sees a table name. */
function describe(op: Op): string {
  const noun = NOUNS[op.table] ?? "item";
  const title = typeof op.payload.title === "string" ? `"${op.payload.title}"` : `a ${noun}`;
  if (op.kind === "insert") return `New ${noun} ${title}`;
  if (op.kind === "delete") return `Deleting a ${noun}`;
  return `Edit to ${title}`;
}

const NOUNS: Record<string, string> = {
  tasks: "task",
  task_labels: "label",
  projects: "project",
  initiatives: "initiative",
  domains: "domain",
  key_results: "key result",
  slots: "slot",
  labels: "label",
  user_settings: "setting",
  record_comments: "comment",
  week_reviews: "week review",
  sprints: "week",
};
