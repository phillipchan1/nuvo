import { useMemo, useState } from "react";
import type { ExternalEvent } from "../../lib/types";
import { useVertical } from "../../hooks/useVertical";
import { useSettings } from "../../hooks/useSettings";
import { useEventRouting, useEventRoutingMutations } from "../../hooks/useEventRouting";
import { eventDomainAttribution, eventKey } from "../../lib/eventActuals";
import { DomainPicker } from "../floors/parts";
import { FactRow, PickSheet } from "../mobile/sheetKit";
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
      {/* A settings row like Repeat and Remind beside it — it was a bordered
          tile of its own, the only enclosed thing in a list of hairline rows. */}
      <FactRow
        lead={
          <span style={{ color }}>
            <DomainSymbol value={current?.icon} size={16} />
          </span>
        }
        label="Counts toward"
        value={current?.name ?? "Unattributed"}
        valueColor={current ? color : null}
        onClick={() => setOpen(true)}
      />

      {open && (
        <PickSheet
          title="Counts toward"
          note="Where this event’s time appears in your domains."
          rows={domains.map((domain) => ({
            id: domain.id,
            name: domain.name,
            color: domain.color,
            lead: <DomainSymbol value={domain.icon} size={18} />,
          }))}
          value={attribution.domainId ?? null}
          onPick={choose}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
