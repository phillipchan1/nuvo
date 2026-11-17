// The main window's half of the desktop focus pill (D-242): feed the floating
// window its snapshot, do what it asks, and decide when it shows.
//
// It shows while you're in focus AND Nuvo is not the window in front — you're
// working in another app, which is the whole point of it. When Nuvo comes
// forward it hides: the rail (on the Schedule) or the in-app pill (anywhere
// else) is already saying the same thing. Desktop Tauri only; a no-op in the
// browser and on iOS.

import { useEffect, useRef, useState } from "react";
import { isMobileTauri, isTauri } from "../lib/platform";
import {
  FOCUS_PILL_ACT,
  FOCUS_PILL_HELLO,
  FOCUS_PILL_STATE,
  FOCUS_PILL_WINDOW,
  type FocusPillAct,
  type FocusPillSnapshot,
} from "../lib/focusPill";

const DESKTOP = isTauri() && !isMobileTauri();

export function useFocusPillWindow(snap: FocusPillSnapshot | null, onAct: (a: FocusPillAct) => void) {
  const [front, setFront] = useState(() => (typeof document === "undefined" ? true : document.hasFocus()));
  const latest = useRef(snap);
  latest.current = snap;
  const act = useRef(onAct);
  act.current = onAct;

  // Is Nuvo's main window the one in front?
  useEffect(() => {
    if (!DESKTOP) return;
    let off: (() => void) | undefined;
    let dead = false;
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const un = await getCurrentWindow().onFocusChanged(({ payload }) => setFront(payload));
      if (dead) un();
      else off = un;
    })();
    return () => {
      dead = true;
      off?.();
    };
  }, []);

  // The pill's taps, and its hello (a window that loaded after us).
  useEffect(() => {
    if (!DESKTOP) return;
    const offs: Array<() => void> = [];
    let dead = false;
    void (async () => {
      const { listen, emitTo } = await import("@tauri-apps/api/event");
      const a = await listen<FocusPillAct>(FOCUS_PILL_ACT, (e) => act.current(e.payload));
      const h = await listen(FOCUS_PILL_HELLO, () => void emitTo(FOCUS_PILL_WINDOW, FOCUS_PILL_STATE, latest.current));
      if (dead) {
        a();
        h();
      } else offs.push(a, h);
    })();
    return () => {
      dead = true;
      offs.forEach((f) => f());
    };
  }, []);

  // Every change to the focus, mirrored.
  useEffect(() => {
    if (!DESKTOP) return;
    void import("@tauri-apps/api/event").then(({ emitTo }) => emitTo(FOCUS_PILL_WINDOW, FOCUS_PILL_STATE, snap));
  }, [snap]);

  // Up while you're in focus somewhere else; down when Nuvo is in front.
  const visible = Boolean(snap) && !front;
  useEffect(() => {
    if (!DESKTOP) return;
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke(visible ? "show_focus_pill" : "hide_focus_pill"));
  }, [visible]);
}
