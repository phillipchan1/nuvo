import { UPDATE_REQUIRED_MESSAGE } from "../lib/maintenance";

/** Full-screen write block when maintenance says this build is too old. */
export default function MinVersionPrompt() {
  return (
    <div className="atmosphere flex h-full items-center justify-center px-4">
      <div className="moment elev-3 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface p-7 text-center">
        <div className="mb-2 text-body text-ink">Update Nuvo to continue.</div>
        <div className="mb-4 text-caption text-muted">{UPDATE_REQUIRED_MESSAGE}</div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="tap fast rounded-md border border-line bg-surface-2 px-4 py-2 text-body font-medium text-ink hover:bg-surface"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
