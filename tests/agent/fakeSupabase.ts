// A Postgrest-shaped fake, just wide enough to run the agent's real tool code.
//
// The point is NOT to reimplement Supabase — it's to let `executeTool` run
// unmodified so the assertions are about the agent's behaviour rather than
// about a mock's. Every builder method the tools actually call is here; anything
// else throws by name, so an untested query surfaces as a loud failure instead
// of a silent `undefined` that makes a test pass for the wrong reason.

export type Row = Record<string, unknown>;

/** The world under test. Swapped wholesale between cases by `resetDb`. */
export const db: Record<string, Row[]> = {};

export function resetDb(tables: Record<string, Row[]>): void {
  inserted = 0;
  for (const k of Object.keys(db)) delete db[k];
  for (const [k, rows] of Object.entries(tables)) db[k] = rows.map((r) => ({ ...r }));
}

/** Embedded selects (`calendar_accounts(provider)`) — child table → the column
 *  on the parent row that points at it. */
const RELATIONS: Record<string, { table: string; fk: string }> = {
  calendar_accounts: { table: "calendar_accounts", fk: "account_id" },
  task_labels: { table: "task_labels", fk: "task_id" },
};

function like(value: unknown, pattern: string): boolean {
  const re = new RegExp(
    `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`,
    "i",
  );
  return re.test(String(value ?? ""));
}

type Filter = (r: Row) => boolean;

/** Stands in for the uuid default on every table's `id`. */
let inserted = 0;

class Query implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private filters: Filter[] = [];
  private selectStr = "*";
  private limitN: number | null = null;
  private mode: "select" | "update" | "delete" | "insert" = "select";
  private payload: Row | Row[] | null = null;
  private singleMode: "one" | "maybe" | null = null;
  private selectCalled = false;

  constructor(private table: string) {}

  private get rows(): Row[] {
    return (db[this.table] ??= []);
  }

  select(str = "*") {
    this.selectStr = str;
    this.selectCalled = true;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  neq(col: string, val: unknown) {
    this.filters.push((r) => r[col] !== val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  ilike(col: string, pattern: string) {
    this.filters.push((r) => like(r[col], pattern));
    return this;
  }
  gte(col: string, val: string) {
    this.filters.push((r) => String(r[col] ?? "") >= val);
    return this;
  }
  lte(col: string, val: string) {
    this.filters.push((r) => String(r[col] ?? "") <= val);
    return this;
  }
  not(col: string, op: string, val: unknown) {
    if (op !== "is") throw new Error(`fakeSupabase: not(${op}) unsupported`);
    this.filters.push((r) => r[col] !== val);
    return this;
  }
  order() {
    return this; // insertion order is the fixture's order — deliberate
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  maybeSingle() {
    this.singleMode = "maybe";
    return this;
  }
  update(patch: Row) {
    this.mode = "update";
    this.payload = patch;
    return this;
  }
  delete() {
    this.mode = "delete";
    return this;
  }
  insert(rows: Row | Row[]) {
    this.mode = "insert";
    this.payload = rows;
    return this;
  }

  // `.single()` is both a modifier and, in the agent's code, always terminal.
  single() {
    this.singleMode = "one";
    return this;
  }

  private matched(): Row[] {
    const hits = this.rows.filter((r) => this.filters.every((f) => f(r)));
    return this.limitN === null ? hits : hits.slice(0, this.limitN);
  }

  /** Attach any embedded relation the select string asked for. */
  private hydrate(r: Row): Row {
    const out = { ...r };
    for (const [name, rel] of Object.entries(RELATIONS)) {
      if (!this.selectStr.includes(`${name}(`)) continue;
      const parentKey = rel.fk;
      const child = (db[rel.table] ?? []).find((c) => c.id === r[parentKey]);
      out[name] = child ? { ...child } : null;
    }
    return out;
  }

  then<R1 = { data: unknown; error: { message: string } | null }, R2 = never>(
    onfulfilled?: ((v: { data: unknown; error: { message: string } | null }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }

  private run(): { data: unknown; error: { message: string } | null } {
    if (this.mode === "insert") {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload!];
      // Postgres fills `id` from a uuid default, and every insert in the tool
      // code reads it straight back via .select().single(). A fake that returns
      // null there fails a create for a reason the product doesn't have.
      const stored = rows.map((r) => ({ id: r.id ?? `gen-${++inserted}`, ...r }));
      this.rows.push(...stored);
      if (!this.selectCalled) return { data: null, error: null };
      if (this.singleMode) {
        return stored.length === 1
          ? { data: stored[0], error: null }
          : { data: null, error: { message: `expected exactly 1 row, got ${stored.length}` } };
      }
      return { data: stored, error: null };
    }
    if (this.mode === "update") {
      for (const r of this.matched()) Object.assign(r, this.payload);
      return { data: null, error: null };
    }
    if (this.mode === "delete") {
      const doomed = new Set(this.matched());
      db[this.table] = this.rows.filter((r) => !doomed.has(r));
      return { data: null, error: null };
    }

    const hits = this.matched().map((r) => this.hydrate(r));
    if (this.singleMode === "one") {
      if (hits.length !== 1) {
        return { data: null, error: { message: `expected exactly 1 row, got ${hits.length}` } };
      }
      return { data: hits[0], error: null };
    }
    if (this.singleMode === "maybe") return { data: hits[0] ?? null, error: null };
    return { data: hits, error: null };
  }
}

/** What `createClient()` hands back — see tests/agent/stubSupabaseJs.ts. */
export function fakeClient() {
  return {
    from(table: string) {
      return new Query(table);
    },
    auth: {
      getUser() {
        throw new Error("fakeSupabase: auth is not part of the tool surface");
      },
    },
    rpc() {
      throw new Error("fakeSupabase: rpc is not part of the tool surface");
    },
  };
}
