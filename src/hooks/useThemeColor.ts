import { useEffect } from "react";

// Keep <meta name="theme-color"> — the browser chrome / iOS status-bar ground —
// in step with the RESOLVED --bg, whatever combination of data-theme /
// data-skin / data-palette produced it. The two static media-attributed tags in
// index.html only know the default Warm Paper pair; a dark-in-light-OS user (or
// any skin) got a mismatched bar. Watches the <html> attributes and re-reads
// the computed token.
export function useThemeColor() {
  useEffect(() => {
    const apply = () => {
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
      if (!bg) return;
      // One runtime-owned tag; the static media pair is removed on first run so
      // it can't fight this one.
      document
        .querySelectorAll('meta[name="theme-color"][media]')
        .forEach((el) => el.remove());
      let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = "theme-color";
        document.head.appendChild(meta);
      }
      meta.content = bg;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-skin", "data-palette"],
    });
    return () => observer.disconnect();
  }, []);
}
