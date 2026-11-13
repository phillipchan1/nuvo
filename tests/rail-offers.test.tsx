// @vitest-environment jsdom
/**
 * Nuvo's offers on the rows they change (D-205, docs/rail-modes.md §3).
 *
 * The panel retired; its offers moved onto the left, one chip per row, under
 * a budget the operator set ("left has to be elegant and balance all that is
 * going on"): three in the desktop rail, two per phone screen, ranked crown →
 * today → inbox, nothing past that, and nothing while Plan or Repair owns the
 * rail. These guard the budget, each chip's trigger and act, and the panel's
 * absence.
 */
import { readFileSync, existsSync } from "node:fs";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PHONE_OFFERS_MAX,
  RAIL_OFFERS_MAX,
  SNOOZE_DAYS,
  budgetOffers,
  isSnoozed,
  offerKey,
  type RailOfferCandidate,
} from "../src/lib/railOffers";
import { onPathDraftRequest, requestPathDraft, takePathDraft } from "../src/lib/draftIntent";
import { FileOffer, HoldOffer, fileGuess, holdSpan, useOfferBudget } from "../src/components/nuvo/RailOffers";
import { useTodayHolds } from "../src/hooks/useFindTime";
import WeekPanel from "../src/components/WeekPanel";
import MobileTaskList from "../src/components/mobile/MobileTaskList";
import TaskRow from "../src/components/TaskRow";
import { VerticalStoreProvider, type VerticalStore } from "../src/hooks/useVertical";
import { AppNavigationProvider } from "../src/hooks/useAppNavigation";
import { OFFERS_NOW, OFFERS_TODAY, OFFERS_VERTICAL, offersClient, offersInbox, offersToday } from "../src/components/nuvo/OffersFixture";
import type { Placement } from "../src/lib/compose";
import type { Task } from "../src/lib/types";

const c = (kind: RailOfferCandidate["kind"], id: string, order: number): RailOfferCandidate => ({
  key: offerKey(kind, id),
  kind,
  rowId: id,
  order,
});
const NOW = Date.parse("2026-11-13T12:00:00Z");

/** jsdom here has no usable localStorage; the chips' per-device memory needs one. */
function memStore(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}
vi.stubGlobal("localStorage", memStore());

describe("the rail's offer budget (budgetOffers)", () => {
  it("ranks crown → today → inbox, each in its own order", () => {
    const out = budgetOffers([c("file", "f1", 0), c("hold", "h2", 600), c("path", "p1", 1), c("hold", "h1", 540), c("path", "p0", 0)], {
      max: 10,
      now: NOW,
    });
    expect(out.map((o) => o.rowId)).toEqual(["p0", "p1", "h1", "h2", "f1"]);
  });

  it("caps at three in the rail and two on a phone screen, and shows nothing past the cap", () => {
    const many = [c("path", "p1", 0), c("hold", "h1", 0), c("hold", "h2", 1), c("file", "f1", 0), c("file", "f2", 1)];
    expect(budgetOffers(many, { now: NOW }).map((o) => o.rowId)).toEqual(["p1", "h1", "h2"]);
    expect(RAIL_OFFERS_MAX).toBe(3);
    expect(budgetOffers(many, { max: PHONE_OFFERS_MAX, now: NOW }).map((o) => o.rowId)).toEqual(["p1", "h1"]);
    // what's past the cap is not counted anywhere — the result IS what shows
    expect(budgetOffers(many, { now: NOW })).toHaveLength(3);
  });

  it("gives a row one chip at most", () => {
    const out = budgetOffers([c("hold", "t1", 0), { ...c("file", "t1", 0) }], { now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("hold");
  });

  it("offers nothing while Plan or Repair owns the rail", () => {
    const some = [c("path", "p1", 0), c("hold", "h1", 0)];
    expect(budgetOffers(some, { mode: "plan", now: NOW })).toEqual([]);
    expect(budgetOffers(some, { mode: "repair", now: NOW })).toEqual([]);
    expect(budgetOffers(some, { mode: "rest", now: NOW })).toHaveLength(2);
  });

  it("an empty account offers nothing (P7)", () => {
    expect(budgetOffers([], { now: NOW })).toEqual([]);
  });

  it("Not now holds an offer off for two weeks, and the next one takes its place", () => {
    const at = new Date(NOW).toISOString();
    expect(isSnoozed("path:a", { "path:a": at }, NOW + 1000)).toBe(true);
    expect(isSnoozed("path:a", { "path:a": at }, NOW + SNOOZE_DAYS * 86_400_000 + 1)).toBe(false);
    const out = budgetOffers([c("path", "a", 0), c("hold", "h1", 0), c("hold", "h2", 1), c("file", "f1", 0)], {
      snoozed: { "path:a": at },
      now: NOW,
    });
    expect(out.map((o) => o.rowId)).toEqual(["h1", "h2", "f1"]);
  });

  it("Plan and Repair replace the rail, so no rest chip can ride them", () => {
    // The rail at rest is LeftRail; a mode swaps it out (Planner). Neither mode's
    // rail imports the chips.
    for (const f of ["src/components/plan/PlanRail.tsx", "src/components/plan/RepairRail.tsx", "src/components/plan/PinnedCrown.tsx"]) {
      if (!existsSync(f)) continue;
      expect(readFileSync(f, "utf8")).not.toMatch(/RailOffers|OfferChip/);
    }
    const planner = readFileSync("src/components/Planner.tsx", "utf8");
    expect(planner).toMatch(/planning \? \([\s\S]*PlanRail[\s\S]*repairing \? \([\s\S]*RepairRail[\s\S]*<LeftRail/);
  });
});

describe("a draft asked for while its list is on screen", () => {
  it("reaches a list that's already mounted", () => {
    const heard: string[] = [];
    const off = onPathDraftRequest((id) => heard.push(id));
    requestPathDraft("p1");
    off();
    requestPathDraft("p2");
    expect(heard).toEqual(["p1"]);
    expect(takePathDraft("p2")).toBe(true);
  });
});

// ── the crown's rows ────────────────────────────────────────────────────────

const store = { data: OFFERS_VERTICAL, ready: true, togglePushLanded: () => {} } as unknown as VerticalStore;

function Crown() {
  const [cands, setCands] = useState<RailOfferCandidate[]>([]);
  const offers = useOfferBudget(cands, RAIL_OFFERS_MAX);
  return (
    <WeekPanel
      renderTask={(t) => <TaskRow key={t.id} task={t} labels={[]} selected={false} onSelect={() => {}} onOpen={() => {}} onToggleDone={() => {}} />}
      offers={offers}
      onPathCandidates={setCands}
    />
  );
}

function mountCrown() {
  return render(
    <QueryClientProvider client={offersClient(offersToday())}>
      <VerticalStoreProvider value={store}>
        <AppNavigationProvider>
          <Crown />
        </AppNavigationProvider>
      </VerticalStoreProvider>
    </QueryClientProvider>,
  );
}

const rowOf = (name: string) => screen.getByText(name).closest("[data-crown-project]") as HTMLElement;

describe("Draft the path on the week crown's project row", () => {
  beforeEach(() => localStorage.clear());

  it("rides a thin project's row, and not a shaped one's", async () => {
    mountCrown();
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Draft the path/ })).toHaveLength(2));
    expect(rowOf("Launch pricing page").querySelector(".k-offer")).not.toBeNull();
    expect(rowOf("Garage studio").querySelector(".k-offer")).not.toBeNull();
    expect(rowOf("Quarterly taxes").querySelector(".k-offer")).toBeNull();
    // It names its evidence, and it takes the weight's place (no second mark).
    const chip = rowOf("Launch pricing page").querySelector(".k-offer") as HTMLElement;
    expect(chip.getAttribute("title")).toMatch(/3h held · 20m of work/);
    expect(rowOf("Launch pricing page").querySelector(".crown-proj-top .crown-meta")).toBeNull();
  });

  it("starts the draft through the path the panel's offer took", async () => {
    mountCrown();
    const heard: string[] = [];
    const off = onPathDraftRequest((id) => heard.push(id));
    const chip = await waitFor(() => rowOf("Launch pricing page").querySelector(".k-offer") as HTMLElement);
    fireEvent.click(chip);
    off();
    expect(heard).toEqual(["p1"]);
  });

  it("Not now (⌫ on the chip) hides it for two weeks", async () => {
    mountCrown();
    const chip = await waitFor(() => rowOf("Garage studio").querySelector(".k-offer") as HTMLElement);
    act(() => {
      fireEvent.keyDown(chip, { key: "Backspace" });
    });
    await waitFor(() => expect(rowOf("Garage studio").querySelector(".k-offer")).toBeNull());
    expect(JSON.parse(localStorage.getItem("nuvo.offers.snoozed") ?? "{}")).toHaveProperty("path:p2");
  });

  it("the shut crown carries no chip", async () => {
    localStorage.setItem("nuvo-rail-week-open", "0");
    mountCrown();
    await waitFor(() => expect(screen.getByText("Projects")).toBeTruthy());
    expect(document.querySelector(".k-offer")).toBeNull();
  });
});

// ── Hold <time> ─────────────────────────────────────────────────────────────

const stubMutations = () => {
  const calls: Record<string, unknown[][]> = {};
  const m = new Proxy(
    {},
    {
      get: (_t, key: string) => (...a: unknown[]) => {
        (calls[key] ??= []).push(a);
      },
    },
  );
  return { m: m as never, calls };
};

describe("Hold <time> on a today task with no time", () => {
  afterEach(() => vi.useRealTimers());

  it("says the time in the clock vocabulary and holds it through the calendar's own block", () => {
    const t = offersToday()[0];
    const p: Placement = { task: t, dayISO: OFFERS_TODAY, startMin: 14 * 60, durationMin: 30, reason: "" };
    expect(holdSpan(p)).toBe("2–2:30pm");
    const { m, calls } = stubMutations();
    render(<HoldOffer task={t} placement={p} mutations={m} />);
    const chip = screen.getByRole("button", { name: /^Hold 2–2:30pm/ });
    fireEvent.click(chip);
    expect(calls.block).toHaveLength(1);
    const [task, start, mins, opts] = calls.block[0] as [Task, Date, number, { undo: string }];
    expect(task.id).toBe(t.id);
    expect(start.getHours()).toBe(14);
    expect(start.getMinutes()).toBe(0);
    expect(mins).toBe(30);
    expect(opts.undo).toBe("toast");
  });

  it("Find time answers for today only, and only for what fits", async () => {
    const qc = offersClient(offersToday());
    const loose = offersToday().filter((t) => !t.start_time && t.status !== "done");
    const { result } = renderHook(() => useTodayHolds(loose, OFFERS_NOW), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.size).toBeGreaterThan(0));
    for (const p of result.current.values()) {
      expect(p.dayISO).toBe(OFFERS_TODAY);
      expect(p.startMin).toBeGreaterThanOrEqual(10 * 60 + 15);
    }
    // the 11am block and the 1–4pm sitting are busy: nothing lands on them
    for (const p of result.current.values()) {
      const end = p.startMin + p.durationMin;
      expect(end <= 11 * 60 || p.startMin >= 12 * 60).toBe(true);
      expect(end <= 13 * 60 || p.startMin >= 16 * 60).toBe(true);
    }
  });
});

describe("Hold <time> on the phone's Today", () => {
  it("rides at most two no-time rows, and never a row on the clock", async () => {
    const { m } = stubMutations();
    const today = offersToday();
    render(
      <QueryClientProvider client={offersClient(today)}>
        <MobileTaskList
          tab="today"
          inbox={[]}
          today={today}
          week={[]}
          trashed={[]}
          labels={[]}
          vertical={OFFERS_VERTICAL as never}
          mutations={m}
          now={OFFERS_NOW}
          onTapTask={() => {}}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Hold / }).length).toBeGreaterThan(0));
    const chips = screen.getAllByRole("button", { name: /^Hold / });
    expect(chips.length).toBeLessThanOrEqual(PHONE_OFFERS_MAX);
    for (const chip of chips) {
      const row = chip.closest(".task-row");
      const title = row?.querySelector(".task-row-title")?.textContent ?? "";
      expect(today.find((t) => t.title === title)?.start_time ?? null).toBeNull();
      // the chip takes the meta's place: no clock / length beside it
      expect(row?.querySelector(".task-row-meta")).toBeNull();
    }
  });
});

// ── File in <project> ───────────────────────────────────────────────────────

describe("File in <project> on an inbox capture", () => {
  it("appears only when the router left a guess on the row", () => {
    const [withGuess, , without] = offersInbox();
    expect(fileGuess(withGuess)?.name).toBe("Garage studio");
    expect(fileGuess(without)).toBeNull();
    const { m } = stubMutations();
    const { container } = render(<FileOffer task={without} mutations={m} homeOfProject={() => null} />);
    expect(container.querySelector(".k-offer")).toBeNull();
  });

  it("files it on the guess, out of triage, with an undo — and grades the guess", () => {
    const [t] = offersInbox();
    const { m, calls } = stubMutations();
    render(<FileOffer task={t} mutations={m} homeOfProject={() => ({ initiativeId: "i9", domainId: "d2" })} />);
    fireEvent.click(screen.getByRole("button", { name: /^File in Garage studio/ }));
    const [id, patch, opts] = calls.patchTask[0] as [string, Partial<Task>, { undo: string; before: Partial<Task> }];
    expect(id).toBe(t.id);
    expect(patch).toMatchObject({ project_id: "p2", initiative_id: "i9", domain_id: "d2", status: "backlog" });
    expect(patch.suggestion).toMatchObject({ dismissed: true, outcome: "accepted" });
    expect(opts.undo).toBe("toast");
    expect(opts.before).toMatchObject({ status: "inbox", project_id: null });
  });

  it("the phone's inbox shows two at most, never on the row without a guess", () => {
    localStorage.clear();
    const { m } = stubMutations();
    const inbox = offersInbox();
    render(
      <QueryClientProvider client={offersClient(offersToday())}>
        <MobileTaskList
          tab="inbox"
          inbox={inbox}
          today={[]}
          week={[]}
          trashed={[]}
          labels={[]}
          vertical={OFFERS_VERTICAL as never}
          mutations={m}
          now={OFFERS_NOW}
          onTapTask={() => {}}
        />
      </QueryClientProvider>,
    );
    const chips = screen.getAllByRole("button", { name: /^File in / });
    expect(chips).toHaveLength(PHONE_OFFERS_MAX);
    // top first
    expect(chips[0].getAttribute("aria-label")).toMatch(/^File in Garage studio/);
    expect(chips[1].getAttribute("aria-label")).toMatch(/^File in Quarterly taxes/);
    expect(screen.getByText("Something about the dentist").closest(".task-row")?.querySelector(".k-offer") ?? null).toBeNull();
    // and the old Accept / ✕ pair is gone from every row
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });
});

// ── the panel is gone ───────────────────────────────────────────────────────

describe("the Nuvo panel retired (D-205)", () => {
  it("AppShell mounts no AgentSidebar and binds no ⌘J", () => {
    const shell = readFileSync("src/components/AppShell.tsx", "utf8");
    expect(shell).not.toMatch(/AgentSidebar|app-chat-slot|toggleAgent/);
    expect(shell).not.toMatch(/toLowerCase\(\) !== "j"/);
    expect(existsSync("src/components/AgentSidebar.tsx")).toBe(false);
    expect(existsSync("src/components/nuvo/NuvoOffers.tsx")).toBe(false);
  });

  it("the navigation carries no panel state", () => {
    const nav = readFileSync("src/lib/appNav.ts", "utf8");
    expect(nav).not.toMatch(/agentOpen/);
  });

  it("the phone's ✦ sheet is Memory and Connect, with no offers", () => {
    const sheet = readFileSync("src/components/mobile/NuvoSheet.tsx", "utf8");
    expect(sheet).toMatch(/Memory/);
    expect(sheet).toMatch(/NuvoConnect/);
    expect(sheet).not.toMatch(/NuvoOffers|useNuvoOffers/);
  });
});
