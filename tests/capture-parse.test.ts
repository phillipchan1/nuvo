import { beforeAll, describe, expect, it } from "vitest";
import { literalKey, nlpReady, parseCapture } from "../src/lib/nlp";

// Thursday 17 Sep 2026, 08:00 local.
const REF = new Date(2026, 8, 17, 8, 0, 0);

beforeAll(async () => {
  await nlpReady;
});

const typed = (input: string) => {
  const p = parseCapture(input, REF);
  return p.spans.map((s) => [s.kind, input.slice(s.start, s.end)]);
};

describe("parseCapture — what it understands", () => {
  it("reads the whole grammar and leaves a clean title", () => {
    const p = parseCapture("call David tom 9am 30m #calls !high @launch // bring the deck", REF);
    expect(p.title).toBe("call David");
    expect(p.doDate).toBe("2026-09-18");
    expect(p.startTime?.getHours()).toBe(9);
    expect(p.durationMinutes).toBe(30);
    expect(p.labels).toEqual(["calls"]);
    expect(p.priority).toBe("high");
    expect(p.route).toBe("launch");
    expect(p.notes).toBe("bring the deck");
  });

  it("reads repeats", () => {
    const p = parseCapture("water plants every week", REF);
    expect(p.recurrence?.freq).toBe("weekly");
    expect(p.title).toBe("water plants");
  });

  it("leaves emails and URLs alone", () => {
    const p = parseCapture("send a@b.co the https://x.io/y link", REF);
    expect(p.route).toBeNull();
    expect(p.notes).toBeNull();
    expect(p.title).toBe("send a@b.co the https://x.io/y link");
  });
});

describe("parseCapture — spans point at what was typed", () => {
  it("highlights each token in place", () => {
    expect(typed("call David tom 9am 30m #calls !high @launch")).toEqual([
      ["date", "tom 9am"],
      ["duration", "30m"],
      ["label", "#calls"],
      ["priority", "!high"],
      ["route", "@launch"],
    ]);
  });

  it("maps an expanded alias back to the typed word", () => {
    expect(typed("review copy tmrw")).toEqual([["date", "tmrw"]]);
  });

  it("covers a note to the end and a repeat phrase", () => {
    expect(typed("stretch daily // 10 min")).toEqual([
      ["repeat", "daily"],
      ["note", "// 10 min"],
    ]);
  });
});

describe("parseCapture — keep as text", () => {
  it("a kept date stays in the title", () => {
    const literal = new Set([literalKey("date", "monday")]);
    const p = parseCapture("prep for monday standup", REF, { literal });
    expect(p.doDate).toBeNull();
    expect(p.title).toBe("prep for monday standup");
  });

  it("a kept name falls through to the next date", () => {
    const literal = new Set([literalKey("date", "tom")]);
    const p = parseCapture("email Tom friday", REF, { literal });
    expect(p.title).toBe("email Tom");
    expect(p.doDate).toBe("2026-09-18");
  });

  it("a kept label is still a word", () => {
    const literal = new Set([literalKey("label", "#1")]);
    const p = parseCapture("ship #1 priority #work", REF, { literal });
    expect(p.labels).toEqual(["work"]);
    expect(p.title).toBe("ship #1 priority");
  });

  it("a kept duration stays", () => {
    const literal = new Set([literalKey("duration", "5m")]);
    const p = parseCapture("run 5m loop", REF, { literal });
    expect(p.durationMinutes).toBeNull();
    expect(p.title).toBe("run 5m loop");
  });
});
