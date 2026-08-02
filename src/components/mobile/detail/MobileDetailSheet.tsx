// The single detail surface for the strategic vertical on mobile — a tall bottom
// Sheet that hosts the Domain / Initiative / Project screens with an internal
// breadcrumb push/pop stack. Both the Projects and Initiatives tabs and global
// search open THIS, so a tapped item behaves the same wherever it's reached.

import { useEffect, useState } from "react";
import { useVertical } from "../../../hooks/useVertical";
import Sheet from "../Sheet";
import {
  DomainScreen,
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
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  const atRoot = stack.length <= 1;

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
      onClose={onClose}
      contentClassName="mobile-scroll overflow-y-auto"
      onContentScroll={(e) => {
        const past = e.currentTarget.scrollTop > 52;
        setScrolled((v) => (v === past ? v : past));
      }}
    >
      <div className="pb-8">
        {frame.level === "domain" ? (
          <DomainScreen key={frame.id} d={d} store={store} id={frame.id} onOpenInitiative={openInitiative} onOpenProject={openProject} />
        ) : frame.level === "initiative" ? (
          <InitiativeScreen key={frame.id} d={d} store={store} id={frame.id} onOpenProject={openProject} />
        ) : frame.level === "project" ? (
          <ProjectScreen key={frame.id} d={d} store={store} id={frame.id} />
        ) : null}
      </div>
    </Sheet>
  );
}
