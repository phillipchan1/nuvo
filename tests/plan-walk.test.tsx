// @vitest-environment jsdom
/**
 * Plan the week walks its draft ONE block at a time (docs/plan-the-week-v2.md §4,
 * the walk). Reported from a real week: a whole draft laid over a full calendar
 * was unreadable — "Admin batch" said nothing about what it held, and you could
 * not see which blocks were new. So: the plan opens on the first block, the rail
 * lists what's inside it, ↵ accepts it (held from then on) and moves to the next,
 * the overlay fades what the calendar already has, and the blocks not under
 * review are drawn quieter. While a block is selected, every open gap on the
 * week is drawn; a click puts the block there, shortened when the gap is smaller.
 */
import { act, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PlanOverlay } from "../src/components/plan/planOverlay";

vi.mock("../src/lib/calendarReveal", () => ({ revealOnCalendar: vi.fn() }));
const openRecord = vi.fn();
vi.mock("../src/hooks/useAppNavigation", () => ({ useAppNavigation: () => ({ navigate: vi.fn(), openRecord, nav: { overlay: "none" } }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("../src/hooks/useSettings", () => ({ useSettings: () => ({ settings: { work_end_minutes: 990 }, isLoading: false, update: vi.fn() }) }));
// The pinned crown (rail-modes §2) reads the week through useWeekCrown; here it
// is one project whose two loose pieces are the Admin batch's.
const CROWN_ROW = {
  rock: { id: "r1" },
  projectId: "p1",
  title: "Launch",
  color: "#2563EB",
  state: "in-motion",
  loose: [{ id: "a1" }, { id: "a2" }],
  placed: [],
  open: 2,
};
const crownWeeks: (string | undefined)[] = [];
vi.mock("../src/hooks/useWeekCrown", () => ({
  SIGNIFICANCE_FLOOR_MINS: 120,
  useWeekCrown: (w?: string) => {
    crownWeeks.push(w);
    return { weekISO: w, weekLabel: "Nov 9 – 15", rows: [CROWN_ROW], landed: 0, total: 1, looseCount: 2, composed: false, significance: null };
  },
}));
const reach = vi.fn((..._args: unknown[]) => Promise.resolve());
vi.mock("../src/lib/motion", async (orig) => ({ ...(await orig<typeof import("../src/lib/motion")>()), reachToCrown: (...a: unknown[]) => reach(...a) }));

const DAY = "2026-11-10";
const t = (id: string, title: string, mins = 30) => ({ id, title, duration_minutes: mins });
const TASKS = [t("a1", "Fill in Timesheet", 15), t("a2", "Renew car registration"), t("r1", "Reply to Grace", 15), t("r2", "Follow up with Theo")];
const SLOTS = [
  { id: "admin", name: "Admin batch", taskIds: ["a1", "a2"], projectId: null, color: null, durationMins: 45 },
  { id: "replies", name: "Replies", taskIds: ["r1", "r2"], projectId: null, color: null, durationMins: 45 },
];
const PLACEMENTS = [
  { task: { id: "replies", title: "Replies" }, dayISO: DAY, startMin: 14 * 60, durationMin: 45, reason: "afternoon run" },
  { task: { id: "admin", title: "Admin batch" }, dayISO: DAY, startMin: 9 * 60, durationMin: 45, reason: "first open hour" },
];

const S = {
  data: { tasks: [], projects: [], domains: [], initiatives: [] },
  slotById: new Map(SLOTS.map((s) => [s.id, s])),
  taskById: new Map(TASKS.map((x) => [x.id, x])),
  empty: [] as never[],
  kept: new Set(),
  result: { unplaced: [], placements: PLACEMENTS, days: [{ freeMins: 600 }] },
  planDays: [DAY],
  workingDays: [1, 2, 3, 4, 5],
  ctx: {},
  // an hour free at 4pm, and 30 minutes at 11am — shorter than either block
  gaps: [
    { dayISO: DAY, startMin: 16 * 60, endMin: 17 * 60 },
    { dayISO: DAY, startMin: 11 * 60, endMin: 11 * 60 + 30 },
  ],
  setBlockLength: vi.fn(),
  placeInGap: vi.fn(),
  // the week's slots — a project sitting here is what the thin-path mark reads
  weekSlots: [] as { project_id: string | null; do_date: string; start_time: string; duration_minutes: number }[],
};
vi.mock("../src/hooks/useWeekDraft", () => ({
  placementKey: (p: { task: { id: string } }) => p.task.id,
  useWeekDraft: () => {
    const [held, setHeld] = useState<Set<string>>(new Set());
    return {
      data: S.data, placements: PLACEMENTS, slotById: S.slotById, taskById: S.taskById, fromGate: DAY,
      alternativesFor: () => [], isHeld: (k: string) => held.has(k),
      holdPlacement: (k: string) => setHeld((h) => new Set([...h, k])),
      unpinPlacement: () => {}, remember: () => {}, undo: () => false, moveLocally: () => {},
      setBlockLength: S.setBlockLength, placeInGap: S.placeInGap, openGaps: () => S.gaps,
      loosePool: S.empty, kept: S.kept, setKept: () => {}, result: S.result, suggestions: S.empty,
      clearRegions: S.empty, weekSlots: S.weekSlots, planDays: S.planDays, workingDays: S.workingDays, dayContexts: S.ctx, applying: false,
    };
  },
}));

let overlays = 0;
const { default: PlanRail } = await import("../src/components/plan/PlanRail");


describe("Plan the week — the walk", () => {
  it("opens on the earliest block, lists what's inside, and ↵ accepts and moves on", () => {
    let overlay: PlanOverlay | null = null;
    render(<PlanRail onOverlay={(o) => (overlay = o)} onClose={() => {}} />);

    // earliest in time first — Admin at 9am, not Replies at 2pm
    expect(screen.getByText("Block 1 of 2")).toBeTruthy();
    expect(screen.getByText("Fill in Timesheet")).toBeTruthy();
    expect(screen.getByText("Renew car registration")).toBeTruthy();

    // the calendar fades what's fixed; the block under review is full strength
    expect(overlay!.dimCalendar).toBe(true);
    const admin = overlay!.blocks.find((b) => b.key === "admin")!;
    const replies = overlay!.blocks.find((b) => b.key === "replies")!;
    expect(admin.selected && !admin.quiet).toBe(true);
    expect(replies.quiet).toBe(true);
    expect(admin.items).toEqual(["Fill in Timesheet", "Renew car registration"]);

    act(() => {
      fireEvent.keyDown(window, { key: "Enter" });
    });
    expect(screen.getByText("1/2 accepted")).toBeTruthy();
    expect(screen.getByText("Block 2 of 2")).toBeTruthy();
    expect(screen.getByText("Reply to Grace")).toBeTruthy();

    // the act names where the block goes (D-204): a time, not an opinion
    fireEvent.click(screen.getByRole("button", { name: /^Hold Tue 2–2:45pm/ }));
    expect(screen.getByText("2/2 accepted")).toBeTruthy();
    expect(screen.getByText(/All 2 blocks accepted/)).toBeTruthy();
  });

  it("Look at it last moves on without accepting", () => {
    render(<PlanRail onOverlay={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^Look at it last/ }));
    expect(screen.getByText("Block 2 of 2")).toBeTruthy();
    expect(screen.getByText("0/2 accepted")).toBeTruthy();
  });
});

describe("Plan the week — acts that say where things go (D-204)", () => {
  it("labels every act of the walk with its destination, keycaps kept", () => {
    render(<PlanRail onOverlay={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /^Hold Tue 9–9:45am/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Look at it last/ })).toBeTruthy();
    // the halves' places aren't known before the split
    expect(screen.getByRole("button", { name: /^Split in two/ })).toBeTruthy();
    // a run of loose work has no project to go back to — it leaves the week
    expect(screen.getByRole("button", { name: /^Out of the week/ })).toBeTruthy();
    // D-150: what comes off the calendar, said under the act
    expect(screen.getByText("Tue 9–9:45am comes off the calendar")).toBeTruthy();
    for (const old of [/Looks good/, /Keep · next/, /^Later$/, /Off this week/, /^Split$/]) expect(screen.queryByText(old)).toBeNull();
    // the dial lives in Settings → Schedule, not in the walk
    expect(screen.queryByText("During the week")).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "How much Nuvo moves" })).toBeNull();
  });

  it("a project's block goes Back to its project — the name truncates, never the verb", () => {
    const was = S.slotById.get("admin")!;
    const saved = S.data;
    S.slotById.set("admin", { ...was, projectId: "p1" });
    S.data = { ...S.data, projects: [{ id: "p1", name: "Launch pricing page for the spring catalogue" }] } as never;
    try {
      render(<PlanRail onOverlay={() => {}} onClose={() => {}} />);
      const btn = screen.getByRole("button", { name: /^Back to Launch pricing page for the spring catalogue/ });
      expect(btn.querySelector(".k-dest-verb")?.textContent).toBe("Back to");
      expect(btn.querySelector(".k-dest-name")?.textContent).toBe("Launch pricing page for the spring catalogue");
    } finally {
      S.slotById.set("admin", was);
      S.data = saved;
    }
  });
});

describe("Plan the week — open time and length", () => {
  it("draws every open gap for the block under review, and a short gap shortens it", () => {
    let overlay: PlanOverlay | null = null;
    S.placeInGap.mockClear();
    render(<PlanRail onOverlay={(o) => (overlay = o)} onClose={() => {}} />);
    const gaps = overlay!.ghosts.filter((g) => g.kind === "gap");
    expect(gaps.map((g) => g.label)).toEqual(["1h open", "30m open · fits shorter"]);
    // Admin is 45m; the 11am gap is 30m → it goes there at 30m
    act(() => overlay!.onPickGhost("gap:1"));
    expect(S.placeInGap).toHaveBeenCalledWith("admin", DAY, 11 * 60, 30);
  });

  it("a length chip sends the block back to the engine at that length", () => {
    S.setBlockLength.mockClear();
    render(<PlanRail onOverlay={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "30m" }));
    expect(S.setBlockLength).toHaveBeenCalledWith("admin", 30);
  });

  it("settles: the overlay is rebuilt only when what it draws changes", async () => {
    // Planner keeps the overlay as state — a new one every render was a loop
    let n = 0;
    function Host() {
      const [, set] = useState<unknown>(null);
      const [cb] = useState(() => (o: unknown) => {
        n++;
        if (n < 100) set(o);
      });
      return <PlanRail onOverlay={cb} onClose={() => {}} />;
    }
    render(<Host />);
    await act(() => new Promise((r) => setTimeout(r, 200)));
    expect(n).toBeLessThan(10);
  });
});

describe("Plan the week — a thin path needs you (D-196)", () => {
  it("names a project whose held time has too little work, and opens it with the draft running", async () => {
    const saved = { data: S.data, slots: S.weekSlots };
    S.data = {
      ...S.data,
      projects: [{ id: "p9", name: "Launch site", domainId: "d1", status: "in_progress" }],
      tasks: [{ id: "x", projectId: "p9", status: "ready", durationMins: 20 }],
    } as never;
    S.weekSlots = [{ project_id: "p9", do_date: DAY, start_time: `${DAY}T13:00:00`, duration_minutes: 180 }];
    const { takePathDraft } = await import("../src/lib/draftIntent");
    try {
      render(<PlanRail onOverlay={() => {}} onClose={() => {}} />);
      expect(screen.getByText("Launch site")).toBeTruthy();
      expect(screen.getByText(/is held for it, and its steps come to 20m/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /Draft the path/ }));
      expect(openRecord).toHaveBeenCalledWith("project", "p9");
      expect(takePathDraft("p9")).toBe(true);
    } finally {
      S.data = saved.data;
      S.weekSlots = saved.slots;
    }
  });
});

describe("Plan the week — the way out", () => {
  const esc = () => act(() => void fireEvent.keyDown(window, { key: "Escape" }));

  it("Esc closes at once when nothing has been touched — even with a block under review", () => {
    const onClose = vi.fn();
    render(<PlanRail onOverlay={() => {}} onClose={onClose} />);
    expect(screen.getByText("Block 1 of 2")).toBeTruthy();
    esc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("with work in the draft, Esc asks first; Esc again discards", () => {
    const onClose = vi.fn();
    render(<PlanRail onOverlay={() => {}} onClose={onClose} />);
    act(() => void fireEvent.keyDown(window, { key: "Enter" })); // accept block 1
    esc();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/Discard/, { selector: ".f-sum" })).toBeTruthy();
    esc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Keep planning takes the question back, and the ✕ asks the same question", () => {
    const onClose = vi.fn();
    render(<PlanRail onOverlay={() => {}} onClose={onClose} />);
    act(() => void fireEvent.keyDown(window, { key: "Enter" }));
    fireEvent.click(screen.getByRole("button", { name: /Close the plan/ }));
    fireEvent.click(screen.getByRole("button", { name: "Keep planning" }));
    expect(screen.queryByRole("button", { name: "Keep planning" })).toBeNull();
    expect(screen.getByText(/Commit/)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("Plan the week — the crown stays pinned, and Hold reaches it (D-202)", () => {
  const withProject = (fn: () => void) => {
    const was = S.slotById.get("admin")!;
    S.slotById.set("admin", { ...was, projectId: "p1" });
    try {
      fn();
    } finally {
      S.slotById.set("admin", was);
    }
  };

  it("the rail's bar carries the week's slate pips, for the week being planned", () => {
    crownWeeks.length = 0;
    const { container } = render(<PlanRail onOverlay={() => {}} onClose={() => {}} />);
    const pip = container.querySelector('[data-pinned-crown] [data-crown-project="p1"]');
    expect(pip).toBeTruthy();
    expect(pip!.getAttribute("data-pip")).toBe("open");
    // the crown is read for the plan's week, never the hook's default
    expect(crownWeeks.every((w) => typeof w === "string" && /^\d{4}-\d{2}-\d{2}$/.test(w))).toBe(true);
  });

  it("Hold sends ONE mark to the project's pip, and its last loose piece held tints the pip", () =>
    withProject(() => {
      reach.mockClear();
      const { container } = render(<PlanRail onOverlay={() => {}} onClose={() => {}} />);
      fireEvent.click(screen.getByRole("button", { name: /^Hold Tue 9–9:45am/ }));
      expect(reach).toHaveBeenCalledTimes(1);
      expect(reach.mock.calls[0][1]).toBe("p1");
      expect(reach.mock.calls[0][0]).toBeInstanceOf(Element);
      expect(container.querySelector('[data-crown-project="p1"]')!.getAttribute("data-pip")).toBe("placed");
    }));

  it("↵ is the same act; a block with no project reaches nothing", () => {
    withProject(() => {
      reach.mockClear();
      render(<PlanRail onOverlay={() => {}} onClose={() => {}} />);
      act(() => void fireEvent.keyDown(window, { key: "Enter" }));
      expect(reach).toHaveBeenCalledTimes(1);
    });
    reach.mockClear();
    render(<PlanRail onOverlay={() => {}} onClose={() => {}} />);
    act(() => void fireEvent.keyDown(window, { key: "Enter" }));
    expect(reach).not.toHaveBeenCalled();
  });
});
