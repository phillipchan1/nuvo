/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DeleteAccount } from "../src/components/account/DeleteAccount";
import {
  ACCOUNT_DELETE_CONFIRM,
  APPLE_DELETE_NOTICE,
  STRIPE_DELETE_BLOCK_MESSAGE,
} from "../src/lib/account";

vi.mock("../src/lib/account", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/account")>("../src/lib/account");
  return {
    ...actual,
    requestAccountDeletion: vi.fn(),
    signOutAfterDeletion: vi.fn(),
  };
});

async function openPanel(planSource?: "stripe" | "apple" | null) {
  const user = userEvent.setup();
  render(<DeleteAccount planSource={planSource} />);
  await user.click(screen.getByRole("button", { name: "Delete account" }));
  return user;
}

describe("DeleteAccount two-step", () => {
  it("stays closed until asked, then requires DELETE before the wipe is live", async () => {
    const user = await openPanel();

    expect(screen.getByText(APPLE_DELETE_NOTICE)).toBeTruthy();
    expect(screen.queryByText(/Stripe/i)).toBeNull();

    const wipe = screen.getByRole("button", { name: "Delete forever" });
    expect(wipe).toBeDisabled();

    await user.type(screen.getByLabelText(/type DELETE to confirm/i), "delete");
    expect(wipe).toBeDisabled();

    await user.clear(screen.getByLabelText(/type DELETE to confirm/i));
    await user.type(screen.getByLabelText(/type DELETE to confirm/i), ACCOUNT_DELETE_CONFIRM);
    expect(wipe).not.toBeDisabled();
  });

  it("tells StoreKit subscribers to cancel in Apple Settings, with no Stripe wording", async () => {
    await openPanel("apple");
    expect(screen.getByText(APPLE_DELETE_NOTICE)).toBeTruthy();
    expect(screen.queryByText(/Stripe/i)).toBeNull();
  });

  it("tells Stripe subscribers to cancel in Billing first", async () => {
    await openPanel("stripe");
    expect(screen.getByText(STRIPE_DELETE_BLOCK_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(/Apple Account settings/i)).toBeNull();
  });
});
