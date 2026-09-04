// Email → inbox task. Resend POSTs `email.received` here (domain catch-all).
// The recipient's local part IS `user_settings.inbound_token`. Subject becomes
// the title; the body becomes notes; the row lands in the inbox, ungroomed.
//
// verify_jwt is OFF (config.toml): Resend cannot send a Supabase JWT. Auth is
// the Svix signature + the unguessable token. A 200 on unknown recipients so
// Resend does not retry mail we cannot route.

import { admin, handleOptions, json, logSync } from "../_shared/admin.ts";
import {
  notesFromMail,
  pickInboundToken,
  receivedMeta,
  titleFromSubject,
  verifySvixSignature,
} from "../_shared/inboundEmail.ts";

const RATE_LIMIT_PER_MIN = 30;

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const secret = Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "";
    const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
    if (!secret || !apiKey) {
      return json({ error: "RESEND_WEBHOOK_SECRET / RESEND_API_KEY not configured" }, 500);
    }

    // Raw body for the HMAC — re-serializing JSON would break the signature.
    const raw = await req.text();
    const ok = await verifySvixSignature({
      secret,
      id: req.headers.get("svix-id") ?? "",
      timestamp: req.headers.get("svix-timestamp") ?? "",
      body: raw,
      signatureHeader: req.headers.get("svix-signature") ?? "",
    });
    if (!ok) return json({ error: "bad signature" }, 401);

    let event: unknown;
    try {
      event = JSON.parse(raw);
    } catch {
      return json({ ignored: "invalid json" });
    }
    const meta = receivedMeta(event);
    if (!meta) return json({ ignored: "not email.received" });

    const token = pickInboundToken(meta.candidates);
    if (!token) return json({ ignored: "no inbox address" });

    const { data: owner } = await admin
      .from("user_settings")
      .select("user_id")
      .eq("inbound_token", token)
      .maybeSingle();
    if (!owner?.user_id) return json({ ignored: "no matching inbox address" });
    const userId = owner.user_id as string;

    const { data: seen } = await admin
      .from("inbound_emails")
      .select("email_id, task_id")
      .eq("email_id", meta.emailId)
      .maybeSingle();
    if (seen?.task_id) return json({ ignored: "duplicate", task_id: seen.task_id });

    // Count before claiming so a 429 does not park the email_id forever.
    const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
    const { count } = await admin
      .from("inbound_emails")
      .select("email_id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("received_at", oneMinAgo);
    if ((count ?? 0) >= RATE_LIMIT_PER_MIN) {
      await logSync("email", "inbound", "error", "rate limited", userId);
      return json({ error: "rate limited" }, 429);
    }

    if (!seen) {
      const { error: claimErr } = await admin.from("inbound_emails").insert({
        email_id: meta.emailId,
        user_id: userId,
        from_address: meta.from || null,
        subject: meta.subject || null,
      });
      if (claimErr) {
        if (/duplicate key|inbound_emails_pkey/i.test(claimErr.message)) {
          const { data: again } = await admin
            .from("inbound_emails")
            .select("task_id")
            .eq("email_id", meta.emailId)
            .maybeSingle();
          if (again?.task_id) return json({ ignored: "duplicate", task_id: again.task_id });
        } else {
          throw new Error(`inbound_emails insert: ${claimErr.message}`);
        }
      }
    }

    let text: string | null = null;
    let html: string | null = null;
    const bodyRes = await fetch(`https://api.resend.com/emails/receiving/${meta.emailId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (bodyRes.ok) {
      const mail = (await bodyRes.json()) as { text?: string | null; html?: string | null; from?: string };
      text = mail.text ?? null;
      html = mail.html ?? null;
      if (!meta.from && typeof mail.from === "string") meta.from = mail.from;
    } else if (bodyRes.status >= 500) {
      throw new Error(`Resend fetch ${bodyRes.status}: ${await bodyRes.text()}`);
    }
    // 4xx: Resend no longer has the body. Still capture the subject so the
    // mail is not lost; notes will be From + whatever metadata we have.

    const title = titleFromSubject(meta.subject, meta.from);
    const notes = notesFromMail({
      from: meta.from,
      text,
      html,
      attachments: meta.attachments,
    });

    const { data: task, error } = await admin
      .from("tasks")
      .insert({
        user_id: userId,
        title,
        notes,
        status: "inbox",
        source: "email",
      })
      .select("id")
      .single();
    if (error) throw new Error(`task insert: ${error.message}`);

    await admin
      .from("inbound_emails")
      .update({ task_id: task.id, from_address: meta.from || null, subject: meta.subject || null })
      .eq("email_id", meta.emailId);

    await logSync("email", "inbound", "ok", undefined, userId);
    return json({ ok: true, task_id: task.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[inbound-email]", msg);
    await logSync("email", "inbound", "error", msg);
    return json({ error: msg }, 500);
  }
});
