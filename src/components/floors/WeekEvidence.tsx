// Expandable evidence under each domain in the hours weave — the receipts
// behind "you spent X hours in Y." Corrections re-attribute the source row.

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { fmtMins } from "../../lib/now";
import type { WeekEvidence, WeekReceipt } from "../../lib/weekEvidence";
import type { Domain } from "../../lib/vertical";
import { useVertical } from "../../hooks/useVertical";
import { useTaskMutations } from "../../hooks/useTasks";
import { useEventRoutingMutations } from "../../hooks/useEventRouting";
import { Modal } from "../ui";

function CorrectModal({
  receipt,
  domains,
  onClose,
  onPick,
}: {
  receipt: WeekReceipt;
  domains: Domain[];
  onClose: () => void;
  onPick: (domainId: string) => void;
}) {
  return (
    <Modal onClose={onClose} width="max-w-sm">
      <div className="p-5">
        <div className="section-label mb-2">Re-attribute</div>
        <p className="mb-4 text-body text-ink">Where should “{receipt.label}” count?</p>
        <div className="flex flex-col gap-1">
          {domains.map((d) => (
            <button
              key={d.id}
              onClick={() => onPick(d.id)}
              className="tap fast flex items-center gap-2 rounded-md px-3 py-2.5 text-left hover:bg-accent-soft"
            >
              <span style={{ color: d.color }}>{d.icon}</span>
              <span className="text-body text-ink">{d.name}</span>
            </button>
          ))}
        </div>
        <button onClick={onClose} className="tap fast mt-4 w-full rounded-md border border-line py-2.5 text-label text-muted">
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function DomainEvidenceList({
  evidence,
  domainId,
  onCorrected,
}: {
  evidence: WeekEvidence;
  domainId: string;
  onCorrected?: () => void;
}) {
  const entry = evidence.domains.find((d) => d.domainId === domainId);
  const { data: vertical } = useVertical();
  const tasks = useTaskMutations();
  const { upsert: routeEvent } = useEventRoutingMutations();
  const [correcting, setCorrecting] = useState<WeekReceipt | null>(null);

  if (!entry || entry.receipts.length === 0) {
    return <p className="py-2 text-meta text-muted">No attributed work this week.</p>;
  }

  const apply = async (domainIdNext: string) => {
    if (!correcting) return;
    try {
      if (correcting.kind === "task") {
        tasks.patchTask(correcting.id, { domain_id: domainIdNext });
      } else if (correcting.kind === "event" && correcting.eventKey) {
        await routeEvent.mutateAsync({ eventKey: correcting.eventKey, domainId: domainIdNext });
      }
      setCorrecting(null);
      toast.success("Updated.");
      onCorrected?.();
    } catch {
      toast.error("Couldn't update.");
    }
  };

  return (
    <>
      <div className="flex flex-col">
        {entry.receipts.map((r) => (
          <div key={`${r.kind}:${r.id}`} className="flex items-baseline gap-2 border-b border-line py-2 last:border-0">
            <span className="min-w-0 flex-1 truncate text-meta text-ink">
              {r.url ? (
                <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">
                  {r.label}
                </a>
              ) : (
                r.label
              )}
              {r.projectName && <span className="text-muted"> · {r.projectName}</span>}
            </span>
            {r.mins > 0 && <span className="mono shrink-0 text-micro text-muted">{fmtMins(r.mins)}</span>}
            {(r.kind === "task" || r.kind === "event") && (
              <button onClick={() => setCorrecting(r)} className="tap fast shrink-0 text-micro text-muted hover:text-ink">
                Correct
              </button>
            )}
          </div>
        ))}
      </div>
      {correcting && (
        <CorrectModal
          receipt={correcting}
          domains={vertical.domains}
          onClose={() => setCorrecting(null)}
          onPick={(id) => void apply(id)}
        />
      )}
    </>
  );
}

/** Hours weave row with expandable receipts. */
export function HoursWeaveWithEvidence({
  evidence,
  domains,
  children,
}: {
  evidence: WeekEvidence;
  domains: { id: string; name: string; color: string; hours: number; target: number; quiet: boolean }[];
  /** Rendered bar row for each domain — parent supplies the visual bar. */
  children: (d: (typeof domains)[0], expanded: boolean, toggle: () => void) => ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2.5">
      {domains.map((d) => {
        const expanded = openId === d.id;
        return (
          <div key={d.id}>
            {children(d, expanded, () => setOpenId(expanded ? null : d.id))}
            {expanded && (
              <div className="mb-2 ml-5 mt-1 border-l border-line pl-3">
                <DomainEvidenceList evidence={evidence} domainId={d.id} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
