import type { ReactNode } from "react";
import type { MatchRange } from "../../lib/search";

/** The matched words in full ink, the rest a step quieter — weight and ink, no
 *  colour: colour is semantic here, and "you typed this" isn't a meaning. */
export default function Highlight({ text, ranges }: { text: string; ranges: readonly MatchRange[] }) {
  if (!ranges.length) return <>{text}</>;
  const out: ReactNode[] = [];
  let i = 0;
  ranges.forEach(([a, b], k) => {
    if (a > i) out.push(text.slice(i, a));
    out.push(
      <mark key={k} className="ks-hit">
        {text.slice(a, b)}
      </mark>,
    );
    i = b;
  });
  if (i < text.length) out.push(text.slice(i));
  return <>{out}</>;
}
