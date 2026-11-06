import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

// Blocker 8: after the copy, a fresh Better Auth sign-up must be able to
// write. The restored Supabase schema points planner FKs at the auth.users
// stub, which nothing fills after the flip.
const ROOT = join(import.meta.dirname, "..");
const WORKFLOW = readFileSync(join(ROOT, ".github/workflows/cutover-migrate.yml"), "utf8");

function pyConst(name: string): string {
  const r = spawnSync(
    "python3",
    ["-c", `import sys; sys.path.insert(0, ${JSON.stringify(join(ROOT, "scripts"))}); from cutover_copy import ${name}; sys.stdout.write(${name})`],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
}

const REPOINT = pyConst("REPOINT_OWNER_FKS_SQL");
const LEFT = pyConst("OWNER_FKS_ON_AUTH_USERS_SQL");

// The shape cmd_restore leaves: STUB_AUTH_SQL's auth.users, Supabase's
// public tables (FKs at auth.users), then PUBLIC_USERS_SQL.
const RESTORED = `
CREATE SCHEMA auth;
CREATE TABLE auth.users (id UUID PRIMARY KEY, email TEXT);
CREATE TABLE public.domains (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE TABLE public.user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  theme TEXT
);
CREATE TABLE public.sync_log (
  id BIGINT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE public.users (id UUID PRIMARY KEY, email TEXT UNIQUE, auth_id UUID UNIQUE);
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-00000000000a', 'old@example.test');
INSERT INTO public.users VALUES ('00000000-0000-0000-0000-00000000000a', 'old@example.test', '00000000-0000-0000-0000-00000000000a');
INSERT INTO public.user_settings VALUES ('00000000-0000-0000-0000-00000000000a', 'paper');
`;

async function restored(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(RESTORED);
  return db;
}

const FRESH = "00000000-0000-0000-0000-0000000000f1";

describe("copy repoints owner FKs at public.users (blocker 8)", () => {
  it("reproduces the failure without the repoint", async () => {
    const db = await restored();
    await db.query("INSERT INTO public.users (id, email, auth_id) VALUES ($1, 'new@example.test', $1)", [FRESH]);
    await expect(db.query("INSERT INTO public.user_settings (user_id) VALUES ($1)", [FRESH])).rejects.toThrow(
      /user_settings_user_id_fkey/,
    );
  });

  it("lets a fresh sign-up write, and keeps names and delete rules", async () => {
    const db = await restored();
    await db.exec(REPOINT);
    expect((await db.query<{ count: number }>(LEFT)).rows[0]!.count).toBe(0);

    await db.query("INSERT INTO public.users (id, email, auth_id) VALUES ($1, 'new@example.test', $1)", [FRESH]);
    await db.query("INSERT INTO public.user_settings (user_id) VALUES ($1)", [FRESH]);
    await db.query("INSERT INTO public.domains (id, user_id) VALUES (gen_random_uuid(), $1)", [FRESH]);

    const defs = (await db.query<{ conname: string; def: string }>(`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE contype = 'f' ORDER BY conname`)).rows;
    expect(defs).toEqual([
      { conname: "domains_user_id_fkey", def: "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE" },
      { conname: "sync_log_user_id_fkey", def: "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED" },
      { conname: "user_settings_user_id_fkey", def: "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE" },
    ]);

    // Deleting the planner owner still cascades (delete-account).
    await db.query("DELETE FROM public.users WHERE id = $1", [FRESH]);
    expect((await db.query("SELECT 1 FROM public.user_settings WHERE user_id = $1", [FRESH])).rows).toHaveLength(0);
    // Copied accounts are untouched.
    expect((await db.query("SELECT theme FROM public.user_settings")).rows).toEqual([{ theme: "paper" }]);
  });

  it("is idempotent", async () => {
    const db = await restored();
    await db.exec(REPOINT);
    await db.exec(REPOINT);
    expect((await db.query<{ count: number }>(LEFT)).rows[0]!.count).toBe(0);
  });

  it("refuses an FK on a column other than id", async () => {
    const db = await restored();
    await db.exec("ALTER TABLE auth.users ADD CONSTRAINT auth_email_key UNIQUE (email); CREATE TABLE public.odd (e TEXT REFERENCES auth.users(email));");
    await expect(db.exec(REPOINT)).rejects.toThrow(/other than id/);
  });

  it("runs in cmd_restore right after PUBLIC_USERS_SQL and dies if any FK is left", () => {
    const at = WORKFLOW.indexOf("psql(target, PUBLIC_USERS_SQL)");
    const repoint = WORKFLOW.indexOf("psql(target, REPOINT_OWNER_FKS_SQL)");
    expect(at).toBeGreaterThan(0);
    expect(repoint).toBeGreaterThan(at);
    expect(WORKFLOW.slice(repoint, repoint + 400)).toMatch(/OWNER_FKS_ON_AUTH_USERS_SQL[\s\S]*die\(/);
  });
});
