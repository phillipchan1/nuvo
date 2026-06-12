// Small shared OpenAI helpers for the one-shot intelligence endpoints
// (scaffold / blueprint / prepare / narrate).

function key(): string {
  const k = Deno.env.get("OPENAI_API_KEY");
  if (!k) throw new Error("OPENAI_API_KEY not configured");
  return k;
}

const model = () => Deno.env.get("OPENAI_MODEL") ?? "gpt-4.1-mini";

async function complete(prompt: string, json: boolean): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model(),
      messages: [{ role: "user", content: prompt }],
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
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
