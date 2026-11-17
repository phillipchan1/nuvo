import type { Context } from "hono";
import { closeSql, openSql, type Sql } from "./db.ts";
import { openAuth, type AuthInstance, type AuthOptions } from "./auth.ts";
import type { Env } from "./env.ts";

export interface RequestIo {
  sql: Sql;
  auth: AuthInstance;
  close: () => Promise<void>;
}

function openRequestIoDefault(env: Env, opts: AuthOptions = {}): RequestIo {
  const sql = openSql(env);
  const opened = openAuth(env, opts);
  return {
    sql,
    auth: opened.auth,
    close: async () => {
      await Promise.allSettled([closeSql(sql), opened.close()]);
    },
  };
}

let factory: (env: Env, opts?: AuthOptions) => RequestIo = openRequestIoDefault;

export function openRequestIo(env: Env, opts?: AuthOptions): RequestIo {
  return factory(env, opts);
}

/** Test-only: swap the opener. Not an I/O cache — the factory itself holds no sockets. */
export function installRequestIoForTests(fn: (env: Env) => RequestIo): () => void {
  factory = fn;
  return () => {
    factory = openRequestIoDefault;
  };
}

/**
 * Close after the response. `waitUntil` keeps the isolate alive on Workers
 * without holding the client for the next request.
 */
export function scheduleClose(c: Context, close: Promise<unknown>): void {
  try {
    const ctx = c.executionCtx;
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(close);
      return;
    }
  } catch {
    // app.request() has no Worker ExecutionContext
  }
  void close;
}
