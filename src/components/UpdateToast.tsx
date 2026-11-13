import { useUpdater } from "../hooks/useUpdater";
import { notableNotes } from "../lib/changelog";
import { Button } from "./kit";

// Quiet bottom-right auto-update prompt. Updates download silently in the
// background (see src/lib/appUpdate.ts) — this only appears once there's
// something the user can act on: a download in progress, or a staged build
// waiting for a restart. It shares state with the Settings → Desktop app panel.
// It wears the kit's toast: a raised card, one line, one act.
export default function UpdateToast() {
  const { state, restart } = useUpdater();
  const notes = notableNotes(state.notes);

  if (state.status !== "downloading" && state.status !== "ready") return null;

  return (
    <div className="k-toast" role="status">
      {state.status === "downloading" && (
        <>
          <span className="k-toast-title">Downloading Nuvo {state.version ?? ""}…</span>
          {/* The fill scales; it never animates a width. */}
          <div className="k-toast-track" aria-hidden>
            <i style={{ transform: `scaleX(${Math.max(0, Math.min(100, state.progress)) / 100})` }} />
          </div>
          <span className="k-toast-meta">{state.progress}%</span>
        </>
      )}

      {state.status === "ready" && (
        <>
          <span className="k-toast-title">Nuvo {state.version ?? ""} is ready</span>
          {notes && (
            <details>
              <summary>What's new</summary>
              <p>{notes}</p>
            </details>
          )}
          <div className="k-toast-acts">
            <Button kind="primary" size="xs" onClick={restart}>
              Restart to update
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
