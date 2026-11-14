// The agent one-shots' `db` on the Worker: the slice of supabase-js they call
// (from/select/update/eq/neq/in/is/not/order/limit/single/maybeSingle), built
// the way postgrest-js builds a request and answered in-process by the
// Worker's PostgREST layer (rest.ts restForStore). So every read and write is
// owner-scoped to the session (rest.ts adds `user_id = <session>` to every
// statement and checks owned FKs on writes), only REST_TABLES are reachable,
// and jsonb is written as one text parameter CAST to jsonb (never a
// JSON.stringify(...)::jsonb template param).

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AgentDb, AgentError, AgentQuery, AgentResult } from "../../supabase/functions/agent/agentDeps.ts";
import { restForStore } from "./rest.ts";
import type { Store } from "./store.ts";

const RESERVED = /[,()]/;

/** postgrest-js strips whitespace outside double quotes. */
function cleanColumns(columns: string): string {
  let quoted = false;
  return columns
    .split("")
    .map((ch) => {
      if (/\s/.test(ch) && !quoted) return "";
      if (ch === '"') quoted = !quoted;
      return ch;
    })
    .join("");
}

function toError(status: number, text: string): AgentError {
  try {
    const body = JSON.parse(text) as Partial<AgentError>;
    if (body && typeof body.message === "string") {
      return { message: body.message, code: body.code, details: body.details ?? null, hint: body.hint ?? null };
    }
  } catch {
    /* not JSON */
  }
  return { message: text || `HTTP ${status}` };
}

class Query implements AgentQuery {
  private method: "GET" | "PATCH" = "GET";
  private body: Record<string, unknown> | undefined;
  private returning = false;
  private readonly params = new URLSearchParams();

  private readonly store: Store;
  private readonly table: string;

  constructor(store: Store, table: string) {
    this.store = store;
    this.table = table;
  }

  select(columns = "*"): this {
    this.params.set("select", cleanColumns(columns));
    if (this.method === "PATCH") this.returning = true;
    return this;
  }

  update(values: Record<string, unknown>): this {
    this.method = "PATCH";
    this.body = values;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.params.append(column, `eq.${value}`);
    return this;
  }

  neq(column: string, value: unknown): this {
    this.params.append(column, `neq.${value}`);
    return this;
  }

  in(column: string, values: readonly unknown[]): this {
    const cleaned = Array.from(new Set(values))
      .map((v) => (typeof v === "string" && RESERVED.test(v) ? `"${v}"` : `${v}`))
      .join(",");
    this.params.append(column, `in.(${cleaned})`);
    return this;
  }

  is(column: string, value: null | boolean): this {
    this.params.append(column, `is.${value}`);
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    this.params.append(column, `not.${operator}.${value}`);
    return this;
  }

  order(column: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}): this {
    const { ascending = true, nullsFirst } = options;
    const term = `${column}.${ascending ? "asc" : "desc"}${nullsFirst === undefined ? "" : nullsFirst ? ".nullsfirst" : ".nullslast"}`;
    const existing = this.params.get("order");
    this.params.set("order", existing ? `${existing},${term}` : term);
    return this;
  }

  limit(count: number): this {
    this.params.set("limit", String(count));
    return this;
  }

  /** One row or an error (PGRST116 when there are 0 or several), as postgrest-js's single(). */
  single(): PromiseLike<AgentResult<any>> {
    return this.run(true);
  }

  /** One row, null for none, PGRST116 for several — postgrest-js's maybeSingle() on a read. */
  maybeSingle(): PromiseLike<AgentResult<any>> {
    return this.run(false).then((res) => {
      if (res.error || !Array.isArray(res.data)) return res;
      if (res.data.length > 1) {
        return {
          data: null,
          error: {
            code: "PGRST116",
            message: "JSON object requested, multiple (or no) rows returned",
            details: `Results contain ${res.data.length} rows, application/vnd.pgrst.object+json requires 1 row`,
            hint: null,
          },
        };
      }
      return { data: res.data[0] ?? null, error: null };
    });
  }

  then<R1 = AgentResult<any[]>, R2 = never>(
    onfulfilled?: ((value: AgentResult<any[]>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run(false).then(onfulfilled, onrejected);
  }

  private async run(singular: boolean): Promise<AgentResult<any>> {
    const res = await restForStore(this.store, {
      method: this.method,
      table: this.table,
      params: this.params,
      prefer: this.method === "PATCH" ? [this.returning ? "return=representation" : "return=minimal"] : [],
      singular,
      body: this.body,
    });
    const text = res.status === 204 ? "" : await res.text();
    if (!res.ok) return { data: null, error: toError(res.status, text) };
    return { data: text ? JSON.parse(text) : null, error: null };
  }
}

/** supabase-js's `from(table)` over the session's store. */
export function agentDb(store: Store): AgentDb {
  return { from: (table: string) => new Query(store, table) };
}
