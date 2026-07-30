import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  conferenceName,
  DEFAULT_MEET_PREFERENCE,
  hasConference,
  joinUrl,
  meetCreateRequest,
  normalizeMeetPreference,
  shouldAddMeet,
} from "../supabase/functions/_shared/conferencing";

describe("meet preference", () => {
  it("defaults to guests-only — a meeting with someone gets a room, a solo block doesn't", () => {
    expect(DEFAULT_MEET_PREFERENCE).toBe("guests");
    expect(shouldAddMeet("guests", 0)).toBe(false);
    expect(shouldAddMeet("guests", 2)).toBe(true);
  });

  it("honours always / never regardless of guests", () => {
    expect(shouldAddMeet("always", 0)).toBe(true);
    expect(shouldAddMeet("always", 3)).toBe(true);
    expect(shouldAddMeet("never", 0)).toBe(false);
    expect(shouldAddMeet("never", 3)).toBe(false);
  });

  it("falls back to the default for a row written before the column existed", () => {
    // user_settings rows predating the migration read back null/undefined; the
    // browser and the edge function must land on the same answer or the toggle
    // would promise a link Google never gets asked for.
    expect(normalizeMeetPreference(null)).toBe("guests");
    expect(normalizeMeetPreference(undefined)).toBe("guests");
    expect(normalizeMeetPreference("nonsense")).toBe("guests");
    expect(shouldAddMeet(null, 1)).toBe(true);
    expect(shouldAddMeet(undefined, 0)).toBe(false);
  });
});

describe("meet create request", () => {
  it("asks Google for a hangoutsMeet conference with the caller's request id", () => {
    const body = meetCreateRequest("req-1");
    expect(body.conferenceData.createRequest.conferenceSolutionKey.type).toBe("hangoutsMeet");
    expect(body.conferenceData.createRequest.requestId).toBe("req-1");
  });
});

describe("join link", () => {
  it("reads the modern conferenceData video entry point", () => {
    const raw = {
      conferenceData: {
        conferenceSolution: { name: "Google Meet" },
        entryPoints: [
          { entryPointType: "phone", uri: "tel:+15551234567" },
          { entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" },
        ],
      },
    };
    expect(joinUrl(raw)).toBe("https://meet.google.com/abc-defg-hij");
    expect(conferenceName(raw)).toBe("Google Meet");
    expect(hasConference(raw)).toBe(true);
  });

  it("falls back to hangoutLink — older events carry only that", () => {
    const raw = { hangoutLink: "https://meet.google.com/legacy-link" };
    expect(joinUrl(raw)).toBe("https://meet.google.com/legacy-link");
    expect(hasConference(raw)).toBe(true);
    expect(conferenceName(raw)).toBe("meeting");
  });

  it("ignores a pending conference that has no entry point yet", () => {
    // Google returns createRequest with status "pending" before the link exists.
    const raw = { conferenceData: { entryPoints: [] } };
    expect(joinUrl(raw)).toBeNull();
    expect(hasConference(raw)).toBe(false);
    expect(joinUrl(null)).toBeNull();
    expect(joinUrl(undefined)).toBeNull();
  });

  it("skips a non-video entry point rather than offering a phone number as the join link", () => {
    const raw = { conferenceData: { entryPoints: [{ entryPointType: "more", uri: "https://x" }] } };
    expect(joinUrl(raw)).toBeNull();
  });
});

// Same drift guard as the planning kernel, for the same reason: the inspector
// used to dig the video entry point out of `conferenceData` by hand, which is
// how `hangoutLink`-only meetings ended up looking link-less on one surface and
// fine on another.
const SHARED = "supabase/functions/_shared/conferencing.ts";

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else out.push(full);
  }
  return out;
}

describe("conferencing has one implementation", () => {
  const files = sourceFiles("src")
    .concat(sourceFiles("supabase/functions"))
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith("conferencing.ts"));

  it("no surface digs the join link out of conferenceData itself", () => {
    const offenders = files.filter((f) =>
      /entryPoints\s*(\?\.)?\s*\.?(find|filter|some)|entryPointType\s*===/.test(
        readFileSync(f, "utf8"),
      )
    );
    expect(offenders, `these files re-read the conference entry points; call joinUrl() from ${SHARED}`)
      .toEqual([]);
  });

  it("no surface re-decides when a new event gets a Meet link", () => {
    const offenders = files.filter((f) =>
      /(function|const|let)\s+shouldAddMeet\b\s*[=(]/.test(readFileSync(f, "utf8"))
    );
    expect(offenders, `these files re-implement shouldAddMeet; import it from ${SHARED}`).toEqual([]);
  });
});
