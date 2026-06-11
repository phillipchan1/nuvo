// THROWAWAY verification harness — mounts the vertical floors in isolation
// (no auth, no Planner/Supabase). Delete this file and verify.html after use.

import { useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import {
  initiativeById,
  initiativesOf,
  projectById,
  projectsOf,
} from "./lib/vertical";
import { VerticalProvider, useVertical } from "./hooks/useVertical";
import FloorPane, { type DetailView, type ProjectView } from "./components/FloorPane";
import type { Focus, Rung } from "./components/AppShell";

function Harness() {
  const { data } = useVertical();
  const [rung, setRung] = useState<Rung>("project");
  const [projectView, setProjectView] = useState<ProjectView>("portfolio");
  const [initiativeView, setInitiativeView] = useState<DetailView>("portfolio");
  const [focus, setFocus] = useState<Focus>(() => {
    const dom = [...data.domains].sort((a, b) => a.sort - b.sort)[0];
    const init = dom ? initiativesOf(data, dom.id)[0] : undefined;
    const proj = init ? projectsOf(data, init.id)[0] : undefined;
    return { domainId: dom?.id ?? "", initiativeId: init?.id ?? "", projectId: proj?.id ?? "" };
  });

  const goRung = (r: Rung) => {
    if (r === "project") setProjectView("portfolio");
    if (r === "initiative") setInitiativeView("portfolio");
    setRung(r);
  };
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
    setFocus({ domainId: proj?.domainId ?? focus.domainId, initiativeId: proj?.initiativeId ?? focus.initiativeId, projectId: id });
    setProjectView("detail");
  };
  const openInitiative = (id: string) => { focusInitiative(id); setRung("initiative"); };
  const openProject = (id: string) => { focusProject(id); setRung("project"); };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-2 border-b border-line bg-surface px-3 py-2">
        {(["now", "project", "initiative", "domain"] as Rung[]).map((r) => (
          <button key={r} onClick={() => goRung(r)}
            className="mono rounded border border-line px-2 py-1 text-[11px]"
            style={{ background: r === rung ? "var(--accent)" : "transparent", color: r === rung ? "#fff" : "var(--muted)" }}>
            {r}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
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
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <VerticalProvider>
    <Harness />
  </VerticalProvider>,
);
