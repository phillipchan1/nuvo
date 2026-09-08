/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/platform", () => ({
  isTauriIOS: () => false,
}));

import { isReviewPasswordLogin } from "../src/lib/reviewLogin";

describe("isReviewPasswordLogin", () => {
  it("is on when the listing-notes query is present", () => {
    expect(isReviewPasswordLogin("?review=1")).toBe(true);
    expect(isReviewPasswordLogin("?review")).toBe(true);
  });

  it("is off on a plain web load (native iOS is the other door)", () => {
    expect(isReviewPasswordLogin("")).toBe(false);
    expect(isReviewPasswordLogin("?shortcut=capture")).toBe(false);
  });
});
