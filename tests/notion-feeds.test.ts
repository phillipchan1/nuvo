import { describe, expect, it } from "vitest";
import {
  feedFilter,
  feedFromSchema,
  importNotes,
  mergeFeeds,
  pageTitle,
  pickAssignee,
  pickDone,
  readFeeds,
  type Feed,
  type NotionPropSchema,
} from "../worker/src/notion/feeds.ts";

// D-257: the one rule is "assigned to me and still open". These hold the
// reading of that rule out of schemas nobody standardised.

const status: NotionPropSchema = {
  id: "st",
  name: "Status",
  type: "status",
  status: {
    options: [
      { id: "a", name: "Not started" },
      { id: "b", name: "In progress" },
      { id: "c", name: "Done" },
      { id: "d", name: "Won't do" },
    ],
    groups: [
      { id: "g1", name: "To-do", option_ids: ["a"] },
      { id: "g2", name: "In progress", option_ids: ["b"] },
      // Renamed by the workspace — the last group is still "complete".
      { id: "g3", name: "Finished", option_ids: ["c", "d"] },
    ],
  },
};
const createdBy: NotionPropSchema = { id: "cb", name: "Reviewer", type: "people" };
const assignee: NotionPropSchema = { id: "as", name: "Assignee", type: "people" };
const title: NotionPropSchema = { id: "title", name: "Name", type: "title" };

describe("Notion feeds", () => {
  it("prefers the people field named like an assignee", () => {
    expect(pickAssignee([title, createdBy, assignee])).toBe("as");
    expect(pickAssignee([title, createdBy])).toBe("cb");
    expect(pickAssignee([title, status])).toBeNull();
  });

  it("reads 'done' as every option in the status's last group, whatever it's called", () => {
    expect(pickDone([status])).toEqual({ kind: "status", prop: "st", values: ["Done", "Won't do"] });
  });

  it("falls back to a Done checkbox, then to nothing excluded", () => {
    const box: NotionPropSchema = { id: "bx", name: "Completed?", type: "checkbox" };
    expect(pickDone([box])).toEqual({ kind: "checkbox", prop: "bx" });
    expect(pickDone([{ id: "x", name: "Flagged", type: "checkbox" }])).toBeNull();
  });

  it("filters to assigned-to-me and not done", () => {
    const feed = feedFromSchema({ id: "ds", title: "Tickets", url: null, props: [title, assignee, status] });
    expect(feedFilter(feed, "me")).toEqual({
      and: [
        { property: "as", people: { contains: "me" } },
        { property: "st", status: { does_not_equal: "Done" } },
        { property: "st", status: { does_not_equal: "Won't do" } },
      ],
    });
  });

  it("can't be a feed without a person field — and can't stay on", () => {
    const prev = { id: "ds", on: true, assignee: "gone" } as Feed;
    const feed = feedFromSchema({ id: "ds", title: "Notes", url: null, props: [title, status] }, prev);
    expect(feed.assignee).toBeNull();
    expect(feed.on).toBe(false);
    expect(feedFilter(feed, "me")).toBeNull();
  });

  it("keeps the person's switch and their chosen field across a refresh", () => {
    const stored = [feedFromSchema({ id: "ds", title: "Tickets", url: null, props: [title, assignee, createdBy] })];
    stored[0] = { ...stored[0], on: true, assignee: "cb" };
    const [merged] = mergeFeeds([{ id: "ds", title: "Tickets v2", url: null, props: [title, assignee, createdBy] }], stored);
    expect(merged.on).toBe(true);
    expect(merged.assignee).toBe("cb");
    expect(merged.title).toBe("Tickets v2");
  });

  it("new databases arrive switched off", () => {
    const [f] = mergeFeeds([{ id: "new", title: "New", url: null, props: [title, assignee] }], []);
    expect(f.on).toBe(false);
  });

  it("reads a page title and labels the source with a way back", () => {
    const page = { properties: { Name: { type: "title", title: [{ plain_text: "Fix " }, { plain_text: "login\n" }] } } };
    expect(pageTitle(page)).toBe("Fix login");
    expect(pageTitle({ properties: {} })).toBe("Untitled");
    expect(importNotes("Tickets", "https://www.notion.so/abc")).toBe("From Notion · Tickets\nhttps://www.notion.so/abc");
  });

  it("never throws on a bad stored row", () => {
    expect(readFeeds(null)).toEqual([]);
    expect(readFeeds("not json")).toEqual([]);
    expect(readFeeds([{ id: "a" }, 3, null])).toHaveLength(1);
  });
});
