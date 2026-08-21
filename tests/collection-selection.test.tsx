// @vitest-environment jsdom
/**
 * The table bulk bar's two-step delete: first click arms, second click
 * commits. Vera's report ("Confirm reverts, count stays 1") looked like this
 * control was swallowing the second click. It isn't — the second click must
 * call `onBulkDelete` with the selected ids. The project coming back after
 * that write is a different bug (`preserveOwingRows`).
 */
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCollectionSelection } from "../src/hooks/useCollectionSelection";
import { DeleteBtn } from "../src/components/floors/parts";

describe("useCollectionSelection bulk delete", () => {
  it("the second click commits the delete — Confirm does not just re-arm", () => {
    const onBulkDelete = vi.fn();
    const { result } = renderHook(() =>
      useCollectionSelection(["p1", "p2"], true, onBulkDelete),
    );

    act(() => {
      result.current.pick("p1", {});
    });
    expect(result.current.count).toBe(1);
    expect(result.current.deleteArmed).toBe(false);

    act(() => {
      result.current.bulkDelete();
    });
    expect(onBulkDelete).not.toHaveBeenCalled();
    expect(result.current.deleteArmed).toBe(true);

    act(() => {
      result.current.bulkDelete();
    });
    expect(onBulkDelete).toHaveBeenCalledTimes(1);
    expect(onBulkDelete).toHaveBeenCalledWith(["p1"]);
    expect(result.current.count).toBe(0);
    expect(result.current.deleteArmed).toBe(false);
  });
});

describe("DeleteBtn (Record modal overflow)", () => {
  it("the armed click commits — 'Delete project?' does not toggle back to Delete", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<DeleteBtn what="project" onDelete={onDelete} />);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete project?" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Delete project?" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
