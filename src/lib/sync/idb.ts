/**
 * The one IndexedDB the client owns.
 *
 * Two stores, deliberately: `ops` is the durable outbox (the user's unsent
 * work — losing it is losing data), `kv` is everything else, currently the
 * dehydrated query cache that lets the app open offline (losing it is a slower
 * first paint). They share a database so a single `open` failure degrades both
 * to the same fallback rather than leaving the app half-persistent.
 *
 * `ops` uses an auto-incrementing key as the replay sequence. That is not a
 * convenience: IndexedDB guarantees the counter is monotonic *and* persisted
 * across restarts, and never reuses a key even after the store is cleared. A
 * hand-rolled counter in localStorage would reset on a cleared origin and let a
 * replayed op sort ahead of rows it depends on.
 *
 * Every entry point is failure-tolerant. Private browsing, a full disk, or a
 * Safari origin eviction all make `indexedDB.open` reject, and a planner that
 * throws on launch because it could not open a cache is worse than a planner
 * that forgets. On failure we fall back to an in-memory store: the session
 * still works, it simply does not survive a restart, and `isDurable()` reports
 * the truth so the UI can say so.
 */

const DB_NAME = "nuvo-sync";
const DB_VERSION = 1;
export const OPS_STORE = "ops";
export const KV_STORE = "kv";

type MemoryStore = { ops: Map<number, unknown>; kv: Map<string, unknown>; seq: number };

let dbPromise: Promise<IDBDatabase | null> | null = null;
let memory: MemoryStore | null = null;
let durable = true;

/** Open and transaction both give up after this. Safari has shipped builds
 *  where `indexedDB.open` never settles, and others where a transaction's
 *  request never fires onsuccess — either one used to freeze a create. */
const SETTLE_MS = 3_000;

function memoryStore(): MemoryStore {
  memory ??= { ops: new Map(), kv: new Map(), seq: 0 };
  return memory;
}

/** False once we have fallen back to memory — the outbox is not crash-safe. */
export function isDurable(): boolean {
  return durable;
}

/** Test seam: forget the cached handle so a fresh fake-indexeddb is picked up. */
export function resetIdbForTests() {
  dbPromise = null;
  memory = null;
  durable = true;
}

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === "undefined") {
      durable = false;
      resolve(null);
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      durable = false;
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OPS_STORE)) {
        db.createObjectStore(OPS_STORE, { keyPath: "seq", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(KV_STORE)) {
        db.createObjectStore(KV_STORE);
      }
    };
    // The timeout below has to know whether the open already finished, and
    // `durable` cannot tell it — that flag is about storage *health*, not about
    // whether this promise settled. Guarding on it meant the timer fired three
    // seconds after every SUCCESSFUL open and flipped a perfectly good database
    // to "not durable", so the app told the user their browser had blocked local
    // storage while it was busily persisting to it. Caught in the running app,
    // not by a unit test: the fake IndexedDB resolves before a timer can matter.
    let settled = false;
    const finish = (db: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      resolve(db);
    };

    req.onsuccess = () => finish(req.result);
    req.onerror = () => {
      durable = false;
      finish(null);
    };
    // Safari has shipped builds where `open` neither resolves nor errors while
    // the tab is being restored. Nothing about the app should wait forever on
    // storage, so give up and run from memory.
    setTimeout(() => {
      if (settled) return;
      durable = false;
      finish(null);
    }, SETTLE_MS);
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        let settled = false;
        const finish = (value: T | null) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        // Same Safari class as the open hang: a transaction that never fires
        // onsuccess/onerror/oncomplete. CreateRecord used to await this, so a
        // wedged write froze the sheet on "Creating…" with the task still in
        // the composer. Fall back to memory the same way a failed open does.
        const timer = setTimeout(() => finish(null), SETTLE_MS);
        const done = (value: T | null) => {
          clearTimeout(timer);
          finish(value);
        };
        try {
          const t = db.transaction(store, mode);
          const req = run(t.objectStore(store));
          req.onsuccess = () => done(req.result);
          req.onerror = () => done(null);
          t.onabort = () => done(null);
          t.oncomplete = () => done(req.result ?? null);
        } catch {
          done(null);
        }
      }),
  );
}

/** Append a record and return the sequence number it was assigned. */
export async function idbAppendOp(value: unknown): Promise<number> {
  const key = await tx<IDBValidKey>(OPS_STORE, "readwrite", (s) => s.add(value as object));
  if (key != null) return Number(key);
  const mem = memoryStore();
  const seq = ++mem.seq;
  mem.ops.set(seq, { ...(value as object), seq });
  return seq;
}

export async function idbAllOps<T>(): Promise<T[]> {
  const rows = await tx<T[]>(OPS_STORE, "readonly", (s) => s.getAll() as IDBRequest<T[]>);
  if (rows != null) return rows;
  return [...memoryStore().ops.values()] as T[];
}

export async function idbDeleteOps(seqs: number[]): Promise<void> {
  if (!seqs.length) return;
  const db = await openDb();
  if (!db) {
    const mem = memoryStore();
    for (const seq of seqs) mem.ops.delete(seq);
    return;
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = setTimeout(done, SETTLE_MS);
    try {
      const t = db.transaction(OPS_STORE, "readwrite");
      const s = t.objectStore(OPS_STORE);
      for (const seq of seqs) s.delete(seq);
      t.oncomplete = () => {
        clearTimeout(timer);
        done();
      };
      t.onerror = () => {
        clearTimeout(timer);
        done();
      };
      t.onabort = () => {
        clearTimeout(timer);
        done();
      };
    } catch {
      clearTimeout(timer);
      done();
    }
  });
}

/** Overwrite an op in place — used to persist attempt counts and last errors. */
export async function idbPutOp<T extends { seq: number }>(value: T): Promise<void> {
  const ok = await tx(OPS_STORE, "readwrite", (s) => s.put(value));
  if (ok == null && !durable) memoryStore().ops.set(value.seq, value);
}

export async function idbGet<T>(key: string): Promise<T | null> {
  const v = await tx<T>(KV_STORE, "readonly", (s) => s.get(key) as IDBRequest<T>);
  if (v != null) return v;
  return (memoryStore().kv.get(key) as T) ?? null;
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  const ok = await tx(KV_STORE, "readwrite", (s) => s.put(value as object, key));
  if (ok == null && !durable) memoryStore().kv.set(key, value);
}

export async function idbDelete(key: string): Promise<void> {
  await tx(KV_STORE, "readwrite", (s) => s.delete(key));
  memoryStore().kv.delete(key);
}
