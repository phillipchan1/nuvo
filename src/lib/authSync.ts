/**
 * Session hand-off between the main window and the ⌥Space panel.
 *
 * The desktop shell is two WKWebViews on one origin. supabase-js syncs tabs
 * with BroadcastChannel; WebKit does not deliver that (or `storage` events)
 * across webviews. The panel is also long-lived and often finishes
 * `getSession()` while still hidden, before localStorage has the token main
 * just wrote. Either way the summon paints "Not signed in" over a logged-in
 * app. Tauri events do cross the boundary; this module is that channel.
 *
 * Main is the only refresher (`autoRefreshToken: false` in the panel). The
 * payload is the live session, not a cue to rotate tokens.
 */

import type { Session, User } from "@supabase/supabase-js";
import { isSpotlightWindow, isTauri } from "./platform";
import { supabaseUrl } from "./supabase";

/** Main → spotlight: the current session, or `null` on sign-out. */
export const AUTH_SESSION_EVENT = "nuvo-auth-session";
/** Spotlight → main: please re-send whatever you have. */
export const AUTH_REQUEST_EVENT = "nuvo-auth-request";

/** Wire format. Tokens stay in-process (Tauri IPC); they must not be logged. */
export type AuthSessionPayload = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  token_type: "bearer";
  user: User;
} | null;

/** Same key supabase-js mints: `sb-<project-ref>-auth-token`. */
export function authStorageKey(url: string = supabaseUrl): string {
  try {
    return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  } catch {
    return "sb-auth-token";
  }
}

export function sessionToPayload(session: Session | null): AuthSessionPayload {
  if (!session?.access_token || !session.refresh_token) return null;
  const expires_at = session.expires_at ?? 0;
  if (!expires_at) return null;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at,
    expires_in: session.expires_in ?? Math.max(0, expires_at - Math.floor(Date.now() / 1000)),
    token_type: "bearer" as const,
    user: session.user,
  };
}

export function payloadToSession(payload: AuthSessionPayload): Session | null {
  if (!payload?.access_token || !payload.refresh_token || !payload.expires_at) return null;
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_at: payload.expires_at,
    expires_in: payload.expires_in,
    token_type: "bearer",
    user: payload.user,
  };
}

/**
 * First-paint auth. A returning device already has the session in
 * localStorage; waiting on `getSession()` to say so is what painted the
 * splash on every mobile open (auth `loading` started `true` even when the
 * slot was full). Spotlight still waits — its store can be empty on the
 * first tick (see useAuth).
 */
export function initialAuthState(
  storage: Storage | null = storageOrNull(),
  spotlight = isSpotlightWindow(),
): { session: Session | null; loading: boolean } {
  if (spotlight) return { session: null, loading: true };
  const session = readPersistedSession(storage);
  return { session, loading: !session };
}

/** Read the persisted supabase session without touching the auth client.
 *  Safe to call from the panel: it never rotates tokens. */
export function readPersistedSession(storage: Storage | null = storageOrNull()): Session | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(authStorageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { currentSession?: Session } | Session;
    const session = "access_token" in parsed ? parsed : parsed.currentSession;
    if (!session?.access_token || !session.refresh_token) return null;
    return session;
  } catch {
    return null;
  }
}

/**
 * Drop a session into this webview's localStorage so supabase-js's next
 * `getSession()` can recover it without a network round-trip.
 *
 * Writes only when this heap has nothing (the hidden-webview-empty-store
 * case). Never overwrites a token that is already there — main may have
 * just rotated, and rolling back is `refresh_token_already_used`.
 */
export function persistSessionIfAbsent(
  session: Session,
  storage: Storage | null = storageOrNull(),
): boolean {
  if (!storage) return false;
  if (!session.access_token || !session.refresh_token || !session.expires_at) return false;
  try {
    const key = authStorageKey();
    if (storage.getItem(key)) return false;
    storage.setItem(key, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

export async function broadcastAuthSession(session: Session | null): Promise<void> {
  if (!isTauri() || isSpotlightWindow()) return;
  try {
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo("spotlight", AUTH_SESSION_EVENT, sessionToPayload(session));
  } catch {
    /* spotlight window missing (tests, web) */
  }
}

export async function requestAuthSession(): Promise<void> {
  if (!isTauri() || !isSpotlightWindow()) return;
  try {
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo("main", AUTH_REQUEST_EVENT);
  } catch {
    /* main window missing */
  }
}

function storageOrNull(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}
