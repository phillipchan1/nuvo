import { useCallback, useEffect, useState } from "react";
import { getCurrentWebviewWindow, WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { useLabels } from "../hooks/useCalendar";
import { useTaskMutations } from "../hooks/useTasks";
import { useAgentContext } from "../hooks/useAgentContext";
import { ASSISTANT_NAME } from "../lib/assistant";
import { NuvoSpotlightPanel, type Command } from "./NuvoSpotlight";

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
  const { agent } = useAgentContext();
  // Bumped on every ⌥Space so the panel remounts fresh (capture mode, empty, focused).
  const [showKey, setShowKey] = useState(0);

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
    }).then((u) => (unlistenShow = u));
    return () => unlistenShow?.();
  }, []);

  // Esc dismisses (the bare panel doesn't own Escape the way the Modal does).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        hide();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hide]);

  const commands: Command[] = [
    {
      id: "open-nuvo",
      title: `Open ${ASSISTANT_NAME}`,
      run: () => {
        if (!IS_TAURI) return;
        void WebviewWindow.getByLabel("main").then((w) => {
          void w?.show();
          void w?.unminimize();
          void w?.setFocus();
        });
      },
    },
  ];

  return (
    <div
      className="flex min-h-screen items-start justify-center bg-transparent p-3"
      onMouseDown={(e) => {
        // Click the transparent backdrop (not the card) to dismiss.
        if (e.target === e.currentTarget) hide();
      }}
    >
      <div className="moment w-full max-w-xl overflow-hidden rounded-2xl border border-line/50 glass-card [box-shadow:var(--shadow-lift)]">
        <NuvoSpotlightPanel
          key={showKey}
          labels={labels}
          commands={commands}
          onCreate={mutations.create}
          agent={agent}
          onClose={hide}
        />
      </div>
    </div>
  );
}
