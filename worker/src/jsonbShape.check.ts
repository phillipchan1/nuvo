// asJsonArray / asJsonValue heal jsonb columns written double-encoded
// (a jsonb string scalar holding "[…]" instead of the array itself).
// Run: node --experimental-strip-types worker/src/jsonbShape.check.ts

import { asJsonArray, asJsonValue } from "./lib/jsonbShape.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: unknown, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// --- asJsonArray ---------------------------------------------------------------
const arr = [{ id: "a" }, { id: "b" }];
ok(asJsonArray(arr) === arr, "array: returned as is");
ok(same(asJsonArray(JSON.stringify(arr)), arr), "stringified array: parsed");
ok(same(asJsonArray(JSON.stringify({ id: "a" })), [{ id: "a" }]), "stringified object: wrapped");
ok(same(asJsonArray({ id: "a" }), [{ id: "a" }]), "object: wrapped");
ok(same(asJsonArray(JSON.stringify(JSON.stringify(arr))), arr), "doubly stringified array: recursed once");
ok(same(asJsonArray(JSON.stringify(JSON.stringify(JSON.stringify(arr)))), []), "triply stringified: gives up");
ok(same(asJsonArray(null), []), "null: []");
ok(same(asJsonArray(undefined), []), "undefined: []");
ok(same(asJsonArray("not json"), []), "garbage string: []");
ok(same(asJsonArray('"just a string"'), []), "stringified scalar: []");
ok(same(asJsonArray(42), []), "number: []");

// --- asJsonValue ---------------------------------------------------------------
const obj = { caldav_href: "/x.ics", caldav_etag: "e1" };
ok(asJsonValue(obj) === obj, "object: unchanged");
ok(asJsonValue(arr) === arr, "array: unchanged");
ok(same(asJsonValue(JSON.stringify(obj)), obj), "stringified object: parsed");
ok(same(asJsonValue(JSON.stringify(arr)), arr), "stringified array: parsed");
ok(same(asJsonValue(`  ${JSON.stringify(obj)}`), obj), "leading whitespace: parsed");
ok(asJsonValue(null) === null, "null: unchanged");
ok(asJsonValue("{not json") === "{not json", "garbage brace string: unchanged");
ok(asJsonValue("hello") === "hello", "plain string: unchanged");
ok(asJsonValue("42") === "42", "numeric string: unchanged");
ok(asJsonValue(42) === 42, "number: unchanged");

if (fails.length) {
  console.error(`jsonbShape.check: ${fails.length}/${checks} failed`);
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`jsonbShape.check: ${checks} checks passed`);
