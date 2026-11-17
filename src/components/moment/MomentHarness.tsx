import { useMemo } from "react";
import { VerticalStoreProvider, type VerticalStore } from "../../hooks/useVertical";
import { playMoment, type Moment } from "../../lib/moments";
import { Button } from "../kit";
import { MomentStage } from "./MomentLayer";

// `?moments` — the top of the finish ladder over fixtures (D-237): the plates
// play through the same bus the app's watch uses, so what you see here is what
// a real ship plays. `&theme=dark` for the dark theme. The day's close is the
// rail's own (DayCrown) — check it at `?rail=offers`.

const WORK = "#5b6cf0";
const HEALTH = "#1f9d6b";
const WRITING = "#d14d7e";

const WEEK: Moment = {
  kind: "week",
  weekLabel: "Nov 16 – 22",
  before: 3,
  of: 4,
  pieces: [
    { key: "p1", label: "Onboarding v2", color: WORK, done: true, pct: 100 },
    { key: "p2", label: "Pricing page", color: WORK, done: true, pct: 100 },
    { key: "p3", label: "Half-marathon block 3", color: HEALTH, done: true, pct: 100 },
    { key: "p4", label: "Chapter 4", color: WRITING, done: true, pct: 70 },
  ],
};

const PROJECT: Moment = {
  kind: "project",
  id: "p1",
  name: "Onboarding v2",
  domain: { name: "Work", color: WORK },
  done: 11,
  of: 11,
  from: 0.82,
  fact: "started Oct 3 · 6 weeks",
};

const INITIATIVE: Moment = {
  kind: "initiative",
  id: "i1",
  name: "Launch the paid plan",
  domain: { name: "Work", color: WORK },
  pieces: [
    { key: "a", label: "Pricing page", color: WORK, done: true, pct: 100 },
    { key: "b", label: "Stripe billing", color: WORK, done: true, pct: 100 },
    { key: "c", label: "Onboarding v2", color: WORK, done: true, pct: 100 },
    { key: "d", label: "Trial emails", color: WORK, done: true, pct: 100 },
    { key: "e", label: "Launch post", color: WRITING, done: true, pct: 60 },
    { key: "f", label: "Referral codes", color: WORK, done: false, pct: 40 },
  ],
  fact: "started Aug 4 · 15 weeks",
};

export default function MomentHarness() {
  const theme = new URLSearchParams(window.location.search).get("theme");
  if (theme === "dark" || theme === "light") document.documentElement.setAttribute("data-theme", theme);
  const store = useMemo(
    () =>
      ({
        data: { domains: [], parkedDomains: [], initiatives: [], projects: [], tasks: [], sprint: null },
      }) as unknown as VerticalStore,
    [],
  );
  return (
    <VerticalStoreProvider value={store}>
      <div className="min-h-[100dvh] bg-[var(--ground)] p-4 sm:p-8">
        <div className="flex flex-wrap gap-2">
          <Button kind="secondary" onClick={() => playMoment(WEEK)}>
            Week landed
          </Button>
          <Button kind="secondary" onClick={() => playMoment(PROJECT)}>
            Project shipped
          </Button>
          <Button kind="secondary" onClick={() => playMoment(INITIATIVE)}>
            Initiative shipped
          </Button>
        </div>
      </div>
      <MomentStage />
    </VerticalStoreProvider>
  );
}
