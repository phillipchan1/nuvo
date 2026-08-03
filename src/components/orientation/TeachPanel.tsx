import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../Icon";
import { createPortal } from "react-dom";
import { useVertical } from "../../hooks/useVertical";
import { useCalendarAccounts } from "../../hooks/useCalendar";
import { useAllTasks } from "../../hooks/useTasks";
import { useAgentContext } from "../../hooks/useAgentContext";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { Btn } from "../ui";
import { ORIENTATION_TEACH_STEPS, type OrientationAction, type TeachMilestone } from "./steps";
import { TEACH_TARGETS, type TeachArm } from "./teachTargets";

// "Walk me through it" — the live door of the first-run walkthrough.
//
// Unlike the visual tour, this does NOT cover the app. It docks (bottom-right on
// desktop, above the bar on a phone), names one act, lights the real element that
// performs it, and then watches real data for the result. The user drives; the
// panel narrates. That's the whole model — there are no act components and no
// mutation paths in here, because every act runs through the surface that already
// owns it (the rail's capture form, the deck's ＋, the agent rail).
//
// Nothing gates. Next is always live, Skip is always there, Esc leaves. A step
// only *auto-advances* on a real transition (not-done → done) that happens while
// you're looking at it, so a milestone that was already satisfied before you got
// here shows its tick and waits for you instead of flashing past.

export default function TeachPanel({
  onDone,
  onAction,
  mobile = false,
}: {
  /** Finish or skip — the provider persists the version. */
  onDone: () => void;
  onAction?: (action: OrientationAction) => void;
  /** Phone shell: no auto-navigation, and floor-only steps degrade to art. */
  mobile?: boolean;
}) {
  const { data } = useVertical();
  const { data: accounts = [] } = useCalendarAccounts();
  const { data: allTasks = [] } = useAllTasks();
  const { agent } = useAgentContext();
  const { nav, goRung, navigate, setTab, openOverlay, closeOverlay, setSettingsSection, openFlow } = useAppNavigation();

  const [step, setStep] = useState(0);
  const [orbSel, setOrbSel] = useState<string | null>(null);
  const [waySel, setWaySel] = useState<string | null>(null);
  const orbRef = useRef<HTMLDivElement | null>(null);
  const wayRef = useRef<HTMLDivElement | null>(null);
  const dimRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Which corner the panel sits in. It moves out of its own way — see `place()`.
  const [dock, setDock] = useState<DockCorner>("br");

  // Does this step reach the real app on THIS shell — either by lighting an
  // element or by bringing a floor forward? Phone-only steps fall through here
  // (the Build floors are desktop-only), which is what sends them back to art.
  const reachesApp = (() => {
    const def = ORIENTATION_TEACH_STEPS[step].target
      ? TEACH_TARGETS[ORIENTATION_TEACH_STEPS[step].target!]
      : null;
    if (!def) return false;
    return mobile ? Boolean(def.mobileSelector) : Boolean(def.selector || def.rung);
  })();

  // Put the app into the state the step is describing. Talking about the chat
  // while the chat is shut, or about the Inbox while the rail shows Today, is the
  // fastest way to lose a first-time reader.
  // Held in a ref, and the pointing effect below depends ONLY on the step.
  //
  // This is load-bearing, not tidiness: navigating changes the identity of the nav
  // helpers, so an effect that lists them as deps re-runs *as a result of its own
  // navigation*, clears `orbSel`, and cancels the in-flight waitForTarget. The
  // symptom is precisely the one worth remembering — the steps that stay on the
  // current floor light up, and every step that travels to another floor silently
  // doesn't.
  const drive = useRef({ nav, goRung, navigate, setTab, openOverlay, closeOverlay, setSettingsSection, openFlow });
  drive.current = { nav, goRung, navigate, setTab, openOverlay, closeOverlay, setSettingsSection, openFlow };

  const runArm = (arm: TeachArm) => {
    const d = drive.current;
    switch (arm) {
      case "rail-inbox": d.setTab("inbox"); break;
      case "rail-today": d.setTab("today"); break;
      case "open-agent": d.navigate({ agentOpen: true }); break;
      case "open-calendars": d.setSettingsSection("connections"); d.openOverlay("settings"); break;
      // Straight to the Projects lane — "what are you moving this week?" — rather
      // than the ritual's first step, so the act the walkthrough is naming is the
      // one on screen. PLAN_STEPS is ["open","projects","rest"].
      case "open-plan": d.openFlow("sunday"); d.navigate({ flowStep: 1 }); break;
    }
  };

  const s = ORIENTATION_TEACH_STEPS[step];
  const last = ORIENTATION_TEACH_STEPS.length - 1;
  const atEnd = step >= last;

  // ── the milestones, derived from real data (never from a click) ─────────────
  // Same five reads the Getting Started tracker uses, so the two can never
  // disagree about what "done" means.
  const askedNuvo = agent.messages?.some((m) => m.role === "user") ?? false;
  const met: Record<TeachMilestone, boolean> = {
    inbox: allTasks.some((t) => t.status === "inbox"),
    timeblock: allTasks.some((t) => t.start_time != null && t.do_date != null),
    project: data.projects.length > 0,
    nuvo: askedNuvo,
    calendar: accounts.length > 0,
  };
  const done = s.milestone ? met[s.milestone] : false;

  const next = useCallback(() => setStep((i) => (i >= last ? i : i + 1)), [last]);
  const back = useCallback(() => setStep((i) => Math.max(0, i - 1)), []);

  // ── point at the real thing ────────────────────────────────────────────────
  // Bring the floor forward, wait for the element to mount (the floor may still
  // be animating in), then hold the orb on it. A target that never appears just
  // leaves the step orb-less rather than hanging.
  useEffect(() => {
    let cancelled = false;
    const def = s.target ? TEACH_TARGETS[s.target] : null;
    const d = drive.current;
    setOrbSel(null);
    setWaySel(null);

    // A step with nothing to point at still has to tidy up — otherwise the closing
    // step ("let's make this week land") delivers you into the Settings modal the
    // calendars step opened. Land them on the Schedule instead.
    if (!def) {
      const home: Record<string, unknown> = {};
      if (d.nav.overlay !== "none") { home.overlay = "none"; home.overlayId = null; }
      if (d.nav.flow) home.flow = null;
      if (!mobile && d.nav.rung !== "day") home.rung = "day";
      if (Object.keys(home).length) d.navigate(home);
      return;
    }

    const arm = mobile ? (def.mobileArm ?? def.arm) : def.arm;

    // ONE synchronous nav patch: close what an earlier step opened, and travel to
    // this step's floor, together.
    //
    // Not two calls. `closeOverlay` prefers `history.back()`, which lands async and
    // gets clobbered by a `navigate()` issued in the same tick — the same race that
    // once made ⌘K commands "do nothing". The symptom here was Settings staying up
    // over the floor the next step was trying to introduce.
    const patch: Record<string, unknown> = {};
    if (arm !== "open-calendars" && d.nav.overlay !== "none") {
      patch.overlay = "none";
      patch.overlayId = null;
    }
    // Same for the ritual: it's a full-screen flow, so a later step would be
    // narrating a floor nobody can see. `closeFlow` unwinds history, so it has
    // the same async-vs-sync race — fold it into the one patch instead.
    if (arm !== "open-plan" && d.nav.flow) patch.flow = null;
    if (!mobile && def.rung) {
      patch.rung = def.rung;
      if (def.clearFocus) patch.focus = { domainId: "", initiativeId: "", projectId: "" };
    }
    if (Object.keys(patch).length) d.navigate(patch);

    // …then open whatever the step is about to talk about.
    if (arm) runArm(arm);

    // Name where we just landed, in the Spine. Without it a floor change reads as
    // the app moving on its own — you get a new screen and nothing says what
    // changed or how you'd get back.
    if (!mobile && def.waypoint) {
      const way = def.waypoint;
      void waitForTarget(way, 2400).then((el) => {
        if (!cancelled && el) setWaySel(way);
      });
    }

    const sel = mobile ? def.mobileSelector : def.selector;
    if (!sel) return;

    void waitForTarget(sel, 2400).then((el) => {
      if (cancelled || !el) return;
      el.scrollIntoView({ behavior: prefersReduced() ? "auto" : "smooth", block: "center" });
      setOrbSel(sel);
    });
    return () => { cancelled = true; };
    // Deps are the step and the shell — deliberately NOT the nav helpers. See `drive`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, s.target, mobile]);

  // Keep the orb pinned as the page scrolls/resizes. If the element leaves the
  // DOM the orb has nothing to sit on, so it goes quiet (the step stays).
  useEffect(() => {
    if (!orbSel) return;
    const pad = 10;
    const place = () => {
      const el = document.querySelector(orbSel) as HTMLElement | null;
      const orb = orbRef.current;
      const dim = dimRef.current;
      if (!orb) return;
      if (!el) {
        orb.style.opacity = "0";
        if (dim) dim.style.opacity = "0";
        return;
      }
      const r = el.getBoundingClientRect();
      orb.style.opacity = "1";
      orb.style.left = `${r.left - pad}px`;
      orb.style.top = `${r.top - pad}px`;
      orb.style.width = `${r.width + pad * 2}px`;
      orb.style.height = `${r.height + pad * 2}px`;
      // Get out of our own way. The panel's home is bottom-right and so is the
      // Nuvo composer, so the Nuvo step used to sit directly on top of the thing
      // it was ringing. Rather than special-casing that step, take the first
      // corner that doesn't overlap the target — which also protects whatever
      // gets tagged next.
      if (!mobile) setDock(pickCorner(r, panelRef.current));
      // The cut-out rides the same rect. Its huge shadow spread IS the dimming —
      // one element, so the hole can never drift out of register with the dark.
      if (dim) {
        dim.style.opacity = "1";
        dim.style.left = `${r.left - pad}px`;
        dim.style.top = `${r.top - pad}px`;
        dim.style.width = `${r.width + pad * 2}px`;
        dim.style.height = `${r.height + pad * 2}px`;
      }
    };
    place();
    const id = window.setInterval(place, 400); // catches layout the events miss
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [orbSel]);

  // The waypoint gets its own loop — it rides the Spine, which doesn't move with
  // the floor's scrolling, and it has no cut-out to keep in register.
  useEffect(() => {
    if (!waySel) return;
    const pad = 6;
    const place = () => {
      const el = document.querySelector(waySel) as HTMLElement | null;
      const way = wayRef.current;
      if (!way) return;
      if (!el) { way.style.opacity = "0"; return; }
      const r = el.getBoundingClientRect();
      way.style.opacity = "1";
      way.style.left = `${r.left - pad}px`;
      way.style.top = `${r.top - pad}px`;
      way.style.width = `${r.width + pad * 2}px`;
      way.style.height = `${r.height + pad * 2}px`;
    };
    place();
    const id = window.setInterval(place, 400);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [waySel]);

  // ── auto-advance, but only on a real transition ────────────────────────────
  // `baseline` is whether this step's milestone was ALREADY met when the step
  // opened. If it was, we show the tick and wait — nobody should watch a step
  // they didn't do fly past.
  const baseline = useRef<boolean | null>(null);
  useEffect(() => { baseline.current = null; }, [step]);
  useEffect(() => {
    if (!s.milestone) return;
    if (baseline.current === null) { baseline.current = done; return; }
    if (baseline.current || !done) return;
    const t = window.setTimeout(() => next(), 1100); // let the tick land first
    return () => window.clearTimeout(t);
  }, [done, s.milestone, step, next]);

  // Esc leaves, always.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onDone(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onDone]);

  const Visual = s.Visual;
  // The real app is always the better teacher — the art only carries a step that
  // can't reach it (the Initiative step, and the floor-only steps on a phone,
  // where those floors don't exist).
  const showVisual = Boolean(Visual) && !reachesApp;

  return createPortal(
    <>
      {/* The Spine waypoint — quieter than the main orb on purpose. It answers
          "where am I now", not "what do I click", so it must never compete with
          the thing the step is actually asking for. */}
      {waySel && (
        <div ref={wayRef} className="marquee-orb is-teach is-waypoint" aria-hidden>
          <div className="marquee-orb-glow" />
        </div>
      )}

      {orbSel && (
        <>
          {/* A whisper of a scrim. The ring does the pointing; this only takes the
              edge off everything else. Click-through, always — the whole premise
              is that the app stays usable while it's lit. */}
          <div ref={dimRef} className="teach-dim" aria-hidden />
          <div ref={orbRef} className="marquee-orb is-teach" aria-hidden>
            <div className="marquee-orb-glow" />
          </div>
        </>
      )}

      <div
        ref={panelRef}
        className={`glass elev-3 fixed z-[80] flex flex-col rounded-2xl border border-line ${
          mobile
            // Clears the bottom bar AND the two floating actions above it (＋ and
            // ✦) — the panel must never cover the thing its own orb points at.
            ? "inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+9rem)]"
            : `w-[340px] ${DOCK_CLASS[dock]} transition-[inset] duration-300`
        }`}
        role="dialog"
        aria-label="Walkthrough"
      >
        <div className="p-4">
          <div className="flex items-center gap-2">
            <span className="section-label flex-1">{s.eyebrow}</span>
            <span className="mono text-micro text-muted">
              {step + 1}/{ORIENTATION_TEACH_STEPS.length}
            </span>
            <button
              onClick={onDone}
              className="tap fast text-caption text-muted hover:text-ink"
              aria-label="Skip the walkthrough"
            >
              Skip
            </button>
          </div>

          {showVisual && Visual && (
            <div className="mt-3 flex justify-center">
              <Visual />
            </div>
          )}

          <h2 className="masthead mt-2.5 text-lead leading-snug text-ink">{s.title}</h2>
          <p className="mt-1.5 text-caption leading-relaxed text-muted">{s.teach}</p>

          {s.milestone && (
            <div className="mt-3 flex items-center gap-2">
              <Tick done={done} />
              <span className={`text-caption ${done ? "text-ink" : "text-muted"}`}>
                {done ? "Done — nice." : "Waiting for you…"}
              </span>
            </div>
          )}

          {s.cta && (
            <button
              onClick={() => { onAction?.(s.cta!.action); }}
              className="tap fast mt-3 inline-flex w-fit items-center gap-1.5 rounded-md border border-accent px-3 py-1.5 text-caption font-medium text-accent hover:bg-accent-soft active:translate-y-px"
            >
              {s.cta.label}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <div className="flex flex-1 items-center gap-1">
            {ORIENTATION_TEACH_STEPS.map((st, i) => (
              <span
                key={st.id}
                className="block rounded-full transition-all"
                style={{
                  width: i === step ? 14 : 5,
                  height: 5,
                  background: i === step ? "var(--accent)" : "var(--line-strong)",
                }}
              />
            ))}
          </div>
          {step > 0 && <Btn kind="ghost" onClick={back} className="!px-3 !py-1.5 !text-caption">Back</Btn>}
          <Btn
            kind="primary"
            onClick={atEnd ? onDone : next}
            className="!px-3 !py-1.5 !text-caption"
          >
            {atEnd ? "Get started" : "Next"}
          </Btn>
        </div>
      </div>
    </>,
    document.body,
  );
}

function Tick({ done }: { done: boolean }) {
  if (!done) return <span className="h-4 w-4 shrink-0 rounded-full border border-line-strong" />;
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--accent)" }}>
      <Icon name="check" size={10} />
    </span>
  );
}

type DockCorner = "br" | "bl" | "tr" | "tl";

const DOCK_CLASS: Record<DockCorner, string> = {
  br: "bottom-5 right-5",
  bl: "bottom-5 left-5",
  tr: "top-5 right-5",
  tl: "top-5 left-5",
};

/**
 * The first corner whose panel rect clears the highlighted element. Order is a
 * preference, not a rule: bottom-right is home, and we only leave it when the
 * target is there. A target big enough to hit every corner keeps the panel at
 * home rather than jittering between equally-bad options.
 */
function pickCorner(target: DOMRect, panel: HTMLElement | null): DockCorner {
  if (!panel) return "br";
  const { width: w, height: h } = panel.getBoundingClientRect();
  if (!w || !h) return "br";
  const m = 20; // matches DOCK_CLASS's inset
  const gap = 16; // breathing room before we call it a collision
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const boxes: Record<DockCorner, { l: number; t: number }> = {
    br: { l: vw - m - w, t: vh - m - h },
    bl: { l: m, t: vh - m - h },
    tr: { l: vw - m - w, t: m },
    tl: { l: m, t: m },
  };
  const hits = (b: { l: number; t: number }) =>
    b.l < target.right + gap &&
    b.l + w > target.left - gap &&
    b.t < target.bottom + gap &&
    b.t + h > target.top - gap;
  const order: DockCorner[] = ["br", "bl", "tr", "tl"];
  return order.find((c) => !hits(boxes[c])) ?? "br";
}

function prefersReduced() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Poll for a target that may not have mounted yet (the floor is still animating
 *  in). Resolves null after `timeout` so a stale selector never hangs the step. */
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
