import { useCallback, useEffect, useState } from "react";
import { getCurrentWebviewWindow, WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useLabels } from "../hooks/useCalendar";
import { useTaskMutations } from "../hooks/useTasks";
import { useAgentContext } from "../hooks/useAgentContext";
import { ASSISTANT_NAME } from "../lib/assistant";
import { NuvoSpotlightPanel, type Command } from "./NuvoSpotlight";

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

  const hide = useCallback(() => {
    void getCurrentWebviewWindow().hide();
  }, []);

  // This window is transparent (just the floating card shows); drop the desktop
  // titlebar inset that main.tsx reserves for the main window's traffic lights.
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add("spotlight-window");
    html.classList.remove("tauri-macos");
    return () => html.classList.remove("spotlight-window");
  }, []);

  // Each summon → fresh panel + refocus.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const win = getCurrentWebviewWindow();
    win
      .listen("spotlight-show", () => {
        setShowKey((k) => k + 1);
        void win.setFocus();
      })
      .then((u) => (unlisten = u));
    return () => unlisten?.();
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
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_64px_-16px_rgba(0,0,0,0.45)]">
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
