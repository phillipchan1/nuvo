// judgeOKRs — the OKR quality critic. Not all key results are created equal: some
// are real outcome metrics, some are vague, some are activities in disguise, some
// set targets that are trivial or impossible in the window. This rides the deployed
// `agent` endpoint (one-shot JSON, NO new edge — same idiom as draftOKRs/groomAI)
// and returns a per-result verdict the wall renders inline. It only JUDGES — it
// never mutates; the human reads the critique and sharpens the number themselves.

import { supabase, supabaseAnonKey, supabaseUrl } from "./supabase";
import { domainById, type Initiative, type KeyResult, type VerticalData } from "./vertical";

export type KRRating = "strong" | "fair" | "weak";

export interface KRVerdict {
  /** the key result's id, so the wall keys the verdict back to its row. */
  id: string;
  rating: KRRating;
  /** one short line — why it's strong, or what would make it a real measure. */
  note: string;
}

async function callAgentJSON(prompt: string): Promise<unknown> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token ?? supabaseAnonKey;
  const res = await fetch(`${supabaseUrl}/functions/v1/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: supabaseAnonKey, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `agent call failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamed = "";
  let finalText: string | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === "[DONE]") continue;
      let evt: { t?: string; v?: string; content?: string; msg?: string };
      try { evt = JSON.parse(payload); } catch { continue; }
      if (evt.t === "c" && typeof evt.v === "string") streamed += evt.v;
      else if (evt.t === "d" && typeof evt.content === "string") finalText = evt.content;
      else if (evt.t === "e") throw new Error(evt.msg || "agent error");
    }
  }
  const text = finalText || streamed;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON in reply");
  return JSON.parse(text.slice(start, end + 1));
}

const RATINGS: KRRating[] = ["strong", "fair", "weak"];

/** Judge each key result on measurability, specificity, and feasibility in the
 *  window. Returns a verdict per result (keyed by id). Throws on network/parse —
 *  the wall catches and stays fully usable. */
export async function judgeKeyResults(opts: { d: VerticalData; item: Initiative }): Promise<KRVerdict[]> {
  const { d, item } = opts;
  const krs = item.keyResults;
  if (krs.length === 0) return [];
  const area = domainById(d, item.domainId)?.name;

  // Number the results 1..N and match verdicts back by that index — models echo a
  // small integer reliably, an exact UUID they do not.
  const list = krs
    .map((k: KeyResult, i) => `${i + 1}. "${k.name}" · ${k.baseline} → ${k.target}${k.unit} (now ${k.current})`)
    .join("\n");

  const prompt =
    "SYSTEM OVERRIDE — OKR CRITIC MODE.\n" +
    "Judge the quality of an initiative's key results. Do NOT call tools. Do NOT modify anything. Treat your data as background only.\n" +
    "Reply with ONLY a raw JSON object — no prose, no fences.\n\n" +
    `Initiative: ${item.name}${area ? ` (area: ${area})` : ""}\n` +
    `Objective: ${item.outcome.trim() || "(none set)"}\n` +
    `Finish line: ${item.targetDate ?? "(none set)"}\n\n` +
    "The key results to judge (by number):\n" + list + "\n\n" +
    "Rate each on three tests: MEASURABLE (a real number that proves the objective, not an activity or a vague word), " +
    "SPECIFIC (unambiguous — you'd know if you hit it), and FEASIBLE-YET-AMBITIOUS (the baseline→target move is real and honest for the window, neither trivial nor impossible). " +
    'Rating: "strong" (a real, sharp measure), "fair" (usable but soft — vague, or target unproven), "weak" (not a real outcome measure — an activity, unmeasurable, or an implausible target).\n' +
    'Return one verdict per number, exactly: {"verdicts": [{"n": <the number>, "rating": "strong|fair|weak", "note": "one short line — praise if strong, else the single fix that would make it a real measure"}]}';

  const raw = (await callAgentJSON(prompt)) as { verdicts?: unknown };
  const arr = Array.isArray(raw.verdicts) ? raw.verdicts : [];
  const out: KRVerdict[] = [];
  for (const v of arr) {
    const o = (v ?? {}) as Record<string, unknown>;
    const n = typeof o.n === "number" ? o.n : typeof o.n === "string" ? parseInt(o.n, 10) : NaN;
    const kr = krs[n - 1];
    if (!kr) continue;
    const rating = (typeof o.rating === "string" && RATINGS.includes(o.rating as KRRating) ? o.rating : "fair") as KRRating;
    out.push({ id: kr.id, rating, note: typeof o.note === "string" ? o.note.trim() : "" });
  }
  return out;
}
