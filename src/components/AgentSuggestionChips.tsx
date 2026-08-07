import type { AgentSuggestion } from "../lib/agentTypes";

const OTHER: AgentSuggestion = { label: "Other…", message: "__other__" };

export default function AgentSuggestionChips({
  suggestions,
  onPick,
  onOther,
  disabled,
}: {
  suggestions: AgentSuggestion[];
  /** Handed the whole suggestion, not just its `message`: the label is what the
   *  user is saying, the message is only what Nuvo hears (D-087). A caller that
   *  takes the message alone can't tell the transcript what was pressed. */
  onPick: (suggestion: AgentSuggestion) => void;
  onOther: () => void;
  disabled?: boolean;
}) {
  const items = [...suggestions, OTHER];

  return (
    <div className="agent-suggestions mt-2 flex flex-col gap-1.5">
      {items.map((s, i) => {
        const isOther = s.message === "__other__";
        return (
          <button
            key={`${s.label}-${i}`}
            type="button"
            disabled={disabled}
            onClick={() => (isOther ? onOther() : onPick(s))}
            className={`agent-suggestion-chip fast group flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-caption transition-all disabled:opacity-40 ${
              isOther
                ? "border-dashed border-line bg-transparent text-muted hover:border-accent/50 hover:bg-accent-soft/20 hover:text-accent"
                : "border-line bg-surface text-ink shadow-sm hover:border-accent/40 hover:bg-accent-soft/30 hover:shadow-[0_2px_12px_-4px_var(--accent-glow)]"
            }`}
          >
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-meta font-semibold ${
                isOther ? "bg-surface-2 text-muted group-hover:text-accent" : "bg-accent-soft text-accent"
              }`}
            >
              {isOther ? "✎" : i + 1}
            </span>
            <span className="min-w-0 flex-1 leading-snug">{s.label}</span>
            {!isOther && (
              <span className="text-label text-muted opacity-0 transition-opacity group-hover:opacity-100">
                ↵
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
