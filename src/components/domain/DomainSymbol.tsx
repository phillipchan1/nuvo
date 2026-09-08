import { domainSymbolEntry } from "../../lib/domainSymbols";

export function DomainSymbol({
  value,
  size = 16,
  label,
  className,
}: {
  value: string | null | undefined;
  size?: number;
  label?: string;
  className?: string;
}) {
  const entry = domainSymbolEntry(value);
  const Icon = entry.icon;

  return (
    <Icon
      size={size}
      strokeWidth={1.65}
      absoluteStrokeWidth
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
    />
  );
}

export default DomainSymbol;
