import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAppNavigation } from "../hooks/useAppNavigation";
import type { Rung } from "./AppShell";
import {
  closeMarqueeSurface,
  requestMarqueeSurface,
  type MarqueeDirective,
} from "../lib/marquee";
import { targetDef, type MarqueeNav } from "../lib/marqueeRegistry";
import type { AgentMessage } from "../lib/agentTypes";

// Where the agent left from, in words — shown in the return pill so "← Back"
// reads as a place, not just a direction.
const RUNG_LABEL: Record<Rung, string> = {
  day: "Schedule",
  project: "Projects",
  initiative: "Initiatives",
  domain: "Domains",
};

/** Conditions under which the user has "taken the wheel" — the session clears. */
interface ClearWhen {
  rungNot?: Rung;       // they navigated off the surface's rung
  overlayNone?: boolean; // they closed the overlay/record
  flowNull?: boolean;    // they closed the flow
}

interface Session {
  spotlightKey?: string; // data-marquee element to orb (omitted = navigation-only)
  label: string;         // pill: "Nuvo brought you to {label}"
  caption?: string;
  returnRung?: Rung;     // set only when Nuvo navigated → drives the return pill
  undo: () => void;      // the "← Back" action
  clear: ClearWhen;
}

/**
 * Marquee — Nuvo drives the left canvas. A reply carrying a `ui` directive
 * navigates to a destination (any of marqueeRegistry.ts) and, where the target
 * is an in-surface section, holds a warm limelight over it. The glow/session
 * persists until you act; when Nuvo moved you, a "brought you here" pill offers a
 * one-tap return. Desktop only (mounted from AppShellInner) — see docs/marquee.md.
 */
export default function Marquee({ messages }: { messages: AgentMessage[] }) {
  const {
    nav, goRung, setTab, setCalView, openFlow, closeFlow,
    openOverlay, closeOverlay, openRecord, setSettingsSection, navigate,
  } = useAppNavigation();

  const ranRef = useRef<string | null>(null);
  const rungRef = useRef<Rung>(nav.rung);
  rungRef.current = nav.rung;

  const [session, setSession] = useState<Session | null>(null);
  const [closing, setClosing] = useState(false);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;
  const orbRef = useRef<HTMLDivElement | null>(null);
  // Suppress auto-clear for a beat after a session starts, so the navigation we
  // just performed doesn't read as the user "taking the wheel".
  const armedRef = useRef(false);

  const end = useCallback(() => {
    if (!sessionRef.current) return;
    setClosing(true);
    window.setTimeout(() => {
      setSession(null);
      setClosing(false);
    }, 300);
  }, []);

  const goBack = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    s.undo();
    end();
  }, [end]);

  // Perform the navigation for a target and return how to undo / auto-clear it.
  const applyNav = useCallback(
    async (n: MarqueeNav, ref: string | undefined, fromRung: Rung, alreadyThere: boolean): Promise<{ navigated: boolean; undo: () => void; clear: ClearWhen }> => {
      switch (n.kind) {
        case "rung":
          goRung(n.rung);
          return { navigated: fromRung !== n.rung, undo: () => goRung(fromRung), clear: { rungNot: n.rung } };
        case "surface":
          if (!alreadyThere) {
            goRung(n.rung);
            await delay(60); // let the surface's listener mount before the event fires
            requestMarqueeSurface(n.surface);
          }
          // Week plan (and any future surface) is history-backed as an overlay —
          // Esc / back clearing it should end the session, same as records.
          return { navigated: !alreadyThere, undo: () => { closeMarqueeSurface(n.surface); goRung(fromRung); }, clear: { rungNot: n.rung, overlayNone: true } };
        case "tab":
          goRung(n.rung);
          setTab(n.tab);
          return { navigated: true, undo: () => goRung(fromRung), clear: { rungNot: n.rung } };
        case "calview":
          goRung(n.rung);
          setCalView(n.calView);
          return { navigated: true, undo: () => goRung(fromRung), clear: { rungNot: n.rung } };
        case "flow":
          openFlow(n.flow);
          return { navigated: true, undo: () => closeFlow(), clear: { flowNull: true } };
        case "settings":
          openOverlay("settings");
          if (n.section) setSettingsSection(n.section);
          return { navigated: true, undo: () => closeOverlay(), clear: { overlayNone: true } };
        case "record":
          openRecord(n.entity, ref!);
          return { navigated: true, undo: () => closeOverlay(), clear: { overlayNone: true } };
        case "task":
          openOverlay("task-record", ref!);
          return { navigated: true, undo: () => closeOverlay(), clear: { overlayNone: true } };
        case "domain":
          navigate({ rung: "domain", focus: { domainId: ref!, initiativeId: "", projectId: "" } });
          return { navigated: true, undo: () => goRung(fromRung), clear: { rungNot: "domain" } };
      }
    },
    [goRung, setTab, setCalView, openFlow, closeFlow, openOverlay, closeOverlay, openRecord, setSettingsSection, navigate],
  );

  const run = useCallback(
    async (ui: MarqueeDirective) => {
      const spot = ui.spotlight?.[0];
      if (!spot) return;
      const def = targetDef(spot.target);
      if (!def) return;
      const ref = spot.ref;

      // Entity targets need a ref (an item id). Without one, do nothing.
      if ((def.nav.kind === "record" || def.nav.kind === "domain" || def.nav.kind === "task") && !ref) return;

      const reduce = prefersReduced();
      const fromRung = rungRef.current;
      const spotSel = def.spotlight ? `[data-marquee="${def.spotlight}"]` : null;
      const alreadyThere = spotSel ? !!document.querySelector(spotSel) : false;

      const plan = await applyNav(def.nav, ref, fromRung, alreadyThere);

      // Spotlight the section once it mounts (navigation-only targets skip this).
      let spotlightKey: string | undefined;
      if (spotSel) {
        const el = await waitForTarget(spotSel, 2200);
        if (el) {
          el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
          await delay(reduce ? 0 : 360);
          spotlightKey = def.spotlight;
        }
      }

      // Nothing to show (already here, no orb) — don't start a session.
      if (!plan.navigated && !spotlightKey) return;

      armedRef.current = false;
      window.setTimeout(() => { armedRef.current = true; }, 320);
      setClosing(false);
      setSession({
        spotlightKey,
        label: def.label,
        caption: ui.caption,
        returnRung: plan.navigated ? fromRung : undefined,
        undo: plan.undo,
        clear: plan.clear,
      });
    },
    [applyNav],
  );

  // Watch the transcript; run each directive once.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || !last.ui) return;
    if (ranRef.current === last.id) return;
    ranRef.current = last.id;
    void run(last.ui);
  }, [messages, run]);

  // Keep the orb pinned to the (scrolling) target. If the target leaves the DOM,
  // the spotlight has nothing to sit on, so the session ends.
  useEffect(() => {
    if (!session?.spotlightKey) return;
    const sel = `[data-marquee="${session.spotlightKey}"]`;
    const pad = 12;
    const place = () => {
      const el = document.querySelector(sel) as HTMLElement | null;
      const orb = orbRef.current;
      if (!el) { if (armedRef.current) end(); return; }
      if (!orb) return;
      const r = el.getBoundingClientRect();
      orb.style.left = `${r.left - pad}px`;
      orb.style.top = `${r.top - pad}px`;
      orb.style.width = `${r.width + pad * 2}px`;
      orb.style.height = `${r.height + pad * 2}px`;
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [session, end]);

  // The user taking the wheel ends the session (once armed): navigating off the
  // surface's rung, closing the overlay/record, or closing the flow.
  useEffect(() => {
    const s = session;
    if (!s || !armedRef.current) return;
    if (s.clear.rungNot && nav.rung !== s.clear.rungNot) end();
    else if (s.clear.overlayNone && nav.overlay === "none") end();
    else if (s.clear.flowNull && !nav.flow) end();
  }, [nav.rung, nav.overlay, nav.flow, session, end]);

  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") end(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session, end]);

  // Dev affordance: drive the marquee by hand without a live backend.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __marquee?: (d: MarqueeDirective) => void }).__marquee = (d) => void run(d);
  }, [run]);

  if (!session) return null;

  return createPortal(
    <>
      {session.spotlightKey && (
        <div ref={orbRef} className={`marquee-orb${closing ? " is-closing" : ""}`}>
          <div className="marquee-orb-glow" />
        </div>
      )}

      {session.returnRung && (
        <div className={`marquee-pill${closing ? " is-closing" : ""}`}>
          <span className="marquee-pill-spark" aria-hidden>✦</span>
          <span className="marquee-pill-text">
            Nuvo brought you to <strong>{session.label}</strong>
            {session.caption && <em className="marquee-pill-caption"> · {session.caption}</em>}
          </span>
          <button className="marquee-pill-back" onClick={goBack}>
            ← Back to {RUNG_LABEL[session.returnRung]}
          </button>
          <button className="marquee-pill-x" onClick={end} aria-label="Dismiss">✕</button>
        </div>
      )}
    </>,
    document.body,
  );
}

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function prefersReduced() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Poll the DOM for a target that may not have mounted yet (the surface is still
 *  animating in). Resolves null after `timeout` ms so a stale key never hangs. */
function waitForTarget(sel: string, timeout: number): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = () => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el) return resolve(el);
      if (performance.now() - start > timeout) return resolve(null);
      requestAnimationFrame(tick);
    };
    tick();
  });
}
