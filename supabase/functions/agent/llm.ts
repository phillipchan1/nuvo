// Small shared OpenAI/OpenRouter helpers for the one-shot intelligence endpoints
// (scaffold / blueprint / prepare / narrate).
//
// Set OPENROUTER_API_KEY to route everything through OpenRouter instead of OpenAI.
// OPENAI_MODEL always overrides the default model for any endpoint.

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENAI_BASE = "https://api.openai.com/v1";

export function llmKey(): string {
  const k = Deno.env.get("OPENROUTER_API_KEY") ?? Deno.env.get("OPENAI_API_KEY");
  if (!k) throw new Error("OPENROUTER_API_KEY or OPENAI_API_KEY not configured");
  return k;
}

export function llmBaseUrl(): string {
  return Deno.env.get("OPENROUTER_API_KEY") ? OPENROUTER_BASE : OPENAI_BASE;
}

/** Pick a model: OPENAI_MODEL env var always wins; otherwise pick per-provider default. */
export function llmModel(openaiDefault: string, orDefault = openaiDefault): string {
  const override = Deno.env.get("OPENAI_MODEL");
  if (override) return override;
  return Deno.env.get("OPENROUTER_API_KEY") ? orDefault : openaiDefault;
}

export function llmHeaders(key: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  if (Deno.env.get("OPENROUTER_API_KEY")) {
    h["HTTP-Referer"] = "https://nuvo.app";
    h["X-Title"] = "Nuvo";
  }
  return h;
}

async function complete(prompt: string, json: boolean): Promise<string> {
  const key = llmKey();
  const res = await fetch(`${llmBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: llmHeaders(key),
    body: JSON.stringify({
      model: llmModel("gpt-5.4-nano", "qwen/qwen3.7-plus-20260602"),
      messages: [{ role: "user", content: prompt }],
      // These endpoints are judgment/extraction, not prose — keep them near
      // deterministic so the same input yields a stable verdict.
      temperature: json ? 0.2 : 0.5,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`LLM error ${res.status}: ${await res.text()}`);
  const completion = await res.json();
  return completion.choices?.[0]?.message?.content ?? "";
}

export const completeText = (prompt: string) => complete(prompt, false);

export async function completeJSON<T>(prompt: string): Promise<T> {
  const raw = await complete(prompt, true);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error("Could not parse the model's JSON response");
  }
}
