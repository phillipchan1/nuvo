// What a run of free text holds that you can ACT on — a URL, an email address, a
// phone number. Pure: no React, no DOM, so the notes field, an event's
// description and the tests all read the same answer.
//
// This is recognition, not formatting. A task's `notes` stays the plain string it
// has always been (it travels to the agent's prompt, the inbound-email body and
// the calendar record, none of which render markup), and the app finds the
// actionable things in it at READ time. Nothing is stored, nothing is required,
// and text that holds nothing recognisable renders as exactly what was typed.
//
// The one rule that shapes every pattern below: **a missed link costs nothing, a
// wrong one costs a bad tap** — a phone number that dials a stranger. So the
// phone patterns are narrow on purpose. We recognise `+<country> …` anywhere in
// the world, and the North-American shapes (`(626) 555-0100`, `1-800-921-8101`);
// a national-format number from elsewhere with no `+` is left as plain text
// rather than guessed at. A bare run of digits is never a phone number — it is
// an order number, a year, a confirmation code.

export type Recognized =
  | { kind: "text"; text: string }
  | { kind: "url" | "email" | "phone"; text: string; href: string };

const NBSP = String.fromCharCode(0xa0); // pasted numbers often carry one between groups
/** What separates the groups of a phone number — never a newline, or the end of
 *  one line would join the start of the next. */
const SEP = String.raw`[ ${NBSP}.-]`;

/** A North-American candidate has to LOOK formatted: a space, dot, hyphen or paren in it. */
const FORMATTED = new RegExp(`[ ${NBSP}.()-]`);

const URL_SRC = String.raw`https?:\/\/[^\s<>"]+`;
const EMAIL_SRC = String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}`;
/** `+<country>` then a national number in 2–5 groups: +44 20 7946 0958 · +33 1 23 45 67 89 ·
 *  +1 (323) 555-0100. Only the first group after the country code may be a single digit. */
const INTL_SRC = String.raw`\+\d{1,3}${SEP}?(?:\(\d{1,4}\)${SEP}?)?\d{1,4}(?:${SEP}?\d{2,4}){1,4}`;
/** North American: an optional 1, a 3-digit area code and a 3-digit exchange that don't
 *  start with 0 or 1 (the plan's own rule — it is what keeps `123-456-7890` and most
 *  dates out), then four digits. */
const NANP_SRC = String.raw`(?:1${SEP}?)?(?:\([2-9]\d{2}\)|[2-9]\d{2})${SEP}?[2-9]\d{2}${SEP}?\d{4}`;

const TOKEN_SRC = `(${URL_SRC})|(${EMAIL_SRC})|(${INTL_SRC})|(${NANP_SRC})`;

/** Characters that, sitting right before a candidate, mean it is the tail of something
 *  longer — an id, a path, an address — and not a number of its own. */
const BAD_BEFORE = /[A-Za-z0-9_@/\\+.-]/;

function countOf(s: string, ch: string): number {
  return s.split(ch).length - 1;
}

/** A URL at the end of a sentence doesn't own the sentence's punctuation, and a
 *  parenthesised one doesn't own the closing paren — but Wikipedia's `Foo_(bar)` does. */
function trimUrl(url: string): string {
  let s = url;
  for (;;) {
    const last = s[s.length - 1];
    if (last === undefined) return s;
    if (/[.,;:!?'"]/.test(last)) s = s.slice(0, -1);
    else if (last === ")" && countOf(s, "(") < countOf(s, ")")) s = s.slice(0, -1);
    else if (last === "]" && countOf(s, "[") < countOf(s, "]")) s = s.slice(0, -1);
    else return s;
  }
}

/** Is this phone-shaped candidate really a phone number, in the context it sits in? */
function acceptPhone(text: string, index: number, raw: string, international: boolean): boolean {
  const before = index > 0 ? text[index - 1] : "";
  if (before && BAD_BEFORE.test(before)) return false;
  const after = text.slice(index + raw.length, index + raw.length + 2);
  if (/^[A-Za-z0-9_@/]/.test(after) || /^[.-]\d/.test(after)) return false;

  const digits = raw.replace(/\D/g, "").length;
  if (international) return digits >= 8 && digits <= 15;
  // North American: ten digits, or eleven behind the leading 1 — and it has to LOOK
  // formatted. `6265550100` is as likely an account number as a phone.
  return (digits === 10 || digits === 11) && FORMATTED.test(raw);
}

/** Split `text` into plain runs and the things in it that can be acted on. The
 *  pieces always concatenate back to `text`, in order. */
export function recognize(text: string): Recognized[] {
  const out: Recognized[] = [];
  if (!text) return out;
  // A fresh matcher per call: a shared /g regex keeps `lastIndex` between callers.
  const re = new RegExp(TOKEN_SRC, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  const flushText = (end: number) => {
    if (end > last) out.push({ kind: "text", text: text.slice(last, end) });
  };

  while ((m = re.exec(text)) !== null) {
    const at = m.index;
    let hit: Recognized;
    if (m[1]) {
      const url = trimUrl(m[1]);
      if (!/^https?:\/\/[^\s]/.test(url)) {
        re.lastIndex = at + 1;
        continue;
      }
      re.lastIndex = at + url.length;
      hit = { kind: "url", text: url, href: url };
    } else if (m[2]) {
      hit = { kind: "email", text: m[2], href: `mailto:${m[2]}` };
    } else {
      const raw = m[3] ?? m[4];
      if (!acceptPhone(text, at, raw, Boolean(m[3]))) {
        re.lastIndex = at + 1;
        continue;
      }
      // Dial what was typed: digits, and a leading + if there was one. No country
      // code is invented — the phone reads a national number in its own region.
      hit = { kind: "phone", text: raw, href: `tel:${raw.startsWith("+") ? "+" : ""}${raw.replace(/\D/g, "")}` };
    }
    flushText(at);
    out.push(hit);
    last = at + hit.text.length;
  }
  flushText(text.length);
  return out;
}

/** Does this text hold anything worth turning into a link? */
export function hasRecognized(text: string): boolean {
  return recognize(text).some((p) => p.kind !== "text");
}
