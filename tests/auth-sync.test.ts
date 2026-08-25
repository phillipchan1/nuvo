/**
 * @vitest-environment jsdom
 *
 * The ⌥Space panel is a second WKWebView. BroadcastChannel and `storage`
 * events do not cross it, so session hand-off has to be a plain payload
 * plus a localStorage write that never overwrites a token already there.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Session, User } from "@supabase/supabase-js";
import {
  authStorageKey,
  payloadToSession,
  initialAuthState,
  persistSessionIfAbsent,
  readPersistedSession,
  sessionToPayload,
} from "../src/lib/authSync";

const KEY = authStorageKey();

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

function user(id = "user-1"): User {
  return {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: "a@b.co",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  } as User;
}

function session(over: Partial<Session> = {}): Session {
  return {
    access_token: "aaa.bbb.ccc",
    refresh_token: "refresh-1",
    expires_at: 1_800_000_000,
    expires_in: 3600,
    token_type: "bearer",
    user: user(),
    ...over,
  };
}

let storage: Storage;

beforeEach(() => {
  storage = memoryStorage();
});

describe("authStorageKey", () => {
  it("namespaces by the supabase project ref, the way supabase-js does", () => {
    expect(authStorageKey("https://abcdxyz.supabase.co")).toBe("sb-abcdxyz-auth-token");
    expect(authStorageKey("http://localhost:54321")).toBe("sb-localhost-auth-token");
  });
});

describe("session payload", () => {
  it("round-trips a live session", () => {
    const s = session();
    expect(payloadToSession(sessionToPayload(s))).toEqual(s);
  });

  it("refuses a session with no expiry — writing that would fail _isValidSession and wipe the slot", () => {
    expect(sessionToPayload(session({ expires_at: undefined }))).toBeNull();
    expect(payloadToSession(null)).toBeNull();
  });
});

describe("persisted session slot", () => {
  it("reads a supabase-js session object", () => {
    const s = session();
    storage.setItem(KEY, JSON.stringify(s));
    expect(readPersistedSession(storage)?.access_token).toBe("aaa.bbb.ccc");
  });

  it("reads the older { currentSession } wrapper", () => {
    storage.setItem(KEY, JSON.stringify({ currentSession: session() }));
    expect(readPersistedSession(storage)?.refresh_token).toBe("refresh-1");
  });

  it("fills an empty slot so the panel can recover without a network round-trip", () => {
    const s = session();
    expect(persistSessionIfAbsent(s, storage)).toBe(true);
    expect(JSON.parse(storage.getItem(KEY)!).access_token).toBe("aaa.bbb.ccc");
  });

  it("does not overwrite a token that is already there (main may have just rotated)", () => {
    storage.setItem(KEY, JSON.stringify(session({ access_token: "newer" })));
    expect(persistSessionIfAbsent(session({ access_token: "older" }), storage)).toBe(false);
    expect(JSON.parse(storage.getItem(KEY)!).access_token).toBe("newer");
  });

  it("returns null when the slot is empty or garbage", () => {
    expect(readPersistedSession(storage)).toBeNull();
    storage.setItem(KEY, "not-json");
    expect(readPersistedSession(storage)).toBeNull();
  });
});

describe("initialAuthState", () => {
  it("opens immediately when the slot already has a session", () => {
    storage.setItem(KEY, JSON.stringify(session()));
    const boot = initialAuthState(storage, false);
    expect(boot.loading).toBe(false);
    expect(boot.session?.access_token).toBe("aaa.bbb.ccc");
  });

  it("waits when this device has never signed in", () => {
    const boot = initialAuthState(storage, false);
    expect(boot).toEqual({ session: null, loading: true });
  });

  it("always waits in the spotlight window — its store can be empty on the first tick", () => {
    storage.setItem(KEY, JSON.stringify(session()));
    expect(initialAuthState(storage, true)).toEqual({ session: null, loading: true });
  });
});
