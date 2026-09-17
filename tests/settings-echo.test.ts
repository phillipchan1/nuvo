import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { applyLiveChange } from "../src/lib/sync/liveApply";
import type { UserSettings } from "../src/lib/types";

describe("the user_settings echo", () => {
  it("paints a legacy reminder_prefs as the normalized shape", () => {
    // A raw echo carrying the pre-list scalars left `block_leads` undefined,
    // and the task popover's reminder row crashed on `.length`.
    const qc = new QueryClient();
    qc.setQueryData(["settings"], { user_id: "u", theme: "system" });
    applyLiveChange(qc, {
      table: "user_settings",
      eventType: "UPDATE",
      new: { user_id: "u", theme: "dark", reminder_prefs: { enabled: true, block_lead: 5 }, hidden_calendar_ids: null },
      old: null,
    });
    const s = qc.getQueryData<UserSettings>(["settings"])!;
    expect(s.theme).toBe("dark");
    expect(s.reminder_prefs.block_leads).toEqual([5]);
    expect(Array.isArray(s.reminder_prefs.event_leads)).toBe(true);
    expect(s.hidden_calendar_ids).toEqual([]);
  });
});
