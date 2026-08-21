import { describe, expect, it } from "vitest";
import { sanitizeCaptureProperties } from "../src/lib/posthog";

describe("sanitizeCaptureProperties", () => {
  it("strips autocapture element text so task titles never leave the device", () => {
    const properties: Record<string, unknown> = {
      $el_text: "Call David tomorrow",
      $el_content: "Therapy 3pm",
      $exception_message: "Cannot read properties of undefined",
    };
    sanitizeCaptureProperties(properties);
    expect(properties.$el_text).toBeUndefined();
    expect(properties.$el_content).toBeUndefined();
    expect(properties.$exception_message).toBe("Cannot read properties of undefined");
  });
});
