/**
 * postgres.js-shaped tagged template over PGlite for isolation checks.
 * Not imported by the Worker runtime (excluded from the Worker tsconfig).
 */
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "./db.ts";

const JSON_MARK = Symbol("pg-json");

interface JsonParam {
  [JSON_MARK]: true;
  value: unknown;
}

function isJsonParam(value: unknown): value is JsonParam {
  return typeof value === "object" && value !== null && JSON_MARK in value;
}

/** `{"a","b"}` — a Postgres array literal, each element quoted and escaped. */
function arrayLiteral(items: unknown[]): string {
  const quote = (v: unknown) =>
    v == null ? "NULL" : `"${String(v).split("\\").join("\\\\").split('"').join('\\"')}"`;
  return `{${items.map(quote).join(",")}}`;
}

export function makePgliteSql(db: PGlite): Sql {
  const query = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = "";
    const params: unknown[] = [];
    for (let i = 0; i < strings.length; i++) {
      text += strings[i];
      if (i >= values.length) continue;
      const value = values[i];
      if (isJsonParam(value)) {
        params.push(JSON.stringify(value.value));
        text += `$${params.length}::jsonb`;
        continue;
      }
      if (value instanceof Uint8Array) {
        params.push(value);
        text += `$${params.length}::bytea`;
        continue;
      }
      params.push(value);
      if (Array.isArray(value)) {
        const uuidish = value.every((item) =>
          typeof item === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item),
        );
        if (uuidish) {
          text += `$${params.length}::uuid[]`;
        } else {
          // Like postgres.js: an untyped array literal, so the server infers the
          // element type — `provider = ANY(...)` against production's enum
          // column fails under a forced ::text[].
          params[params.length - 1] = arrayLiteral(value);
          text += `$${params.length}`;
        }
      } else {
        text += `$${params.length}`;
      }
    }
    const result = await db.query(text, params);
    return result.rows;
  }) as Sql;

  async function begin<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
    await db.query("BEGIN");
    try {
      const result = await fn(query as Sql);
      await db.query("COMMIT");
      return result;
    } catch (err) {
      await db.query("ROLLBACK").catch(() => undefined);
      throw err;
    }
  }

  async function unsafe(text: string, params: unknown[] = []) {
    const result = await db.query(text, params);
    return result.rows;
  }

  Object.assign(query, {
    json(value: unknown) {
      return { [JSON_MARK]: true, value } satisfies JsonParam;
    },
    begin,
    unsafe,
  });
  return query;
}
