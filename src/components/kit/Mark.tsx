// NuvoMark — the app's mark, "Statement" (D-191): a geometric N with an ember
// full stop on the mulberry field. The ONE in-app drawing of it — the sidebar,
// the login, first run and orientation all render this, and the app icons are
// rasterized from the same geometry (src-tauri/app-icon.svg; public/favicon.svg
// is the small optical size). Never draw the mark anywhere else.
//
// Two optical sizes, picked by `size`: at 32px and below the stems thicken and
// the full stop grows, so the N and the dot survive in a 20px sidebar or a
// 16px tab instead of blurring together.
//
// The field and glyph are brand colours, not theme tokens: the mark looks the
// same on Light and Dark, exactly as the icon on the Dock does.

const FIELD = "#8e2fa3";
const GLYPH = "#ffffff";
const EMBER = "#ff6a33";

export function NuvoMark({ size = 28, title, className }: { size?: number; title?: string; className?: string }) {
  const small = size <= 32;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ flex: "none", display: "block" }}
    >
      {title && <title>{title}</title>}
      <rect width="1024" height="1024" rx={small ? 230 : 226} fill={FIELD} />
      {small ? (
        <>
          <g fill={GLYPH}>
            <rect x="160" y="252" width="168" height="520" rx="14" />
            <rect x="496" y="252" width="168" height="520" rx="14" />
            <polygon points="160,252 328,252 664,772 496,772" />
          </g>
          <circle cx="788" cy="684" r="88" fill={EMBER} />
        </>
      ) : (
        <>
          <g fill={GLYPH}>
            <rect x="214" y="292" width="132" height="440" rx="12" />
            <rect x="516" y="292" width="132" height="440" rx="12" />
            <polygon points="214,292 346,292 648,732 516,732" />
          </g>
          <circle cx="750" cy="666" r="66" fill={EMBER} />
        </>
      )}
    </svg>
  );
}
