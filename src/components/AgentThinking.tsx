// The waiting state, unboxed.
//
// A reply arrives on the paper, not in a bubble, so the thing standing in for it
// has to arrive the same way — a boxed "Thinking…" that dissolves into open text
// makes the reply look like it moved. Same voice, same left edge, same weight.
//
// Shared by all three chat surfaces (the rail, the mobile ChatPane, the ⌘K
// spotlight), which each carried their own copy of this markup before.
export default function AgentThinking({ compact }: { compact?: boolean }) {
  return (
    <div className="agent-turn flex items-center gap-1.5 text-muted">
      <span aria-hidden className="leading-none opacity-60">
        ⋯
      </span>
      <span className={`shimmer italic ${compact ? "text-meta" : "text-label"}`}>Thinking…</span>
    </div>
  );
}
