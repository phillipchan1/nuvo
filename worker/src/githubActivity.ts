/**
 * GitHub activity source — merged PRs as actuals.
 * Port of supabase/functions/github-activity. Tokens are sealed with
 * PR A's `sealToken` / `openToken` (AAD `activity_sources:row_id:user_id`).
 */
import type { Context } from "hono";
import { json, OPEN_CORS } from "./cors.ts";
import { bearerToken, cronAuthorized } from "./cron.ts";
import { jsonParam, type Sql } from "./db.ts";
import type { Env } from "./env.ts";
import { BadRequestError, readJson } from "./http.ts";
import { gateCronBearerRoute } from "./cutoverFlip.ts";
import { WRITE_FROZEN_MESSAGE, writeFrozen } from "./maintenance.ts";
import {
  openToken,
  parseTokenKeyring,
  sealToken,
  TokenCryptoError,
  type TokenAad,
  type TokenKeyring,
} from "./secrets.ts";
import { requestIo, requireStore, type AppEnv } from "./session.ts";
import type { Store } from "./store.ts";

const GH = "https://api.github.com";

/** Same margin as `scripts/cutover_copy.py` `SYNC_LOG_SEQUENCE_MARGIN`. */
export const SYNC_LOG_SEQUENCE_MARGIN = 1_000_000;
export const SYNC_LOG_SEQ_NAME = "public.sync_log_id_seq";

export const GITHUB_POLL_CRON = "20 9 * * *";
export const TRIM_SYNC_LOG_CRON = "0 10 * * 0";

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "nuvo",
  };
}

// deno-lint-ignore no-control-regex
const clean = (s: unknown): string => (typeof s === "string" ? s : "").replace(/[\x00-\x1F\x7F]/g, " ").trim();

interface RepoMeta {
  full_name: string;
  pushed_at: string | null;
  private: boolean;
}

interface PR {
  node_id: string;
  title: string;
  url: string;
  merged_at: string;
}

interface SourceRow {
  id: string;
  user_id: string;
  cursor: string | null;
  refresh_token_enc: unknown;
  refresh_token_iv: unknown;
  key_version: number | null;
}

function asBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string" && value.startsWith("\\x")) {
    const hex = value.slice(2);
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  return null;
}

/** Prefix/length only — never log the token. */
export function githubTokenShapeOk(token: string): boolean {
  return /^(ghp_|github_pat_|gho_|ghu_|ghs_)/.test(token) && token.length >= 20;
}

function sourceAad(rowId: string, userId: string): TokenAad {
  return { table: "activity_sources", rowId, userId };
}

async function tokenRing(env: Env): Promise<TokenKeyring> {
  return parseTokenKeyring({
    TOKEN_ENC_KEY_V1: env.TOKEN_ENC_KEY_V1,
    TOKEN_ENC_KEY_V2: env.TOKEN_ENC_KEY_V2,
    TOKEN_ENC_CURRENT: env.TOKEN_ENC_CURRENT,
  });
}

export async function fetchRepos(token: string): Promise<RepoMeta[]> {
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

export async function fetchMergedPRs(token: string, fullName: string, since: string): Promise<PR[]> {
  const out: PR[] = [];
  const day = since.slice(0, 10);
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

function asIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

async function openSourceToken(env: Env, src: SourceRow): Promise<string | null> {
  const enc = asBytes(src.refresh_token_enc);
  const iv = asBytes(src.refresh_token_iv);
  if (!enc || !iv) return null;
  try {
    const ring = await tokenRing(env);
    return await openToken(
      { ciphertext: enc, iv, keyVersion: src.key_version ?? 1 },
      sourceAad(src.id, src.user_id),
      ring,
    );
  } catch {
    return null;
  }
}

async function markReconnect(sql: Sql, src: SourceRow): Promise<void> {
  await sql`
    UPDATE activity_sources
    SET needs_reconnect = true, updated_at = now()
    WHERE id = ${src.id}
      AND user_id = ${src.user_id}
  `;
}

async function logSync(
  sql: Sql,
  userId: string,
  status: "ok" | "error",
  error?: string,
): Promise<void> {
  await sql`
    INSERT INTO sync_log (user_id, provider, operation, status, error)
    VALUES (${userId}, 'github', 'sync', ${status}, ${error ?? null})
  `;
}

async function ownedProjectId(store: Store, projectId: string): Promise<string | null> {
  const rows = (await store.sql`
    SELECT id FROM projects
    WHERE id = ${projectId}
      AND user_id = ${store.userId}
    LIMIT 1
  `) as { id: string }[];
  return rows[0]?.id ?? null;
}

async function loadOwnedSource(store: Store, sourceId: string): Promise<SourceRow | null> {
  const rows = (await store.sql`
    SELECT id, user_id, cursor, refresh_token_enc, refresh_token_iv, key_version
    FROM activity_sources
    WHERE id = ${sourceId}
      AND user_id = ${store.userId}
    LIMIT 1
  `) as SourceRow[];
  return rows[0] ?? null;
}

async function listOwnedSources(store: Store): Promise<SourceRow[]> {
  return (await store.sql`
    SELECT id, user_id, cursor, refresh_token_enc, refresh_token_iv, key_version
    FROM activity_sources
    WHERE user_id = ${store.userId}
      AND kind = 'github'
  `) as SourceRow[];
}

async function syncSource(
  sql: Sql,
  env: Env,
  src: SourceRow,
  onlyRepo?: string,
): Promise<{ count: number; recent: Array<{ title: string; url: string }> }> {
  const token = await openSourceToken(env, src);
  if (!token) {
    await markReconnect(sql, src);
    return { count: 0, recent: [] };
  }

  let bindings = (await sql`
    SELECT selector, project_id
    FROM activity_bindings
    WHERE source_id = ${src.id}
      AND user_id = ${src.user_id}
  `) as Array<{ selector: string; project_id: string }>;
  if (onlyRepo) bindings = bindings.filter((b) => b.selector === onlyRepo);
  if (!bindings.length) return { count: 0, recent: [] };

  const since = asIso(src.cursor) ?? new Date(Date.now() - 180 * 86_400_000).toISOString();
  const recent: Array<{ title: string; url: string; merged_at: string }> = [];
  let maxMerged = asIso(src.cursor) ?? "";
  let count = 0;

  for (const b of bindings) {
    const prs = await fetchMergedPRs(token, b.selector, since);
    for (const pr of prs) {
      await sql`
        INSERT INTO activity_units (
          user_id, source_id, kind, external_id, title, url, selector, project_id, occurred_at
        )
        VALUES (
          ${src.user_id}, ${src.id}, 'github', ${pr.node_id}, ${pr.title}, ${pr.url},
          ${b.selector}, ${b.project_id}, ${pr.merged_at}
        )
        ON CONFLICT (source_id, external_id) DO UPDATE SET
          title = EXCLUDED.title,
          url = EXCLUDED.url,
          selector = EXCLUDED.selector,
          project_id = EXCLUDED.project_id,
          occurred_at = EXCLUDED.occurred_at
        WHERE activity_units.user_id = ${src.user_id}
      `;
      count += 1;
      recent.push({ title: pr.title, url: pr.url, merged_at: pr.merged_at });
      if (pr.merged_at > maxMerged) maxMerged = pr.merged_at;
    }
  }

  await sql`
    UPDATE activity_sources
    SET last_synced_at = now(),
        cursor = ${maxMerged || since},
        needs_reconnect = false,
        updated_at = now()
    WHERE id = ${src.id}
      AND user_id = ${src.user_id}
  `;

  recent.sort((a, b) => (a.merged_at < b.merged_at ? 1 : -1));
  return { count, recent: recent.slice(0, 5).map(({ title, url }) => ({ title, url })) };
}

async function completeJSON<T>(env: Env, prompt: string): Promise<T> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.OPENAI_MODEL ?? "gpt-5.4-nano",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}`);
  const completion = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return JSON.parse(completion.choices?.[0]?.message?.content ?? "{}") as T;
}

export async function runGithubPoll(sql: Sql, env: Env): Promise<{ ok: true; synced: number; users: number }> {
  const users = (await sql`SELECT id FROM users`) as { id: string }[];
  let synced = 0;
  for (const user of users) {
    const sources = (await sql`
      SELECT id, user_id, cursor, refresh_token_enc, refresh_token_iv, key_version
      FROM activity_sources
      WHERE user_id = ${user.id}
        AND kind = 'github'
    `) as SourceRow[];
    for (const src of sources) {
      try {
        const r = await syncSource(sql, env, src);
        synced += r.count;
      } catch (e) {
        await logSync(sql, src.user_id, "error", String((e as Error)?.message ?? e));
      }
    }
  }
  return { ok: true, synced, users: users.length };
}

/**
 * Parked identity floor for A's sync_log resync.
 *
 * After restore, cutover `setval`s `sync_log_id_seq` to source max(id) +
 * 1e6 so Neon inserts sit above Supabase ids. Resync copies missing
 * source ids (OVERRIDING SYSTEM VALUE) and setvals
 * GREATEST(max(id), last_value, 1) — the park never decreases.
 *
 * Copied source ids typically sit below the parked floor
 * (`last_value - margin + 1`). The floor keeps recent Neon-origin rows
 * out of age trim; it is not a permanent partition. After about 1e6
 * further Neon inserts the floor rises past those early Neon ids and
 * age-trim applies to any row older than 30 days. `CUTOVER_FLIPPED`
 * must be set only after unschedule → final resync, or every resync
 * copies old source rows back and the next trim deletes them again.
 * Never reset the sequence. Fresh / unparked sequences (last_value <
 * margin) trim by age only.
 */
export async function parkedSyncLogFloor(sql: Sql): Promise<number | null> {
  const rows = (await sql`SELECT last_value FROM public.sync_log_id_seq`) as { last_value: string | number }[];
  const last = Number(rows[0]?.last_value ?? 0);
  if (!Number.isFinite(last) || last < SYNC_LOG_SEQUENCE_MARGIN) return null;
  return Math.max(last - SYNC_LOG_SEQUENCE_MARGIN + 1, 1);
}

export async function runTrimSyncLog(sql: Sql): Promise<{
  ok: true;
  deleted: number;
  users: number;
  parked_floor: number | null;
}> {
  const parkedFloor = await parkedSyncLogFloor(sql);
  const users = (await sql`SELECT id FROM users`) as { id: string }[];
  let deleted = 0;
  for (const user of users) {
    const rows = parkedFloor == null
      ? ((await sql`
          DELETE FROM sync_log
          WHERE user_id = ${user.id}
            AND created_at < now() - interval '30 days'
          RETURNING id
        `) as { id: number }[])
      : ((await sql`
          DELETE FROM sync_log
          WHERE user_id = ${user.id}
            AND created_at < now() - interval '30 days'
            AND id < ${parkedFloor}
          RETURNING id
        `) as { id: number }[]);
    deleted += rows.length;
  }
  const orphans = parkedFloor == null
    ? ((await sql`
        DELETE FROM sync_log
        WHERE user_id IS NULL
          AND created_at < now() - interval '30 days'
        RETURNING id
      `) as { id: number }[])
    : ((await sql`
        DELETE FROM sync_log
        WHERE user_id IS NULL
          AND created_at < now() - interval '30 days'
          AND id < ${parkedFloor}
        RETURNING id
      `) as { id: number }[]);
  deleted += orphans.length;
  return { ok: true, deleted, users: users.length, parked_floor: parkedFloor };
}

async function connectSource(store: Store, env: Env, token: string): Promise<Response> {
  if (!token) return json({ error: "Paste a token first." }, 400, OPEN_CORS);
  const who = await fetch(`${GH}/user`, { headers: ghHeaders(token) });
  if (who.status === 401 || who.status === 403) {
    return json({ error: "That token was rejected — check it has Pull requests: read." }, 400, OPEN_CORS);
  }
  if (!who.ok) return json({ error: `GitHub error ${who.status}.` }, 400, OPEN_CORS);
  const me = (await who.json()) as { login: string; avatar_url: string };
  const repos = await fetchRepos(token);
  if (!repos.length) {
    return json(
      { error: "Token works, but it can't see any repositories — set Repository access to the repos you want." },
      400,
      OPEN_CORS,
    );
  }

  const id = crypto.randomUUID();
  const inserted = (await store.sql`
    INSERT INTO activity_sources (id, user_id, kind, login, avatar_url, repos, needs_reconnect)
    VALUES (${id}, ${store.userId}, 'github', ${me.login}, ${me.avatar_url}, ${jsonParam(store.sql, repos)}, false)
    ON CONFLICT (user_id, kind, login) DO UPDATE SET
      avatar_url = EXCLUDED.avatar_url,
      repos = EXCLUDED.repos,
      needs_reconnect = false,
      updated_at = now()
    WHERE activity_sources.user_id = ${store.userId}
    RETURNING id, login, avatar_url, repos
  `) as Array<{ id: string; login: string; avatar_url: string; repos: unknown }>;
  const row = inserted[0];
  if (!row) return json({ error: "cannot insert" }, 400, OPEN_CORS);

  const ring = await tokenRing(env);
  const sealed = await sealToken(token, sourceAad(row.id, store.userId), ring);
  await store.sql`
    UPDATE activity_sources
    SET refresh_token_enc = ${sealed.ciphertext},
        refresh_token_iv = ${sealed.iv},
        key_version = ${sealed.keyVersion},
        token_secret_id = NULL,
        updated_at = now()
    WHERE id = ${row.id}
      AND user_id = ${store.userId}
  `;
  return json({ ok: true, source: row }, 200, OPEN_CORS);
}

export async function handleGithubActivity(c: Context<AppEnv>): Promise<Response> {
  if (c.req.method === "OPTIONS") return new Response("ok", { headers: OPEN_CORS });
  if (c.req.method !== "POST") return json({ error: "method not allowed" }, 405, OPEN_CORS);

  let body: Record<string, unknown>;
  try {
    const raw = await readJson<unknown>(c);
    body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch (err) {
    if (err instanceof BadRequestError) return json({ error: "bad request" }, 400, OPEN_CORS);
    throw err;
  }

  const action = clean(body.action) || "sync";
  const cronToken = bearerToken(c.req.header("authorization"));
  if (action === "sync" && cronAuthorized(cronToken, c.env.CRON_SECRET)) {
    const skipped = gateCronBearerRoute("github-poll", c.env);
    if (skipped) return json({ ok: true, ...skipped }, 200, OPEN_CORS);
    if (writeFrozen(c.env.MAINTENANCE_WRITE_FREEZE)) {
      return json({ error: "write_frozen", message: WRITE_FROZEN_MESSAGE }, 503, OPEN_CORS);
    }
    const io = await requestIo(c);
    return json(await runGithubPoll(io.sql, c.env), 200, OPEN_CORS);
  }

  const got = await requireStore(c);
  if ("error" in got) return got.error;
  if (writeFrozen(c.env.MAINTENANCE_WRITE_FREEZE)) {
    return json({ error: "write_frozen", message: WRITE_FROZEN_MESSAGE }, 503, OPEN_CORS);
  }
  const { store } = got;

  try {
    if (action === "connect") {
      return await connectSource(store, c.env, clean(body.token));
    }

    if (action === "repos") {
      const sources = await listOwnedSources(store);
      const src = sources[0];
      if (!src) return json({ repos: [] }, 200, OPEN_CORS);
      const token = await openSourceToken(c.env, src);
      if (!token) return json({ repos: [] }, 200, OPEN_CORS);
      const repos = await fetchRepos(token);
      await store.sql`
        UPDATE activity_sources
        SET repos = ${jsonParam(store.sql, repos)}, updated_at = now()
        WHERE id = ${src.id}
          AND user_id = ${store.userId}
      `;
      return json({ repos }, 200, OPEN_CORS);
    }

    if (action === "sync") {
      const sources = await listOwnedSources(store);
      const wanted = clean(body.sourceId);
      const target = wanted ? sources.filter((s) => s.id === wanted) : sources;
      let count = 0;
      let recent: Array<{ title: string; url: string }> = [];
      for (const src of target) {
        const r = await syncSource(store.sql, c.env, src, clean(body.repo) || undefined);
        count += r.count;
        if (r.recent.length) recent = r.recent;
      }
      return json({ ok: true, count, recent }, 200, OPEN_CORS);
    }

    if (action === "bind") {
      const sourceId = clean(body.sourceId);
      const projectId = clean(body.projectId);
      const repo = clean(body.repo);
      if (!sourceId || !projectId || !repo) return json({ error: "Missing sourceId, projectId, or repo." }, 400, OPEN_CORS);
      const src = await loadOwnedSource(store, sourceId);
      const project = await ownedProjectId(store, projectId);
      if (!src || !project) return json({ error: "not found" }, 404, OPEN_CORS);
      await store.sql`
        INSERT INTO activity_bindings (user_id, source_id, project_id, selector)
        VALUES (${store.userId}, ${src.id}, ${project}, ${repo})
        ON CONFLICT (source_id, selector) DO UPDATE SET
          project_id = EXCLUDED.project_id
        WHERE activity_bindings.user_id = ${store.userId}
      `;
      const r = await syncSource(store.sql, c.env, src, repo);
      return json({ ok: true, count: r.count, recent: r.recent }, 200, OPEN_CORS);
    }

    if (action === "theme") {
      const weekStartISO = clean(body.weekStartISO);
      if (!weekStartISO) return json({ groups: [] }, 200, OPEN_CORS);
      const weekStart = new Date(weekStartISO);
      const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);
      const units = (await store.sql`
        SELECT title, project_id, selector
        FROM activity_units
        WHERE user_id = ${store.userId}
          AND occurred_at >= ${weekStart.toISOString()}
          AND occurred_at < ${weekEnd.toISOString()}
      `) as Array<{ title: string; project_id: string | null; selector: string | null }>;
      if (!units.length) return json({ groups: [] }, 200, OPEN_CORS);

      const projRows = (await store.sql`
        SELECT id, name FROM projects WHERE user_id = ${store.userId}
      `) as Array<{ id: string; name: string }>;
      const projName = new Map(projRows.map((p) => [p.id, p.name]));
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
        const raw = await completeJSON<{ lines?: Array<{ i: unknown; line: unknown }> }>(c.env, prompt);
        for (const l of raw.lines ?? []) {
          const i = Number(l.i);
          if (Number.isInteger(i) && i >= 0 && i < groups.length && typeof l.line === "string") {
            lines.set(i, clean(l.line));
          }
        }
      } catch {
        lines = new Map();
      }
      return json(
        { groups: groups.map((g, i) => ({ project: g.name, theme: lines.get(i) ?? null, titles: g.titles })) },
        200,
        OPEN_CORS,
      );
    }

    if (action === "disconnect") {
      const sourceId = clean(body.sourceId);
      if (!sourceId) return json({ error: "Missing sourceId." }, 400, OPEN_CORS);
      await store.sql`
        DELETE FROM activity_sources
        WHERE id = ${sourceId}
          AND user_id = ${store.userId}
      `;
      return json({ ok: true }, 200, OPEN_CORS);
    }

    return json({ error: `Unknown action: ${action}` }, 400, OPEN_CORS);
  } catch (err) {
    if (err instanceof TokenCryptoError) return json({ error: "service unavailable" }, 503, OPEN_CORS);
    throw err;
  }
}
