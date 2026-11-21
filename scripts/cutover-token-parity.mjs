/**
 * Token-less parity for the cutover token step. Pure — no I/O.
 *
 * A source row with no Vault pointer (refresh_token_secret_id IS NULL) never
 * had a token to seal, so the seal step skips it. Every such row must still
 * land in Neon as an unsealed row (refresh_token_enc IS NULL), and nothing
 * else may: an extra unsealed row is a token that was owed and not sealed, a
 * missing one is a row that was sealed without a token or never copied.
 *
 * Applied to apple_identities (Tech Lead ruling: prod has two Apple identities
 * from ID-token-only sign-in). Counts only — never ids, emails or tokens.
 */

/** Source: rows that carried no Vault token. Run on the read-only source. */
export const SOURCE_TOKENLESS_APPLE_SQL = `
  SELECT count(*)::int AS n
  FROM public.apple_identities
  WHERE refresh_token_secret_id IS NULL
`;

/** Neon: rows with no sealed token, after sealing. */
export const TARGET_UNSEALED_APPLE_SQL = `
  SELECT count(*)::int AS n
  FROM public.apple_identities
  WHERE refresh_token_enc IS NULL
`;

/**
 * @param {{ table?: string, source: unknown, target: unknown }} counts
 * @returns {{ ok: boolean, line: string }}
 */
export function tokenlessParity({ table = "apple_identities", source, target }) {
  const s = Number(source);
  const t = Number(target);
  const ok = Number.isInteger(s) && Number.isInteger(t) && s >= 0 && s === t;
  return { ok, line: `${table} token-less: source=${source} neon=${target}` };
}
