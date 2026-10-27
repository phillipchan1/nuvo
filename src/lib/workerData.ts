/**
 * PostgREST-shaped client that talks to Worker /api/data and /api/rpc.
 * Used only when the launch-time switch has flipped to the Worker.
 */
import { edgeFunctionUrl, workerApiRoot } from "./backend";
import { workerAuthHeaders } from "./sessionAuth";

const supabaseOrigin = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
  || "http://localhost:54321";

type Filter =
  | { kind: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"; col: string; value: unknown }
  | { kind: "in"; col: string; value: unknown[] }
  | { kind: "is"; col: string; value: unknown }
  | { kind: "not-is"; col: string; value: unknown };

type Order = { col: string; ascending: boolean; nullsFirst?: boolean };

type Result<T> = { data: T; error: { message: string; code?: string } | null };

function err(message: string, code?: string): { message: string; code?: string } {
  return code ? { message, code } : { message };
}

function asError(e: unknown): { message: string; code?: string } {
  if (e && typeof e === "object" && "message" in e) {
    const code = "code" in e && typeof (e as { code?: unknown }).code === "string"
      ? (e as { code: string }).code
      : undefined;
    return err(String((e as { message: unknown }).message), code);
  }
  return err(e instanceof Error ? e.message : String(e));
}

function applyFilters(rows: Record<string, unknown>[], filters: Filter[]): Record<string, unknown>[] {
  return rows.filter((row) => {
    for (const f of filters) {
      const cell = row[f.col];
      switch (f.kind) {
        case "eq":
          if (cell !== f.value) return false;
          break;
        case "neq":
          if (cell === f.value) return false;
          break;
        case "gt":
          if (cell == null || (cell as string | number) <= (f.value as string | number)) return false;
          break;
        case "gte":
          if (cell == null || (cell as string | number) < (f.value as string | number)) return false;
          break;
        case "lt":
          if (cell == null || (cell as string | number) >= (f.value as string | number)) return false;
          break;
        case "lte":
          if (cell == null || (cell as string | number) > (f.value as string | number)) return false;
          break;
        case "in":
          if (!f.value.includes(cell)) return false;
          break;
        case "is":
          if (f.value === null) {
            if (cell !== null && cell !== undefined) return false;
          } else if (cell !== f.value) return false;
          break;
        case "not-is":
          if (f.value === null) {
            if (cell === null || cell === undefined) return false;
          } else if (cell === f.value) return false;
          break;
      }
    }
    return true;
  });
}

function applyOrder(rows: Record<string, unknown>[], orders: Order[]): Record<string, unknown>[] {
  if (!orders.length) return rows;
  return [...rows].sort((a, b) => {
    for (const o of orders) {
      const av = a[o.col];
      const bv = b[o.col];
      const aNull = av == null;
      const bNull = bv == null;
      if (aNull || bNull) {
        if (aNull && bNull) continue;
        const nullsFirst = o.nullsFirst ?? !o.ascending;
        if (aNull) return nullsFirst ? -1 : 1;
        return nullsFirst ? 1 : -1;
      }
      if (av < bv) return o.ascending ? -1 : 1;
      if (av > bv) return o.ascending ? 1 : -1;
    }
    return 0;
  });
}

function parseSelect(select: string): { cols: string[] | null; nests: { name: string; cols: string[] }[] } {
  const nests: { name: string; cols: string[] }[] = [];
  let rest = select;
  rest = rest.replace(/(\w+)\(([^)]*)\)/g, (_m, name: string, inner: string) => {
    const cols = inner.trim() && inner.trim() !== "*"
      ? inner.split(",").map((s) => s.trim()).filter(Boolean)
      : ["*"];
    nests.push({ name, cols });
    return "";
  });
  const cols = rest
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (cols.includes("*") || cols.length === 0) return { cols: null, nests };
  return { cols, nests };
}

function project(row: Record<string, unknown>, cols: string[] | null): Record<string, unknown> {
  if (!cols) return row;
  const out: Record<string, unknown> = {};
  for (const c of cols) if (c in row) out[c] = row[c];
  return out;
}

async function workerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const root = workerApiRoot();
  if (!root) throw new Error("Worker API is not active");
  const headers = await workerAuthHeaders(
    init.headers && typeof init.headers === "object" && !Array.isArray(init.headers)
      ? (init.headers as Record<string, string>)
      : {},
  );
  return fetch(`${root}${path}`, { ...init, headers, credentials: "include" });
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function rowsFrom(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  if (body && typeof body === "object" && "data" in body) {
    const data = (body as { data: unknown }).data;
    if (Array.isArray(data)) return data as Record<string, unknown>[];
    if (data && typeof data === "object") return [data as Record<string, unknown>];
    return [];
  }
  return [];
}

function rowFrom(body: unknown): Record<string, unknown> | null {
  const rows = rowsFrom(body);
  return rows[0] ?? (body && typeof body === "object" && "data" in body
    ? ((body as { data: Record<string, unknown> | null }).data ?? null)
    : null);
}

async function listTable(table: string, signal?: AbortSignal): Promise<Record<string, unknown>[]> {
  const res = await workerFetch(`/data/${encodeURIComponent(table)}`, { method: "GET", signal });
  const body = await readJson(res);
  if (!res.ok) {
    const message = (body as { error?: string; message?: string } | null)?.error
      ?? (body as { message?: string } | null)?.message
      ?? `GET ${table} failed (${res.status})`;
    throw Object.assign(new Error(message), { code: String(res.status) });
  }
  return rowsFrom(body);
}

async function nestEmbeds(
  table: string,
  rows: Record<string, unknown>[],
  nests: { name: string; cols: string[] }[],
  signal?: AbortSignal,
): Promise<void> {
  for (const nest of nests) {
    if (nest.name === "key_results" && table === "initiatives") {
      const kids = await listTable("key_results", signal);
      for (const row of rows) {
        const mine = kids.filter((k) => k.initiative_id === row.id);
        row.key_results = nest.cols[0] === "*" ? mine : mine.map((k) => project(k, nest.cols));
      }
      continue;
    }
    if (nest.name === "task_labels") {
      await Promise.all(rows.map(async (row) => {
        if (typeof row.id !== "string") {
          row.task_labels = [];
          return;
        }
        const res = await workerFetch(`/data/task_labels?task_id=${encodeURIComponent(row.id)}`, {
          method: "GET",
          signal,
        });
        const body = await readJson(res);
        const labels = res.ok ? rowsFrom(body) : [];
        row.task_labels = nest.cols[0] === "*" ? labels : labels.map((k) => project(k, nest.cols));
      }));
    }
  }
}

export function workerFrom(table: string) {
  return new WorkerQuery(table);
}

class WorkerQuery {
  private table: string;
  private filters: Filter[] = [];
  private orders: Order[] = [];
  private selectSpec = "*";
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private limitN: number | null = null;
  private wantSingle: "single" | "maybe" | null = null;
  private signal: AbortSignal | undefined;
  private mode: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private payload: unknown = null;
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } | null = null;

  constructor(table: string) {
    this.table = table;
  }

  select(columns = "*"): this {
    this.selectSpec = columns;
    return this;
  }

  eq(col: string, value: unknown): this {
    this.filters.push({ kind: "eq", col, value });
    return this;
  }

  neq(col: string, value: unknown): this {
    this.filters.push({ kind: "neq", col, value });
    return this;
  }

  gt(col: string, value: unknown): this {
    this.filters.push({ kind: "gt", col, value });
    return this;
  }

  gte(col: string, value: unknown): this {
    this.filters.push({ kind: "gte", col, value });
    return this;
  }

  lt(col: string, value: unknown): this {
    this.filters.push({ kind: "lt", col, value });
    return this;
  }

  lte(col: string, value: unknown): this {
    this.filters.push({ kind: "lte", col, value });
    return this;
  }

  in(col: string, value: unknown[]): this {
    this.filters.push({ kind: "in", col, value });
    return this;
  }

  is(col: string, value: unknown): this {
    this.filters.push({ kind: "is", col, value });
    return this;
  }

  not(col: string, op: string, value: unknown): this {
    if (op === "is") this.filters.push({ kind: "not-is", col, value });
    return this;
  }

  match(values: Record<string, string>): this {
    for (const [col, value] of Object.entries(values)) this.filters.push({ kind: "eq", col, value });
    return this;
  }

  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }): this {
    this.orders.push({ col, ascending: opts?.ascending ?? true, nullsFirst: opts?.nullsFirst });
    return this;
  }

  range(from: number, to: number): this {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  abortSignal(signal: AbortSignal): this {
    this.signal = signal;
    return this;
  }

  single(): this {
    this.wantSingle = "single";
    return this;
  }

  maybeSingle(): this {
    this.wantSingle = "maybe";
    return this;
  }

  insert(row: unknown): this {
    this.mode = "insert";
    this.payload = row;
    return this;
  }

  update(row: Record<string, unknown>): this {
    this.mode = "update";
    this.payload = row;
    return this;
  }

  upsert(row: unknown, opts?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
    this.mode = "upsert";
    this.payload = row;
    this.upsertOpts = opts ?? null;
    return this;
  }

  delete(): this {
    this.mode = "delete";
    return this;
  }

  then<TResult1 = Result<unknown>, TResult2 = never>(
    onfulfilled?: ((value: Result<unknown>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<Result<unknown>> {
    try {
      if (this.mode === "select") return await this.runSelect();
      if (this.mode === "delete") return await this.runDelete();
      if (this.mode === "update") return await this.runUpdate();
      return await this.runWrite();
    } catch (e) {
      return { data: this.wantSingle ? null : [], error: asError(e) };
    }
  }

  private async runSelect(): Promise<Result<unknown>> {
    const { cols, nests } = parseSelect(this.selectSpec);
    let rows = applyFilters(await listTable(this.table, this.signal), this.filters);
    rows = applyOrder(rows, this.orders);
    if (nests.length) await nestEmbeds(this.table, rows, nests, this.signal);
    if (this.rangeFrom != null && this.rangeTo != null) {
      rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
    } else if (this.limitN != null) {
      rows = rows.slice(0, this.limitN);
    }
    const projected = rows.map((r) => project(r, cols));
    if (this.wantSingle === "single") {
      if (!projected[0]) return { data: null, error: err("JSON object requested, multiple (or no) rows returned", "PGRST116") };
      return { data: projected[0], error: null };
    }
    if (this.wantSingle === "maybe") return { data: projected[0] ?? null, error: null };
    return { data: projected, error: null };
  }

  private idFromFilters(): string | null {
    const id = this.filters.find((f) => f.kind === "eq" && f.col === "id");
    return id && typeof id.value === "string" ? id.value : null;
  }

  private async runDelete(): Promise<Result<unknown>> {
    if (this.table === "task_labels") {
      const task = this.filters.find((f) => f.kind === "eq" && f.col === "task_id");
      const label = this.filters.find((f) => f.kind === "eq" && f.col === "label_id");
      if (typeof task?.value === "string" && typeof label?.value === "string") {
        const res = await workerFetch(
          `/data/task_labels?task_id=${encodeURIComponent(task.value)}&label_id=${encodeURIComponent(label.value)}`,
          { method: "DELETE", signal: this.signal },
        );
        if (!res.ok) {
          const body = await readJson(res);
          return { data: null, error: err((body as { error?: string })?.error ?? `delete failed (${res.status})`) };
        }
        return { data: null, error: null };
      }
    }
    const id = this.idFromFilters();
    if (id) {
      const res = await workerFetch(`/data/${encodeURIComponent(this.table)}/${encodeURIComponent(id)}`, {
        method: "DELETE",
        signal: this.signal,
      });
      if (!res.ok && res.status !== 404) {
        const body = await readJson(res);
        return { data: null, error: err((body as { error?: string })?.error ?? `delete failed (${res.status})`) };
      }
      return { data: null, error: null };
    }
    const rows = applyFilters(await listTable(this.table, this.signal), this.filters);
    for (const row of rows) {
      const rowId = typeof row.id === "string" ? row.id : null;
      if (!rowId) continue;
      const res = await workerFetch(`/data/${encodeURIComponent(this.table)}/${encodeURIComponent(rowId)}`, {
        method: "DELETE",
        signal: this.signal,
      });
      if (!res.ok && res.status !== 404) {
        const body = await readJson(res);
        return { data: null, error: err((body as { error?: string })?.error ?? `delete failed (${res.status})`) };
      }
    }
    return { data: null, error: null };
  }

  private async runUpdate(): Promise<Result<unknown>> {
    const patch = (this.payload ?? {}) as Record<string, unknown>;
    const id = this.idFromFilters();
    const targets = id
      ? [{ id }]
      : applyFilters(await listTable(this.table, this.signal), this.filters);
    const updated: Record<string, unknown>[] = [];
    for (const row of targets) {
      const rowId = typeof row.id === "string" ? row.id : id;
      if (!rowId) continue;
      const res = await workerFetch(`/data/${encodeURIComponent(this.table)}/${encodeURIComponent(rowId)}`, {
        method: "PATCH",
        signal: this.signal,
        body: JSON.stringify(patch),
      });
      const body = await readJson(res);
      if (!res.ok) {
        return { data: null, error: err((body as { error?: string })?.error ?? `update failed (${res.status})`) };
      }
      const next = rowFrom(body) ?? { ...row, ...patch, id: rowId };
      updated.push(next);
    }
    const { cols } = parseSelect(this.selectSpec);
    const projected = updated.map((r) => project(r, cols));
    if (this.wantSingle || this.limitN === 1) return { data: projected[0] ?? null, error: null };
    return { data: projected, error: null };
  }

  private async runWrite(): Promise<Result<unknown>> {
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
    const written: Record<string, unknown>[] = [];
    for (const row of rows) {
      if (this.table === "task_labels" && row && typeof row === "object") {
        const rec = row as { task_id?: string; label_id?: string };
        const res = await workerFetch("/data/task_labels", {
          method: "POST",
          signal: this.signal,
          body: JSON.stringify({ task_id: rec.task_id, label_id: rec.label_id }),
        });
        const body = await readJson(res);
        if (!res.ok) {
          return { data: null, error: err((body as { error?: string })?.error ?? `write failed (${res.status})`) };
        }
        written.push(rowFrom(body) ?? (row as Record<string, unknown>));
        continue;
      }
      const res = await workerFetch(`/data/${encodeURIComponent(this.table)}`, {
        method: "POST",
        signal: this.signal,
        body: JSON.stringify(row),
      });
      const body = await readJson(res);
      if (!res.ok) {
        if (this.upsertOpts?.ignoreDuplicates && (res.status === 400 || res.status === 409)) {
          continue;
        }
        return { data: null, error: err((body as { error?: string })?.error ?? `write failed (${res.status})`) };
      }
      written.push(rowFrom(body) ?? (row as Record<string, unknown>));
    }
    const { cols } = parseSelect(this.selectSpec);
    const projected = written.map((r) => project(r, cols));
    if (this.wantSingle) return { data: projected[0] ?? null, error: null };
    return { data: Array.isArray(this.payload) ? projected : projected[0] ?? null, error: null };
  }
}

export async function workerRpc<T = unknown>(
  name: string,
  args?: Record<string, unknown>,
): Promise<Result<T>> {
  try {
    const res = await workerFetch(`/rpc/${encodeURIComponent(name)}`, {
      method: "POST",
      body: JSON.stringify(args ?? {}),
    });
    const body = await readJson(res);
    if (!res.ok) {
      return {
        data: null as T,
        error: err(
          (body as { error?: string; message?: string } | null)?.error
            ?? (body as { message?: string } | null)?.message
            ?? `rpc ${name} failed (${res.status})`,
          String(res.status),
        ),
      };
    }
    const data = body && typeof body === "object" && "data" in body
      ? (body as { data: T }).data
      : (body as T);
    return { data, error: null };
  } catch (e) {
    return { data: null as T, error: asError(e) };
  }
}

export async function workerInvoke<T = unknown>(
  name: string,
  body?: Record<string, unknown>,
): Promise<{ data: T | null; error: { message: string } | null }> {
  try {
    const headers = await workerAuthHeaders();
    const res = await fetch(edgeFunctionUrl(supabaseOrigin, name), {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify(body ?? {}),
    });
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try { parsed = JSON.parse(text); } catch { parsed = { error: text }; }
    }
    if (!res.ok) {
      const message = (parsed as { error?: string; message?: string } | null)?.error
        ?? (parsed as { message?: string } | null)?.message
        ?? `${name} failed (${res.status})`;
      return { data: parsed as T, error: { message } };
    }
    return { data: parsed as T, error: null };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
  }
}
