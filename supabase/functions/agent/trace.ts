// One structured line per chat turn.
//
// The chat is the surface that fails *quietly* — it answers fluently whether it
// was right or not, so between eval runs there is no signal at all
// (docs/agent-conformance.md §1). A battery tells you how the chat behaved on
// 36 fixtures last time someone ran it; this tells you how it behaved on the
// real account, today.
//
// Deliberately one console line of JSON rather than a table: no migration, no
// RLS surface, queryable in the Supabase function logs, and impossible to break
// a reply by failing. What it records is chosen so a regression is visible
// WITHOUT reading the conversation — rounds climbing, exhausted turning up,
// dedupe firing, tools erroring, latency drifting.
//
// No message content and no arguments: this runs over a real person's planner,
// and a debugging aid should not quietly become a transcript of their life.
//
// Zero imports, zero Deno globals.

export interface TurnTraceInput {
  model: string;
  promptVariant: string;
  reasoningEffort?: string;
  rounds: number;
  exhausted: boolean;
  calls: { name: string; error?: string; deduped?: boolean }[];
  actionCount: number;
  /** Wall-clock for the whole turn. */
  ms: number;
  /** How many messages of history the turn carried — context growth shows here. */
  historyLength: number;
}

export interface TurnTrace {
  evt: "agent.turn";
  model: string;
  prompt: string;
  reasoning: string;
  rounds: number;
  /** The headline failure: the turn stopped with work still queued. */
  exhausted: boolean;
  tools: string[];
  toolCount: number;
  errorCount: number;
  /** Duplicate writes the loop absorbed. Non-zero means the model is trying to
   *  double-write — worth a scenario even though the user never saw it. */
  dedupedCount: number;
  actions: number;
  ms: number;
  history: number;
}

export function buildTurnTrace(input: TurnTraceInput): TurnTrace {
  return {
    evt: "agent.turn",
    model: input.model,
    prompt: input.promptVariant,
    reasoning: input.reasoningEffort ?? "default",
    rounds: input.rounds,
    exhausted: input.exhausted,
    tools: input.calls.map((c) => c.name),
    toolCount: input.calls.length,
    errorCount: input.calls.filter((c) => c.error).length,
    dedupedCount: input.calls.filter((c) => c.deduped).length,
    actions: input.actionCount,
    ms: Math.round(input.ms),
    history: input.historyLength,
  };
}

/** Anything worth being woken up by. Kept next to the trace so "what counts as
 *  a bad turn" has one definition rather than living in a log query someone
 *  wrote once. */
export function traceIsNoteworthy(t: TurnTrace): boolean {
  return t.exhausted || t.errorCount > 0 || t.dedupedCount > 0;
}
