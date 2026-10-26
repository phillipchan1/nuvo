// sslmode + fetch_types guards for worker/src/db.ts
// Run: node --experimental-strip-types worker/src/db.check.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import ConnectionParameters from "pg/lib/connection-parameters.js";
import { clientConnection, clientSsl, postgresSsl, stripSslMode, usesHyperdrive } from "./db.ts";
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

const hyperdrive = "postgresql://user:pass@abcd1234.hyperdrive.local:5432/nuvo";
ok(postgresSsl(hyperdrive) === false, "hyperdrive.local is not client TLS");
ok(
  postgresSsl(`${hyperdrive}?sslmode=require`) === false,
  "hyperdrive.local wins over sslmode=require",
);
ok(
  postgresSsl("postgresql://user:pass@hyperdrive.local:5432/nuvo") === false,
  "bare hyperdrive.local is not client TLS",
);
ok(
  postgresSsl("postgresql://hyperdrive@ep-prod.us-east-1.aws.neon.tech/nuvo") === "require",
  "hyperdrive in the user does not disable TLS",
);
ok(
  postgresSsl("postgresql://neondb@ep-prod.us-east-1.aws.neon.tech/hyperdrive") === "require",
  "hyperdrive in the db name does not disable TLS",
);
ok(clientSsl({ HYPERDRIVE: { connectionString: hyperdrive } }, hyperdrive) === false, "HYPERDRIVE binding disables client TLS");
ok(
  clientSsl({ HYPERDRIVE: { connectionString: neon } }, neon) === false,
  "HYPERDRIVE binding disables TLS even when the hostname is not hyperdrive.local",
);
ok(clientSsl({}, neon) === "require", "direct remote URL without HYPERDRIVE still requires TLS");
ok(usesHyperdrive({ HYPERDRIVE: { connectionString: hyperdrive } }), "usesHyperdrive: real binding");
ok(!usesHyperdrive({ HYPERDRIVE: { connectionString: "postgresql://x@y/z?id=00000000000000000000000000000000" } }), "usesHyperdrive: placeholder id is ignored");
ok(!usesHyperdrive({}), "usesHyperdrive: unset binding");

const hyperdriveRequire = `${hyperdrive}?sslmode=require`;
const hyperCfg = clientConnection({ HYPERDRIVE: { connectionString: hyperdriveRequire } }, hyperdriveRequire);
ok(hyperCfg.ssl === false, "clientConnection: HYPERDRIVE + sslmode=require is not TLS");
ok(!/[?&]sslmode=/i.test(hyperCfg.connectionString), "clientConnection: sslmode stripped so pg cannot re-enable TLS");
ok(stripSslMode(hyperdriveRequire) === hyperdrive || !/[?&]sslmode=/i.test(stripSslMode(hyperdriveRequire)), "stripSslMode removes sslmode=require");
const neonCfg = clientConnection({}, neonRequire);
ok(neonCfg.ssl === "require", "clientConnection: direct Neon + sslmode=require still requires TLS");
ok(/sslmode=require/i.test(neonCfg.connectionString), "clientConnection: Neon URL keeps sslmode when TLS is on");
const boundNeon = `postgresql://neondb@ep-bound.example/nuvo?sslmode=require`;
const boundCfg = clientConnection({ HYPERDRIVE: { connectionString: boundNeon } }, boundNeon);
ok(boundCfg.ssl === false, "clientConnection: HYPERDRIVE binding wins over sslmode=require on a non-hyperdrive host");
ok(!/[?&]sslmode=/i.test(boundCfg.connectionString), "clientConnection: binding URL sslmode is stripped");
const pgHyper = new ConnectionParameters({
  connectionString: hyperCfg.connectionString,
  ssl: hyperCfg.ssl === "require",
});
ok(!pgHyper.ssl, "pg client: Hyperdrive ?sslmode=require does not force TLS");
const pgBound = new ConnectionParameters({
  connectionString: boundCfg.connectionString,
  ssl: boundCfg.ssl === "require",
});
ok(!pgBound.ssl, "pg client: HYPERDRIVE binding URL ?sslmode=require does not force TLS");
const pgNeon = new ConnectionParameters({
  connectionString: neonCfg.connectionString,
  ssl: neonCfg.ssl === "require",
});
ok(Boolean(pgNeon.ssl), "pg client: direct Neon still requires TLS");

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "db.ts"), "utf8");
ok(!/fetch_types:\s*false/.test(src), "db.ts does not disable fetch_types");
ok(src.includes("postgresSsl"), "db.ts uses postgresSsl");
ok(src.includes("clientConnection") && src.includes("stripSslMode"), "db.ts strips sslmode when TLS is off");
ok(!/url\.includes\("localhost"\)/.test(src), "db.ts does not substring-match localhost for TLS");
ok(!/includes\("hyperdrive"\)/.test(src), "db.ts does not substring-match hyperdrive for TLS");
ok(!/WeakMap/.test(src), "db.ts does not cache Sql in a WeakMap");
ok(/export function openSql/.test(src), "db.ts opens a fresh client per call");
ok(/max:\s*1/.test(src), "db.ts caps postgres.js at 1 socket per request");
const cutover = readFileSync(join(here, "../../docs/cloudflare-cutover.md"), "utf8");
ok(/Hyperdrive/.test(cutover), "cutover docs name Hyperdrive as the production connection pool");
ok(/two sockets per request/.test(cutover), "cutover docs state the per-request socket count");

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
