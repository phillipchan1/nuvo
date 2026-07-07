import { useSyncExternalStore } from "react";

// ── Appearance store ───────────────────────────────────────────────────────
// Two coupled, device-local axes (neither synced to the settings row):
//
//   MATERIAL (data-skin)  — glass vs. flat vs. mono vs. print vs. paper.
//   SCHEME   (data-palette) — the colour set *within* a material. Each material
//                             owns its OWN schemes: Paper wears warmth moods,
//                             Terminal wears editor themes (Ayu/Ocean/…), etc.
//
// A scheme is remembered PER material, so switching skins restores the scheme
// you last used for it. "paper" carries no data-skin attribute (the base CSS is
// the paper skin); its scheme ids stay daybreak/dusk/fog so the original palette
// CSS keeps matching. The attribute stays `data-palette` for the same reason.
export type Skin = "paper" | "flat" | "terminal" | "blueprint" | "eink";

export const SKIN_LABELS: Record<Skin, { name: string; hint: string }> = {
  paper: { name: "Aurora", hint: "Warm glass" },
  flat: { name: "Flat", hint: "Crisp UI" },
  terminal: { name: "Terminal", hint: "Mono console" },
  blueprint: { name: "Blueprint", hint: "Drafting print" },
  eink: { name: "E-Ink", hint: "Restful paper" },
};

type Swatch = { bg: string; surface: string; line: string; accent: string };
export type SchemeModes = "both" | "dark" | "light";
export type Scheme = {
  id: string;
  name: string;
  hint: string;
  // Which light/dark modes this scheme supports. "both" → the theme toggle
  // drives it (separate light+dark CSS). "dark"/"light" → self-contained; the
  // theme toggle can't change it (e.g. Dracula is dark, Whiteprint is light).
  // Omitted = "both".
  modes?: SchemeModes;
  // Preview colours for the picker. For single-mode schemes light === dark.
  light: Swatch;
  dark: Swatch;
};

/** The light/dark modes a scheme supports (default "both"). */
export function schemeModes(skin: Skin, id: string): SchemeModes {
  return SCHEMES[skin].find((s) => s.id === id)?.modes ?? "both";
}

// The label the scheme picker wears for each material — moods for paper, editor
// themes for terminal, and so on. The name is the material's vernacular.
export const SCHEME_GROUP: Record<Skin, { label: string; hint: string }> = {
  paper: { label: "Mood", hint: "The warmth of the paper. Switch it whenever the day calls for it." },
  flat: { label: "Tone", hint: "The temperature of the white — neutral, cool, or warm." },
  terminal: { label: "Color scheme", hint: "Editor themes, straight from your terminal. Pick your flavor." },
  blueprint: { label: "Print", hint: "How the drawing is printed — cyanotype, whiteprint, or sepia." },
  eink: { label: "Tint", hint: "The cast of the paper — a grey, sepia, or cool reader." },
};

// The scheme catalogue. The FIRST scheme of each material is its default (and is
// the one the material's base CSS already paints, so it needs no scheme block).
// The real token values live in index.css; these entries drive the picker + the
// list of valid ids per material.
export const SCHEMES: Record<Skin, Scheme[]> = {
  paper: [
    { id: "daybreak", name: "Daybreak", hint: "Warm paper",
      light: { bg: "#f4f1ea", surface: "#fffdf8", line: "#e7e0d2", accent: "#92568a" },
      dark:  { bg: "#17130e", surface: "#201b14", line: "#332c20", accent: "#c692bf" } },
    { id: "dusk", name: "Dusk", hint: "Balanced",
      light: { bg: "#f1f0f3", surface: "#ffffff", line: "#e6e4ec", accent: "#6d54c0" },
      dark:  { bg: "#16151c", surface: "#1e1d26", line: "#302e3b", accent: "#9a86f0" } },
    { id: "fog", name: "Fog", hint: "Cool grey",
      light: { bg: "#eef0f5", surface: "#ffffff", line: "#e4e6ef", accent: "#5a4be2" },
      dark:  { bg: "#141320", surface: "#1c1a28", line: "#2d2b3d", accent: "#8b80ff" } },
  ],
  flat: [
    { id: "snow", name: "Snow", hint: "Pure white",
      light: { bg: "#ffffff", surface: "#ffffff", line: "#ececef", accent: "#92568a" },
      dark:  { bg: "#0c0c0e", surface: "#161619", line: "#26262b", accent: "#c692bf" } },
    { id: "arctic", name: "Arctic", hint: "Cool indigo",
      light: { bg: "#f6f8fc", surface: "#ffffff", line: "#e5eaf3", accent: "#4f46e5" },
      dark:  { bg: "#0b0d13", surface: "#141720", line: "#232936", accent: "#8b93ff" } },
    { id: "linen", name: "Linen", hint: "Warm ivory",
      light: { bg: "#fdfbf6", surface: "#ffffff", line: "#ebe4d7", accent: "#b06a3c" },
      dark:  { bg: "#100f0b", surface: "#1a1714", line: "#2a2620", accent: "#d69b6a" } },
  ],
  terminal: [
    { id: "phosphor", name: "Phosphor", hint: "Green CRT", modes: "dark",
      light: { bg: "#0b0e0a", surface: "#101510", line: "#1e2b19", accent: "#8fef5a" },
      dark:  { bg: "#0b0e0a", surface: "#101510", line: "#1e2b19", accent: "#8fef5a" } },
    { id: "ayu", name: "Ayu", hint: "Warm mirage", modes: "dark",
      light: { bg: "#0f131a", surface: "#1a1f29", line: "#2a3341", accent: "#ffb454" },
      dark:  { bg: "#0f131a", surface: "#1a1f29", line: "#2a3341", accent: "#ffb454" } },
    { id: "ocean", name: "Ocean", hint: "Deep slate", modes: "dark",
      light: { bg: "#0f1b26", surface: "#16232e", line: "#25333f", accent: "#5ccfe6" },
      dark:  { bg: "#0f1b26", surface: "#16232e", line: "#25333f", accent: "#5ccfe6" } },
    { id: "dracula", name: "Dracula", hint: "Purple night", modes: "dark",
      light: { bg: "#282a36", surface: "#343746", line: "#44475a", accent: "#bd93f9" },
      dark:  { bg: "#282a36", surface: "#343746", line: "#44475a", accent: "#bd93f9" } },
    { id: "nord", name: "Nord", hint: "Arctic frost", modes: "dark",
      light: { bg: "#2e3440", surface: "#3b4252", line: "#434c5e", accent: "#88c0d0" },
      dark:  { bg: "#2e3440", surface: "#3b4252", line: "#434c5e", accent: "#88c0d0" } },
    { id: "gruvbox", name: "Gruvbox", hint: "Light & dark",
      light: { bg: "#fbf1c7", surface: "#f9f5d7", line: "#ebdbb2", accent: "#b57614" },
      dark:  { bg: "#282828", surface: "#32302f", line: "#3c3836", accent: "#fabd2f" } },
    { id: "one", name: "One", hint: "Light & dark",
      light: { bg: "#fafafa", surface: "#ffffff", line: "#e5e5e6", accent: "#4078f2" },
      dark:  { bg: "#282c34", surface: "#2c313a", line: "#3b414d", accent: "#61afef" } },
    { id: "tokyonight", name: "Tokyo Night", hint: "Neon dusk", modes: "dark",
      light: { bg: "#1a1b26", surface: "#24283b", line: "#343a52", accent: "#7aa2f7" },
      dark:  { bg: "#1a1b26", surface: "#24283b", line: "#343a52", accent: "#7aa2f7" } },
    { id: "monokai", name: "Monokai", hint: "Classic dark", modes: "dark",
      light: { bg: "#272822", surface: "#31322a", line: "#49483e", accent: "#a6e22e" },
      dark:  { bg: "#272822", surface: "#31322a", line: "#49483e", accent: "#a6e22e" } },
    { id: "solarized", name: "Solarized", hint: "Light & dark",
      light: { bg: "#fdf6e3", surface: "#fffbf0", line: "#eee8d5", accent: "#268bd2" },
      dark:  { bg: "#002b36", surface: "#073642", line: "#0f4b57", accent: "#268bd2" } },
    { id: "catppuccin", name: "Catppuccin", hint: "Latte & Mocha",
      light: { bg: "#eff1f5", surface: "#ffffff", line: "#e6e9ef", accent: "#8839ef" },
      dark:  { bg: "#1e1e2e", surface: "#28283e", line: "#3a3a52", accent: "#cba6f7" } },
  ],
  blueprint: [
    { id: "cyanotype", name: "Cyanotype", hint: "Deep blue", modes: "dark",
      light: { bg: "#0e2c46", surface: "#143a56", line: "#2c5a7a", accent: "#ffd166" },
      dark:  { bg: "#0e2c46", surface: "#143a56", line: "#2c5a7a", accent: "#ffd166" } },
    { id: "whiteprint", name: "Whiteprint", hint: "Ink on white", modes: "light",
      light: { bg: "#eef3f8", surface: "#ffffff", line: "#ccdcea", accent: "#1c5a8a" },
      dark:  { bg: "#eef3f8", surface: "#ffffff", line: "#ccdcea", accent: "#1c5a8a" } },
    { id: "sepia", name: "Sepia", hint: "Aged draft", modes: "dark",
      light: { bg: "#241c12", surface: "#2e2416", line: "#453a26", accent: "#e0a850" },
      dark:  { bg: "#241c12", surface: "#2e2416", line: "#453a26", accent: "#e0a850" } },
  ],
  eink: [
    { id: "paperwhite", name: "Paperwhite", hint: "Warm grey",
      light: { bg: "#e9e6de", surface: "#f2efe8", line: "#d5d0c3", accent: "#3a3733" },
      dark:  { bg: "#1a1a18", surface: "#242320", line: "#33322e", accent: "#cbc6ba" } },
    { id: "sepia", name: "Sepia", hint: "Kindle warm",
      light: { bg: "#e4d9c3", surface: "#efe6d3", line: "#d3c4a3", accent: "#5a4a2f" },
      dark:  { bg: "#211c14", surface: "#2a251b", line: "#3a3324", accent: "#c9b98f" } },
    { id: "carta", name: "Carta", hint: "Cool grey",
      light: { bg: "#ecedf0", surface: "#f6f7f9", line: "#d7dbe0", accent: "#3a3d42" },
      dark:  { bg: "#191a1c", surface: "#232527", line: "#323538", accent: "#c6cace" } },
  ],
};

const SKINS = Object.keys(SKIN_LABELS) as Skin[];
const SKIN_KEY = "nuvo.skin";
const SCHEME_KEY = "nuvo.scheme"; // JSON: { [skin]: schemeId }
const LEGACY_PALETTE_KEY = "nuvo.palette"; // pre-scheme global mood → seeds paper

function defaultScheme(skin: Skin): string {
  return SCHEMES[skin][0].id;
}

function readSkin(): Skin {
  try {
    const v = localStorage.getItem(SKIN_KEY) as Skin | null;
    if (v && SKINS.includes(v)) return v;
  } catch { /* ignore */ }
  return "paper";
}

function readSchemes(): Record<Skin, string> {
  const out = {} as Record<Skin, string>;
  for (const s of SKINS) out[s] = defaultScheme(s);
  try {
    const raw = localStorage.getItem(SCHEME_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Record<Skin, string>>;
      for (const s of SKINS) {
        const id = saved[s];
        if (id && SCHEMES[s].some((sc) => sc.id === id)) out[s] = id;
      }
    } else {
      // Migrate the old global mood into paper's scheme (daybreak/dusk/fog).
      const legacy = localStorage.getItem(LEGACY_PALETTE_KEY);
      if (legacy && SCHEMES.paper.some((sc) => sc.id === legacy)) out.paper = legacy;
    }
  } catch { /* ignore */ }
  return out;
}

let skin: Skin = readSkin();
let schemeBySkin: Record<Skin, string> = readSchemes();
const listeners = new Set<() => void>();

function currentScheme(): string {
  return schemeBySkin[skin] ?? defaultScheme(skin);
}

// Paint BOTH axes together — the scheme is meaningless without its material.
function apply() {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (skin === "paper") delete el.dataset.skin;
  else el.dataset.skin = skin;
  el.dataset.palette = currentScheme();
}

// First paint before React mounts (no flash).
apply();

function notify() {
  listeners.forEach((l) => l());
}

export function setSkin(s: Skin) {
  if (s === skin) return;
  skin = s;
  try { localStorage.setItem(SKIN_KEY, s); } catch { /* ignore */ }
  apply(); // re-applies this material's remembered scheme too
  notify();
}

export function setScheme(id: string) {
  if (!SCHEMES[skin].some((sc) => sc.id === id)) return;
  if (schemeBySkin[skin] === id) return;
  schemeBySkin = { ...schemeBySkin, [skin]: id };
  try { localStorage.setItem(SCHEME_KEY, JSON.stringify(schemeBySkin)); } catch { /* ignore */ }
  apply();
  notify();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Read + set the active material. Re-renders consumers on change. */
export function useSkin(): [Skin, (s: Skin) => void] {
  const s = useSyncExternalStore(subscribe, () => skin, () => skin);
  return [s, setSkin];
}

/** The active scheme + the schemes available for the current material. */
export function useScheme(): { scheme: string; schemes: Scheme[]; setScheme: (id: string) => void } {
  const s = useSyncExternalStore(subscribe, () => skin, () => skin);
  const scheme = useSyncExternalStore(subscribe, () => currentScheme(), () => currentScheme());
  return { scheme, schemes: SCHEMES[s], setScheme };
}
