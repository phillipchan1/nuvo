// Get ready — a rail mode (D-206, docs/rail-modes.md).
//
// The crown's one door. The rail becomes a stack of cards that take this
// screen to ready, worst first (`lib/readyCards`): at most five show, each one
// thing with one evidence line and one act that names where it goes. Nothing is
// written until you press (P3). Pressing lands the card, Reaches to the crown
// row it moved (D-202), and lets it go; the next card slides in under your
// hand. There is never a count of what's left (P4). When nothing is left the
// rail says "Ready." once and hands itself back.
//
// Plan the week and Repair stay their own modes: a card can open them, and then
// this mode ends (one mode at a time; no rest chips while it owns the rail —
// LeftRail isn't mounted).
//
// Keys: ↵ the focused card's act · j / k move · ⌫ Not now (or Leave it where it
// is) · Esc back to your day.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconButton, OfferCard } from "../kit";
import { Icon } from "../Icon";
import { landBlock, motionMs, motionOff } from "../../lib/motion";
import { READY_MAX, type ReadyCard } from "../../lib/readyCards";
import PinnedCrown from "./PinnedCrown";
import { useReadyCards } from "./useReadyCards";

/** How long "Ready." stays before the rail hands itself back. */
export const READY_HOLD_MS = 1200;

const later = (ms: number, fn: () => void): number | null => {
  if (!(ms > 0)) {
    fn();
    return null;
  }
  return window.setTimeout(fn, ms);
};
const beat = (token: string) => (motionOff() ? 0 : motionMs(token));

/** The stack's state machine, shared by the rail and the phone's sheet: which
 *  cards show, which one has focus, and what pressing does to the stack. */
export function useReadyStack(cards: readonly ReadyCard[], max = READY_MAX) {
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  // Cards you just acted on, held on screen (from a snapshot — the model may
  // already have dropped them) while they land and let go.
  const [leaving, setLeaving] = useState<{ card: ReadyCard; index: number; letGo: boolean }[]>([]);
  const [arriving, setArriving] = useState<Set<string>>(() => new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const acted = useRef(false);

  // A card leaves the stack locally the moment you act; once the data agrees
  // (the card is gone from the model) the local mark is dropped, so an Undo
  // brings the card back.
  useEffect(() => {
    setGone((prev) => {
      if (![...prev].some((k) => !cards.some((c) => c.key === k))) return prev;
      return new Set([...prev].filter((k) => cards.some((c) => c.key === k)));
    });
  }, [cards]);

  const visible = useMemo(() => {
    const held = new Set(leaving.map((l) => l.card.key));
    const list = cards.filter((c) => !gone.has(c.key) && !held.has(c.key)).slice(0, Math.max(0, max - leaving.length));
    for (const l of [...leaving].sort((a, b) => a.index - b.index)) list.splice(Math.min(l.index, list.length), 0, l.card);
    return list;
  }, [cards, gone, leaving, max]);

  // The next card arrives only because of your act — never on load.
  const lastKeys = useRef<string[]>([]);
  useEffect(() => {
    const keys = visible.map((c) => c.key);
    if (acted.current) {
      const fresh = keys.filter((k) => !lastKeys.current.includes(k));
      if (fresh.length) {
        acted.current = false;
        setArriving(new Set(fresh));
        later(beat("--d-land"), () => setArriving(new Set()));
      }
    }
    lastKeys.current = keys;
  }, [visible]);

  const settled = visible.filter((c) => !leaving.some((l) => l.card.key === c.key));
  const focused = settled.find((c) => c.key === focusKey) ?? settled[0] ?? null;

  /** Run one of a card's acts; the card lands, then lets go. */
  const act = useCallback(
    (card: ReadyCard, which: "primary" | "secondary", from: HTMLElement | null, cardEl: HTMLElement | null) => {
      if (leaving.some((l) => l.card.key === card.key)) return;
      if (which === "primary") card.primary.run(from);
      else card.secondary?.run();
      // A card that opens a mode doesn't leave: the mode replaces this one.
      if (which === "primary" && card.opensMode) return;
      const index = Math.max(0, visible.findIndex((c) => c.key === card.key));
      const at = settled.indexOf(card);
      const next = settled[at + 1] ?? settled[at - 1] ?? null;
      setFocusKey(next?.key ?? null);
      acted.current = true;
      setLeaving((ls) => [...ls, { card, index, letGo: false }]);
      if (which === "primary") landBlock(cardEl);
      later(which === "primary" ? beat("--d-land") : 0, () => {
        setLeaving((ls) => ls.map((l) => (l.card.key === card.key ? { ...l, letGo: true } : l)));
        later(beat("--d-task-complete"), () => {
          setGone((prev) => new Set(prev).add(card.key));
          setLeaving((ls) => ls.filter((l) => l.card.key !== card.key));
        });
      });
    },
    [visible, settled, leaving],
  );

  const step = (d: number) => {
    if (!settled.length) return;
    const i = focused ? settled.indexOf(focused) : 0;
    setFocusKey(settled[(((i + d) % settled.length) + settled.length) % settled.length].key);
  };

  const lettingGo = useMemo(() => new Set(leaving.filter((l) => l.letGo).map((l) => l.card.key)), [leaving]);
  return { visible, focused, lettingGo, arriving, act, step, setFocusKey, empty: settled.length === 0 && leaving.length === 0 };
}

export default function GetReadyRail({
  cards,
  onClose,
  railRef,
  crown,
}: {
  cards: readonly ReadyCard[];
  onClose: () => void;
  railRef?: React.MutableRefObject<HTMLDivElement | null>;
  /** the crown, pinned (rail-modes §2) — defaults to the live PinnedCrown */
  crown?: ReactNode;
}) {
  const s = useReadyStack(cards);
  const cardEls = useRef(new Map<string, HTMLDivElement>());

  const press = (card: ReadyCard, which: "primary" | "secondary", from?: HTMLElement | null) => {
    const el = cardEls.current.get(card.key) ?? null;
    s.act(card, which, from ?? el?.querySelector<HTMLElement>(".k-offer-card-act") ?? el, el);
  };

  // Ready: say it once, then hand the rail back.
  useEffect(() => {
    if (!s.empty) return;
    const t = later(READY_HOLD_MS, onClose);
    return () => {
      if (t != null) window.clearTimeout(t);
    };
  }, [s.empty, onClose]);

  const keys = useRef({ s, press, onClose });
  keys.current = { s, press, onClose };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && (t.closest("input, textarea, [contenteditable=true], [data-nested-surface]") || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = keys.current;
      const eat = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.key === "Escape") return eat(), k.onClose();
      const f = k.s.focused;
      if (!f) return;
      // ↵ on a focused button belongs to that button.
      if (e.key === "Enter" && !(t && t.closest("button"))) return eat(), k.press(f, "primary");
      if (e.key === "Backspace" && f.secondary) return eat(), k.press(f, "secondary");
      if (e.key === "j" || e.key === "ArrowDown") return eat(), k.s.step(1);
      if (e.key === "k" || e.key === "ArrowUp") return eat(), k.s.step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      ref={railRef}
      data-ready-rail
      className="titlebar-pad relative z-40 flex h-full w-[340px] shrink-0 flex-col"
      style={{ borderRight: "1px solid var(--line-1)", ["--titlebar-pad-y" as string]: "0px" }}
    >
      <div className="flex h-12 shrink-0 items-center gap-1.5 pl-4 pr-2" style={{ boxShadow: "inset 0 -1px 0 var(--line-1)" }}>
        <span className="f-title min-w-0 flex-1 truncate">Get ready</span>
        {crown ?? <PinnedCrown />}
        <IconButton label="Back to your day" shortcut="Esc" icon={<Icon name="close" size={14} />} onClick={onClose} />
      </div>

      <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto px-4 pb-5 pt-4" role="list" aria-label="Get ready">
        {s.empty ? (
          <p className="f-title py-6 text-center" data-ready-done role="status">
            Ready.
          </p>
        ) : (
          s.visible.map((c) => (
            <div key={c.key} role="listitem">
              <OfferCard
                ref={(el) => {
                  if (el) cardEls.current.set(c.key, el);
                  else cardEls.current.delete(c.key);
                }}
                title={c.title}
                why={c.why}
                verb={c.primary.verb}
                name={c.primary.name}
                shortcut="↵"
                focused={s.focused?.key === c.key}
                leaving={s.lettingGo.has(c.key)}
                arriving={s.arriving.has(c.key)}
                onFocusCard={() => s.setFocusKey(c.key)}
                onPress={(el) => press(c, "primary", el)}
                onNotNow={c.secondary?.label === "Not now" ? () => press(c, "secondary") : undefined}
                secondary={c.secondary && c.secondary.label !== "Not now" ? { label: c.secondary.label, onPress: () => press(c, "secondary") } : undefined}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** The rail over the live models — what the Planner mounts in the ready mode.
 *  The composer runs only while this is mounted. */
export function LiveGetReadyRail({
  onClose,
  railRef,
  ...live
}: Parameters<typeof useReadyCards>[0] & {
  onClose: () => void;
  railRef?: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const cards = useReadyCards(live);
  return <GetReadyRail cards={cards} onClose={onClose} railRef={railRef} />;
}
