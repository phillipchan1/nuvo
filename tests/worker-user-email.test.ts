import { describe, expect, it } from "vitest";
import { workerUserEmail, workerUserEmailUrl } from "../supabase/functions/_shared/workerUser.ts";
import { stripePayerEmail } from "../supabase/functions/_shared/stripePayer.ts";

const USER = "11111111-1111-4111-8111-111111111111";

describe("workerUserEmail", () => {
  it("builds the internal Worker URL", () => {
    expect(workerUserEmailUrl("https://api.nuvo.day/", USER)).toBe(
      `https://api.nuvo.day/api/internal/user-email?id=${USER}`,
    );
  });

  it("returns the email on 200", async () => {
    const got = await workerUserEmail(
      USER,
      { apiBase: "https://api.nuvo.day", serviceRole: "svc" },
      async () => new Response(JSON.stringify({ email: "a@example.test" }), { status: 200 }),
    );
    expect(got).toBe("a@example.test");
  });

  it("is undefined without secrets, a non-UUID, or a non-2xx", async () => {
    expect(await workerUserEmail(USER, {})).toBeUndefined();
    expect(await workerUserEmail("nope", { apiBase: "https://api.nuvo.day", serviceRole: "svc" })).toBeUndefined();
    expect(
      await workerUserEmail(
        USER,
        { apiBase: "https://api.nuvo.day", serviceRole: "svc" },
        async () => new Response("no", { status: 404 }),
      ),
    ).toBeUndefined();
  });
});

describe("stripePayerEmail", () => {
  it("prefers customer_details.email, then customer_email, then email", () => {
    expect(stripePayerEmail({ customer_details: { email: "a@ex.test" }, customer_email: "b@ex.test" })).toBe(
      "a@ex.test",
    );
    expect(stripePayerEmail({ customer_email: "b@ex.test" })).toBe("b@ex.test");
    expect(stripePayerEmail({ email: "c@ex.test" })).toBe("c@ex.test");
    expect(stripePayerEmail({})).toBeUndefined();
    expect(stripePayerEmail(null)).toBeUndefined();
  });
});
