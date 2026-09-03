/**
 * In-page instrumentation. Installed once per page load by run.mjs.
 *
 * The three numbers that matter, and why:
 *  - forcedLayout: every getBoundingClientRect / offset* / getComputedStyle call.
 *    This is the metric that found the real regressions — it is deterministic,
 *    unlike wall-clock, and it is what layout thrash actually is.
 *  - blockedMs: long tasks. What "the app froze" means.
 *  - dropped / worstFrameMs: real frame pacing. Only meaningful because the perf
 *    browser is genuinely visible — a hidden tab clamps timers to 1000ms and
 *    never runs requestAnimationFrame at all, which silently invalidates
 *    everything measured in it.
 */
const BODY = `
if (!window.__probe) {
  window.__probe = true;
  window.__L = 0;
  const bump = () => { window.__L++; };
  const wrapFn = (o,n) => { const f=o[n]; if(!f||f.__w) return;
    const g=function(...a){ bump(); return f.apply(this,a); }; g.__w=1; o[n]=g; };
  wrapFn(Element.prototype,'getBoundingClientRect');
  wrapFn(Element.prototype,'getClientRects');
  const wrapGet=(p,k)=>{ const d=Object.getOwnPropertyDescriptor(p,k); if(!d||!d.get||d.get.__w) return;
    const g=d.get, ng=function(){ bump(); return g.call(this); }; ng.__w=1;
    Object.defineProperty(p,k,{...d,get:ng}); };
  ['offsetTop','offsetLeft','offsetWidth','offsetHeight','offsetParent'].forEach(k=>wrapGet(HTMLElement.prototype,k));
  ['clientTop','clientLeft','clientWidth','clientHeight','scrollTop','scrollLeft','scrollWidth','scrollHeight'].forEach(k=>wrapGet(Element.prototype,k));
  const gcs=window.getComputedStyle; window.getComputedStyle=function(...a){ bump(); return gcs.apply(this,a); };

  window.__LT=[]; new PerformanceObserver(l=>{for(const e of l.getEntries()) window.__LT.push(Math.round(e.duration));}).observe({entryTypes:['longtask']});
  window.__EV=[]; new PerformanceObserver(l=>{for(const e of l.getEntries()) window.__EV.push(Math.round(e.duration));}).observe({type:'event',durationThreshold:16});

  window.__frames=[]; let last=performance.now(); let on=false;
  window.__frameOn=()=>{ window.__frames.length=0; last=performance.now(); on=true; };
  window.__frameOff=()=>{ on=false; };
  const tick=(t)=>{ if(on) window.__frames.push(t-last); last=t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);

  window.__reset=()=>{ window.__LT.length=0; window.__EV.length=0; window.__L=0; };
  window.__report=()=>{
    const f=window.__frames.slice(1);
    return {
      forcedLayout: window.__L,
      blockedMs: window.__LT.reduce((a,b)=>a+b,0),
      inpMs: window.__EV.reduce((a,b)=>Math.max(a,b),0),
      dropped: f.filter(x=>x>32).length,
      worstFrameMs: f.length? Math.round(Math.max(...f)) : 0,
    };
  };
  window.__btn=(t)=>[...document.querySelectorAll('button')].find(b=>((b.getAttribute('aria-label')||'')+'|'+(b.title||'')+'|'+b.textContent).includes(t));
  window.__key=(k,meta,alt)=>document.dispatchEvent(new KeyboardEvent('keydown',{key:k,metaKey:!!meta,altKey:!!alt,bubbles:true}));
  window.__blurLayers=()=>[...document.querySelectorAll('*')].filter(e=>{const v=getComputedStyle(e).backdropFilter; return v&&v!=='none';}).length;
}
`;

/** For Runtime.evaluate (wrapped in an async fn by cdp.evaluate). */
export const INSTALL = BODY + "\nreturn true;";
/** For Page.addScriptToEvaluateOnNewDocument — survives reloads. */
export const INSTALL_ON_LOAD = BODY;

