#!/usr/bin/env node
/**
 * Contract check for the deployed `apply_patch` RPC.
 *
 * This exists because of a real outage-shaped bug: migration 53's `apply_patch`
 * failed with `42702 column reference "id" is ambiguous` on every patch that had
 * a field to apply, and *nothing in `npm test` could see it*. The TypeScript
 * suite models the merge rule (`tests/sync/multi-device.test.ts`) but never
 * executes a line of plpgsql, so a syntax or aliasing error ships green.
 *
 * Worse than a dropped write: PostgREST returns 42702 as a 4xx with a `42…`
 * SQLSTATE, which the client reads as a considered refusal — so every queued
 * update would have gone straight to PARKED while the database was healthy.
 *
 * A `supabase db start` harness would be the textbook answer, but it needs
 * Docker. This checks the thing that actually matters — the function as
 * deployed — and needs nothing but credentials.
 *
 *   node scripts/check-apply-patch.mjs                 # read-only checks
 *   node scripts/check-apply-patch.mjs --write         # + a self-cleaning scratch row
 *
 * Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY and NUVO_TEST_EMAIL /
 * NUVO_TEST_PASSWORD (falls back to VITE_DEV_EMAIL / VITE_DEV_PASSWORD) from
 * .env.local.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const WRITE = process.argv.includes("--write");

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

let failures = 0;
function check(name, ok, detail) {
  const mark = ok ? "[32m✓[0m" : "[31m✗[0m";
  console.log(`  ${mark} ${name}`);
  if (!ok) {
    failures++;
    if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`);
  }
}

const rpc = (args) => supabase.rpc("apply_patch", args);

async function main() {
  const email = env.NUVO_TEST_EMAIL ?? env.VITE_DEV_EMAIL;
  const password = env.NUVO_TEST_PASSWORD ?? env.VITE_DEV_PASSWORD;
  const { error: authErr } = await supabase.auth.signInWithPassword({ email, password });
  if (authErr) throw new Error(`sign-in failed: ${authErr.message}`);

  console.log("\napply_patch — deployed contract\n");

  // 1. Deployed and callable at all. An empty patch returns before any UPDATE,
  //    so this passes even on the broken migration-53 function — which is
  //    precisely why it is not the only check here.
  {
    const { data, error } = await rpc({
      p_table: "tasks",
      p_match: { id: "00000000-0000-0000-0000-000000000000" },
      p_patch: {},
      p_field_ts: {},
    });
    check("deployed and callable", !error, error);
    check("no match → matched: 0", data?.matched === 0, data);
  }

  // 2. The allowlist is the only thing between this function and every tenant
  //    table in the database.
  {
    const { error } = await rpc({
      p_table: "subscriptions",
      p_match: { id: "x" },
      p_patch: { entitled: true },
      p_field_ts: {},
    });
    check("non-syncable table refused", error?.code === "42501", error);
  }
  {
    const { error } = await rpc({
      p_table: "tasks; drop table tasks--",
      p_match: { id: "x" },
      p_patch: { title: "x" },
      p_field_ts: {},
    });
    check("injection-shaped table name refused", error?.code === "42501", error);
  }
  {
    const { error } = await rpc({
      p_table: "tasks",
      p_match: {},
      p_patch: { title: "x" },
      p_field_ts: {},
    });
    check("empty match refused", error?.code === "22023", error);
  }

  if (!WRITE) {
    console.log("\n  (skipping merge checks — pass --write to exercise them)\n");
    return;
  }

  // 3. The merge itself. This is the half that migration 53 got wrong, and it
  //    can only be reached by a patch that actually applies a field.
  const id = crypto.randomUUID();
  const { data: { user } } = await supabase.auth.getUser();
  const { error: insErr } = await supabase.from("tasks").insert({
    id,
    user_id: user.id,
    title: "apply_patch contract check — safe to delete",
    status: "trashed", // born trashed so it never appears in a real surface
  });
  if (insErr) throw new Error(`scratch insert failed: ${insErr.message}`);

  try {
    const future = new Date(Date.now() + 60_000).toISOString();
    const ancient = "2000-01-01T00:00:00.000Z";
    const read = async () =>
      (await supabase.from("tasks").select("title, notes, field_ts").eq("id", id).single()).data;

    // A fresh stamp applies — the case that returned 42702 before migration 54.
    {
      const { data, error } = await rpc({
        p_table: "tasks",
        p_match: { id },
        p_patch: { title: "applied" },
        p_field_ts: { title: future },
      });
      const row = await read();
      check("fresh stamp applies", !error && row?.title === "applied", error ?? row);
      check("stamp is recorded in field_ts", Boolean(row?.field_ts?.title), row?.field_ts);
      check("reports the applied field", data?.applied?.includes("title"), data);
    }

    // A stale stamp must lose — this is the whole point of field-level LWW.
    {
      const { data } = await rpc({
        p_table: "tasks",
        p_match: { id },
        p_patch: { title: "CLOBBERED" },
        p_field_ts: { title: ancient },
      });
      const row = await read();
      check("stale stamp rejected", row?.title === "applied", row);
      check("reports the rejected field", data?.rejected?.includes("title"), data);
    }

    // Two devices, different fields: neither may lose its write.
    {
      await rpc({
        p_table: "tasks",
        p_match: { id },
        p_patch: { notes: "from device B" },
        p_field_ts: { notes: future },
      });
      const row = await read();
      check(
        "a second field merges without disturbing the first",
        row?.title === "applied" && row?.notes === "from device B",
        row,
      );
    }

    // Identity columns are never patchable, whatever the caller sends.
    {
      const { data } = await rpc({
        p_table: "tasks",
        p_match: { id },
        p_patch: { user_id: "00000000-0000-0000-0000-000000000000" },
        p_field_ts: { user_id: future },
      });
      const row = (await supabase.from("tasks").select("user_id").eq("id", id).single()).data;
      check(
        "user_id is refused, not written",
        data?.rejected?.includes("user_id") && row?.user_id === user.id,
        data,
      );
    }
  } finally {
    await supabase.from("tasks").delete().eq("id", id);
    const gone = (await supabase.from("tasks").select("id").eq("id", id)).data;
    check("scratch row cleaned up", Array.isArray(gone) && gone.length === 0, gone);
  }
}

main()
  .then(() => {
    console.log(failures ? `\n${failures} check(s) FAILED\n` : "\nall checks passed\n");
    process.exit(failures ? 1 : 0);
  })
  .catch((e) => {
    console.error("\nharness error:", e.message, "\n");
    process.exit(1);
  });
