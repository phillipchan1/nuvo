// The single detail surface for the strategic vertical on mobile — a tall bottom
// Sheet that hosts the Domain / Initiative / Project screens with an internal
// breadcrumb push/pop stack. Both the Projects and Initiatives tabs and global
// search open THIS, so a tapped item behaves the same wherever it's reached.

import { useEffect, useState } from "react";
import { useVertical } from "../../../hooks/useVertical";
import { useMobileSheetStackHistory } from "../../../hooks/useMobileOverlayHistory";
import Sheet from "../Sheet";
import {
  DomainScreen,
  InitiativeScreen,
  ProjectScreen,
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

  // Let the shell mirror the open frame into the agent's screen context.
  useEffect(() => {
    onFrameChange?.(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame.level, (frame as { id?: string }).id]);

  const openDomain = (id: string) => push({ level: "domain", id });
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

  const titleNode = (
    <div className="flex min-w-0 items-center gap-1">
      {!atRoot && (
        <button
          onClick={back}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Back"
          className="tap fast -ml-1 flex items-center rounded-lg px-1 text-lead text-muted active:bg-surface-2"
          style={{ cursor: "default" }}
        >
          ‹
        </button>
      )}
      <span className="min-w-0 flex-1 truncate">{title}</span>
    </div>
  );

  return (
    <Sheet tall title={titleNode} onClose={onClose} contentClassName="mobile-scroll overflow-y-auto">
      <div className="pb-8">
        {frame.level === "domain" ? (
          <DomainScreen key={frame.id} d={d} store={store} id={frame.id} onOpenInitiative={openInitiative} onOpenProject={openProject} />
        ) : frame.level === "initiative" ? (
          <InitiativeScreen key={frame.id} d={d} store={store} id={frame.id} onOpenProject={openProject} onOpenDomain={openDomain} />
        ) : frame.level === "project" ? (
          <ProjectScreen key={frame.id} d={d} store={store} id={frame.id} onOpenInitiative={openInitiative} onOpenDomain={openDomain} />
        ) : null}
      </div>
    </Sheet>
  );
}
