import { useCallback, useEffect, useMemo, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useLabels } from "../hooks/useCalendar";
import { useTaskMutations } from "../hooks/useTasks";
import { useVertical } from "../hooks/useVertical";
import { useAgentContext } from "../hooks/useAgentContext";
import { ASSISTANT_NAME } from "../lib/assistant";
import {
  buildSearchHits,
  SPOTLIGHT_NAVIGATE_EVENT,
  type SpotlightNav,
} from "../lib/spotlightNav";
import { NuvoSpotlightPanel, type Command, type Mode, type SearchHit } from "./NuvoSpotlight";

// Tauri-only wiring (NSPanel hide, window events) is skipped in the browser, so
// the DEV `?spotlight` preview harness can render the panel against live data.
const IS_TAURI = "__TAURI_INTERNALS__" in globalThis;

// The standalone floating panel rendered in the dedicated "spotlight" Tauri
// window — summoned by the global ⌥Space hotkey. Same NuvoSpotlightPanel the
// in-app ⌘K uses, just hosted in a frameless, always-on-top window instead of
// a Modal. Capture writes land in Supabase; the main window's realtime sub
// picks them up — no cross-window plumbing needed.
export default function SpotlightWindow() {
  const { labels } = useLabels();
  const mutations = useTaskMutations();
  const { data: vertical } = useVertical();
  const { agent, navFocus } = useAgentContext();

  const contextLabel = useMemo(() => {
    if (!navFocus) return undefined;
    const { projectId, initiativeId, domainId } = navFocus;
    if (projectId) return vertical.projects.find((p) => p.id === projectId)?.name;
    if (initiativeId) return vertical.initiatives.find((i) => i.id === initiativeId)?.name;
    if (domainId) return vertical.domains.find((d) => d.id === domainId)?.name;
    return undefined;
  }, [navFocus, vertical]);
  // Bumped on every ⌥Space so the panel remounts fresh (capture mode, empty, focused).
  const [showKey, setShowKey] = useState(0);
  // Tracked so the floating card can widen for chat (a roomier modality).
  const [mode, setMode] = useState<Mode>("capture");
  // The result deck wants the same room as the in-app ⌘K. Grow once it appears and
  // hold it for the rest of the summon (no jitter as you refine the query); each
  // fresh ⌥Space starts narrow again (reset in the spotlight-show listener).
  const [wide, setWide] = useState(false);
  const onLayoutChange = useCallback((deck: boolean) => setWide((w) => w || deck), []);

  // The native panel is a fixed-size window, so the deck can't just overflow the
  // card — grow the *window* to fit it (and back to the lean capture size when a
  // new summon starts narrow). No-op outside Tauri (the DEV preview harness).
  useEffect(() => {
    if (!IS_TAURI) return;
    void getCurrentWebviewWindow().setSize(
      wide ? new LogicalSize(960, 680) : new LogicalSize(680, 480),
    );
  }, [wide]);

  // Dismiss via the Rust `hide_spotlight` command — the window is an NSPanel, so
  // a JS `getCurrentWebviewWindow().hide()` doesn't reliably order it out (and
  // desyncs the ⌥Space toggle's visibility check). See lib.rs. In the browser
  // (the DEV preview harness, no Tauri) this is a no-op.
  const hide = useCallback(() => {
    if (IS_TAURI) void invoke("hide_spotlight");
  }, []);

  // This window is transparent (just the floating card shows); drop the desktop
  // titlebar inset that main.tsx reserves for the main window's traffic lights.
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add("spotlight-window");
    html.classList.remove("tauri-macos");
    return () => html.classList.remove("spotlight-window");
  }, []);

  // Each summon → remount the panel fresh (empty capture field); React's mount
  // effect focuses the input. Click-away dismiss is owned by the native NSPanel
  // delegate (window_did_resign_key in lib.rs), not a JS blur listener — a
  // panel's window delegate is replaced, so Tauri's "blur" event no longer fires.
  //
  // Deliberately NO win.setFocus() here: Tauri's setFocus calls NSApp.activate,
  // which pulls all of Nuvo to the foreground and defeats the non-activating
  // panel (the "⌥Space makes the whole app active" bug). The panel is already
  // the key window from Rust's show_and_make_key(), so keystrokes land without it.
  useEffect(() => {
    if (!IS_TAURI) return;
    let unlistenShow: (() => void) | undefined;
    const win = getCurrentWebviewWindow();
    win.listen("spotlight-show", () => {
      setShowKey((k) => k + 1);
      setMode("capture"); // each summon starts in capture, narrow
      setWide(false); // …and lean; the deck re-grows it only if you search
      agent.clear(); // the overlay is ephemeral — fresh chat every summon
    }).then((u) => (unlistenShow = u));
    return () => unlistenShow?.();
  }, []);

  // Esc — and ⌘W, which reads as "close this window" — dismiss the panel (the
  // bare panel doesn't own these the way the Modal does).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w")) {
        e.preventDefault();
        hide();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hide]);

  // Hand off to the main window — shared by "Open Nuvo" and pulling up a record.
  // Routes through the Rust `surface_main` command (AppKit activate), NOT a JS
  // show()/setFocus(): the panel is non-activating, so only a native activate
  // pulls a background app to the foreground. It also dismisses the panel.
  const focusMain = useCallback(() => {
    if (IS_TAURI) void invoke("surface_main");
  }, []);

  const commands: Command[] = [
    { id: "open-nuvo", title: `Open ${ASSISTANT_NAME}`, run: focusMain },
  ];

  // Quick pull-up: the same searchable vertical as the in-app ⌘K. Selecting a hit
  // hands the (serializable) nav intent to the main window — which replays it on
  // its live navigation — then brings it forward and dismisses the panel.
  const searchHits = useMemo<SearchHit[]>(
    () =>
      buildSearchHits(vertical).map((h) => ({
        ...h,
        run: () => {
          if (IS_TAURI) void emit(SPOTLIGHT_NAVIGATE_EVENT, h.nav satisfies SpotlightNav);
          focusMain();
          hide();
        },
      })),
    [vertical, focusMain, hide],
  );

  return (
    <div
      // h-screen + overflow-hidden, not min-h-screen: a card taller than the
      // window clips instead of spawning a stray document scrollbar while the
      // native window catches up to the deck's height.
      className="flex h-screen items-start justify-center overflow-hidden bg-transparent p-3"
      onMouseDown={(e) => {
        // Click the transparent backdrop (not the card) to dismiss.
        if (e.target === e.currentTarget) hide();
      }}
    >
      <div
        className={`moment w-full overflow-hidden rounded-2xl border border-line/50 glass-card transition-[max-width] duration-200 [box-shadow:var(--shadow-lift)] ${
          mode === "ask" ? "max-w-2xl" : wide ? "max-w-4xl" : "max-w-xl"
        }`}
      >
        <NuvoSpotlightPanel
          key={showKey}
          labels={labels}
          commands={commands}
          searchHits={searchHits}
          onCreate={mutations.create}
          agent={agent}
          onClose={hide}
          onModeChange={setMode}
          onLayoutChange={onLayoutChange}
          contextLabel={contextLabel}
        />
      </div>
    </div>
  );
}
