import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { Icon } from "../Icon";
import { cx } from "./cx";

// Input · Textarea · SearchField · FormField — every place you type.
//
// Plain text <input>s on purpose (CLAUDE.md, low-data-entry): iOS dictation
// works in them. The frame (.k-field) draws the border and the focus wash; the
// input inside is bare, so an icon or a keycap can sit in the same box.

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  icon?: ReactNode;
  trailing?: ReactNode;
  invalid?: boolean;
  /** sm 28 · md 32 (default) */
  size?: "sm" | "md";
  frameClassName?: string;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { icon, trailing, invalid, size = "md", disabled, frameClassName, type = "text", ...rest },
  ref,
) {
  return (
    <span className={cx("k-field", frameClassName)} data-size={size === "md" ? undefined : size} data-invalid={invalid || undefined} data-disabled={disabled || undefined}>
      {icon}
      <input ref={ref} type={type} disabled={disabled} aria-invalid={invalid || undefined} {...rest} />
      {trailing}
    </span>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean; frameClassName?: string }>(
  function Textarea({ invalid, disabled, frameClassName, ...rest }, ref) {
    return (
      <span className={cx("k-field", frameClassName)} data-multiline="" data-invalid={invalid || undefined} data-disabled={disabled || undefined}>
        <textarea ref={ref} disabled={disabled} aria-invalid={invalid || undefined} {...rest} />
      </span>
    );
  },
);

export const SearchField = forwardRef<HTMLInputElement, Omit<InputProps, "icon" | "type">>(function SearchField(props, ref) {
  return <Input ref={ref} type="search" icon={<Icon name="search" size={14} />} {...props} />;
});

/** A labelled field with an optional hint or error under it. The error wins
 *  the hint's slot, so the form never grows a line when it goes wrong. */
export function FormField({
  label,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <label className="k-field-label" htmlFor={id}>
      {label}
      {children(id)}
      {(error || hint) && (
        <span className="k-field-hint" data-invalid={error ? "" : undefined}>
          {error || hint}
        </span>
      )}
    </label>
  );
}
