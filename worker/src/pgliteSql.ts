/**
 * postgres.js-shaped tagged template over PGlite for isolation checks.
 * Not imported by the Worker runtime (excluded from the Worker tsconfig).
 *
 * Supports nested fragments and `sql.unsafe` so store.ts can build a
 * dynamic SET / VALUES list the same way postgres.js does.
 */
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "./db.ts";

const JSON_MARK = Symbol("pg-json");
const UNSAFE_MARK = Symbol("pg-unsafe");
const FRAG_MARK = Symbol("pg-frag");

interface JsonParam {
  [JSON_MARK]: true;
  value: unknown;
}

interface UnsafeParam {
  [UNSAFE_MARK]: true;
  sql: string;
}

interface FragParam {
  [FRAG_MARK]: true;
  strings: readonly string[];
  values: readonly unknown[];
}

function isJsonParam(value: unknown): value is JsonParam {
  return typeof value === "object" && value !== null && JSON_MARK in value;
}

function isUnsafeParam(value: unknown): value is UnsafeParam {
  return typeof value === "object" && value !== null && UNSAFE_MARK in value;
}

function isFragParam(value: unknown): value is FragParam {
  return typeof value === "object" && value !== null && FRAG_MARK in value;
}

function flatten(
  strings: readonly string[],
  values: readonly unknown[],
): { text: string; params: unknown[] } {
  let text = "";
  const params: unknown[] = [];

  const appendValue = (value: unknown) => {
    if (isFragParam(value)) {
      const inner = flatten(value.strings, value.values);
      text += inner.text.replace(/\$(\d+)/g, (_m, n: string) => `$${params.length + Number(n)}`);
      params.push(...inner.params);
      return;
    }
    if (isUnsafeParam(value)) {
      text += value.sql;
      return;
    }
    if (isJsonParam(value)) {
      params.push(JSON.stringify(value.value));
      text += `$${params.length}::jsonb`;
      return;
    }
    if (value instanceof Uint8Array) {
      params.push(value);
      text += `$${params.length}::bytea`;
      return;
    }
    params.push(value);
    if (Array.isArray(value)) {
      const uuidish = value.every(
        (item) =>
          typeof item === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item),
      );
      const ints = value.every((item) => typeof item === "number" && Number.isFinite(item));
      const dates = value.every((item) => typeof item === "string" && /^\d{4}-\d{2}-\d{2}/.test(item));
      text += uuidish
        ? `$${params.length}::uuid[]`
        : ints
          ? `$${params.length}::integer[]`
          : dates
            ? `$${params.length}::date[]`
            : `$${params.length}::text[]`;
    } else {
      text += `$${params.length}`;
    }
  };

  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < values.length) appendValue(values[i]);
  }
  return { text, params };
}

export function makePgliteSql(db: PGlite): Sql {
  const exec = async (strings: TemplateStringsArray, values: unknown[]) => {
    const { text, params } = flatten(strings, values);
    const result = await db.query(text, params);
    return result.rows;
  };

  const query = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const frag: FragParam & Promise<unknown[]> = {
      [FRAG_MARK]: true,
      strings,
      values,
      then(onFulfilled, onRejected) {
        return exec(strings, values).then(onFulfilled, onRejected);
      },
    } as FragParam & Promise<unknown[]>;
    return frag;
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

  Object.assign(query, {
    json(value: unknown) {
      return { [JSON_MARK]: true, value } satisfies JsonParam;
    },
    unsafe(sql: string) {
      return { [UNSAFE_MARK]: true, sql } satisfies UnsafeParam;
    },
    begin,
  });
  return query;
}
