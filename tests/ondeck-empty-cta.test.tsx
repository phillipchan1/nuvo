// @vitest-environment jsdom
/**
 * Click the On Deck empty CTA and the same create sheet Table / P open must
 * come up. Vera's walk: the button was painted, two clicks did nothing, Table
 * "+ new project" worked. A source grep can miss a handler that no-ops at
 * runtime; this drives the real FloorGuide through the real nav store.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import OnDeckFloor from "../src/components/floors/OnDeckFloor";
import { AppNavigationProvider, useAppNavigation } from "../src/hooks/useAppNavigation";
import { VerticalStoreProvider, type VerticalStore } from "../src/hooks/useVertical";
import type { VerticalData } from "../src/lib/vertical";

const EMPTY: VerticalData = {
  domains: [],
  initiatives: [],
  projects: [],
  tasks: [],
} as unknown as VerticalData;

const store = { data: EMPTY, ready: true } as unknown as VerticalStore;

function FloorModalProbe() {
  const { nav } = useAppNavigation();
  return <div data-testid="floor-modal">{nav.floorModal ?? "none"}</div>;
}

describe("On Deck empty 'Add your first project'", () => {
  it("opens the new-project sheet on click", async () => {
    const user = userEvent.setup();
    render(
      <AppNavigationProvider>
        <VerticalStoreProvider value={store}>
          <OnDeckFloor />
          <FloorModalProbe />
        </VerticalStoreProvider>
      </AppNavigationProvider>,
    );

    expect(screen.getByTestId("floor-modal")).toHaveTextContent("none");
    await user.click(screen.getByRole("button", { name: "Add your first project" }));
    expect(screen.getByTestId("floor-modal")).toHaveTextContent("new-project");
  });
});
