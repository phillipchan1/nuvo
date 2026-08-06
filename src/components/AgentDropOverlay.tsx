import { Icon } from "./Icon";

/** Full-panel file-drop affordance — the whole chat surface is the target. */
export default function AgentDropOverlay({ compact }: { compact?: boolean }) {
  return (
    <div className="agent-drop-zone pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center">
      <div className="agent-drop-zone-card flex flex-col items-center gap-2 px-8 py-6 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Icon name="paperclip" size={22} />
        </span>
        <span className="text-body font-medium text-accent">Drop to attach</span>
        {!compact && (
          <span className="mono text-meta text-muted">Images, PDFs, text files</span>
        )}
      </div>
    </div>
  );
}
