// How a set of runs becomes a verdict, and whether the battery blocks.
//
// Its own module because at a 100% bar this is the part that decides what
// "green" means, and a rule that decides that shouldn't only be exercised when
// someone has an API key and spends tokens. Pure — see tests/agent-contract.test.ts.

export type Verdict = "pass" | "flaky" | "fail";

/**
 * `pass` only when every run passed. The split below it matters:
 *
 * - **fail** — it never worked. The chat can't do this.
 * - **flaky** — it worked sometimes. Easy to wave off ("it passed on my run"),
 *   and worse than a clean fail in practice: the capability looks present, so
 *   nobody goes looking, and the user is the one who finds the 1-in-5. At a
 *   100% bar this is the verdict that does the most work.
 */
export function verdictFor(passes: number, total: number): Verdict {
  if (total <= 0) throw new Error("a verdict needs at least one run");
  if (passes >= total) return "pass";
  return passes === 0 ? "fail" : "flaky";
}

export interface Judged {
  id: string;
  verdict: Verdict;
  quarantined?: string;
}

/** What the battery blocks on: anything red that isn't explicitly parked. */
export function blocking(results: Judged[]): Judged[] {
  return results.filter((r) => r.verdict !== "pass" && !r.quarantined);
}

/** 0 = the chat is at the bar. 1 = it isn't. */
export function exitCode(results: Judged[]): 0 | 1 {
  return blocking(results).length ? 1 : 0;
}
