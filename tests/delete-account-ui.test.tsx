/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DeleteAccount } from "../src/components/account/DeleteAccount";
import { ACCOUNT_DELETE_CONFIRM } from "../src/lib/account";

vi.mock("../src/lib/account", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/account")>("../src/lib/account");
  return {
    ...actual,
    requestAccountDeletion: vi.fn(),
    signOutAfterDeletion: vi.fn(),
  };
});

describe("DeleteAccount two-step", () => {
  it("stays closed until asked, then requires DELETE before the wipe is live", async () => {
    const user = userEvent.setup();
    render(<DeleteAccount />);

    expect(screen.queryByLabelText(/type DELETE to confirm/i)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Delete account" }));

    expect(screen.getByText(/cancel in Apple Account settings first/i)).toBeTruthy();
    expect(screen.getByText(/cancel that Stripe subscription/i)).toBeTruthy();

    const wipe = screen.getByRole("button", { name: "Delete forever" });
    expect(wipe).toBeDisabled();

    await user.type(screen.getByLabelText(/type DELETE to confirm/i), "delete");
    expect(wipe).toBeDisabled();

    await user.clear(screen.getByLabelText(/type DELETE to confirm/i));
    await user.type(screen.getByLabelText(/type DELETE to confirm/i), ACCOUNT_DELETE_CONFIRM);
    expect(wipe).not.toBeDisabled();
  });
});
