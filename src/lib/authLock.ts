/**
 * Cross-window mutex for Supabase auth refreshes.
 *
 * supabase-js serializes refreshes inside one JS heap. Nuvo's desktop app runs
 * two heaps on the same origin (the main window and the long-lived ⌥Space
 * panel), sharing one localStorage and therefore one refresh token. Two
 * refreshes of the same token is `refresh_token_already_used`, and GoTrue
 * treats that as theft — it revokes the whole session and dumps the user on
 * the login screen.
 *
 * Navigator LockManager is per-agent, so it does not coordinate WKWebViews.
 * localStorage does. This lock is what we pass as `auth.lock` on the client.
 */

const KEY_PREFIX = "nuvo.auth.lock:";
/** A crashed holder must not pin the lock forever. Token refresh is <1s. */
const TTL_MS = 8_000;

function storageOrNull(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isLive(held: string | null): boolean {
  if (!held) return false;
  const ts = Number(held.split(":")[0]);
  return Number.isFinite(ts) && Date.now() - ts < TTL_MS;
}

function tryAcquire(storage: Storage, key: string, token: string): boolean {
  try {
    if (isLive(storage.getItem(key))) return false;
    storage.setItem(key, token);
    return storage.getItem(key) === token;
  } catch {
    // Storage blocked (quota, privacy mode mid-flight) — skip the lock
    // rather than freeze sign-in.
    return true;
  }
}

export async function authLock<T>(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<T>,
): Promise<T> {
  const storage = storageOrNull();
  if (!storage) return fn();

  const key = KEY_PREFIX + name;
  const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const deadline =
    acquireTimeout < 0 ? Number.POSITIVE_INFINITY : Date.now() + Math.max(0, acquireTimeout);

  while (!tryAcquire(storage, key, token)) {
    if (Date.now() >= deadline) {
      // Don't hang auth on a stuck holder. Overwrite and proceed: a rare race
      // beats a login screen that never comes back.
      try {
        storage.setItem(key, token);
      } catch {
        /* ignore */
      }
      break;
    }
    await sleep(30 + Math.random() * 40);
  }

  try {
    return await fn();
  } finally {
    try {
      if (storage.getItem(key) === token) storage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
