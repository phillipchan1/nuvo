import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { recognize, type Recognized } from "./recognize";

// Renders an event's description/notes as safe React — no dangerouslySetInnerHTML.
// A plain URL in the text (ICS/Teams invites paste the join link straight into the
// body, not `location`) and a real `<a>` tag (Google's HTML description) both need
// to end up as a tappable link, or the Zoom/Meet/Teams join link is just inert
// text — the one thing you opened the event for. Shared so every surface that
// shows a description (desktop popover, mobile sheet) can find and join the same
// meeting link the same way. What counts as a link — a URL, an email, a phone
// number — is `lib/recognize.ts`, and the same renderer draws a task's notes.
//
// Invite bodies are built for email, not for a 250px column: Google's
// `-::~:~::~:…::-` fence, Teams' 80-underscore rules, 100-character join URLs
// and a seventeen-line dial-in list. Those unbroken runs used to push the column
// sideways (a horizontal scrollbar inside the card), and the whole body made the
// card scroll for a page. So: a fence is drawn as a rule, any run wraps where it
// must (`overflow-wrap: anywhere`), and a long body opens clamped with
// "Show all".

/** A line that is only punctuation drawn as a divider — Google's fence, Teams'
 *  underscore rule, an ASCII line of dashes or box-drawing. */
const FENCE_RE = /-::~[:~]*::-|_{12,}|[-─—=]{12,}/g;

/** The ONE anchor for anything `recognize` finds — a URL, an email, a phone number.
 *  `target="_blank"` on purpose, `tel:` and `mailto:` included: the native shells open
 *  links through tauri-plugin-opener, whose click handler only takes `_blank` anchors
 *  (see tests/external-links.test.ts). The vertical padding is a thumb-sized hit area on
 *  a touch screen — an inline element's padding grows what you can tap without moving
 *  a line of text. Shared with the task notes field, so a number reads the same in an
 *  invite and in a note.
 *
 *  No `break-all` / `nowrap`: a link wraps exactly as the words around it do, and only a
 *  run too long for its own line breaks (the container's `overflow-wrap: anywhere`).
 *  `break-all` split `maya` / `@example.com` across a line end while the notes
 *  textarea moved the whole address down — so the field jumped every time it swapped
 *  between reading and editing. */
export function renderRecognized(parts: Recognized[], keyBase: string): React.ReactNode[] {
  return parts.map((p, i) =>
    p.kind === "text" ? (
      p.text
    ) : (
      <a key={`${keyBase}-${i}`} href={p.href} target="_blank" rel="noopener noreferrer"
        className="text-accent underline-offset-2 hover:underline [@media(pointer:coarse)]:py-3">
        {p.text}
      </a>
    ),
  );
}

function linkifyRun(text: string, keyBase: string): React.ReactNode[] {
  return renderRecognized(recognize(text), keyBase);
}

function linkifyText(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  FENCE_RE.lastIndex = 0;
  while ((m = FENCE_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(...linkifyRun(text.slice(last, m.index), `t${last}`));
    parts.push(<hr key={`f${m.index}`} className="my-2 border-0 border-t border-line" />);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(...linkifyRun(text.slice(last), `t${last}`));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

/** `inLink`: already inside an `<a>`, where a second anchor would be invalid HTML. */
function domToReact(node: Node, key: number, inLink = false): React.ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.textContent ?? "";
    if (!t) return null;
    return <React.Fragment key={key}>{inLink ? t : linkifyText(t)}</React.Fragment>;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const href = tag === "a" ? (el.getAttribute("href") ?? "") : "";
  const linked = inLink || (tag === "a" && /^https?:\/\//.test(href));
  const kids = Array.from(el.childNodes).map((n, i) => domToReact(n, i, linked));
  switch (tag) {
    case "a": {
      if (/^https?:\/\//.test(href))
        return <a key={key} href={href} target="_blank" rel="noopener noreferrer"
          className="text-accent underline-offset-2 hover:underline break-all">{kids}</a>;
      return <React.Fragment key={key}>{kids}</React.Fragment>;
    }
    case "br": return <br key={key} />;
    case "hr": return <hr key={key} className="my-2 border-0 border-t border-line" />;
    case "p": return el.textContent?.trim() ? <p key={key}>{kids}</p> : null;
    case "b": case "strong": return <strong key={key}>{kids}</strong>;
    case "i": case "em": return <em key={key}>{kids}</em>;
    case "ul": return <ul key={key} className="list-disc pl-4 space-y-0.5">{kids}</ul>;
    case "ol": return <ol key={key} className="list-decimal pl-4 space-y-0.5">{kids}</ol>;
    case "li": return <li key={key}>{kids}</li>;
    default: return <React.Fragment key={key}>{kids}</React.Fragment>;
  }
}

/** `className` supplies the type scale (`text-caption` on desktop, `text-body`
 *  on the phone) — it isn't baked in here so the two never fight over which
 *  `text-*` utility wins the cascade. `clampLines` opens a long body folded
 *  to about that many lines, with a "Show all" toggle; omitted, it's all shown. */
export function DescriptionHtml({
  html,
  className,
  clampLines,
}: {
  html: string;
  className: string;
  clampLines?: number;
}) {
  const nodes = useMemo(() => {
    // Plain text (an ICS/Teams body, or one this app wrote) keeps its line
    // breaks; it is not HTML, and parsing it as such would collapse them.
    const isHtml = /<[a-z][\s\S]*>/i.test(html);
    const source = isHtml ? html : html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>");
    const doc = new DOMParser().parseFromString(source, "text/html");
    return Array.from(doc.body.childNodes).map((n, i) => domToReact(n, i));
  }, [html]);

  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !clampLines) return;
    setOverflows(el.scrollHeight > el.clientHeight + 2);
  }, [nodes, clampLines]);
  useLayoutEffect(() => setOpen(false), [html]);

  const clamped = Boolean(clampLines) && !open;
  return (
    <div className="min-w-0">
      <div
        ref={ref}
        className={`min-w-0 space-y-1.5 leading-relaxed text-text [overflow-wrap:anywhere] [&_p]:mb-1 [&_ul]:my-1 [&_ol]:my-1 ${className} ${
          clamped ? "overflow-hidden" : ""
        }`}
        style={
          clamped
            ? {
                maxHeight: `${clampLines! * 1.625}em`,
                // Fade the last line rather than cutting it mid-glyph.
                WebkitMaskImage: overflows ? "linear-gradient(to bottom, black 70%, transparent)" : undefined,
                maskImage: overflows ? "linear-gradient(to bottom, black 70%, transparent)" : undefined,
              }
            : undefined
        }
      >
        {nodes}
      </div>
      {clampLines && (overflows || open) && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="fast mt-1 text-label font-medium text-accent hover:underline"
          aria-expanded={open}
        >
          {open ? "Show less" : "Show all"}
        </button>
      )}
    </div>
  );
}
