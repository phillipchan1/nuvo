import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import { useIsMobile } from "../../hooks/useIsMobile";
import Sheet from "../mobile/Sheet";
import { Icon } from "../Icon";
import { IconButton } from "./Button";

// Dialog — a 12px solid panel on a dimmed scrim (D-190). On a phone it IS the
// bottom Sheet (CLAUDE.md golden rule 3): same title, same body, same footer,
// so a caller writes one dialog and both shells get their native overlay.

export function Dialog({
  title,
  onClose,
  children,
  footer,
  width = 480,
  align = "top",
  closeOnEscape = true,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** the actions row; the primary act goes last (rightmost) */
  footer?: ReactNode;
  width?: number;
  align?: "top" | "center";
  /** false when the content owns Escape (a field that clears first, D-051) */
  closeOnEscape?: boolean;
}) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <Sheet title={title} onClose={onClose}>
        <div className="px-4 pb-4">{children}</div>
        {footer && <div className="k-dialog-foot pb-safe">{footer}</div>}
      </Sheet>
    );
  }
  return (
    <DesktopDialog title={title} onClose={onClose} footer={footer} width={width} align={align} closeOnEscape={closeOnEscape}>
      {children}
    </DesktopDialog>
  );
}

function DesktopDialog({
  title,
  onClose,
  children,
  footer,
  width,
  align,
  closeOnEscape,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width: number;
  align: "top" | "center";
  closeOnEscape: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(panel);
  useEffect(() => {
    if (!closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, closeOnEscape]);

  return createPortal(
    <div className="k-scrim" data-align={align === "top" ? undefined : align} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" tabIndex={-1} className="k-dialog" style={{ maxWidth: width }}>
        <div className="k-dialog-head">
          <h2>{title}</h2>
          <IconButton label="Close" shortcut="Esc" icon={<Icon name="close" size={14} />} onClick={onClose} />
        </div>
        <div className="k-dialog-body">{children}</div>
        {footer && <div className="k-dialog-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
