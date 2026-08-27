/** Readable errors — the toast, the phone, and the developer log.
 *
 *  Supabase's client throws `FunctionsHttpError` with the useless message
 *  "Edge Function returned a non-2xx status code". The reason is in the
 *  response body. PostgREST puts it on `code` / `details`. Without unwrapping,
 *  Mac shows a console 400 and the phone shows "Something went wrong".
 *
 *  Local only. PostHog gets a short, title-free string (D-114) — never a
 *  request body, never calendar/task copy.
 */
import { useEffect, useState } from "react";
import { captureAppException } from "./posthog";

export type AppErrorNote = {
  at: number;
  message: string;
  detail?: string;
  source?: string;
};

const KEY = "nuvo.errorLog";
const CHANGE = "nuvo-error-log";
const MAX = 30;

const GENERIC = "Something went wrong";
const EDGE_GENERIC = /edge function returned a non-2xx|failed to send a request to the edge function/i;

export function readErrorLog(): AppErrorNote[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AppErrorNote[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function rememberError(note: AppErrorNote): void {
  const next = [note, ...readErrorLog()].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota / private */
  }
  window.dispatchEvent(new Event(CHANGE));
}

export function clearErrorLog(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(CHANGE));
}

export function formatErrorLog(notes: AppErrorNote[] = readErrorLog()): string {
  if (!notes.length) return "No recent errors.";
  return notes
    .map((n) => {
      const when = new Date(n.at).toISOString();
      const src = n.source ? ` [${n.source}]` : "";
      const extra = n.detail ? `\n  ${n.detail}` : "";
      return `${when}${src} ${n.message}${extra}`;
    })
    .join("\n");
}

export function formatAppErrorSync(error: unknown): { message: string; detail?: string } {
  if (error == null) return { message: GENERIC };
  if (typeof error === "string" && error.trim()) return { message: error.trim() };
  if (typeof error !== "object") return { message: GENERIC };

  const e = error as {
    message?: unknown;
    code?: unknown;
    details?: unknown;
    hint?: unknown;
    name?: unknown;
    status?: unknown;
    context?: unknown;
  };

  const raw = typeof e.message === "string" ? e.message.trim() : "";
  const code = typeof e.code === "string" ? e.code : undefined;
  const details = typeof e.details === "string" ? e.details : undefined;
  const hint = typeof e.hint === "string" ? e.hint : undefined;
  const status = typeof e.status === "number" ? e.status : statusFromContext(e.context);
  const fn = functionFromContext(e.context);

  const parts = [code, details, hint].filter((p): p is string => Boolean(p && p !== raw));
  const detail = [fn && status ? `${fn} ${status}` : fn, ...parts].filter(Boolean).join(" · ") || undefined;

  if (raw && !EDGE_GENERIC.test(raw)) {
    return { message: raw, detail };
  }

  if (status === 404 && fn) {
    return { message: `${fn} isn't deployed on the server.`, detail: `HTTP ${status}` };
  }
  if (status === 401) {
    return { message: "Couldn't reach the server — try signing in again.", detail: fn ? `${fn} 401` : "401" };
  }
  if (raw) return { message: raw, detail: detail ?? (status ? `HTTP ${status}` : undefined) };
  return { message: GENERIC, detail };
}

export async function formatAppError(error: unknown): Promise<{ message: string; detail?: string }> {
  const base = formatAppErrorSync(error);
  const body = await readFunctionBody(error);
  if (!body) return base;
  const fromBody = body.error || body.message || body.msg;
  if (!fromBody) return base;
  if (base.message === GENERIC || EDGE_GENERIC.test(base.message)) {
    return { message: fromBody, detail: base.detail };
  }
  if (fromBody !== base.message) {
    return { message: base.message, detail: [base.detail, fromBody].filter(Boolean).join(" · ") };
  }
  return base;
}

/** Last (source → message, when) actually announced, for `repeatAfterMs`. */
const lastReported = new Map<string, { message: string; at: number }>();

/** Test seam — the throttle is module state, so a suite must be able to clear it. */
export function resetReportThrottle(): void {
  lastReported.clear();
}

/**
 * Format an error, keep it, and (optionally) say it once.
 *
 * `repeatAfterMs` is for failures that repeat on a TIMER rather than on a
 * user's act. The subscription read refetches every 5s for as long as it is
 * erroring, so a permanent server-side fault — a migration that never landed,
 * say — raised a red toast every five seconds for the life of the session and
 * pushed 30 identical rows through the error log, evicting everything that
 * would have explained it. Same source, same message, inside the window: keep
 * it, don't re-announce it. A *different* message always speaks immediately.
 */
export async function reportAppError(
  error: unknown,
  opts?: { source?: string; toast?: (message: string) => void; repeatAfterMs?: number },
): Promise<string> {
  const formatted = await formatAppError(error);
  if (opts?.repeatAfterMs != null) {
    const key = opts.source ?? "";
    const prev = lastReported.get(key);
    const at = Date.now();
    if (prev && prev.message === formatted.message && at - prev.at < opts.repeatAfterMs) {
      return formatted.message;
    }
    lastReported.set(key, { message: formatted.message, at });
  }
  rememberError({
    at: Date.now(),
    message: formatted.message,
    detail: formatted.detail,
    source: opts?.source,
  });
  captureAppException(error, {
    source: opts?.source,
    message: formatted.message,
    detail: formatted.detail,
  });
  opts?.toast?.(formatted.message);
  return formatted.message;
}

export function subscribeErrorLog(onChange: () => void): () => void {
  window.addEventListener(CHANGE, onChange);
  return () => window.removeEventListener(CHANGE, onChange);
}

export function useErrorLog(): AppErrorNote[] {
  const [notes, setNotes] = useState(readErrorLog);
  useEffect(() => subscribeErrorLog(() => setNotes(readErrorLog())), []);
  return notes;
}

function statusFromContext(context: unknown): number | undefined {
  if (context && typeof context === "object" && "status" in context) {
    const s = (context as { status?: unknown }).status;
    if (typeof s === "number") return s;
  }
  return undefined;
}

function functionFromContext(context: unknown): string | undefined {
  if (!context || typeof context !== "object") return undefined;
  const url = "url" in context && typeof (context as { url?: unknown }).url === "string"
    ? (context as { url: string }).url
    : undefined;
  if (!url) return undefined;
  try {
    const path = new URL(url).pathname;
    const m = path.match(/\/functions\/v1\/([^/?]+)/);
    return m?.[1];
  } catch {
    return undefined;
  }
}

async function readFunctionBody(
  error: unknown,
): Promise<{ error?: string; message?: string; msg?: string } | null> {
  if (!error || typeof error !== "object") return null;
  const ctx = (error as { context?: unknown }).context;
  if (!ctx || typeof ctx !== "object") return null;
  const res = ctx as { json?: () => Promise<unknown>; clone?: () => { json: () => Promise<unknown> } };
  try {
    const payload = res.clone ? await res.clone().json() : await res.json?.();
    if (!payload || typeof payload !== "object") return null;
    const o = payload as Record<string, unknown>;
    return {
      error: typeof o.error === "string" ? o.error : undefined,
      message: typeof o.message === "string" ? o.message : undefined,
      msg: typeof o.msg === "string" ? o.msg : undefined,
    };
  } catch {
    return null;
  }
}
