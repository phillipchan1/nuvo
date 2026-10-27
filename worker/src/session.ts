import type { Context } from "hono";
import { SessionLookupError, sessionUser } from "./auth.ts";
import { OPEN_CORS, json } from "./cors.ts";
import type { Env } from "./env.ts";
import { openRequestIo, type RequestIo } from "./requestIo.ts";
import { bootstrapUser, makeStore, type Store } from "./store.ts";

export type AppEnv = { Bindings: Env; Variables: { io?: RequestIo } };

export async function requestIo(c: Context<AppEnv>): Promise<RequestIo> {
  const existing = c.get("io");
  if (existing) return existing;
  const io = openRequestIo(c.env);
  c.set("io", io);
  return io;
}

export async function requireStore(
  c: Context<AppEnv>,
): Promise<
  | { store: Store; email: string | null; user: { id: string; email?: string | null; emailVerified: boolean } }
  | { error: Response }
> {
  const io = await requestIo(c);
  let user;
  try {
    user = await sessionUser(io.auth, c.req.raw);
  } catch (err) {
    if (err instanceof SessionLookupError) {
      return { error: json({ error: "service unavailable" }, 503, OPEN_CORS) };
    }
    throw err;
  }
  if (!user) return { error: json({ error: "unauthorized" }, 401, OPEN_CORS) };
  const store = await bootstrapUser(makeStore(io.sql, user.id), user.email ?? null, {
    emailVerified: user.emailVerified,
  });
  return { store, email: user.email ?? null, user };
}
