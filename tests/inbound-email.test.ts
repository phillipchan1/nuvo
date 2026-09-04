import { describe, expect, it } from "vitest";
import {
  addressesFrom,
  htmlToText,
  inboundAddress,
  notesFromMail,
  pickInboundToken,
  receivedMeta,
  svixSign,
  titleFromSubject,
  verifySvixSignature,
} from "../supabase/functions/_shared/inboundEmail.ts";

describe("inbound address", () => {
  it("is token@inbox.nuvo.day", () => {
    expect(inboundAddress("a1b2c3d4e5f6")).toBe("a1b2c3d4e5f6@inbox.nuvo.day");
  });

  it("accepts a domain override without a leading @", () => {
    expect(inboundAddress("a1b2c3d4e5f6", "@mail.example")).toBe("a1b2c3d4e5f6@mail.example");
  });
});

describe("recipient → token", () => {
  it("reads Name <addr>, arrays, and {email} objects", () => {
    expect(addressesFrom("Jane <jane@x.com>")).toEqual(["jane@x.com"]);
    expect(addressesFrom(["a@b.co", { email: "c@d.co" }])).toEqual(["a@b.co", "c@d.co"]);
  });

  it("only accepts a 12-hex local part — hello@ is not an inbox", () => {
    expect(pickInboundToken(["hello@inbox.nuvo.day", "a1b2c3d4e5f6@inbox.nuvo.day"])).toBe(
      "a1b2c3d4e5f6",
    );
    expect(pickInboundToken(["not-a-token@inbox.nuvo.day"])).toBeNull();
  });
});

describe("subject is the title", () => {
  it("uses the subject, stripping nested Re:/Fwd:", () => {
    expect(titleFromSubject("Fwd: Re: Q3 budget")).toBe("Q3 budget");
    expect(titleFromSubject("Invoice 4412")).toBe("Invoice 4412");
  });

  it("does not treat the subject as capture grammar — a time in it stays in the title", () => {
    expect(titleFromSubject("Call David tomorrow 9am")).toBe("Call David tomorrow 9am");
  });

  it("falls back to the sender when the subject is empty", () => {
    expect(titleFromSubject("  ", "Jane Doe <jane@x.com>")).toBe("Email from Jane Doe");
    expect(titleFromSubject("", "")).toBe("Forwarded email");
  });
});

describe("body becomes notes", () => {
  it("prefers plain text, keeps From, lists attachments", () => {
    expect(
      notesFromMail({
        from: "Jane <jane@x.com>",
        text: "Please look at this.",
        html: "<p>ignored</p>",
        attachments: [{ filename: "lease.pdf" }],
      }),
    ).toBe("From: Jane <jane@x.com>\n\nPlease look at this.\n\nAttached: lease.pdf");
  });

  it("strips HTML when there is no text part", () => {
    expect(htmlToText("<p>Hello <b>there</b></p><script>x()</script>")).toBe("Hello there");
  });
});

describe("email.received metadata", () => {
  it("reads Resend's webhook shape and prefers received_for", () => {
    const meta = receivedMeta({
      type: "email.received",
      data: {
        email_id: "em_1",
        from: "Ada <ada@x.com>",
        to: ["caught@resend.dev"],
        received_for: ["a1b2c3d4e5f6@inbox.nuvo.day"],
        subject: "Hello",
        attachments: [{ filename: "a.pdf" }],
      },
    });
    expect(meta).toMatchObject({
      emailId: "em_1",
      from: "ada@x.com",
      subject: "Hello",
      attachments: [{ filename: "a.pdf" }],
    });
    expect(pickInboundToken(meta!.candidates)).toBe("a1b2c3d4e5f6");
  });

  it("ignores other event types and missing email_id", () => {
    expect(receivedMeta({ type: "email.delivered", data: { email_id: "x" } })).toBeNull();
    expect(receivedMeta({ type: "email.received", data: {} })).toBeNull();
  });
});

describe("Svix signature", () => {
  const secret = `whsec_${btoa("test-secret-bytes-for-hmac!!")}`;

  it("accepts a fresh v1 signature and rejects a tampered body", async () => {
    const id = "msg_1";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = '{"type":"email.received"}';
    const sig = await svixSign(secret, id, timestamp, body);
    expect(
      await verifySvixSignature({
        secret,
        id,
        timestamp,
        body,
        signatureHeader: `v1,${sig}`,
      }),
    ).toBe(true);
    expect(
      await verifySvixSignature({
        secret,
        id,
        timestamp,
        body: '{"type":"email.received","x":1}',
        signatureHeader: `v1,${sig}`,
      }),
    ).toBe(false);
  });

  it("rejects a replay older than five minutes", async () => {
    const id = "msg_2";
    const timestamp = String(Math.floor(Date.now() / 1000) - 400);
    const body = "{}";
    const sig = await svixSign(secret, id, timestamp, body);
    expect(
      await verifySvixSignature({
        secret,
        id,
        timestamp,
        body,
        signatureHeader: `v1,${sig}`,
      }),
    ).toBe(false);
  });
});
