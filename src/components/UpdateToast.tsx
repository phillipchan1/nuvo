import { useUpdater } from "../hooks/useUpdater";

export default function UpdateToast() {
  const { state, install, dismiss } = useUpdater();

  if (state.status === "idle" || state.status === "error") return null;

  return (
    <div className="rise elev-3 fixed bottom-4 right-4 z-50 flex w-72 flex-col gap-2 rounded-lg border border-line bg-surface px-4 py-3">
      {state.status === "available" && (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-caption font-semibold">
              Nuvo {state.version} available
            </span>
            <button
              onClick={dismiss}
              className="text-label text-muted hover:text-ink fast"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
          {state.body && (
            <p className="text-label text-muted leading-snug line-clamp-3">
              {state.body}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={install}
              className="fast rounded-md border border-accent bg-accent px-3 py-1 text-label font-medium text-white shadow-sm hover:brightness-110 active:translate-y-px"
            >
              Install &amp; Restart
            </button>
            <button
              onClick={dismiss}
              className="fast rounded-md border border-line px-3 py-1 text-label font-medium text-muted hover:border-line-strong hover:text-ink"
            >
              Later
            </button>
          </div>
        </>
      )}

      {state.status === "downloading" && (
        <>
          <span className="text-caption font-semibold">Downloading update…</span>
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
        <span className="text-caption font-semibold">
          Update ready — restarting…
        </span>
      )}
    </div>
  );
}
