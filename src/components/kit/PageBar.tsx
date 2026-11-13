import { Fragment, type ReactNode } from "react";

// PageBar — the one 48px bar every page in the panel wears (D-190, the frame).
// Breadcrumb on the left, then the page's view tabs, a drag gap, then the
// page's actions. Always in that order; no page draws its own toolbar.
//
// The whole bar drags the window in the desktop app (`data-tauri-drag-region`
// "deep": its controls still click); the empty fill is a plain drag region.

export function PageBar({
  icon,
  trail,
  tabs,
  actions,
  leading,
}: {
  /** the page's glyph, already sized (16px) */
  icon?: ReactNode;
  /** the breadcrumb, root first; the last item is the page and reads bold */
  trail: readonly ReactNode[];
  /** the page's views — a kit <Tabs> */
  tabs?: ReactNode;
  /** right-aligned acts — kit Buttons / IconButtons / a Segmented */
  actions?: ReactNode;
  /** before the breadcrumb — a "show panels" exit from focus mode */
  leading?: ReactNode;
}) {
  return (
    <header data-tauri-drag-region="deep" className="k-bar">
      {leading}
      <nav className="k-crumb" aria-label="Breadcrumb">
        {icon && <span className="k-crumb-icon">{icon}</span>}
        {trail.map((t, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <span className="k-crumb-sep" aria-hidden="true">
                /
              </span>
            )}
            <span className={i === trail.length - 1 ? "k-crumb-here" : "k-crumb-up"} aria-current={i === trail.length - 1 ? "page" : undefined}>
              {t}
            </span>
          </Fragment>
        ))}
      </nav>
      {tabs && <div className="k-bar-tabs">{tabs}</div>}
      <div className="k-bar-fill" data-tauri-drag-region="" />
      {actions && <div className="k-bar-actions">{actions}</div>}
    </header>
  );
}
