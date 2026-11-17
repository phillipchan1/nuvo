// The desktop's floating focus pill (D-242) — the window that stays over every
// other app while you're in focus.
//
// A mirror, not a client: it draws the main window's snapshot
// (FOCUS_PILL_STATE), ticks its own minute clock so "38m left" stays honest,
// and sends every tap back to main (FOCUS_PILL_ACT), which performs it with its
// own mutations. Showing and hiding the window is main's call too.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  FOCUS_PILL_ACT,
  FOCUS_PILL_HELLO,
  FOCUS_PILL_STATE,
  type FocusPillAct,
  type FocusPillSnapshot,
} from "../../lib/focusPill";
import { FocusPillView } from "./FocusPill";

const IS_TAURI = "__TAURI_INTERNALS__" in globalThis;

async function send(a: FocusPillAct) {
  if (!IS_TAURI) return;
  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo("main", FOCUS_PILL_ACT, a);
  // "Show me" and "what's next" are answered in the main window — bring it up.
  if (a.act === "show" || a.act === "next") {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("surface_main");
  }
}

// DEV, in a browser: /focus.html draws a sample so the card can be checked
// without a desktop build. Tree-shaken from production.
const SAMPLE: FocusPillSnapshot | null =
  import.meta.env.DEV && !IS_TAURI
    ? {
        title: "Morning Focus",
        task: { id: "t1", title: "Request Access to Permit Hub" },
        done: 1,
        total: 3,
        closed: false,
        closedAt: null,
        start: Date.now() - 20 * 60_000,
        end: Date.now() + 38 * 60_000,
        then: { title: "Leadership stand-up", start: Date.now() + 38 * 60_000 },
        named: true,
        theme: "light",
      }
    : null;

export default function FocusPillWindow() {
  const [snap, setSnap] = useState<FocusPillSnapshot | null>(SAMPLE);
  const [now, setNow] = useState(() => new Date());
  const ref = useRef<HTMLDivElement>(null);

  // The snapshot, and a hello so a window that loaded after main isn't blank.
  useEffect(() => {
    if (!IS_TAURI) return;
    let off: (() => void) | undefined;
    let dead = false;
    void (async () => {
      const { listen, emitTo } = await import("@tauri-apps/api/event");
      const un = await listen<FocusPillSnapshot | null>(FOCUS_PILL_STATE, (e) => setSnap(e.payload));
      if (dead) un();
      else off = un;
      await emitTo("main", FOCUS_PILL_HELLO);
    })();
    return () => {
      dead = true;
      off?.();
    };
  }, []);

  // Its own clock: the line counts down while main sits in the background.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Wear main's theme.
  useEffect(() => {
    if (snap) document.documentElement.dataset.theme = snap.theme;
  }, [snap?.theme]);

  // The window is transparent; fit it to the card so no invisible glass eats
  // clicks meant for the app underneath (the ⌥Space panel's lesson).
  useLayoutEffect(() => {
    if (!IS_TAURI || !ref.current) return;
    const h = Math.ceil(ref.current.getBoundingClientRect().height);
    if (h > 0) void import("@tauri-apps/api/core").then(({ invoke }) => invoke("fit_focus_pill", { height: h }));
  });

  return <div ref={ref} className="focus-pill-frame">{snap && <FocusPillView snap={snap} now={now} onAct={(a) => void send(a)} />}</div>;
}
