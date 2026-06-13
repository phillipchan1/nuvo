import { useEffect, useState } from "react";

// The breakpoint below which the app switches from the desktop spine/rail/calendar
// layout to the single-column mobile shell. 768px keeps tablets in portrait on
// mobile (where the dense desktop layout is unusable) but lets landscape iPads
// and laptops keep the full experience.
export const MOBILE_BREAKPOINT = 768;

const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function read(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

/** True when the viewport is phone-sized. Reacts to rotation / resize. */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(read);

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(QUERY);
    const onChange = () => setMobile(mq.matches);
    onChange();
    // Safari < 14 only supports addListener
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  return mobile;
}
