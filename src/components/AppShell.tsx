import { useEffect, useState } from "react";
import {
  SEED,
  initiativeById,
  initiativesOf,
  projectById,
  projectsOf,
} from "../lib/vertical";
import Planner from "./Planner";
import Spine from "./Spine";
import FloorPane from "./FloorPane";

export type Rung = "now" | "day" | "project" | "initiative" | "domain";
export interface Focus {
  domainId: string;
  initiativeId: string;
  projectId: string;
}

// Bottom-to-top order, so ⌘↑ widens the lens and ⌘↓ narrows it.
const LADDER: Rung[] = ["now", "day", "project", "initiative", "domain"];
const DEFAULT_FOCUS: Focus = { domainId: "d_family", initiativeId: "i_fin", projectId: "p_q3recon" };

export default function AppShell() {
  const [rung, setRung] = useState<Rung>("day");
  const [focus, setFocus] = useState<Focus>(DEFAULT_FOCUS);

  // Keep the branch coherent as focus changes at any altitude.
  const focusDomain = (id: string) => {
    const init = initiativesOf(SEED, id)[0];
    const proj = init ? projectsOf(SEED, init.id)[0] : null;
    setFocus({ domainId: id, initiativeId: init?.id ?? "", projectId: proj?.id ?? "" });
  };
  const focusInitiative = (id: string) => {
    const init = initiativeById(SEED, id);
    const proj = projectsOf(SEED, id)[0];
    setFocus({ domainId: init?.domainId ?? focus.domainId, initiativeId: id, projectId: proj?.id ?? "" });
  };
  const focusProject = (id: string) => {
    const proj = projectById(SEED, id);
    setFocus({
      domainId: proj?.domainId ?? focus.domainId,
      initiativeId: proj?.initiativeId ?? focus.initiativeId,
      projectId: id,
    });
  };

  // ⌘↑ / ⌘↓ travel the ladder.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      setRung((r) => {
        const i = LADDER.indexOf(r);
        const next = e.key === "ArrowUp" ? Math.min(LADDER.length - 1, i + 1) : Math.max(0, i - 1);
        return LADDER[next];
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full bg-bg">
      <Spine rung={rung} setRung={setRung} />
      <div className="relative min-w-0 flex-1">
        {/* Day · Week stays mounted so the calendar never loses its place. */}
        <Planner />
        {rung !== "day" && (
          <div className="absolute inset-0 z-30 bg-bg">
            <FloorPane
              rung={rung}
              focus={focus}
              focusDomain={focusDomain}
              focusInitiative={focusInitiative}
              focusProject={focusProject}
              goRung={setRung}
            />
          </div>
        )}
      </div>
    </div>
  );
}
