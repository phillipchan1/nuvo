// Which model the conversational agent runs on — one definition, two runtimes.
//
// This used to live twice: a default pair in index.ts and a hand-copied mirror
// in tests/agent/harness.ts carrying the comment "the fallbacks mirror
// agent/index.ts". A mirror is a promise, not a mechanism — and the battery
// certifying a different model than the edge function ships is the same class
// of drift the planning kernel exists to stop (docs/planning-kernel.md).
//
// The other reason it lives here: the two defaults are DIFFERENT FAMILIES.
// Whichever API key happens to be set silently decides whether the chat is an
// OpenAI model or a Qwen one, and a prompt tuned against one is not evidence
// about the other. resolveAgentModel reports that as `crossFamilyFallback` so
// the caller can say so out loud instead of discovering it in an eval result.
//
// Zero imports, zero Deno globals, no process access — callers pass their own
// env bag. Pure, so the battery reads the same resolution the agent does.

/** Just the variables that decide the model. Both runtimes can build one. */
export interface ModelEnv {
  /** Overrides the conversational agent only. Highest precedence. */
  AGENT_MODEL?: string;
  /** Overrides every LLM endpoint, including the passive ones. */
  OPENAI_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  OPENAI_API_KEY?: string;
}

/** Where the chat lands when nothing is pinned and the key is OpenAI's. */
export const DEFAULT_AGENT_MODEL_OPENAI = "gpt-5.4-mini";
/** Where the chat lands when nothing is pinned and the key is OpenRouter's. */
export const DEFAULT_AGENT_MODEL_OPENROUTER = "qwen/qwen3.6-flash";

export interface ModelChoice {
  model: string;
  provider: "openai" | "openrouter";
  baseUrl: string;
  /** True when an env var named the model — the only state worth trusting an
   *  eval result from, because it survives a key change. */
  pinned: boolean;
  /** True when nothing was pinned AND the provider default swapped the model to
   *  a different family than the other provider would have used. Callers should
   *  surface this; it means the running model depends on which key is set. */
  crossFamilyFallback: boolean;
}

export function resolveAgentModel(env: ModelEnv): ModelChoice {
  const useOpenRouter = Boolean(env.OPENROUTER_API_KEY);
  const provider = useOpenRouter ? "openrouter" : "openai";
  const baseUrl = useOpenRouter
    ? "https://openrouter.ai/api/v1"
    : "https://api.openai.com/v1";

  const override = env.AGENT_MODEL || env.OPENAI_MODEL;
  if (override) {
    return { model: override, provider, baseUrl, pinned: true, crossFamilyFallback: false };
  }

  return {
    model: useOpenRouter ? DEFAULT_AGENT_MODEL_OPENROUTER : DEFAULT_AGENT_MODEL_OPENAI,
    provider,
    baseUrl,
    pinned: false,
    // The two defaults are deliberately different families; an unpinned run is
    // therefore only as reproducible as the key that happens to be set.
    crossFamilyFallback: true,
  };
}

/** One line for a log or an eval header, so a run always says what it ran on. */
export function describeModelChoice(c: ModelChoice): string {
  const how = c.pinned ? "pinned" : "provider default";
  const warn = c.crossFamilyFallback
    ? " — NOT pinned: set AGENT_MODEL, or this run is not comparable to one made with a different key"
    : "";
  return `${c.model} via ${c.provider} (${how})${warn}`;
}
