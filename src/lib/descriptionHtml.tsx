import React, { useMemo } from "react";

// Renders an event's description/notes as safe React — no dangerouslySetInnerHTML.
// A plain URL in the text (ICS/Teams invites paste the join link straight into the
// body, not `location`) and a real `<a>` tag (Google's HTML description) both need
// to end up as a tappable link, or the Zoom/Meet/Teams join link is just inert
// text — the one thing you opened the event for. Shared so every surface that
// shows a description (desktop popover, mobile sheet) can find and join the same
// meeting link the same way.

function linkifyText(text: string): React.ReactNode {
  const URL_RE = /https?:\/\/[^\s<>"]+/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <a key={m.index} href={m[0]} target="_blank" rel="noopener noreferrer"
        className="text-accent underline-offset-2 hover:underline break-all">
        {m[0]}
      </a>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

function domToReact(node: Node, key: number): React.ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.textContent ?? "";
    return t ? <React.Fragment key={key}>{linkifyText(t)}</React.Fragment> : null;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const kids = Array.from(el.childNodes).map((n, i) => domToReact(n, i));
  switch (tag) {
    case "a": {
      const href = el.getAttribute("href") ?? "";
      if (/^https?:\/\//.test(href))
        return <a key={key} href={href} target="_blank" rel="noopener noreferrer"
          className="text-accent underline-offset-2 hover:underline break-all">{kids}</a>;
      return <React.Fragment key={key}>{kids}</React.Fragment>;
    }
    case "br": return <br key={key} />;
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
 *  `text-*` utility wins the cascade. */
export function DescriptionHtml({ html, className }: { html: string; className: string }) {
  const nodes = useMemo(() => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return Array.from(doc.body.childNodes).map((n, i) => domToReact(n, i));
  }, [html]);
  return (
    <div className={`space-y-1.5 leading-relaxed text-text [&_p]:mb-1 [&_ul]:my-1 [&_ol]:my-1 ${className}`}>
      {nodes}
    </div>
  );
}
