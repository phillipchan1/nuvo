import { useEffect, useState } from "react";
import {
  initiativeById,
  initiativesOf,
  projectById,
  projectsOf,
} from "../lib/vertical";
import { VerticalProvider, useVertical } from "../hooks/useVertical";
import { parseDateISO, planningWeekStartISO, todayISO } from "../lib/dates";
import Planner from "./Planner";
import Spine from "./Spine";
import FloorPane, { type DetailView, type ProjectView } from "./FloorPane";
import SundayRitual from "./rituals/SundayRitual";

export type Rung = "now" | "day" | "project" | "initiative" | "domain";
export interface Focus {
  domainId: string;
  initiativeId: string;
  projectId: string;
}

// Top-to-bottom on the spine: ⌘1 = Now … ⌘5 = Domain. ⌘↓ widens, ⌘↑ narrows.
export const LADDER: Rung[] = ["now", "day", "project", "initiative", "domain"];

export default function AppShell() {
  return (
    <VerticalProvider>
      <AppShellInner />
    </VerticalProvider>
  );
}

function AppShellInner() {
  const { data, ready } = useVertical();
  const [rung, setRung] = useState<Rung>("day");
  // The Project / Initiative rungs open on a high-level board; drilling into a
  // single record sets "detail".
  const [projectView, setProjectView] = useState<ProjectView>("portfolio");
  const [initiativeView, setInitiativeView] = useState<DetailView>("portfolio");
  const [focus, setFocus] = useState<Focus>({ domainId: "", initiativeId: "", projectId: "" });
  const [sundayOpen, setSundayOpen] = useState(false);
  const [sundayNudge, setSundayNudge] = useState(false);

  // Entering a board rung from the spine/keyboard lands on the board, not a
  // stale drill-down.
  const goRung = (r: Rung) => {
    if (r === "project") setProjectView("portfolio");
    if (r === "initiative") setInitiativeView("portfolio");
    setRung(r);
  };

  // Keep the branch coherent as focus changes at any altitude.
  const focusDomain = (id: string) => {
    const init = initiativesOf(data, id)[0];
    const proj = init ? projectsOf(data, init.id)[0] : null;
    setFocus({ domainId: id, initiativeId: init?.id ?? "", projectId: proj?.id ?? "" });
  };
  const focusInitiative = (id: string) => {
    const init = initiativeById(data, id);
    const proj = projectsOf(data, id)[0];
    setFocus({ domainId: init?.domainId ?? focus.domainId, initiativeId: id, projectId: proj?.id ?? "" });
    setInitiativeView("detail");
  };
  const focusProject = (id: string) => {
    const proj = projectById(data, id);
    setFocus({
      domainId: proj?.domainId ?? focus.domainId,
      initiativeId: proj?.initiativeId ?? focus.initiativeId,
      projectId: id,
    });
    setProjectView("detail");
  };

  // Live data arrives async: seed the focus branch once domains land.
  useEffect(() => {
    if (!ready || focus.domainId) return;
    const dom = [...data.domains].sort((a, b) => a.sort - b.sort)[0];
    if (dom) focusDomain(dom.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, data.domains.length]);

  // Sunday nudge: around the turn of the week, if this week's sprint hasn't
  // been reviewed, offer the ritual once (dismissable per week).
  useEffect(() => {
    if (!ready) return;
    const dow = parseDateISO(todayISO()).getDay(); // app-TZ weekday; 0 = Sunday, 1 = Monday
    const key = `nuvo-sunday-${planningWeekStartISO()}`;
    if ((dow === 0 || dow === 1) && !data.sprint?.reviewed_at && !localStorage.getItem(key)) {
      setSundayNudge(true);
    }
  }, [ready, data.sprint?.reviewed_at]);

  const dismissSundayNudge = () => {
    localStorage.setItem(`nuvo-sunday-${planningWeekStartISO()}`, "1");
    setSundayNudge(false);
  };

  // Cross-floor drill-ins: set the focus, the rung, and the detail view together
  // (without the board reset that goRung applies).
  const openInitiative = (id: string) => { focusInitiative(id); setRung("initiative"); };
  const openProject = (id: string) => { focusProject(id); setRung("project"); };

  // ⌘1–5 jump to a rung; ⌘↑ / ⌘↓ travel the ladder.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      if (!(e.metaKey || e.ctrlKey)) return;

      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        setRung((r) => {
          const i = LADDER.indexOf(r);
          const next = e.key === "ArrowDown" ? Math.min(LADDER.length - 1, i + 1) : Math.max(0, i - 1);
          const target = LADDER[next];
          if (target === "project") setProjectView("portfolio");
          if (target === "initiative") setInitiativeView("portfolio");
          return target;
        });
        return;
      }

      const num = Number(e.key);
      if (num >= 1 && num <= LADDER.length) {
        e.preventDefault();
        const target = LADDER[num - 1];
        if (target === "project") setProjectView("portfolio");
        if (target === "initiative") setInitiativeView("portfolio");
        setRung(target);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full bg-bg">
      <Spine rung={rung} setRung={goRung} onBegin={() => setSundayOpen(true)} />
      <div className="relative min-w-0 flex-1">
        {/* Day · Week stays mounted so the calendar never loses its place. */}
        <Planner openSunday={() => setSundayOpen(true)} />
        {rung !== "day" && (
          <div className="absolute inset-0 z-30 bg-bg">
            <FloorPane
              rung={rung}
              focus={focus}
              focusDomain={focusDomain}
              openInitiative={openInitiative}
              openProject={openProject}
              goRung={goRung}
              projectView={projectView}
              setProjectView={setProjectView}
              initiativeView={initiativeView}
              setInitiativeView={setInitiativeView}
            />
          </div>
        )}

        {/* the weekly nudge — quiet, dismissable, once per week */}
        {sundayNudge && !sundayOpen && (
          <div className="absolute bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-line bg-surface px-4 py-2 shadow-lg">
            <span className="text-[12px]">A new week is here — plan it?</span>
            <button
              onClick={() => { setSundayOpen(true); setSundayNudge(false); }}
              className="fast rounded-full bg-accent px-3 py-1 text-[11px] font-medium text-white"
            >
              Sunday ritual ▸
            </button>
            <button onClick={dismissSundayNudge} className="fast text-[11px] text-muted hover:text-ink">
              not now
            </button>
          </div>
        )}
      </div>

      {sundayOpen && <SundayRitual onClose={() => { setSundayOpen(false); setSundayNudge(false); }} />}
    </div>
  );
}
