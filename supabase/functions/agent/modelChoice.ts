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
  /** One of REASONING_EFFORTS. Unset leaves the provider default. */
  AGENT_REASONING?: string;
  OPENROUTER_API_KEY?: string;
  OPENAI_API_KEY?: string;
}

// The GPT-5.6 family, by tier — the chat ran on gpt-5.4-mini before, which is a
// small model asked to hold ~3k tokens of arbitrary product policy. Terra is the
// balanced tier and the default here; Sol is the frontier ceiling worth putting
// in the eval matrix; Luna is the cost tier. Costs are noise at one user, so the
// real trade is LATENCY — this is a streaming chat and round 0 is felt.
export const AGENT_MODELS = {
  /** Frontier. The ceiling to measure against, not an obvious default. */
  sol: "gpt-5.6-sol",
  /** Balanced intelligence/cost — the default for the chat. */
  terra: "gpt-5.6-terra",
  /** Cost-optimized, high volume. */
  luna: "gpt-5.6-luna",
} as const;

/** Where the chat lands when nothing is pinned and the key is OpenAI's. */
export const DEFAULT_AGENT_MODEL_OPENAI = AGENT_MODELS.terra;
/** Where the chat lands when nothing is pinned and the key is OpenRouter's. */
export const DEFAULT_AGENT_MODEL_OPENROUTER = "qwen/qwen3.6-flash";

/** The 5.6 family's reasoning axis.
 *
 *  NOTE: currently inert for the chat. `/v1/chat/completions` rejects
 *  reasoning_effort alongside function tools, and an agent turn always carries
 *  tools — createChatClient drops it and warns. Kept because the resolution is
 *  right and a `/v1/responses` transport would make it live; see loop.ts. */
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";
export const REASONING_EFFORTS: ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh", "max"];

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
  /** Reasoning effort to request, when the env named a valid one. Undefined
   *  leaves the provider's default — which is what the chat shipped on before,
   *  so an unset value is a real choice, not a missing one. */
  reasoningEffort?: ReasoningEffort;
}

function readReasoning(raw: string | undefined): ReasoningEffort | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  // An unrecognized value is ignored rather than passed through: the provider
  // would 400 the whole turn, and a typo'd env var should not take the chat down.
  return (REASONING_EFFORTS as string[]).includes(v) ? (v as ReasoningEffort) : undefined;
}

export function resolveAgentModel(env: ModelEnv): ModelChoice {
  const useOpenRouter = Boolean(env.OPENROUTER_API_KEY);
  const provider = useOpenRouter ? "openrouter" : "openai";
  const baseUrl = useOpenRouter
    ? "https://openrouter.ai/api/v1"
    : "https://api.openai.com/v1";

  const reasoningEffort = readReasoning(env.AGENT_REASONING);

  const override = env.AGENT_MODEL || env.OPENAI_MODEL;
  if (override) {
    return { model: override, provider, baseUrl, pinned: true, crossFamilyFallback: false, reasoningEffort };
  }

  return {
    model: useOpenRouter ? DEFAULT_AGENT_MODEL_OPENROUTER : DEFAULT_AGENT_MODEL_OPENAI,
    provider,
    baseUrl,
    pinned: false,
    // The two defaults are deliberately different families; an unpinned run is
    // therefore only as reproducible as the key that happens to be set.
    crossFamilyFallback: true,
    reasoningEffort,
  };
}

/** One line for a log or an eval header, so a run always says what it ran on. */
export function describeModelChoice(c: ModelChoice): string {
  const how = c.pinned ? "pinned" : "provider default";
  const reasoning = c.reasoningEffort ? `, reasoning=${c.reasoningEffort}` : "";
  const warn = c.crossFamilyFallback
    ? " — NOT pinned: set AGENT_MODEL, or this run is not comparable to one made with a different key"
    : "";
  return `${c.model} via ${c.provider} (${how}${reasoning})${warn}`;
}
