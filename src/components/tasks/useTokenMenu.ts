/**
 * `#label` / `@home` suggestions for a plain text field.
 *
 * The field stays a plain `<input>` / `<textarea>` (iOS dictation needs one);
 * picking a suggestion only rewrites its value. Shared by the task add box and
 * ⌘K so the two can't suggest different things for the same keystroke.
 */

import { useMemo, useState } from "react";
import { routeKey, type RouteTarget } from "../../lib/nlp";
import type { Label } from "../../lib/types";

export interface TokenMatch {
  insert: string;
  label: string;
  hint?: string;
  color?: string | null;
}

export interface TokenMenu {
  open: boolean;
  trigger: "#" | "@" | null;
  matches: TokenMatch[];
  index: number;
  setIndex: (i: number) => void;
  move: (by: number) => void;
  dismiss: () => void;
  /** The field's next value and caret after taking `match`. */
  accept: (match: TokenMatch) => { text: string; caret: number };
}

const CAP = 6;

export function useTokenMenu({
  text,
  caret,
  labels,
  routeTargets,
  colorOf,
  enabled = true,
}: {
  text: string;
  caret: number;
  labels: Label[];
  routeTargets: RouteTarget[];
  /** A home's identity colour, for the swatch beside it. */
  colorOf?: (t: RouteTarget) => string | null;
  enabled?: boolean;
}): TokenMenu {
  const [index, setIndex] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);

  const token = useMemo(() => {
    if (!enabled) return null;
    const upto = text.slice(0, caret);
    // The token under the caret: a #/@ trigger with no whitespace since.
    const m = upto.match(/(^|\s)([#@])([\w-]*)$/);
    if (!m) return null;
    return { trigger: m[2] as "#" | "@", query: m[3], start: caret - m[3].length - 1 };
  }, [text, caret, enabled]);

  const matches = useMemo<TokenMatch[]>(() => {
    if (!token) return [];
    const q = routeKey(token.query);
    if (token.trigger === "#") {
      return labels
        .filter((l) => routeKey(l.name).startsWith(q))
        .slice(0, CAP)
        .map((l) => ({ insert: `#${l.name.replace(/\s+/g, "-")}`, label: `#${l.name}`, color: l.color }));
    }
    const rank = { project: 0, initiative: 1, domain: 2 } as const;
    return routeTargets
      .filter((t) => routeKey(t.name).includes(q))
      .sort((a, b) => {
        const pa = routeKey(a.name).startsWith(q) ? 0 : 1;
        const pb = routeKey(b.name).startsWith(q) ? 0 : 1;
        return pa - pb || rank[a.kind] - rank[b.kind];
      })
      .slice(0, CAP)
      .map((t) => ({
        insert: `@${t.name.replace(/\s+/g, "-")}`,
        label: t.name,
        hint: t.kind,
        color: colorOf?.(t) ?? null,
      }));
  }, [token, labels, routeTargets, colorOf]);

  const key = token ? `${token.start}:${token.trigger}` : null;
  const open = matches.length > 0 && key !== dismissedAt;
  const safeIndex = matches.length ? Math.min(index, matches.length - 1) : 0;

  return {
    open,
    trigger: token?.trigger ?? null,
    matches,
    index: safeIndex,
    setIndex,
    move: (by) => {
      if (!matches.length) return;
      setIndex((safeIndex + by + matches.length) % matches.length);
    },
    dismiss: () => setDismissedAt(key),
    accept: (match) => {
      if (!token) return { text, caret };
      const before = text.slice(0, token.start);
      const after = text.slice(caret).replace(/^\s+/, "");
      setIndex(0);
      return { text: `${before}${match.insert} ${after}`, caret: before.length + match.insert.length + 1 };
    },
  };
}
