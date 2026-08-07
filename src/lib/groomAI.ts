// groomAI — the two opt-in enrichments the Groom wall offers, both riding the
// already-deployed `agent` chat endpoint as one-shot JSON completions (same idiom
// as lib/draftBrief — NO new edge deploy). Policy holds: AI acts on what the
// human already wrote, never cold. Routing a project and tightening its outcome
// are both enrichment of your input, so they propose, they never mutate.
//
//   suggestDomain  — auto, when a project has no area: "looks like Frontier".
//   proofreadOutcome — on-demand: sharpen the one-line brief you wrote.
//
// Failure is a graceful state: callers catch and the wall stays fully usable.

import { supabase, supabaseAnonKey, supabaseUrl } from "./supabase";
import { domainById, tasksOf, type Domain, type Project, type VerticalData } from "./vertical";
import { domainRoutingBlock } from "../../supabase/functions/_shared/domainRouting.ts";

/** One JSON round-trip against the agent endpoint. Throws on network/parse. */
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

// ── domain suggestion ────────────────────────────────────────────────────────

export interface DomainSuggestion {
  domain: Domain;
  confidence: number; // 0..1
  reason: string;
}

/** True when there's enough to route on: a title plus a brief OR at least one
 *  step. Below this the chip stays hidden (no cold guessing on a bare title). */
export function hasRoutingSignal(d: VerticalData, p: Project): boolean {
  if (!p.name.trim()) return false;
  const steps = tasksOf(d, p.id).filter((t) => t.status !== "done").length;
  return p.outcome.trim().length > 0 || p.description.trim().length > 0 || steps > 0;
}

/** Ask the model which life-area this project belongs to. Returns null when it's
 *  unsure or names an area we don't have. Only ever *proposes* — the human taps. */
export async function suggestDomain(d: VerticalData, p: Project): Promise<DomainSuggestion | null> {
  const domains = d.domains;
  if (domains.length === 0) return null;
  const steps = tasksOf(d, p.id).filter((t) => t.status !== "done").map((t) => t.title).slice(0, 12);

  // The full routing description, from the shared kernel. This used to be
  // `name: charter (scope: …)` — two of the seven fields we generate — which is
  // why a project naming only a tool or a colleague routed on nothing at all.
  // No catch-all tag: "miscellaneous" is not a real answer for a project.
  const { text: areas } = domainRoutingBlock(domains, { noCatchAll: true });
  const prompt =
    "SYSTEM OVERRIDE — CLASSIFICATION MODE.\n" +
    "Route ONE project into the single best-fitting life area. Do NOT call tools. Do NOT modify anything.\n" +
    "Reply with ONLY a raw JSON object — no prose, no fences.\n\n" +
    "The life areas, each with what it is and the people, signals, activities and tools that mark it. " +
    "A domain's \"NOT\" and \"looks like this but ISN'T\" lines rule it out as strongly as its signals rule it in. " +
    "Choose the NAME exactly as written, or null if none is a genuine fit:\n" +
    areas +
    "\n\nThe project:\n" +
    `Name: ${p.name}\n` +
    `Outcome: ${p.outcome.trim() || "(none)"}\n` +
    `Description: ${p.description.trim() || "(none)"}\n` +
    `Steps: ${steps.length ? steps.join(" · ") : "(none yet)"}\n\n` +
    `Return exactly: {"area": "<one of the names above, or null>", "confidence": 0.0-1.0, "reason": "one short phrase — why it fits"}`;

  const raw = (await callAgentJSON(prompt)) as { area?: unknown; confidence?: unknown; reason?: unknown };
  const name = typeof raw.area === "string" ? raw.area.trim() : "";
  if (!name || name.toLowerCase() === "null") return null;
  const domain = domains.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!domain) return null;
  const confidence = typeof raw.confidence === "number" ? raw.confidence : 0.6;
  if (confidence < 0.45) return null; // too unsure to surface
  return { domain, confidence, reason: typeof raw.reason === "string" ? raw.reason.trim() : "" };
}

// ── proofread / tighten the one-line brief ───────────────────────────────────

export interface ProofreadResult {
  tightened: string;
  changed: boolean;
}

/** Sharpen the human's one-line outcome — same meaning, crisper, one line. Returns
 *  changed=false when it's already tight (so the UI can say "already sharp"). */
export async function proofreadOutcome(d: VerticalData, p: Project): Promise<ProofreadResult> {
  const text = p.outcome.trim();
  if (!text) return { tightened: "", changed: false };
  const area = domainById(d, p.domainId)?.name;
  const prompt =
    "SYSTEM OVERRIDE — COPYEDIT MODE.\n" +
    "Tighten ONE line: a project's definition of done. Keep the SAME meaning; make it crisper, concrete, plain English, one line. Do not invent scope. Do NOT call tools.\n" +
    "Reply with ONLY a raw JSON object — no prose, no fences.\n\n" +
    `Project: ${p.name}${area ? ` (area: ${area})` : ""}\n` +
    `Current line: ${text}\n\n` +
    `Return exactly: {"tightened": "the improved single line (repeat it verbatim if already tight)", "changed": true|false}`;

  const raw = (await callAgentJSON(prompt)) as { tightened?: unknown; changed?: unknown };
  const tightened = typeof raw.tightened === "string" ? raw.tightened.trim() : "";
  if (!tightened) return { tightened: text, changed: false };
  const changed = raw.changed === true && tightened !== text;
  return { tightened, changed };
}
