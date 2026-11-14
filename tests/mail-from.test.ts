import { describe, expect, it } from "vitest";
import { mailFrom } from "../worker/src/mailFrom.ts";

describe("mailFrom", () => {
  it("splits a display-name sender", () => {
    expect(mailFrom("Nuvo <noreply@inbox.nuvo.day>")).toEqual({ name: "Nuvo", email: "noreply@inbox.nuvo.day" });
  });
  it("keeps a bare address", () => {
    expect(mailFrom("noreply@inbox.nuvo.day")).toBe("noreply@inbox.nuvo.day");
  });
  it("drops quotes and empty names", () => {
    expect(mailFrom('"Nuvo" <noreply@inbox.nuvo.day>')).toEqual({ name: "Nuvo", email: "noreply@inbox.nuvo.day" });
    expect(mailFrom("<noreply@inbox.nuvo.day>")).toBe("noreply@inbox.nuvo.day");
  });
});
