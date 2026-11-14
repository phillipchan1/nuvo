// The `/` door mounted on the desktop: reads the data, and turns a chosen
// result into navigation. Every open REPLACES the search's own history entry,
// so Back from what you opened returns to where you were — not to the search.

import { useVertical } from "../../hooks/useVertical";
import { useAllTasks } from "../../hooks/useTasks";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { revealOnCalendar } from "../../lib/calendarReveal";
import { eventHitDateISO } from "../../lib/eventSearch";
import SearchDoor, { type SearchTarget } from "./SearchDoor";

export default function DesktopSearch({ onClose }: { onClose: () => void }) {
  const { data: vertical } = useVertical();
  const { data: tasks = [] } = useAllTasks();
  const { navigate } = useAppNavigation();

  const onOpen = (t: SearchTarget) => {
    const lift = { overlayId: null, overlaySubId: null, floorModal: null } as const;
    switch (t.kind) {
      case "project":
      case "initiative":
        navigate({ ...lift, overlay: t.kind === "project" ? "project-record" : "initiative-record", overlayId: t.id }, "replace");
        return;
      case "task":
        navigate({ ...lift, overlay: "task-record", overlayId: t.id }, "replace");
        return;
      case "domain":
        // Rung and focus together — the rung's own front door would reset focus
        // to the wall (rungPatch), and this is a drill-in by name.
        navigate({ ...lift, overlay: "none", rung: "domain", focus: { domainId: t.id, initiativeId: "", projectId: "" } }, "replace");
        return;
      case "event":
        navigate({ ...lift, overlay: "none", rung: "day" }, "replace");
        revealOnCalendar({ dateISO: eventHitDateISO(t.hit), eventId: t.hit.id });
        return;
      case "date":
        navigate({ ...lift, overlay: "none", rung: "day" }, "replace");
        revealOnCalendar({ dateISO: t.dateISO, scrollToTime: "08:00:00" });
        return;
    }
  };

  return <SearchDoor vertical={vertical} tasks={tasks} onOpen={onOpen} onClose={onClose} />;
}
