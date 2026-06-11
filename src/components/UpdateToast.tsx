import { useUpdater } from "../hooks/useUpdater";

export default function UpdateToast() {
  const { state, install, dismiss } = useUpdater();

  if (state.status === "idle" || state.status === "error") return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-72 flex-col gap-2 border border-line bg-surface px-4 py-3 shadow-lg">
      {state.status === "available" && (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold">
              Nuvo {state.version} available
            </span>
            <button
              onClick={dismiss}
              className="text-[11px] text-muted hover:text-ink fast"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
          {state.body && (
            <p className="text-[11px] text-muted leading-snug line-clamp-3">
              {state.body}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={install}
              className="fast border border-accent bg-accent px-3 py-1 text-[11px] font-medium text-white hover:opacity-90"
            >
              Install &amp; Restart
            </button>
            <button
              onClick={dismiss}
              className="fast border border-line px-3 py-1 text-[11px] font-medium text-muted hover:text-ink"
            >
              Later
            </button>
          </div>
        </>
      )}

      {state.status === "downloading" && (
        <>
          <span className="text-[12px] font-semibold">Downloading update…</span>
          <div className="h-1 w-full overflow-hidden rounded-full bg-line">
            <div
              className="h-full bg-accent fast"
              style={{ width: `${state.progress}%` }}
            />
          </div>
          <span className="mono text-[11px] text-muted">{state.progress}%</span>
        </>
      )}

      {state.status === "ready" && (
        <span className="text-[12px] font-semibold">
          Update ready — restarting…
        </span>
      )}
    </div>
  );
}
