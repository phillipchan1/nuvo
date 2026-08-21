import { describe, expect, it, beforeEach } from "vitest";
/**
 * @vitest-environment jsdom
 */
import {
  captureReferralCodeFromLocation,
  clearPendingReferralCode,
  friendShareSentence,
  normalizeReferralCode,
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
