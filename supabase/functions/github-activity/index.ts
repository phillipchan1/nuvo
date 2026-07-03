// Activity source #2 — GitHub merged PRs as actuals.
//
// Mirrors the calendar feed (google-sync + route-events): pull completed units,
// attribute them to a project, never re-spend on what we've seen. The unit is a
// MERGED PR (titled, human-authored) — not commits. Auth is a fine-grained PAT
// held in Vault (single-user app; no OAuth). Spec: docs/activity-sources.md.
//
// Actions (POST { action, … }):
//   connect    { token }            → validate via /user, store PAT in Vault,
//                                      fetch repos, upsert activity_sources
//   repos      { }                  → refresh + return the source's repos
//   sync       { sourceId?, repo? } → pull merged PRs since cursor for bound
//                                      repos; upsert activity_units; return
//                                      { count, recent } (scoped → the "magic
//                                      moment"). No user (service role / cron) →
//                                      sync every source for every user.
//   theme      { weekStartISO }     → AI-theme this week's PRs into "what you
//                                      built", grouped by project (Reflect)
//   disconnect { sourceId }         → delete the source (cascades units+bindings)

import { admin, handleOptions, json, requireUser, readSecret, storeSecret, logSync } from "../_shared/admin.ts";

const GH = "https://api.github.com";
const ghHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "nuvo",
});

// deno-lint-ignore no-control-regex
const clean = (s: unknown): string => (typeof s === "string" ? s : "").replace(/[\x00-\x1F\x7F]/g, " ").trim();

interface RepoMeta { full_name: string; pushed_at: string | null; private: boolean }

async function fetchRepos(token: string): Promise<RepoMeta[]> {
  const out: RepoMeta[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(
      `${GH}/user/repos?sort=pushed&per_page=100&page=${page}&affiliation=owner,collaborator,organization_member`,
      { headers: ghHeaders(token) },
    );
    if (!res.ok) break;
    const rows = (await res.json()) as Array<{ full_name: string; pushed_at: string | null; private: boolean }>;
    if (!rows.length) break;
    for (const r of rows) out.push({ full_name: r.full_name, pushed_at: r.pushed_at, private: r.private });
    if (rows.length < 100) break;
  }
  return out;
}

interface PR { node_id: string; title: string; url: string; merged_at: string }

/** Merged PRs in a repo since `since` (ISO). Uses the search API (gives merged_at). */
async function fetchMergedPRs(token: string, fullName: string, since: string): Promise<PR[]> {
  const out: PR[] = [];
  const day = since.slice(0, 10); // search granularity is a date
  for (let page = 1; page <= 3; page++) {
    const q = encodeURIComponent(`repo:${fullName} is:pr is:merged merged:>=${day}`);
    const res = await fetch(`${GH}/search/issues?q=${q}&sort=updated&order=desc&per_page=100&page=${page}`, {
      headers: ghHeaders(token),
    });
    if (!res.ok) break;
    const body = (await res.json()) as {
      items?: Array<{ node_id: string; title: string; html_url: string; pull_request?: { merged_at?: string | null } }>;
    };
    const items = body.items ?? [];
    for (const it of items) {
      const mergedAt = it.pull_request?.merged_at;
      if (!mergedAt) continue;
      out.push({ node_id: it.node_id, title: clean(it.title) || "(untitled)", url: it.html_url, merged_at: mergedAt });
    }
    if (items.length < 100) break;
  }
  return out;
}

type SourceRow = {
  id: string;
  user_id: string;
  token_secret_id: string | null;
  cursor: string | null;
};

/** Pull merged PRs for one source's bound repos and upsert them as units.
 *  When `onlyRepo` is set, scope to it (and return the recent titles for the
 *  bind-time "found N things you shipped" moment). */
async function syncSource(src: SourceRow, onlyRepo?: string): Promise<{ count: number; recent: Array<{ title: string; url: string }> }> {
  if (!src.token_secret_id) return { count: 0, recent: [] };
  const token = await readSecret(src.token_secret_id);
  if (!token) {
    await admin.from("activity_sources").update({ needs_reconnect: true }).eq("id", src.id);
    return { count: 0, recent: [] };
  }

  const { data: bindRows } = await admin
    .from("activity_bindings")
    .select("selector, project_id")
    .eq("source_id", src.id);
  let bindings = (bindRows ?? []) as Array<{ selector: string; project_id: string }>;
  if (onlyRepo) bindings = bindings.filter((b) => b.selector === onlyRepo);
  if (!bindings.length) return { count: 0, recent: [] };

  // First sync seeds 180 days; thereafter from the cursor (small overlap is fine —
  // upsert on (source_id, external_id) makes re-seen PRs idempotent).
  const since = src.cursor ?? new Date(Date.now() - 180 * 86_400_000).toISOString();

  const rows: Array<Record<string, unknown>> = [];
  const recent: Array<{ title: string; url: string; merged_at: string }> = [];
  let maxMerged = src.cursor ?? "";
  for (const b of bindings) {
    const prs = await fetchMergedPRs(token, b.selector, since);
    for (const pr of prs) {
      rows.push({
        user_id: src.user_id,
        source_id: src.id,
        kind: "github",
        external_id: pr.node_id,
        title: pr.title,
        url: pr.url,
        selector: b.selector,
        project_id: b.project_id,
        occurred_at: pr.merged_at,
      });
      recent.push({ title: pr.title, url: pr.url, merged_at: pr.merged_at });
      if (pr.merged_at > maxMerged) maxMerged = pr.merged_at;
    }
  }

  if (rows.length) {
    const { error } = await admin.from("activity_units").upsert(rows, { onConflict: "source_id,external_id" });
    if (error) throw new Error(error.message);
  }
  await admin
    .from("activity_sources")
    .update({ last_synced_at: new Date().toISOString(), cursor: maxMerged || since, needs_reconnect: false })
    .eq("id", src.id);

  recent.sort((a, b) => (a.merged_at < b.merged_at ? 1 : -1));
  return { count: rows.length, recent: recent.slice(0, 5).map(({ title, url }) => ({ title, url })) };
}

async function completeJSON<T>(prompt: string): Promise<T> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("OPENAI_MODEL") ?? "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4, // a little warmth — this is human-facing prose, lightly
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const completion = await res.json();
  return JSON.parse(completion.choices?.[0]?.message?.content ?? "{}") as T;
}

function isServiceRole(req: Request): boolean {
  const auth = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  return auth === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const body = await req.json().catch(() => ({}));
    const action: string = body.action ?? "sync";

    // ── cron / service-role: sync every source for every user ──────────────
    if (action === "sync" && isServiceRole(req)) {
      const { data: srcRows } = await admin
        .from("activity_sources")
        .select("id, user_id, token_secret_id, cursor");
      let total = 0;
      for (const src of (srcRows ?? []) as SourceRow[]) {
        try {
          const r = await syncSource(src);
          total += r.count;
        } catch (e) {
          await logSync("github", "sync", "error", String((e as Error)?.message ?? e), src.user_id);
        }
      }
      return json({ ok: true, synced: total });
    }

    // ── everything else is user-scoped ─────────────────────────────────────
    const user = await requireUser(req);

    if (action === "connect") {
      const token = clean(body.token);
      if (!token) return json({ error: "Paste a token first." }, 400);
      const who = await fetch(`${GH}/user`, { headers: ghHeaders(token) });
      if (who.status === 401 || who.status === 403) {
        return json({ error: "That token was rejected — check it has Pull requests: read." }, 400);
      }
      if (!who.ok) return json({ error: `GitHub error ${who.status}.` }, 400);
      const me = (await who.json()) as { login: string; avatar_url: string };
      const repos = await fetchRepos(token);
      if (!repos.length) {
        return json({ error: "Token works, but it can't see any repositories — set Repository access to the repos you want." }, 400);
      }
      const secretId = await storeSecret(`github:${user.id}:${me.login}`, token);
      const { data: row, error } = await admin
        .from("activity_sources")
        .upsert(
          {
            user_id: user.id,
            kind: "github",
            login: me.login,
            avatar_url: me.avatar_url,
            token_secret_id: secretId,
            repos,
            needs_reconnect: false,
          },
          { onConflict: "user_id,kind,login" },
        )
        .select("id, login, avatar_url, repos")
        .single();
      if (error) throw new Error(error.message);
      return json({ ok: true, source: row });
    }

    if (action === "repos") {
      const { data: src } = await admin
        .from("activity_sources")
        .select("id, token_secret_id")
        .eq("user_id", user.id)
        .eq("kind", "github")
        .maybeSingle();
      if (!src?.token_secret_id) return json({ repos: [] });
      const token = await readSecret(src.token_secret_id);
      if (!token) return json({ repos: [] });
      const repos = await fetchRepos(token);
      await admin.from("activity_sources").update({ repos }).eq("id", src.id);
      return json({ repos });
    }

    if (action === "sync") {
      const { data: srcRows } = await admin
        .from("activity_sources")
        .select("id, user_id, token_secret_id, cursor")
        .eq("user_id", user.id)
        .eq("kind", "github");
      const sources = (srcRows ?? []) as SourceRow[];
      const target = body.sourceId ? sources.filter((s) => s.id === body.sourceId) : sources;
      let count = 0;
      let recent: Array<{ title: string; url: string }> = [];
      for (const src of target) {
        const r = await syncSource(src, clean(body.repo) || undefined);
        count += r.count;
        if (r.recent.length) recent = r.recent;
      }
      return json({ ok: true, count, recent });
    }

    if (action === "theme") {
      const weekStartISO = clean(body.weekStartISO);
      if (!weekStartISO) return json({ groups: [] });
      const weekStart = new Date(weekStartISO);
      const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);
      const { data: unitRows } = await admin
        .from("activity_units")
        .select("title, project_id, selector")
        .eq("user_id", user.id)
        .gte("occurred_at", weekStart.toISOString())
        .lt("occurred_at", weekEnd.toISOString());
      const units = (unitRows ?? []) as Array<{ title: string; project_id: string | null; selector: string | null }>;
      if (!units.length) return json({ groups: [] });

      const { data: projRows } = await admin
        .from("projects")
        .select("id, name")
        .eq("user_id", user.id);
      const projName = new Map((projRows ?? []).map((p) => [p.id as string, p.name as string]));

      // group by project (the app)
      const byProject = new Map<string, { name: string; titles: string[] }>();
      for (const u of units) {
        const key = u.project_id ?? u.selector ?? "_";
        const name = (u.project_id && projName.get(u.project_id)) || u.selector || "Other";
        const g = byProject.get(key) ?? { name, titles: [] };
        g.titles.push(u.title);
        byProject.set(key, g);
      }
      const groups = [...byProject.values()];

      const prompt = `A person shipped these things this week (each is a merged pull request title), grouped by project. Write a short, warm "what you built" line for EACH group — outcomes in plain human language, not a list of PR titles, never a count. Speak in second person, past tense ("you shipped…", "you rebuilt…"). One sentence per group, ≤22 words.

${groups.map((g, i) => `[${i}] ${g.name}\n${g.titles.map((t) => `  - ${t}`).join("\n")}`).join("\n\n")}

Respond with JSON only: {"lines":[{"i":<group index>,"line":"<one sentence>"}]}`;

      let lines = new Map<number, string>();
      try {
        const raw = await completeJSON<{ lines?: Array<{ i: unknown; line: unknown }> }>(prompt);
        for (const l of raw.lines ?? []) {
          const i = Number(l.i);
          if (Number.isInteger(i) && i >= 0 && i < groups.length && typeof l.line === "string") lines.set(i, clean(l.line));
        }
      } catch {
        lines = new Map(); // theming is a nicety — fall back to raw titles client-side
      }

      return json({
        groups: groups.map((g, i) => ({ project: g.name, theme: lines.get(i) ?? null, titles: g.titles })),
      });
    }

    if (action === "disconnect") {
      const sourceId = clean(body.sourceId);
      if (!sourceId) return json({ error: "Missing sourceId." }, 400);
      const { error } = await admin.from("activity_sources").delete().eq("user_id", user.id).eq("id", sourceId);
      if (error) throw new Error(error.message);
      return json({ ok: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    if (e instanceof Response) return e;
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
