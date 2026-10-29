import type { Session } from "@supabase/supabase-js";

/**
 * The Better Auth session, said in Supabase's shape, for code that asks
 * `supabase.auth` who is signed in.
 *
 * With the Worker as the backend GoTrue never issues a session, so every
 * `supabase.auth.getSession()` / `getUser()` — the outbox's owner key, push
 * registration, the agent's bearer, a dozen hooks — would answer "nobody".
 * `useAuth` publishes what Better Auth said here; `src/lib/supabase.ts` answers
 * those two calls from it. Only ever written when `VITE_API_BASE_URL` is set.
 */

/** How long a caller waits for the first answer before treating it as signed out. */
const FIRST_ANSWER_MS = 8_000;

let current: Session | null = null;
let answered = false;
let waiters: Array<(s: Session | null) => void> = [];

export function setWorkerSession(session: Session | null): void {
  current = session;
  answered = true;
  const ready = waiters;
  waiters = [];
  for (const resolve of ready) resolve(session);
}

/** The current session — after Better Auth has answered once, like GoTrue's initialize. */
export function workerSession(): Promise<Session | null> {
  if (answered) return Promise.resolve(current);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiters = waiters.filter((w) => w !== done);
      resolve(current);
    }, FIRST_ANSWER_MS);
    const done = (s: Session | null) => {
      clearTimeout(timer);
      resolve(s);
    };
    waiters.push(done);
  });
}

export function resetWorkerSessionForTests(): void {
  current = null;
  answered = false;
  waiters = [];
}
