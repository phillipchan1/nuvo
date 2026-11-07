// Shortcut hints in the platform's own spelling. The app's hints are authored
// in Mac glyphs ("⌘K", "⇧⌘Z", "⌥↑"); on Windows/Linux the same string reads
// "Ctrl+K", "Ctrl+Shift+Z", "Alt+↑". Handlers already accept metaKey||ctrlKey,
// so only the label was wrong.

import { isMac } from "./platform";

const WORD: Record<string, string> = { "⌘": "Ctrl", "⌃": "Ctrl", "⌥": "Alt", "⇧": "Shift" };
const ORDER = ["⌃", "⌘", "⌥", "⇧"];

export function shortcutLabel(mac: string, onMac: boolean = isMac()): string {
  if (onMac) return mac;
  const mods: string[] = [];
  let rest = mac;
  // Leading modifier glyphs, in any authored order.
  while (rest.length && WORD[rest[0]]) {
    mods.push(rest[0]);
    rest = rest.slice(1);
  }
  if (mods.length === 0) return mac;
  const words = ORDER.filter((g) => mods.includes(g)).map((g) => WORD[g]);
  // ⌘ and ⌃ both become Ctrl — say it once.
  const uniq = words.filter((w, i) => words.indexOf(w) === i);
  return [...uniq, rest.trim()].join("+");
}
