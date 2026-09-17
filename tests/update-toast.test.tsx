/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import UpdateToast from "../src/components/UpdateToast";
import type { UpdateState } from "../src/lib/appUpdate";

const ready = (notes: string | null): UpdateState => ({
  status: "ready",
  version: "0.1.614",
  progress: 100,
  error: null,
  notes,
});

const { state } = vi.hoisted(() => ({
  state: {
    current: {
      status: "ready" as const,
      version: "0.1.614",
      progress: 100,
      error: null,
      notes: null as string | null,
    },
  },
}));

vi.mock("../src/hooks/useUpdater", () => ({
  useUpdater: () => ({
    state: state.current,
    check: vi.fn(),
    restart: vi.fn(),
  }),
}));

describe("UpdateToast notes", () => {
  it("names what they get when the notes are for a person using the app", () => {
    state.current = ready(
      "- There's a Join button when a meeting has a link, so you can hop on faster.",
    );
    render(<UpdateToast />);
    expect(screen.getByText("What's new")).toBeInTheDocument();
    expect(screen.getByText(/Join button/)).toBeInTheDocument();
  });

  it("hides What's new when the notes are plumbing", () => {
    state.current = ready(
      "- Streamlined the calendar reconciliation so everything feels snappier.",
    );
    render(<UpdateToast />);
    expect(screen.getByText("Nuvo 0.1.614 is ready")).toBeInTheDocument();
    expect(screen.queryByText("What's new")).not.toBeInTheDocument();
    expect(screen.queryByText(/reconciliation/)).not.toBeInTheDocument();
  });
});
