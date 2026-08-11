import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useOnline } from "../hooks/useOnline";
import { useOutbox, outboxSummary } from "../hooks/useOutbox";
import { discard, parkedOps, syncNowIfConfigured, unpark, type Op } from "../lib/sync";

/**
 * The sync layer's one surface — and it lives in Settings, not above the app.
 *
 * It used to be a strip in normal flow at the top of the shell. Every task or
 * slot drag queues exactly one write, which drains within a beat while online,
 * so the strip mounted and unmounted within a frame or two and shoved the
 * whole app down and back on every interaction. Debouncing it to 400ms killed
 * the fast case but not the shape of the problem: a queue that is draining
 * normally is not news, and any chrome that reports it is chrome the user
 * pays for on every write (D-095).
 *
 * So the queue speaks in exactly one place — here — and interrupts only for
 * the one state the user genuinely has to act on: a **parked** op, a change
 * the server refused that will never land on its own. Silently dropping a
 * write is the failure this whole layer exists to make impossible, so that
 * case raises a toast (floating, no layout shift) pointing back at this panel,
 * which holds it until it is retried or explicitly discarded.
 */
export default function SyncPanel() {
  const online = useOnline();
  const status = useOutbox();
  const [ops, setOps] = useState<Op[]>([]);

  const reload = () => void parkedOps().then(setOps);
  useEffect(reload, [status.parked]);

  const summary = outboxSummary(status, online);

  return (
    <div>
      <div className="section-label mb-2 mt-6">Sync</div>

      <div className="rounded-lg border border-line bg-surface-2/40 px-3.5 py-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className={`h-2 w-2 shrink-0 rounded-full ${
              status.parked > 0 ? "bg-signal" : online ? "bg-accent" : "bg-muted"
            }`}
          />
          <div className="min-w-0 flex-1">
            <div className="text-body text-ink">{summary ?? "Everything is saved"}</div>
            <p className="text-caption text-muted">
              {status.parked > 0
                ? "These stayed on this device. Retry them, or discard them if they're no longer wanted."
                : online
                  ? "Changes are written here first, then sent. You don't have to watch this."
                  : "Work you do now is kept on this device and sent when you're back."}
            </p>
          </div>

          {status.parked === 0 && status.pending > 0 && online && !status.syncing && (
            <button
              onClick={() => void syncNowIfConfigured()}
              className="tap fast shrink-0 rounded-md border border-line px-2.5 py-1 text-label font-medium"
            >
              Sync now
            </button>
          )}
        </div>

        {!status.durable && (
          <p className="mt-2 border-t border-line pt-2 text-caption text-signal">
            This browser blocked local storage, so unsent work won't survive a restart.
          </p>
        )}

        {ops.length > 0 && (
          <ul className="mt-2 divide-y divide-line border-t border-line">
            {ops.map((op) => (
              <li key={op.seq} className="flex items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body">{describe(op)}</p>
                  <p className="mt-0.5 text-meta text-muted">{op.lastError ?? "Rejected"}</p>
                </div>
                <button
                  onClick={() => void unpark([op.seq]).then(() => syncNowIfConfigured()).then(reload)}
                  className="tap fast shrink-0 rounded-md border border-line px-2 py-1 text-label"
                >
                  Retry
                </button>
                <button
                  onClick={() => void discard([op.seq]).then(reload)}
                  className="tap fast shrink-0 rounded-md border border-line px-2 py-1 text-label text-muted"
                >
                  Discard
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * The one interruption the queue is still allowed.
 *
 * Mounted once at the shell root. It fires only when the parked count *rises*
 * — a write the server refused — never for pending, syncing or offline, which
 * all resolve themselves and are none of the user's business. The toast floats
 * over the app, so unlike the old strip it can't move anything.
 */
export function useParkedAlert(openSyncSettings: () => void) {
  const { parked } = useOutbox();
  const seen = useRef(parked);

  useEffect(() => {
    if (parked > seen.current) {
      toast.error(
        `${parked} change${parked === 1 ? "" : "s"} couldn't be saved`,
        {
          description: "They're still on this device. Review them in Settings.",
          action: { label: "Review", onClick: openSyncSettings },
        },
      );
    }
    seen.current = parked;
  }, [parked, openSyncSettings]);
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
