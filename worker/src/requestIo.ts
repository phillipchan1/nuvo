import type { Context } from "hono";
import { closeSql, openSql, type Sql } from "./db.ts";
import { openAuth, type AuthInstance } from "./auth.ts";
import type { Env } from "./env.ts";

export interface RequestIo {
  sql: Sql;
  auth: AuthInstance;
  close: () => Promise<void>;
}

function openRequestIoDefault(env: Env): RequestIo {
  const sql = openSql(env);
  const opened = openAuth(env);
  return {
    sql,
    auth: opened.auth,
    close: async () => {
      await Promise.allSettled([closeSql(sql), opened.close()]);
    },
  };
}

let factory: (env: Env) => RequestIo = openRequestIoDefault;

export function openRequestIo(env: Env): RequestIo {
  return factory(env);
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
