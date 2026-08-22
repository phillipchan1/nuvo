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

type MemoryStore = { ops: Map<number, unknown>; kv: Map<string, unknown> };

let dbPromise: Promise<IDBDatabase | null> | null = null;
let memory: MemoryStore | null = null;
let durable = true;

/** Open and transaction both give up after this. Safari has shipped builds
 *  where `indexedDB.open` never settles, and others where a transaction's
 *  request never fires onsuccess — either one used to freeze a create. */
const SETTLE_MS = 3_000;

function memoryStore(): MemoryStore {
  memory ??= { ops: new Map(), kv: new Map() };
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
  highWater = 0;
  memoryMinted = 0;
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

/**
 * The outcome of one transaction.
 *
 * A bare `T | null` cannot tell "the store answered, and the answer is nothing"
 * from "the store never answered". Both are legitimate here — `get` on a missing
 * key really does resolve `undefined` — and conflating them is how a *write*
 * failure came to look like an ordinary empty result.
 */
type TxResult<T> = { ok: true; value: T | null } | { ok: false };

const TX_FAILED: TxResult<never> = { ok: false };

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
  /** Resolve only once the transaction commits. Writes whose durability the
   *  caller is about to promise the user must use this: `req.onsuccess` fires
   *  while the transaction is still open, so a force-quit between the two
   *  loses a write we already reported as safe. */
  awaitCommit = false,
): Promise<TxResult<T>> {
  return openDb().then(
    (db) =>
      new Promise<TxResult<T>>((resolve) => {
        if (!db) return resolve(TX_FAILED);
        let settled = false;
        const finish = (r: TxResult<T>) => {
          if (settled) return;
          settled = true;
          resolve(r);
        };
        // Same Safari class as the open hang: a transaction that never fires
        // onsuccess/onerror/oncomplete. CreateRecord used to await this, so a
        // wedged write froze the sheet on "Creating…" with the task still in
        // the composer. Fall back to memory the same way a failed open does.
        const timer = setTimeout(() => finish(TX_FAILED), SETTLE_MS);
        const done = (r: TxResult<T>) => {
          clearTimeout(timer);
          finish(r);
        };
        try {
          const t = db.transaction(store, mode);
          const req = run(t.objectStore(store));
          let value: T | null = null;
          let requestOk = false;
          req.onsuccess = () => {
            value = req.result ?? null;
            requestOk = true;
            if (!awaitCommit) done({ ok: true, value });
          };
          req.onerror = () => done(TX_FAILED);
          t.onabort = () => done(TX_FAILED);
          t.onerror = () => done(TX_FAILED);
          t.oncomplete = () =>
            done(requestOk || !awaitCommit ? { ok: true, value } : TX_FAILED);
        } catch {
          done(TX_FAILED);
        }
      }),
  );
}

/**
 * Highest integer sequence IndexedDB has handed out that we know of, so a
 * memory-fallback op can be given a key that sorts *after* it.
 *
 * Memory keys are fractional on purpose. IndexedDB's auto-increment only ever
 * mints integers, so `4.000001` can never be reused by a later successful
 * append — which is what stops an ack for one op from retiring an unrelated
 * one. It also keeps replay order intact: a fallback op queued between stored
 * ops 4 and 5 still sorts between them, so a child insert cannot overtake its
 * parent.
 */
let highWater = 0;
let memoryMinted = 0;

function noteSeq(seq: unknown): void {
  if (typeof seq === "number" && Number.isFinite(seq)) {
    highWater = Math.max(highWater, Math.floor(seq));
  }
}

function nextMemorySeq(): number {
  memoryMinted += 1;
  return highWater + memoryMinted / 1_000_000;
}

/**
 * Move any memory-held ops back into IndexedDB once it is writable again.
 *
 * The seq is preserved (`put`, not `add`) so an in-flight drain's ack still
 * addresses the same span. Ops are idempotent, so the worst case of a half-
 * finished migration is one redundant send, never a lost or duplicated row.
 */
async function reclaimMemoryOps(): Promise<void> {
  const mem = memory;
  if (!mem || mem.ops.size === 0) return;
  for (const [seq, op] of [...mem.ops]) {
    const r = await tx(OPS_STORE, "readwrite", (s) => s.put(op as object), true);
    if (!r.ok) return; // still not writable — keep them in memory, try later
    mem.ops.delete(seq);
  }
  // Everything the user owes is on disk again.
  if (mem.ops.size === 0 && mem.kv.size === 0) durable = true;
}

/**
 * Append a record and return the sequence number it was assigned.
 *
 * A failed append does **not** mean a dropped write. The op goes to the memory
 * store so the drain can still deliver it this session, and `durable` flips so
 * the UI stops claiming the queue survives a restart. Silently keeping it only
 * in memory while `idbAllOps` read exclusively from IndexedDB is what made a
 * capture vanish with no trace and no signal.
 */
export async function idbAppendOp(value: unknown): Promise<number> {
  const r = await tx<IDBValidKey>(
    OPS_STORE,
    "readwrite",
    (s) => s.add(value as object),
    true,
  );
  if (r.ok && r.value != null) {
    const seq = Number(r.value);
    noteSeq(seq);
    return seq;
  }
  // Storage refused the write. Keep the intent reachable, and say so.
  durable = false;
  const mem = memoryStore();
  const seq = nextMemorySeq();
  mem.ops.set(seq, { ...(value as object), seq });
  return seq;
}

/**
 * Everything the device owes, from both stores.
 *
 * The union is the point. Reading only IndexedDB meant an op that had fallen
 * back to memory was invisible to every drain that followed — the capture was
 * painted, persisted into the read cache, and never sent, so it disappeared the
 * first time anything refetched.
 */
export async function idbAllOps<T>(): Promise<T[]> {
  await reclaimMemoryOps();
  const r = await tx<T[]>(OPS_STORE, "readonly", (s) => s.getAll() as IDBRequest<T[]>);
  const stored = r.ok && Array.isArray(r.value) ? r.value : [];
  for (const row of stored) noteSeq((row as { seq?: unknown }).seq);
  const mem = memory ? ([...memory.ops.values()] as T[]) : [];
  if (!mem.length) return stored;
  return [...stored, ...mem];
}

export async function idbDeleteOps(seqs: number[]): Promise<void> {
  if (!seqs.length) return;
  // Always sweep the memory store too: with both stores live, an op may be
  // held in either, and an ack that only cleared one would re-send forever.
  if (memory) for (const seq of seqs) memory.ops.delete(seq);
  const db = await openDb();
  if (!db) return;
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

/**
 * Overwrite an op in place — used to persist attempt counts and last errors.
 *
 * An op already living in memory has to be updated there; one on disk whose
 * write fails is mirrored into memory so the attempt budget it just spent is
 * not forgotten (that is how a poisoned op retried forever).
 */
export async function idbPutOp<T extends { seq: number }>(value: T): Promise<void> {
  if (memory?.ops.has(value.seq)) {
    memory.ops.set(value.seq, value);
    return;
  }
  const r = await putExistingOp(value);
  if (!r.ok) {
    durable = false;
    memoryStore().ops.set(value.seq, value);
  }
}

/**
 * Update an op **only if it is still there**, in one transaction.
 *
 * A plain `put` resurrects the dead. Nuvo's desktop shell runs two WKWebViews
 * (the main window and the ⌥Space panel) over one IndexedDB, so both drain the
 * same queue. Interleave them and this happens: window A sends an op and hits a
 * blip, window B sends the same op and succeeds and acks it away, then A's
 * `recordFailure` writes the op back — undeleted, with an attempt count, and
 * owed forever. For a *delete* op that is not merely noisy: it would be re-sent
 * against a row that has since been legitimately recreated. Read-then-write
 * inside the same transaction makes the ack authoritative.
 */
function putExistingOp<T extends { seq: number }>(value: T): Promise<TxResult<void>> {
  return openDb().then(
    (db) =>
      new Promise<TxResult<void>>((resolve) => {
        if (!db) return resolve(TX_FAILED);
        let settled = false;
        const done = (r: TxResult<void>) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(r);
        };
        const timer = setTimeout(() => done(TX_FAILED), SETTLE_MS);
        try {
          const t = db.transaction(OPS_STORE, "readwrite");
          const s = t.objectStore(OPS_STORE);
          const read = s.get(value.seq);
          read.onsuccess = () => {
            // Acked and gone. Nothing to record against it.
            if (read.result === undefined) return done({ ok: true, value: null });
            s.put(value);
          };
          read.onerror = () => done(TX_FAILED);
          t.oncomplete = () => done({ ok: true, value: null });
          t.onerror = () => done(TX_FAILED);
          t.onabort = () => done(TX_FAILED);
        } catch {
          done(TX_FAILED);
        }
      }),
  );
}

export async function idbGet<T>(key: string): Promise<T | null> {
  const r = await tx<T>(KV_STORE, "readonly", (s) => s.get(key) as IDBRequest<T>);
  // A successful read of a missing key is an answer, not a failure — only fall
  // through to memory when the store never answered at all.
  if (r.ok) return r.value ?? ((memory?.kv.get(key) as T) ?? null);
  return (memoryStore().kv.get(key) as T) ?? null;
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  const r = await tx(KV_STORE, "readwrite", (s) => s.put(value as object, key));
  if (!r.ok) memoryStore().kv.set(key, value);
  else memory?.kv.delete(key);
}

export async function idbDelete(key: string): Promise<void> {
  await tx(KV_STORE, "readwrite", (s) => s.delete(key));
  memory?.kv.delete(key);
}
