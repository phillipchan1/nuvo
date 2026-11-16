// The celebration ladder (D-209, docs/readiness-ladder.md §4). The reward grows
// with what the act means:
//
//   Ready     a click   — the piece pops in                      haptic light
//   Fits /    a lock    — the bar sweeps once                    haptic medium
//   Placed
//   Day       the stop  — the bar sweeps, rings, the ember stop
//                         drops onto "Today" with sparks          haptic success
//   Shipped   the Seal  — stamp, jolt, ring (only toward a moving
//                         bet; otherwise the stamp alone)        haptic success
//
// Laws it keeps (Momentum, design-language.md): only on the user's own act —
// every caller fires from a transition it watched happen, never on mount;
// transform and opacity only; off under reduced motion or a still material.
// What it no longer refuses (D-209 amends D-203's list): the sweep, the ring,
// the sparks. Still refused: sound, streaks, levels, a running tally.

import { motionOff, play } from "./motion";
import { haptic } from "./haptics";

/** A piece that just filled pops up and settles — the smallest reward. */
export function pop(el: Element | null | undefined, delayMs = 0): void {
  play(
    el,
    [{ transform: "scaleY(1)" }, { transform: "scaleY(2)", offset: 0.45 }, { transform: "scaleY(1)" }],
    "--d-land",
    "--ease-land",
    delayMs,
  );
}

/** A round thing that just moved swells and settles — a dial's step, the
 *  day's hero (D-219). Uniform scale, so a circle stays a circle. */
export function bump(el: Element | null | undefined, delayMs = 0, amount = 1.1): void {
  play(
    el,
    [{ transform: "scale(1)" }, { transform: `scale(${amount})`, offset: 0.4 }, { transform: "scale(1)" }],
    "--d-land",
    "--ease-land",
    delayMs,
  );
}

/** One bright pass across a bar that just closed. Draws its own overlay and
 *  removes it; the bar must clip (`overflow: hidden`). */
export function sweep(bar: HTMLElement | null | undefined, delayMs = 0): void {
  if (!bar || motionOff() || typeof document === "undefined") return;
  const s = document.createElement("span");
  s.className = "k-sweep";
  s.setAttribute("aria-hidden", "true");
  bar.appendChild(s);
  const a = play(s, [{ transform: "translateX(-100%)" }, { transform: "translateX(100%)" }], "--d-advance", "--ease-momentum", delayMs);
  if (!a) return s.remove();
  a.onfinish = a.oncancel = () => s.remove();
}

/** An ember outline that opens off an element and fades — the lock and the
 *  Seal. Fixed-position, so it never reflows anything. */
export function ring(el: Element | null | undefined, delayMs = 0, round = false): void {
  if (!el || motionOff() || typeof document === "undefined") return;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return;
  const d = document.createElement("span");
  d.className = "k-ring";
  if (round) d.style.borderRadius = "50%";
  d.setAttribute("aria-hidden", "true");
  Object.assign(d.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${Math.max(r.width, 12)}px`, height: `${Math.max(r.height, 12)}px` });
  document.body.appendChild(d);
  const a = play(d, [{ transform: "scale(0.94)", opacity: 0.9 }, { transform: "scale(1.3)", opacity: 0 }], "--d-advance", "--ease-momentum", delayMs);
  if (!a) return d.remove();
  a.onfinish = a.oncancel = () => d.remove();
}

/** Eight sparks off the centre of an element — the ember stop's moment. */
export function burst(el: Element | null | undefined, delayMs = 0): void {
  if (!el || motionOff() || typeof document === "undefined") return;
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  for (let i = 0; i < 8; i++) {
    const d = document.createElement("span");
    d.className = "k-spark";
    d.setAttribute("aria-hidden", "true");
    d.dataset.tone = i % 2 ? "accent" : "signal";
    Object.assign(d.style, { left: `${x}px`, top: `${y}px` });
    document.body.appendChild(d);
    const ang = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const dist = 14 + (i % 3) * 4;
    const a = play(
      d,
      [
        { transform: "translate(0, 0) scale(1)", opacity: 1 },
        { transform: `translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist}px) scale(0)`, opacity: 0 },
      ],
      "--d-advance",
      "--ease-momentum",
      delayMs,
    );
    if (!a) d.remove();
    else a.onfinish = a.oncancel = () => d.remove();
  }
}

/** The ember stop drops onto a title with a little overshoot, then sparks. */
export function dropStop(el: Element | null | undefined, delayMs = 0): void {
  if (!el) return;
  play(
    el,
    [
      { transform: "translateY(-1.1em) scale(0.4)", opacity: 0 },
      { transform: "translateY(0.08em) scale(1.25)", opacity: 1, offset: 0.62 },
      { transform: "none", opacity: 1 },
    ],
    "--d-land",
    "--ease-land",
    delayMs,
  );
  if (!motionOff()) setTimeout(() => burst(el), delayMs + 260);
}

/** A card or block jolts under a stamp. */
export function jolt(el: Element | null | undefined, delayMs = 0): void {
  play(
    el,
    [
      { transform: "none" },
      { transform: "translate(2px, 1px)" },
      { transform: "translate(-2px, -1px)" },
      { transform: "translate(1px, -1px)" },
      { transform: "none" },
    ],
    "--d-base",
    "--ease-out",
    delayMs,
  );
}

/** A mark just closed — the reward its tier earns. */
export function closeMark(bar: HTMLElement | null | undefined, tier: "small" | "medium" | "large"): void {
  if (tier === "small") {
    haptic("light");
    return;
  }
  sweep(bar, 120);
  if (tier === "large") ring(bar, 260);
  haptic("medium");
}

/** **The Seal** (D-209) — shipping a project, the largest moment on the ladder
 *  short of a season. A "Shipped" stamp slams onto where the project is (its
 *  crown row, or the deck's Shipped mark); toward a bet that's moving the
 *  target also jolts and an ember ring opens. Toward none: the stamp alone. */
export function seal(projectId: string, significant: boolean): void {
  haptic("success");
  if (typeof document === "undefined" || motionOff()) return;
  stamp(
    document.querySelector<HTMLElement>(`[data-crown-project="${CSS.escape(projectId)}"]`) ??
      document.querySelector<HTMLElement>('[data-mark="shipped"] .k-dial-ring'),
    significant,
  );
}

/** **The Seal, one altitude up** (D-230) — shipping an initiative, the
 *  largest finish there is short of a season. It used to flip a status and
 *  say nothing. The stamp lands on the bet's card on the deck (or on the
 *  control you pressed, when the deck isn't on screen) and always carries the
 *  jolt, the ring and the sparks: a bet only ships once. */
export function sealInitiative(initiativeId: string, from?: Element | null): void {
  haptic("success");
  if (typeof document === "undefined" || motionOff()) return;
  const target =
    document.querySelector<HTMLElement>(`[data-init-drag="${CSS.escape(initiativeId)}"]`) ??
    (from instanceof HTMLElement ? from : null) ??
    document.querySelector<HTMLElement>('[data-mark="moving"] .k-dial-ring');
  stamp(target, true);
  burst(target, 240);
}

function stamp(target: HTMLElement | null, significant: boolean): void {
  if (!target) return;
  const r = target.getBoundingClientRect();
  if (!r.width && !r.height) return;
  const st = document.createElement("span");
  st.className = "k-seal";
  st.setAttribute("aria-hidden", "true");
  st.textContent = "Shipped";
  Object.assign(st.style, { left: `${r.left + r.width / 2}px`, top: `${r.top + r.height / 2}px` });
  document.body.appendChild(st);
  const a = play(
    st,
    [
      { transform: "translate(-50%, -50%) scale(2.4) rotate(-14deg)", opacity: 0, offset: 0 },
      { transform: "translate(-50%, -50%) scale(0.94) rotate(-6deg)", opacity: 1, offset: 0.22 },
      { transform: "translate(-50%, -50%) scale(1) rotate(-6deg)", opacity: 1, offset: 0.8 },
      { transform: "translate(-50%, -50%) scale(1) rotate(-6deg)", opacity: 0, offset: 1 },
    ],
    "--d-advance",
    "--ease-out",
  );
  if (!a) return st.remove();
  a.onfinish = a.oncancel = () => st.remove();
  if (significant) {
    jolt(target, 160);
    ring(target, 200);
  }
}

/** A dial closing (D-219) — the lock, drawn for a circle. Shaping clicks (a
 *  swell and a light tap); a Scheduled / Fits close swells, rings and taps
 *  harder; the run's close (Done, Shipped, Moving) also throws sparks. */
export function closeDial(el: HTMLElement | null | undefined, tier: "small" | "medium" | "large", delayMs = 0): void {
  if (tier === "small") {
    bump(el, delayMs, 1.12);
    setTimeout(() => haptic("light"), delayMs);
    return;
  }
  bump(el, delayMs, 1.18);
  ring(el, delayMs + 120, true);
  if (tier === "large") burst(el, delayMs + 160);
  setTimeout(() => haptic(tier === "large" ? "success" : "medium"), delayMs);
}
