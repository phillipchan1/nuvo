import { useUpdater } from "../hooks/useUpdater";

// Quiet bottom-right auto-update prompt. Updates download silently in the
// background (see src/lib/appUpdate.ts) — this only appears once there's
// something the user can act on: a download in progress, or a staged build
// waiting for a restart. It shares state with the Settings → Desktop app panel.
export default function UpdateToast() {
  const { state, restart } = useUpdater();

  if (state.status !== "downloading" && state.status !== "ready") return null;

  return (
    <div className="rise elev-3 fixed bottom-4 right-4 z-50 flex w-72 flex-col gap-2 rounded-lg border border-line bg-surface px-4 py-3">
      {state.status === "downloading" && (
        <>
          <span className="text-caption font-semibold">
            Downloading Nuvo {state.version ?? ""}…
          </span>
          <div className="h-1 w-full overflow-hidden rounded-full bg-line">
            <div
              className="h-full bg-accent fast"
              style={{ width: `${state.progress}%` }}
            />
          </div>
          <span className="mono text-label text-muted">{state.progress}%</span>
        </>
      )}

      {state.status === "ready" && (
        <>
          <span className="text-caption font-semibold">
            Nuvo {state.version ?? ""} is ready
          </span>
          {state.notes && (
            <details className="text-label text-muted">
              <summary className="cursor-pointer select-none hover:text-ink fast">
                What's new
              </summary>
              <p className="mt-1 whitespace-pre-line leading-snug">{state.notes}</p>
            </details>
          )}
          <div className="pt-1">
            <button
              onClick={restart}
              className="fast rounded-md border border-accent bg-accent px-3 py-1 text-label font-medium text-white shadow-sm hover:brightness-110 active:translate-y-px"
            >
              Restart to update
            </button>
          </div>
        </>
      )}
    </div>
  );
}
