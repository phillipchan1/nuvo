// The waiting state, unboxed.
//
// A reply arrives as plain text, not in a bubble, so the thing standing in for
// it has to arrive the same way — a boxed "Thinking…" that dissolves into open
// text makes the reply look like it moved. Same voice, same left edge, same
// weight; it breathes in opacity only.
//
// Shared by all three chat surfaces (the rail, the mobile ChatPane, the ⌘K
// spotlight), which each carried their own copy of this markup before.
export default function AgentThinking({ compact }: { compact?: boolean }) {
  return (
    <div className="agent-turn agent-thinking" data-compact={compact || undefined} role="status">
      <span className="doc-pulse">Thinking…</span>
    </div>
  );
}
