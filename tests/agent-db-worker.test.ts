// worker/src/agentDb.ts: the postgrest-js-shaped builder the shared agent
// cores run on in the Worker. Covers the edges the one-shot tests don't reach:
// in.() quoting of reserved characters, maybeSingle() with several rows,
// update+select returning rows, and owner scoping of an unfiltered read/write.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentDb } from "../worker/src/agentDb.ts";
import { makePgliteSql } from "../worker/src/pgliteSql.ts";
import { resetRestCatalogForTests } from "../worker/src/rest.ts";
import { makeStore } from "../worker/src/store.ts";
import { oneShotPg } from "./agent/oneShotPg.ts";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const T1 = "aaaaaaaa-3333-4000-8000-000000000001";
const T2 = "aaaaaaaa-3333-4000-8000-000000000002";
const TB = "bbbbbbbb-3333-4000-8000-000000000001";

let db: PGlite;
let a: ReturnType<typeof agentDb>;

beforeAll(async () => {
  db = await oneShotPg();
  resetRestCatalogForTests();
  await db.exec(`
    INSERT INTO public.tasks (id, user_id, title, status, sort_order) VALUES
      ('${T1}', '${A}', 'Pay rent, (June) "now"', 'inbox', 1),
      ('${T2}', '${A}', 'Plain', 'inbox', 2),
      ('${TB}', '${B}', 'Pay rent, (June) "now"', 'inbox', 1);
  `);
  a = agentDb(makeStore(makePgliteSql(db), A));
});
afterAll(async () => {
  await db.close();
});

describe("agentDb", () => {
  it("in() quotes values with , ( ) and only returns the caller's rows", async () => {
    const { data, error } = await a.from("tasks").select("id, title").in("title", ['Pay rent, (June) "now"', "Plain"]).order("sort_order");
    expect(error).toBeNull();
    expect((data as { id: string }[]).map((r) => r.id)).toEqual([T1, T2]);
  });
  it("maybeSingle(): null for none, PGRST116 for several", async () => {
    const none = await a.from("tasks").select("id").eq("id", TB).maybeSingle();
    expect(none).toMatchObject({ data: null, error: null });
    const many = await a.from("tasks").select("id").eq("status", "inbox").maybeSingle();
    expect(many.data).toBeNull();
    expect(many.error).toMatchObject({ code: "PGRST116" });
  });
  it("single(): PGRST116 for another user's row", async () => {
    const r = await a.from("tasks").select("id").eq("id", TB).single();
    expect(r.data).toBeNull();
    expect(r.error).toMatchObject({ code: "PGRST116" });
  });
  it("update().eq() never reaches another user's row; update().select() returns the changed rows", async () => {
    const foreign = await a.from("tasks").update({ notes: "hijack" }).eq("id", TB).select("id");
    expect(foreign).toMatchObject({ data: [], error: null });
    expect((await db.query<{ notes: string | null }>(`SELECT notes FROM public.tasks WHERE id = $1`, [TB])).rows[0].notes).not.toBe("hijack");
    const mine = await a.from("tasks").update({ suggestion: { kind: "x", n: 1 } }).eq("id", T2).select("id");
    expect(mine).toMatchObject({ data: [{ id: T2 }], error: null });
    const t = (await db.query<{ t: string }>(`SELECT jsonb_typeof(suggestion) AS t FROM public.tasks WHERE id = $1`, [T2])).rows[0].t;
    expect(t).toBe("object");
  });
  it("is() / not() / neq() filters", async () => {
    const r = await a.from("tasks").select("id").is("project_id", null).neq("id", T1).not("status", "in", '("done","trashed")');
    expect((r.data as { id: string }[]).map((x) => x.id)).toEqual([T2]);
  });
});
