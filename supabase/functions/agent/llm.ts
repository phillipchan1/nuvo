// Small shared OpenAI/OpenRouter helpers for the one-shot intelligence endpoints
// (scaffold / blueprint / prepare / narrate). The request itself lives in
// llmCore.ts so the Cloudflare Worker runs the same one; this file binds it to
// Deno.env.
//
// Set OPENROUTER_API_KEY to route everything through OpenRouter instead of OpenAI.
// OPENAI_MODEL always overrides the default model for any endpoint.

import {
  completeFrom,
  completeJSONFrom,
  llmBaseUrlFrom,
  llmHeadersFrom,
  llmKeyFrom,
  llmModelFrom,
  type EnvGet,
} from "./llmCore.ts";

const denoEnv: EnvGet = (name) => Deno.env.get(name);

export function llmKey(): string {
  return llmKeyFrom(denoEnv);
}

export function llmBaseUrl(): string {
  return llmBaseUrlFrom(denoEnv);
}

/** Pick a model: OPENAI_MODEL env var always wins; otherwise pick per-provider default. */
export function llmModel(openaiDefault: string, orDefault = openaiDefault): string {
  return llmModelFrom(denoEnv, openaiDefault, orDefault);
}

export function llmHeaders(key: string): Record<string, string> {
  return llmHeadersFrom(denoEnv, key);
}

export const completeText = (prompt: string) => completeFrom(denoEnv, prompt, false);

export function completeJSON<T>(prompt: string): Promise<T> {
  return completeJSONFrom<T>(denoEnv, prompt);
}
