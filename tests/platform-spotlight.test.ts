/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { isSpotlightWindow } from "../src/lib/platform";

describe("isSpotlightWindow", () => {
  it("is false in an ordinary browser tab", () => {
    expect(isSpotlightWindow()).toBe(false);
  });
});
