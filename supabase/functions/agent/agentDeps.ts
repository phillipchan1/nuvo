// What a one-shot endpoint needs from its runtime, handed in rather than
// imported, so the Supabase agent and the Cloudflare Worker run the same code.
//   db  — the slice of supabase-js the one-shots use. On Supabase it is the
//         service-role `admin`; on the Worker, worker/src/agentDb.ts, which
//         answers through the Worker's PostgREST layer scoped to the session.
//   env — how settings are read (Deno.env.get, or the Worker's bindings).
// Zero runtime imports.

import type { EnvGet } from "./llmCore.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any

export interface AgentError {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

/** supabase-js's result shape, with untyped rows — as the one-shots always read it. */
export interface AgentResult<D> {
  data: D | null;
  error: AgentError | null;
}

/** The PostgREST builder methods the one-shots call, nothing more. */
export interface AgentQuery extends PromiseLike<AgentResult<any[]>> {
  select(columns?: string): AgentQuery;
  update(values: Record<string, unknown>): AgentQuery;
  eq(column: string, value: unknown): AgentQuery;
  neq(column: string, value: unknown): AgentQuery;
  in(column: string, values: readonly unknown[]): AgentQuery;
  is(column: string, value: null | boolean): AgentQuery;
  not(column: string, operator: string, value: unknown): AgentQuery;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): AgentQuery;
  limit(count: number): AgentQuery;
  single(): PromiseLike<AgentResult<any>>;
  maybeSingle(): PromiseLike<AgentResult<any>>;
}

export interface AgentDb {
  from(table: string): AgentQuery;
}

export interface AgentDeps {
  db: AgentDb;
  env: EnvGet;
}

/** A core function's arguments after `deps` — for the Supabase bindings. */
export type Rest<F> = F extends (deps: AgentDeps, ...args: infer A) => any ? A : never;
