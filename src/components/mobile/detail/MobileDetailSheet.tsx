// The single detail surface for the strategic vertical on mobile — a tall bottom
// Sheet that hosts the Domain / Initiative / Project screens with an internal
// breadcrumb push/pop stack. Both the Projects and Initiatives tabs and global
// search open THIS, so a tapped item behaves the same wherever it's reached.

import { useEffect, useRef, useState } from "react";
import { releaseVelocity, type VelocitySample } from "../../../lib/gesture";
import { haptic } from "../../../lib/haptics";
import { useVertical } from "../../../hooks/useVertical";
import { useMobileSheetStackHistory } from "../../../hooks/useMobileOverlayHistory";
import Sheet from "../Sheet";
import { useRecordActions } from "../MobileRecordActions";
import MobileDomainScreen from "./MobileDomainScreen";
import {
  InitiativeScreen,
  ProjectScreen,
  RecordCrumbs,
  frameFor,
  type DetailTarget,
  type Frame,
} from "./verticalDetail";

export default function MobileDetailSheet({
  target,
  onClose,
  onFrameChange,
}: {
  target: DetailTarget;
  onClose: () => void;
  onFrameChange?: (f: Frame) => void;
}) {
  const store = useVertical();
  const d = store.data;

  const [stack, setStack] = useState<Frame[]>(() => [frameFor(target)]);
  // A fresh jump (new item, or the same id re-fired via the nonce) resets the stack.
  useEffect(() => {
    setStack([frameFor(target)]);
  }, [target.n]);

  const frame = stack[stack.length - 1];
  const push = (f: Frame) => setStack((s) => [...s, f]);
  const atRoot = stack.length <= 1;

  // History-backed breadcrumbs: the sheet holds a base entry plus one per
  // pushed frame, so hardware back pops one frame at a time before closing the
  // sheet itself. Frame pops flow history → state, so the ‹ button just walks
  // history and popstate does the slicing.
  useMobileSheetStackHistory(
    stack.length - 1,
    (d) => setStack((s) => (s.length > d + 1 ? s.slice(0, d + 1) : s)),
    onClose,
    "detail",
  );
  const back = () => {
    if (!atRoot) history.back();
  };

  // Push slides in from the right, pop from the left — a navigation stack, not
  // a swap. Direction is read from the depth change.
  const depth = stack.length;
  // Kept in a ref (set only when the depth actually changes) so an unrelated
  // re-render mid-animation doesn't strip the class and snap the frame.
  const prevDepth = useRef(depth);
  const enterRef = useRef<"push" | "pop" | null>(null);
  if (depth !== prevDepth.current) {
    enterRef.current = depth > prevDepth.current ? "push" : "pop";
    prevDepth.current = depth;
  }
  const enter = enterRef.current;

  // ── Edge-swipe back (UINavigationController's interactive pop) ───────────
  // From the left 24px of a pushed frame, a horizontal drag pulls the frame
  // right; let go past a third of the width — or flick — and it pops (through
  // history, exactly like ‹). The root frame has nothing to pop to, so the
  // gesture never engages there.
  const pane = useRef<HTMLDivElement>(null);
  const edge = useRef<{ x: number; y: number; id: number; engaged: boolean; samples: VelocitySample[] } | null>(null);
  const setPaneX = (x: number, animate: boolean) => {
    const el = pane.current;
    if (!el) return;
    el.style.transition = animate ? "transform var(--d-native) var(--ease-native), opacity var(--d-native) var(--ease-native)" : "none";
    el.style.transform = x ? `translateX(${x}px)` : "";
    el.style.opacity = x ? String(Math.max(0.4, 1 - x / (el.offsetWidth * 1.4))) : "";
  };
  const edgeHandlers = atRoot
    ? {}
    : {
        onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
          if (e.pointerType === "mouse" || e.clientX > 24) return;
          edge.current = { x: e.clientX, y: e.clientY, id: e.pointerId, engaged: false, samples: [{ y: e.clientX, t: e.timeStamp }] };
        },
        onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
          const g = edge.current;
          if (!g) return;
          const dx = e.clientX - g.x;
          const dy = e.clientY - g.y;
          if (!g.engaged) {
            if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { edge.current = null; return; }
            if (dx < 10 || dx < 1.5 * Math.abs(dy)) return;
            g.engaged = true;
            e.currentTarget.setPointerCapture(g.id);
          }
          e.stopPropagation();
          g.samples.push({ y: e.clientX, t: e.timeStamp });
          if (g.samples.length > 6) g.samples.shift();
          setPaneX(Math.max(0, dx), false);
        },
        onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
          const g = edge.current;
          edge.current = null;
          if (!g?.engaged) return;
          const dx = Math.max(0, e.clientX - g.x);
          const w = pane.current?.offsetWidth ?? 375;
          const v = releaseVelocity(g.samples);
          if (dx > w / 3 || (v > 0.5 && dx > 30)) {
            haptic("light");
            setPaneX(w, true);
            window.setTimeout(() => {
              setPaneX(0, false);
              back();
            }, 200);
          } else {
            setPaneX(0, true);
          }
        },
        onPointerCancel: () => {
          edge.current = null;
          setPaneX(0, true);
        },
      };

  // Let the shell mirror the open frame into the agent's screen context.
  useEffect(() => {
    onFrameChange?.(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame.level, (frame as { id?: string }).id]);

  // No openDomain: the record head's DomainPicker *changes* the area rather than
  // linking to it, which is the desktop record's arrangement. A domain screen is
  // still pushed onto this stack from global search.
  const openInitiative = (id: string) => push({ level: "initiative", id });
  const openProject = (id: string) => push({ level: "project", id });

  // The record's lifecycle acts (ship · park · delete) — the desktop reaches
  // them by right-clicking the card, the phone by the ⋯ in this row. Without it
  // a project or initiative could not be deleted on a phone at all. Deleting the
  // record you're looking at closes the sheet with it; "Open" is a no-op here
  // (you are already in it), so the menu is opened by button only.
  const { openActions, sheet: actionSheet } = useRecordActions(() => {});
  const recordFrame = frame.level === "project" || frame.level === "initiative" ? frame : null;
  const gone =
    recordFrame &&
    !(recordFrame.level === "project"
      ? d.projects.some((p) => p.id === recordFrame.id)
      : d.initiatives.some((i) => i.id === recordFrame.id));
  useEffect(() => {
    if (!gone) return;
    // Deleted out from under us: fall back to the parent frame if there is one,
    // otherwise leave — never sit on a "this project is gone" screen.
    if (atRoot) onClose();
    else history.back();
  }, [gone, atRoot, onClose]);

  const title =
    frame.level === "domain"
      ? d.domains.find((x) => x.id === frame.id)?.name ?? "Domain"
      : frame.level === "initiative"
        ? d.initiatives.find((x) => x.id === frame.id)?.name ?? "Initiative"
        : frame.level === "project"
          ? d.projects.find((x) => x.id === frame.id)?.name ?? "Project"
          : "";

  // The record's name is the HERO inside the sheet (RecordHead), so printing it
  // in the title row too was the same words twice, eating the top of a phone
  // screen. Instead the row stays empty until the hero scrolls away and then
  // takes the name over — iOS's large-title collapse. The row itself never
  // moves: it owns Back, ✕, and the drag-to-dismiss handle.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => setScrolled(false), [frame.level, (frame as { id?: string }).id]);

  const titleNode = (
    <div className="flex min-w-0 items-center gap-1">
      {!atRoot && (
        <button
          onClick={back}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Back"
          className="tap-icon fast -ml-1 flex items-center justify-center rounded-lg px-1 text-lead text-muted active:bg-surface-2"
          style={{ cursor: "default" }}
        >
          ‹
        </button>
      )}
      {/* one row, two states, cross-faded in place: where this record lives
          (and the control that moves it) at rest, its name once you've scrolled
          past the hero. The controls opt out of the sheet's drag-to-dismiss —
          the grab pill above still owns that. */}
      <div className="relative min-w-0 flex-1" style={{ minHeight: 44 }}>
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="fast absolute inset-0 flex items-center gap-1.5"
          style={{ opacity: scrolled ? 0 : 1, pointerEvents: scrolled ? "none" : undefined }}
          aria-hidden={scrolled}
        >
          <RecordCrumbs d={d} store={store} frame={frame} onOpenInitiative={openInitiative} />
        </div>
        <span
          className="fast pointer-events-none absolute inset-0 flex items-center truncate"
          style={{ opacity: scrolled ? 1 : 0 }}
          aria-hidden={!scrolled}
        >
          {title}
        </span>
      </div>
    </div>
  );

  return (
    <Sheet
      tall
      title={titleNode}
      action={
        recordFrame && (
          <button
            onClick={() => openActions(recordFrame.level, recordFrame.id)}
            aria-label={`Actions for this ${recordFrame.level}`}
            className="tap-icon fast flex h-8 w-8 items-center justify-center rounded-full text-lead text-muted active:bg-surface-2"
            style={{ cursor: "default" }}
          >
            ⋯
          </button>
        )
      }
      onClose={onClose}
      contentClassName="mobile-scroll overflow-y-auto"
      onContentScroll={(e) => {
        const past = e.currentTarget.scrollTop > 52;
        setScrolled((v) => (v === past ? v : past));
      }}
    >
      <div
        ref={pane}
        key={`${frame.level}:${(frame as { id?: string }).id ?? ""}`}
        className={`pb-8 ${enter === "push" ? "nav-push-in" : enter === "pop" ? "nav-pop-in" : ""}`}
        style={atRoot ? undefined : { touchAction: "pan-y" }}
        {...edgeHandlers}
      >
        {frame.level === "domain" ? (
          <MobileDomainScreen key={frame.id} d={d} store={store} id={frame.id} onOpenInitiative={openInitiative} onOpenProject={openProject} onClose={onClose} />
        ) : frame.level === "initiative" ? (
          <InitiativeScreen key={frame.id} d={d} store={store} id={frame.id} onOpenProject={openProject} />
        ) : frame.level === "project" ? (
          <ProjectScreen key={frame.id} d={d} store={store} id={frame.id} />
        ) : null}
      </div>
      {actionSheet}
    </Sheet>
  );
}
