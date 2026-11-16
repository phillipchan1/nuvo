// @vitest-environment jsdom
/**
 * The phone's project / initiative / domain screens save every field on blur,
 * and nothing blurred it on the way out of a frame: pushing a child record
 * unmounted the frame (Safari fires no blur on a removed field; React has
 * stopped dispatching by then), so a rename typed and then "open that project"
 * was lost. The sheet flushes the focused field before the frame changes.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const committed = vi.fn();

vi.mock("../src/hooks/useVertical", () => ({
  useVertical: () => ({
    data: {
      domains: [],
      initiatives: [{ id: "i1", name: "The bet", domainId: "d1" }],
      projects: [{ id: "p1", name: "A project", domainId: "d1" }],
    },
  }),
}));
vi.mock("../src/components/mobile/MobileRecordActions", () => ({
  useRecordActions: () => ({ openActions: vi.fn(), sheet: null }),
}));
vi.mock("../src/components/mobile/detail/verticalDetail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/components/mobile/detail/verticalDetail")>();
  return {
    ...actual,
    RecordCrumbs: () => null,
    InitiativeScreen: ({ onOpenProject }: { onOpenProject: (id: string) => void }) => (
      <>
        <actual.TextField value="The bet" onCommit={committed} />
        <button type="button" onClick={() => onOpenProject("p1")}>
          Open the project
        </button>
      </>
    ),
    ProjectScreen: () => <div>Project screen</div>,
  };
});

import MobileDetailSheet from "../src/components/mobile/detail/MobileDetailSheet";

describe("MobileDetailSheet", () => {
  it("opening a child record commits the field being typed in first", () => {
    render(<MobileDetailSheet target={{ kind: "initiative", id: "i1", n: 1 }} onClose={() => {}} />);
    const name = screen.getByDisplayValue("The bet");
    name.focus();
    fireEvent.change(name, { target: { value: "The bigger bet" } });
    // the row is a button: on iOS it never takes focus, so nothing blurred the field
    fireEvent.click(screen.getByText("Open the project"));
    expect(committed).toHaveBeenCalledWith("The bigger bet");
    expect(screen.getByText("Project screen")).toBeTruthy();
  });
});
