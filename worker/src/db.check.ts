// sslmode + fetch_types guards for worker/src/db.ts
// Run: node --experimental-strip-types worker/src/db.check.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { postgresSsl } from "./db.ts";
import { makePgliteSql } from "./pgliteSql.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const neon = "postgresql://neondb@ep-prod.us-east-1.aws.neon.tech/nuvo";
const neonLocalQuery = `${neon}?application_name=localhost`;
const neonDisable = `${neon}?sslmode=disable`;
const neonPrefer = `${neon}?sslmode=prefer`;
const neonRequire = `${neon}?sslmode=require`;
const loopback = "postgresql://postgres@localhost:5432/nuvo";
const loopbackRequire = `${loopback}?sslmode=require`;

ok(postgresSsl(neon) === "require", "Neon host with no sslmode requires TLS");
ok(postgresSsl(neonRequire) === "require", "sslmode=require is require");
ok(postgresSsl(`${neon}?sslmode=verify-full`) === "require", "sslmode=verify-full is require");
ok(postgresSsl(neonDisable) === false, "sslmode=disable turns TLS off");
ok(postgresSsl(neonPrefer) === false, "sslmode=prefer turns TLS off");
ok(postgresSsl(`${neon}?sslmode=allow`) === false, "sslmode=allow turns TLS off");
ok(postgresSsl(loopback) === false, "localhost host with no sslmode is not TLS");
ok(postgresSsl("postgresql://postgres@127.0.0.1:5432/nuvo") === false, "127.0.0.1 host is not TLS");
ok(postgresSsl("postgresql://postgres@[::1]:5432/nuvo") === false, "[::1] host is not TLS");
ok(postgresSsl(loopbackRequire) === "require", "localhost + sslmode=require still requires TLS");
ok(postgresSsl(neonLocalQuery) === "require", "localhost in a query param does not disable TLS");
ok(
  postgresSsl("postgresql://localhost_admin@ep-prod.neon.tech/nuvo") === "require",
  "localhost in the user does not disable TLS",
);

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "db.ts"), "utf8");
ok(!/fetch_types:\s*false/.test(src), "db.ts does not disable fetch_types");
ok(src.includes("postgresSsl"), "db.ts uses postgresSsl");
ok(!/url\.includes\("localhost"\)/.test(src), "db.ts does not substring-match localhost for TLS");

const db = new PGlite();
await db.exec("CREATE TABLE array_probe (id int, tags text[])");
const sql = makePgliteSql(db);
await sql`INSERT INTO array_probe (id, tags) VALUES (1, ${["alpha", "beta"]})`;
const rows = await sql`SELECT tags FROM array_probe WHERE id = 1` as { tags: string[] }[];
ok(Array.isArray(rows[0]?.tags), "array insert: tags comes back as an array");
ok(rows[0]?.tags?.includes("alpha") && rows[0]?.tags?.includes("beta"), "array insert: values survive");
await db.close();

console.log(`${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error("  FAIL", f);
  process.exit(1);
}
console.log("db: ok");
