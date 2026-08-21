import { describe, expect, it, beforeEach } from "vitest";
/**
 * @vitest-environment jsdom
 */
import {
  captureReferralCodeFromLocation,
  clearPendingReferralCode,
  friendShareSentence,
  normalizeReferralCode,
  personalReferralCode,
  randomReferralSuffix,
  readPendingReferralCode,
  slugFromDisplayName,
  writePendingReferralCode,
} from "../src/lib/referral";

describe("normalizeReferralCode", () => {
  it("uppercases and strips junk", () => {
    expect(normalizeReferralCode("  phil! ")).toBe("PHIL");
    expect(normalizeReferralCode("david-c")).toBe("DAVID-C");
  });
  it("rejects too-short or empty", () => {
    expect(normalizeReferralCode("a")).toBeNull();
    expect(normalizeReferralCode("")).toBeNull();
    expect(normalizeReferralCode(null)).toBeNull();
  });
});

describe("slugFromDisplayName", () => {
  it("takes the first name", () => {
    expect(slugFromDisplayName("David Chung")).toBe("DAVID");
    expect(slugFromDisplayName("Esther")).toBe("ESTHER");
  });
  it("falls back", () => {
    expect(slugFromDisplayName("")).toBe("FRIEND");
    expect(slugFromDisplayName(null)).toBe("FRIEND");
  });
});

describe("personalReferralCode", () => {
  it("always includes a random suffix — never bare PHIL", () => {
    expect(personalReferralCode("Phil", "K7RM")).toBe("PHIL-K7RM");
    expect(personalReferralCode(slugFromDisplayName("David Chung"), "2N4P")).toBe("DAVID-2N4P");
  });
  it("rejects a short suffix", () => {
    expect(() => personalReferralCode("Phil", "AB")).toThrow(/4 characters/);
  });
  it("draws a 4-char ambiguity-safe suffix", () => {
    const s = randomReferralSuffix(() => new Uint8Array([0, 1, 31, 16]));
    expect(s).toHaveLength(4);
    expect(s).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
  });
});

describe("pending referral storage", () => {
  beforeEach(() => {
    clearPendingReferralCode();
  });

  it("round-trips a code", () => {
    writePendingReferralCode("phil");
    expect(readPendingReferralCode()).toBe("PHIL");
  });

  it("captures from ?code= and strips the param", () => {
    let replaced = "";
    const code = captureReferralCodeFromLocation("?code=ESTHER&foo=1", (url) => {
      replaced = url;
    });
    expect(code).toBe("ESTHER");
    expect(readPendingReferralCode()).toBe("ESTHER");
    expect(replaced).toContain("foo=1");
    expect(replaced).not.toContain("code=");
  });

  it("accepts ?ref= as an alias", () => {
    expect(captureReferralCodeFromLocation("?ref=DAVID", () => {})).toBe("DAVID");
  });
});

describe("friendShareSentence", () => {
  it("names the code and the two-sided offer", () => {
    const s = friendShareSentence("PHIL");
    expect(s).toContain("PHIL");
    expect(s).toContain("50%");
    expect(s).toContain("free month");
    expect(s).toContain("nuvo.day/?code=PHIL");
  });
});
