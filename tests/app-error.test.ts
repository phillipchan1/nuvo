/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { formatAppError, formatAppErrorSync, isAbortError } from "../src/lib/appError";

describe("formatAppErrorSync", () => {
  it("keeps a real Error message", () => {
    expect(formatAppErrorSync(new Error("Not signed in")).message).toBe("Not signed in");
  });

  it("does not dump a generic 'Something went wrong' for a string", () => {
    expect(formatAppErrorSync("Calendar account not found").message).toBe("Calendar account not found");
  });

  it("surfaces PostgREST code and details", () => {
    const err = Object.assign(new Error("column domains.foo does not exist"), {
      code: "42703",
      details: null,
    });
    const out = formatAppErrorSync(err);
    expect(out.message).toContain("column domains.foo");
    expect(out.detail).toContain("42703");
  });

  it("does not toast 'Something went wrong' when only code/details exist", () => {
    const out = formatAppErrorSync({
      code: "PGRST116",
      message: "",
      details: "The result contains 2 rows",
      hint: null,
    });
    expect(out.message).not.toBe("Something went wrong");
    expect(out.message).toContain("PGRST116");
    expect(out.message).toContain("The result contains 2 rows");
  });

  it("names a missing edge function instead of the generic non-2xx line", () => {
    const err = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: { status: 404, url: "https://example.supabase.co/functions/v1/delete-account" },
    });
    const out = formatAppErrorSync(err);
    expect(out.message).toBe("delete-account isn't deployed on the server.");
  });
});

describe("isAbortError", () => {
  it("recognises supabase-js aborted fetches", () => {
    expect(isAbortError({ name: "AbortError", message: "The user aborted a request." })).toBe(true);
    expect(
      isAbortError({
        code: "25P02",
        message: "current transaction is aborted, commands ignored until end of transaction block",
      }),
    ).toBe(false);
  });
});

describe("formatAppError", () => {
  it("lifts the JSON body off a FunctionsHttpError", async () => {
    const err = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: {
        status: 400,
        url: "https://example.supabase.co/functions/v1/google-events",
        json: async () => ({ error: "start_at and end_at required" }),
      },
    });
    const out = await formatAppError(err);
    expect(out.message).toBe("start_at and end_at required");
    expect(out.detail).toContain("google-events");
  });
});
