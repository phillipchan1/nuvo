import { useMemo, useState } from "react";
import type { ExternalEvent } from "../../lib/types";
import { useVertical } from "../../hooks/useVertical";
import { useSettings } from "../../hooks/useSettings";
import { useEventRouting, useEventRoutingMutations } from "../../hooks/useEventRouting";
import { eventDomainAttribution, eventKey } from "../../lib/eventActuals";
import { DomainPicker } from "../floors/parts";
import Sheet from "../mobile/Sheet";
import DomainSymbol from "./DomainSymbol";

type RoutableEvent = Pick<
  ExternalEvent,
  "account_id" | "provider_event_id" | "calendar_id"
>;

/** One visible answer for where an event's time goes, on both shells. */
export default function EventDomainControl({
  event,
  mobile = false,
}: {
  event: RoutableEvent;
  mobile?: boolean;
}) {
  const { data } = useVertical();
  const { settings } = useSettings();
  const routing = useEventRouting();
  const { upsert } = useEventRoutingMutations();
  const [open, setOpen] = useState(false);

  const domains = useMemo(
    () => [...data.domains].sort((a, b) => a.sort - b.sort),
    [data.domains],
  );
  const attribution = eventDomainAttribution(
    event,
    settings?.calendar_domain_map ?? {},
    routing,
  );
  const current = domains.find((domain) => domain.id === attribution.domainId);
  const choose = (domainId: string) => {
    upsert.mutate({ eventKey: eventKey(event), domainId });
    setOpen(false);
  };

  if (!mobile) {
    return (
      <div className="mb-1 flex flex-wrap items-center gap-1.5 text-meta">
        <span className="mono text-muted">Counts toward</span>
        <DomainPicker
          domains={domains}
          value={attribution.domainId ?? ""}
          onChange={choose}
          size="sm"
        />
      </div>
    );
  }

  const color = current?.color ?? "var(--muted)";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tap fast flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 text-left active:bg-surface-2"
        aria-label={`Counts toward ${current?.name ?? "an unattributed domain"}`}
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{
            color,
            background: `color-mix(in srgb, ${color} 14%, var(--surface))`,
          }}
        >
          <DomainSymbol value={current?.icon} size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="section-label block !p-0">Counts toward</span>
          <span className="block truncate text-body font-medium" style={{ color }}>
            {current?.name ?? "Unattributed"}
          </span>
        </span>
        <span className="text-muted" aria-hidden>›</span>
      </button>

      {open && (
        <Sheet title="Counts toward" onClose={() => setOpen(false)}>
          <div className="px-3 pb-safe">
            <p className="px-1 pb-2 text-caption text-muted">
              Where this event’s time appears in your domains.
            </p>
            {domains.map((domain) => (
              <button
                key={domain.id}
                type="button"
                onClick={() => choose(domain.id)}
                className="tap fast flex w-full items-center gap-3 rounded-xl px-3 text-left active:bg-accent-soft"
                style={{ color: domain.id === attribution.domainId ? domain.color : "var(--ink)" }}
              >
                <span style={{ color: domain.color }}>
                  <DomainSymbol value={domain.icon} size={18} />
                </span>
                <span className="min-w-0 flex-1 truncate text-body">{domain.name}</span>
                {domain.id === attribution.domainId && <span aria-hidden>✓</span>}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}
