import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { VerticalProvider } from "../hooks/useVertical";
import { ASSISTANT_NAME } from "../lib/assistant";
import CaptureDoor, { type CaptureAdded } from "./capture/CaptureDoor";

// Tauri-only wiring (NSPanel hide, window events) is skipped in the browser, so
// the DEV `?spotlight` preview harness can render the panel against live data.
const IS_TAURI = "__TAURI_INTERNALS__" in globalThis;

/** Dismiss the panel. The window is an NSPanel, so a JS
 *  `getCurrentWebviewWindow().hide()` doesn't reliably order it out (and desyncs
 *  the ⌥Space toggle's visibility check) — everything routes through Rust. See
 *  lib.rs. No-op in the browser (the DEV preview harness). */
function hidePanel() {
  if (IS_TAURI) void invoke("hide_spotlight");
}

/** The window's own chrome, applied for as long as the spotlight is mounted —
 *  signed in or not. It lives out here, not in the panel, because a summon that
 *  finds no session used to render nothing at all: no `.spotlight-window` class,
 *  so the window kept the opaque `--surface` page background and the summon read
 *  as a dead warm-paper rectangle floating over the desktop. */
function useSpotlightChrome() {
  useEffect(() => {
    // This window is transparent (just the floating card shows); drop the desktop
    // titlebar inset that main.tsx reserves for the main window's traffic lights.
    const html = document.documentElement;
    html.classList.add("spotlight-window");
    html.classList.remove("tauri-macos");
    return () => html.classList.remove("spotlight-window");
  }, []);

  // Esc — and ⌘W, which reads as "close this window" — dismiss the panel (the
  // bare panel doesn't own these the way the Modal does). Owned here so a summon
  // still dismisses from the keyboard even when there's no session to capture into.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The capture door handles its own Escape (clear the line first, D-051)
      // and marks it; only an unclaimed one dismisses from out here.
      if (e.defaultPrevented) return;
      if (e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w")) {
        e.preventDefault();
        hidePanel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** What the ⌥Space window mounts — the panel once there's a session, an honest
 *  card before then. Never nothing: an empty summon is indistinguishable from a
 *  broken app, and the window is already floating over whatever you were doing.
 *  "Not signed in" is the genuine empty case. A logged-in main window with a
 *  blank panel is a session-sync bug — see `lib/authSync.ts`. */
export function SpotlightHost({ signedIn, loading }: { signedIn: boolean; loading: boolean }) {
  useSpotlightChrome();

  if (signedIn) {
    return (
      <VerticalProvider>
        <SpotlightWindow />
      </VerticalProvider>
    );
  }

  return (
    <SpotlightFrame>
      {loading ? (
        <div className="flex items-center justify-center px-5 py-8">
          <span className="wordmark shimmer text-head">nuvo</span>
        </div>
      ) : (
        <div className="px-5 py-6">
          <div className="masthead text-display leading-tight text-ink">Not signed in</div>
          <div className="mt-1.5 text-caption leading-relaxed text-muted">
            Quick capture needs your account. Open {ASSISTANT_NAME} and sign in — the next ⌥Space
            lands straight in the inbox.
          </div>
          <button
            type="button"
            onClick={() => {
              if (IS_TAURI) void invoke("surface_main");
            }}
            className="tap fast mt-4 w-full rounded-md border border-line bg-surface-2 px-3 py-2.5 text-body font-medium text-ink hover:bg-surface active:translate-y-px"
          >
            Open {ASSISTANT_NAME}
          </button>
        </div>
      )}
    </SpotlightFrame>
  );
}

/** The floating card the panel sits in — shared by the live panel and the
 *  signed-out card so both dismiss on backdrop click and wear the same glass.
 *  The native window is fitted to the card (`fit_spotlight`): transparent
 *  height beyond it would swallow clicks meant for the app underneath, and
 *  height short of it clips the card. */
function SpotlightFrame({ children }: { children: ReactNode }) {
  const cardRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || !IS_TAURI) return;
    const fit = () => void invoke("fit_spotlight", { height: Math.ceil(card.getBoundingClientRect().height) + 24 });
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(card);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      // h-screen + overflow-hidden, not min-h-screen: a card taller than the
      // window clips instead of spawning a stray document scrollbar while the
      // native window catches up to the card's height.
      className="flex h-screen items-start justify-center overflow-hidden bg-transparent p-3"
      onMouseDown={(e) => {
        // Click the transparent backdrop (not the card) to dismiss.
        if (e.target === e.currentTarget) hidePanel();
      }}
    >
      <div
        ref={cardRef}
        className="moment w-full max-w-xl overflow-hidden rounded-2xl border border-line/50 glass-card [box-shadow:var(--shadow-lift)]"
      >
        {children}
      </div>
    </div>
  );
}

// How long the "added" beat holds before the panel goes: long enough to read
// that it landed and where, short enough that the next ⌥Space isn't waiting.
const ADDED_BEAT_MS = 900;

// The standalone floating panel rendered in the dedicated "spotlight" Tauri
// window — summoned by the global ⌥Space hotkey. The same capture door as ⌘K
// and the phone's ＋ (D-149). Writes land in the shared outbox and reach the
// main window through Realtime — no cross-window plumbing.
export default function SpotlightWindow() {
  // Bumped on every ⌥Space so the door remounts fresh (Task, empty, focused).
  const [showKey, setShowKey] = useState(0);
  // The farewell: what was added, held for a beat so the summon ends on a
  // "got it" instead of vanishing mid-keystroke.
  const [added, setAdded] = useState<CaptureAdded | null>(null);
  const beat = useRef<number | null>(null);

  // Each summon → remount the door fresh; its mount effect focuses the line.
  // Click-away dismiss is owned by the native NSPanel delegate
  // (window_did_resign_key in lib.rs), not a JS blur listener.
  //
  // Deliberately NO win.setFocus() here: Tauri's setFocus calls NSApp.activate,
  // which pulls all of Nuvo to the foreground and defeats the non-activating
  // panel. The panel is already the key window from Rust's show_and_make_key().
  useEffect(() => {
    if (!IS_TAURI) return;
    let unlistenShow: (() => void) | undefined;
    getCurrentWebviewWindow()
      .listen("spotlight-show", () => {
        // A summon during the last one's beat must not be hidden by its timer.
        if (beat.current != null) window.clearTimeout(beat.current);
        beat.current = null;
        setAdded(null);
        setShowKey((k) => k + 1);
      })
      .then((u) => (unlistenShow = u));
    return () => unlistenShow?.();
  }, []);

  useEffect(() => () => {
    if (beat.current != null) window.clearTimeout(beat.current);
  }, []);

  const onAdded = useCallback((a: CaptureAdded) => {
    setAdded(a);
    beat.current = window.setTimeout(() => {
      beat.current = null;
      hidePanel();
    }, ADDED_BEAT_MS);
  }, []);

  return (
    <SpotlightFrame>
      {added ? (
        <div className="moment flex flex-col items-center gap-1 px-6 py-8 text-center" role="status">
          <span className="text-lead leading-none text-accent" aria-hidden>
            ✓
          </span>
          <h2 className="masthead text-lead text-ink">
            {added.kind === "task" ? "Task" : added.kind === "event" ? "Event" : "Slot"} added
          </h2>
          {added.title && <p className="line-clamp-2 max-w-sm text-body text-ink/80">{added.title}</p>}
          <p className="mono text-meta text-muted">{added.where}</p>
        </div>
      ) : (
        <div className="px-4 pb-3 pt-4">
          <CaptureDoor key={showKey} variant="panel" autoFocus onClose={hidePanel} onAdded={onAdded} />
        </div>
      )}
    </SpotlightFrame>
  );
}
