import type { AgentSuggestion } from "../lib/agentTypes";
import { Icon } from "./Icon";
import { ChipButton } from "./kit";

// What Nuvo offers you to say next — kit ChipButtons that wrap to as many lines
// as they need, then "Other…" to say something it didn't think of.

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
    <div className="agent-suggestions">
      {items.map((s, i) => {
        const isOther = s.message === "__other__";
        return (
          <ChipButton
            key={`${s.label}-${i}`}
            disabled={disabled}
            onClick={() => (isOther ? onOther() : onPick(s))}
            icon={isOther ? <Icon name="pen" size={12} /> : undefined}
            className="agent-suggestion-chip"
            data-other={isOther || undefined}
          >
            {s.label}
          </ChipButton>
        );
      })}
    </div>
  );
}
