// Measure domain routing against YOUR real data, before anything deploys.
//
//   npm run routing:check                  — how every domain reads to a router
//   npm run routing:check -- --events 60   — replay real meetings, diff vs cache
//   npm run routing:check -- --inbox       — replay the current inbox
//   npm run routing:check -- --domain SCE  — what a re-groom would propose
//
// STRICTLY READ-ONLY. It never writes a row, never persists a verdict, and never
// touches `event_domain_routing` or `tasks.suggestion` — so it can be run
// against the live account without changing what the app shows.
//
// It exists because the accuracy claim can't be checked in CI: the tests prove
// the serializer emits the fields, and only real domains and real meeting titles
// prove the model then routes them correctly. Everything below the model is
// covered by `tests/domain-routing.test.ts`; this is the part that needs eyes.
//
// Needs `.env.local` (gitignored) with VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
// and DEV credentials (VITE_DEV_EMAIL / VITE_DEV_PASSWORD), plus OPENAI_API_KEY
// for the replay modes. Without the key it still prints the domain block, which
// is the half most worth reading.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  domainRoutingBlock,
  fromDomainRow,
  ROUTING_CONFIDENCE_FLOOR,
  routingStrength,
} from "../supabase/functions/_shared/domainRouting";
import { eventSignalKey, readEventSignal } from "../supabase/functions/_shared/eventSignal";

// ── env ──────────────────────────────────────────────────────────────────────

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = { ...process.env as Record<string, string> };
  for (const file of [".env.local", ".env"]) {
    try {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
        if (m && !out[m[1]]) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    } catch { /* file is optional */ }
  }
  return out;
}

const env = loadEnv();
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : "";
};
const has = (name: string) => arg(name) !== undefined;

const DIM = "\x1b[2m", BOLD = "\x1b[1m", RESET = "\x1b[0m";
const WARN = "\x1b[33m", OK = "\x1b[32m", BAD = "\x1b[31m";

// ── the model, same selection the edge functions use ─────────────────────────

async function completeJSON<T>(prompt: string): Promise<T> {
  const key = env.OPENAI_API_KEY ?? env.LLM_API_KEY;
  if (!key) throw new Error("no OPENAI_API_KEY — set it in .env.local to replay");
  const res = await fetch(`${env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: env.OPENAI_MODEL ?? "gpt-5.4-nano",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`LLM error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as T;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const url = env.VITE_SUPABASE_URL, anon = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (.env.local)");
  const sb = createClient(url, anon);

  if (env.VITE_DEV_EMAIL && env.VITE_DEV_PASSWORD) {
    const { error } = await sb.auth.signInWithPassword({
      email: env.VITE_DEV_EMAIL,
      password: env.VITE_DEV_PASSWORD,
    });
    if (error) throw new Error(`sign-in failed: ${error.message}`);
  }

  const { data: domRows, error } = await sb
    .from("domains").select("id, name, intention, charter, context, context_at").order("sort_order");
  if (error) throw error;
  if (!domRows?.length) throw new Error("no domains on this account");
  const domains = domRows.map(fromDomainRow);

  // ── 1 · how each domain reads to a router ──────────────────────────────────
  const { text: block, catchAllId } = domainRoutingBlock(domains);
  console.log(`\n${BOLD}What a router actually sees${RESET}\n`);
  console.log(block);
  console.log(`\n${DIM}catch-all: ${catchAllId ? domains.find((d) => d.id === catchAllId)!.name : "(none — residual items will read as unattributed)"}${RESET}`);

  console.log(`\n${BOLD}Routing strength${RESET} ${DIM}(named things ×2 · describing words ×1 — 4+ reads as "clear")${RESET}`);
  for (const d of domains) {
    const s = routingStrength(d);
    const row = domRows.find((r) => r.id === d.id)!;
    const tint = s === 0 ? BAD : s < 4 ? WARN : OK;
    const groomed = row.context_at ? String(row.context_at).slice(0, 10) : "never groomed";
    console.log(`  ${tint}${String(s).padStart(3)}${RESET}  ${d.name.padEnd(18)} ${DIM}${groomed}${RESET}`);
  }

  // ── 2 · replay real meetings ───────────────────────────────────────────────
  if (has("events")) {
    const limit = Number(arg("events") || 40);
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data: rows } = await sb
      .from("external_events")
      .select("account_id, provider_event_id, calendar_id, title, location, raw, start_at")
      .gte("start_at", since).lte("start_at", new Date().toISOString())
      .order("start_at", { ascending: false }).limit(limit);

    const { data: cached } = await sb.from("event_domain_routing").select("event_key, domain_id, confidence");
    const before = new Map((cached ?? []).map((r) => [r.event_key as string, r]));
    const nameOf = (id: string | null | undefined) => domains.find((d) => d.id === id)?.name ?? "—";

    // Same dedup the endpoint does: one completion per unique routing question.
    const uniq = new Map<string, { i: number; title: string; sig: ReturnType<typeof readEventSignal>; keys: string[] }>();
    for (const r of rows ?? []) {
      const sig = readEventSignal(r.raw, r.location);
      const k = eventSignalKey(String(r.title ?? ""), "", sig);
      const eventKey = `${r.account_id}:${r.provider_event_id}`;
      const hit = uniq.get(k);
      if (hit) hit.keys.push(eventKey);
      else uniq.set(k, { i: uniq.size, title: String(r.title ?? ""), sig, keys: [eventKey] });
    }

    const list = [...uniq.values()];
    console.log(`\n${BOLD}Replaying ${list.length} unique questions from ${rows?.length ?? 0} meetings${RESET}\n`);
    const evLine = list.map((u) => {
      const meta = [u.sig.attendees && `with ${u.sig.attendees}`, u.sig.location && `at ${u.sig.location}`]
        .filter(Boolean).join("; ");
      return `[${u.i}] "${u.title || "(untitled)"}"${meta ? ` (${meta})` : ""}`;
    }).join("\n");

    const out = await completeJSON<{ routed?: Array<{ i: number; domainId: string | null; confidence: number }> }>(
      `You are attributing a person's calendar events to their life domains.\n\nTheir domains:\n${block}\n\nThe events:\n${evLine}\n\nAssign a specific domain only on a strong match; otherwise the [CATCH-ALL] if one exists; otherwise null. Report confidence honestly.\n\nJSON only:\n{"routed":[{"i":<index>,"domainId":<id or null>,"confidence":<0..1>}]}`,
    );

    let changed = 0;
    for (const v of out.routed ?? []) {
      const u = list[v.i];
      if (!u) continue;
      const old = before.get(u.keys[0]);
      const oldName = nameOf(old?.domain_id as string | null);
      const newName = nameOf(v.domainId);
      const low = v.confidence < ROUTING_CONFIDENCE_FLOOR;
      const moved = oldName !== newName;
      if (moved) changed++;
      const mark = moved ? `${WARN}→${RESET}` : " ";
      console.log(
        `  ${mark} ${u.title.slice(0, 46).padEnd(46)} ${DIM}${oldName.padEnd(14)}${RESET}` +
        ` ${moved ? BOLD : DIM}${newName.padEnd(14)}${RESET}` +
        ` ${low ? `${BAD}${v.confidence.toFixed(2)} (below floor → unattributed)${RESET}` : DIM + v.confidence.toFixed(2) + RESET}` +
        `${u.keys.length > 1 ? `${DIM}  ×${u.keys.length}${RESET}` : ""}`,
      );
    }
    console.log(`\n${DIM}${changed} of ${list.length} questions would land somewhere new. Nothing was written.${RESET}`);
  }

  // ── 3 · replay the inbox ───────────────────────────────────────────────────
  if (has("inbox")) {
    const { data: tasks } = await sb
      .from("tasks").select("id, title, notes, suggestion").eq("status", "inbox").limit(25);
    if (!tasks?.length) console.log(`\n${DIM}inbox is empty${RESET}`);
    else {
      const itemsLine = tasks.map((t, i) => `[${i}] "${t.title}"${t.notes ? ` — ${t.notes}` : ""}`).join("\n");
      const out = await completeJSON<{ items?: Array<{ i: number; targetId: string | null; confidence: number }> }>(
        `File each inbox item into the life domain it belongs to.\n\nDOMAINS:\n${block}\n\nITEMS:\n${itemsLine}\n\nAn item naming a domain's people, signals, activities or tools belongs to that domain even if it never names the domain. Return null when nothing matches.\n\nJSON only:\n{"items":[{"i":<index>,"targetId":<domain id or null>,"confidence":<0..1>}]}`,
      );
      console.log(`\n${BOLD}Inbox${RESET}\n`);
      for (const v of out.items ?? []) {
        const t = tasks[v.i];
        if (!t) continue;
        const oldName = domains.find((d) => `D:${d.id}` === (t.suggestion as { targetId?: string } | null)?.targetId)?.name ?? "—";
        const newName = domains.find((d) => d.id === v.targetId)?.name ?? "—";
        const low = v.confidence < ROUTING_CONFIDENCE_FLOOR;
        console.log(
          `  ${String(t.title).slice(0, 46).padEnd(46)} ${DIM}${oldName.padEnd(14)}${RESET} ${BOLD}${newName.padEnd(14)}${RESET}` +
          ` ${low ? `${BAD}${v.confidence.toFixed(2)}${RESET}` : DIM + v.confidence.toFixed(2) + RESET}`,
        );
      }
      console.log(`\n${DIM}Proposals only — no suggestion was persisted.${RESET}`);
    }
  }

  // ── 4 · what a re-groom would propose ──────────────────────────────────────
  const only = arg("domain");
  if (only) {
    const d = domains.find((x) => x.name.toLowerCase() === only.toLowerCase());
    if (!d) throw new Error(`no domain named "${only}" — have: ${domains.map((x) => x.name).join(", ")}`);
    console.log(`\n${BOLD}What a re-groom of ${d.name} would look like${RESET}`);
    console.log(`${DIM}(the edge function does this with its full prompt; this is the charter half)${RESET}\n`);
    console.log(JSON.stringify(d.context, null, 2));
    console.log(`\n${DIM}To see a live proposal, open the domain in the app and tap Re-groom — it proposes without saving.${RESET}`);
  }

  console.log("");
}

main().catch((e) => {
  console.error(`\n${BAD}${e instanceof Error ? e.message : String(e)}${RESET}\n`);
  process.exit(1);
});
