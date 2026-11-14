// The one-shot endpoints' OpenAI/OpenRouter call, with the environment passed in.
// Zero imports, zero Deno globals: the Supabase agent (llm.ts, reading Deno.env)
// and the Cloudflare Worker (reading its bindings) run the same request.
//
// Set OPENROUTER_API_KEY to route everything through OpenRouter instead of OpenAI.
// OPENAI_MODEL always overrides the default model for any endpoint.

export type EnvGet = (name: string) => string | undefined;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENAI_BASE = "https://api.openai.com/v1";

export function llmKeyFrom(get: EnvGet): string {
  const k = get("OPENROUTER_API_KEY") ?? get("OPENAI_API_KEY");
  if (!k) throw new Error("OPENROUTER_API_KEY or OPENAI_API_KEY not configured");
  return k;
}

export function llmBaseUrlFrom(get: EnvGet): string {
  return get("OPENROUTER_API_KEY") ? OPENROUTER_BASE : OPENAI_BASE;
}

/** Pick a model: OPENAI_MODEL env var always wins; otherwise pick per-provider default. */
export function llmModelFrom(get: EnvGet, openaiDefault: string, orDefault = openaiDefault): string {
  const override = get("OPENAI_MODEL");
  if (override) return override;
  return get("OPENROUTER_API_KEY") ? orDefault : openaiDefault;
}

export function llmHeadersFrom(get: EnvGet, key: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  if (get("OPENROUTER_API_KEY")) {
    h["HTTP-Referer"] = "https://nuvo.app";
    h["X-Title"] = "Nuvo";
  }
  return h;
}

export async function completeFrom(
  get: EnvGet,
  prompt: string,
  json: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const key = llmKeyFrom(get);
  const res = await fetchImpl(`${llmBaseUrlFrom(get)}/chat/completions`, {
    method: "POST",
    headers: llmHeadersFrom(get, key),
    body: JSON.stringify({
      model: llmModelFrom(get, "gpt-5.4-nano", "qwen/qwen3.7-plus-20260602"),
      messages: [{ role: "user", content: prompt }],
      // These endpoints are judgment/extraction, not prose — keep them near
      // deterministic so the same input yields a stable verdict.
      temperature: json ? 0.2 : 0.5,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`LLM error ${res.status}: ${await res.text()}`);
  const completion = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return completion.choices?.[0]?.message?.content ?? "";
}

export async function completeJSONFrom<T>(get: EnvGet, prompt: string, fetchImpl: typeof fetch = fetch): Promise<T> {
  const raw = await completeFrom(get, prompt, true, fetchImpl);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error("Could not parse the model's JSON response");
  }
}

/** llm.ts's helper set, bound to one environment — what a ported one-shot calls. */
export function llmFor(get: EnvGet) {
  return {
    llmKey: () => llmKeyFrom(get),
    llmBaseUrl: () => llmBaseUrlFrom(get),
    llmModel: (openaiDefault: string, orDefault = openaiDefault) => llmModelFrom(get, openaiDefault, orDefault),
    llmHeaders: (key: string) => llmHeadersFrom(get, key),
    completeText: (prompt: string) => completeFrom(get, prompt, false),
    completeJSON: <T>(prompt: string) => completeJSONFrom<T>(get, prompt),
  };
}
