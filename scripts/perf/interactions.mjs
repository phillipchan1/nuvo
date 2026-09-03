/**
 * The interactions the budget covers. Adding a surface? Add it here — an
 * interaction nobody measures is one nobody notices getting slower.
 *
 * `act(i)` returns an expression evaluated in the page. Alternate on `i` so a
 * repeated trial genuinely changes state: clicking "Inbox" when already on
 * Inbox measures nothing and quietly reports a perfect score.
 */
export const INTERACTIONS = [
  { key: "nav:projects",    label: "⌘2  → Projects",      act: () => `window.__key('2',true); return 1;` },
  { key: "nav:initiatives", label: "⌘3  → Initiatives",   act: () => `window.__key('3',true); return 1;` },
  { key: "nav:domains",     label: "⌘4  → Domains",       act: () => `window.__key('4',true); return 1;` },
  { key: "nav:schedule",    label: "⌘1  → Schedule",      act: () => `window.__key('1',true); return 1;` },

  { key: "cal:day",   label: "lens Week ↔ Day",   act: (i) => i % 2 ? `window.__btn('Week')?.click(); return 1;` : `window.__btn('Day')?.click(); return 1;` },
  { key: "cal:month", label: "lens Week ↔ Month", act: (i) => i % 2 ? `window.__btn('Week')?.click(); return 1;` : `window.__btn('Month')?.click(); return 1;` },
  { key: "cal:year",  label: "lens Week ↔ Year",  act: (i) => i % 2 ? `window.__btn('Week')?.click(); return 1;` : `window.__btn('Year')?.click(); return 1;` },

  { key: "cal:travel", label: "week travel (next/prev)", act: (i) => i % 2 ? `window.__btn('Previous')?.click(); return 1;` : `window.__btn('Next')?.click(); return 1;` },
  { key: "cal:today",  label: "Today",                   act: () => `window.__btn('Go to today')?.click(); return 1;` },

  { key: "rail:tabs", label: "rail Today ↔ Inbox", act: (i) => i % 2 ? `window.__btn('Today')?.click(); return 1;` : `window.__btn('Inbox')?.click(); return 1;` },

  { key: "popover:open", label: "open event popover",
    act: (i) => `const evs=[...document.querySelectorAll('.fc-event')].filter(x=>x.offsetHeight>10&&x.isConnected);`
              + `const e=evs[${i}%evs.length]||evs[0]; e.dispatchEvent(new MouseEvent('click',{bubbles:true})); return 1;` },

  { key: "focus:toggle", label: "focus mode ⌘.",   act: () => `window.__key('.',true); return 1;` },
  { key: "settings:open", label: "open Settings",  act: (i) => i % 2 ? `window.__key('Escape'); return 1;` : `window.__btn('Settings')?.click(); return 1;` },
];
