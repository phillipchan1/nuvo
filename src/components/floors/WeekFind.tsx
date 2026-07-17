// The Find — one evidence-backed discovery in the Review.
// Actions: That's true · Not quite (correct) · Keep this · Carry to Monday.
// AI narration is best-effort; deterministic copy is the fallback.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "../../lib/supabase";
import { fmtMins } from "../../lib/now";
import type { WeekFind } from "../../lib/weekFinds";
import type { WeekReceipt } from "../../lib/weekEvidence";
import type { Domain } from "../../lib/vertical";
import { useVertical } from "../../hooks/useVertical";
import { useTaskMutations } from "../../hooks/useTasks";
import { useEventRoutingMutations } from "../../hooks/useEventRouting";
import { useWeekReviewActions, useWeekReviewRow, type FindResponse } from "../../hooks/useWeekReview";
import { Modal } from "../ui";

function ReceiptRow({
  r,
  onCorrect,
}: {
  r: WeekReceipt;
  onCorrect?: (r: WeekReceipt) => void;
}) {
  const kindLabel = r.kind === "task" ? "Task" : r.kind === "event" ? "Meeting" : r.kind === "activity" ? "Shipped" : "";
  return (
    <div className="flex items-baseline gap-2 border-b border-line py-2 last:border-0">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: r.domainColor || "var(--line-strong)" }} />
      <div className="min-w-0 flex-1">
        {r.url ? (
          <a href={r.url} target="_blank" rel="noreferrer" className="text-body text-ink hover:underline">
            {r.label}
          </a>
        ) : (
          <span className="text-body text-ink">{r.label}</span>
        )}
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-micro text-muted">
          {kindLabel && <span>{kindLabel}</span>}
          {r.projectName && <span>· {r.projectName}</span>}
          {r.mins > 0 && <span className="mono">· {fmtMins(r.mins)}</span>}
        </div>
      </div>
      {onCorrect && (r.kind === "task" || r.kind === "event") && (
        <button onClick={() => onCorrect(r)} className="tap fast shrink-0 text-micro text-muted hover:text-ink">
          Correct
        </button>
      )}
    </div>
  );
}

function CorrectSheet({
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
              style={{ color: d.id === receipt.domainId ? d.color : "var(--ink)" }}
            >
              <span style={{ color: d.color }}>{d.icon}</span>
              <span className="text-body">{d.name}</span>
              {d.id === receipt.domainId && <span className="ml-auto text-micro text-muted">current</span>}
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

export function WeekFindCard({
  find,
  weekStartISO,
  sealed,
  onReseal,
}: {
  find: WeekFind;
  weekStartISO: string;
  sealed: boolean;
  /** After a source correction, parent reseals the live report. */
  onReseal?: () => void;
}) {
  const { data: vertical } = useVertical();
  const tasks = useTaskMutations();
  const { upsert: routeEvent } = useEventRoutingMutations();
  const actions = useWeekReviewActions(weekStartISO);
  const row = useWeekReviewRow(weekStartISO);
  const [openReceipts, setOpenReceipts] = useState(false);
  const [correcting, setCorrecting] = useState<WeekReceipt | null>(null);
  const [mondayNote, setMondayNote] = useState("");
  const [showMonday, setShowMonday] = useState(false);

  const response = row.data?.find_response ?? null;
  const kept = row.data?.find_kept ?? false;

  // Best-effort AI warm-up of the deterministic Find.
  const narrated = useQuery({
    queryKey: ["review_find_narrate", weekStartISO, find.id],
    queryFn: async (): Promise<{ headline: string; detail: string }> => {
      const { data, error } = await supabase.functions.invoke("agent", {
        body: {
          reviewFind: {
            kind: find.kind,
            tone: find.tone,
            headline: find.headline,
            detail: find.detail,
            receiptLabels: find.receipts.map((r) => r.label),
            sealed,
          },
        },
      });
      if (error) throw error;
      return { headline: data.headline as string, detail: data.detail as string };
    },
    enabled: !row.data?.find_narration,
    staleTime: Infinity,
    retry: false,
    meta: { silent: true },
  });

  useEffect(() => {
    if (narrated.data && !row.data?.find_narration) {
      void actions.setFindNarration.mutateAsync(narrated.data).catch(() => {});
    }
  }, [narrated.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const headline = row.data?.find_narration?.headline ?? narrated.data?.headline ?? find.headline;
  const detail = row.data?.find_narration?.detail ?? narrated.data?.detail ?? find.detail;

  const respond = async (r: FindResponse) => {
    try {
      await actions.setFindResponse.mutateAsync({ response: r, kept: r === "kept" });
      if (r === "confirmed") toast.success("Noted.");
      if (r === "kept") toast.success("Kept in this week's memory.");
      if (r === "dismissed") toast("Dismissed.");
      if (r === "kept" || r === "confirmed") setShowMonday(true);
    } catch {
      toast.error("Couldn't save that — try again.");
    }
  };

  const applyCorrection = async (domainId: string) => {
    if (!correcting) return;
    try {
      if (correcting.kind === "task") {
        tasks.patchTask(correcting.id, { domain_id: domainId });
      } else if (correcting.kind === "event" && correcting.eventKey) {
        await routeEvent.mutateAsync({ eventKey: correcting.eventKey, domainId });
      }
      await actions.setFindResponse.mutateAsync({ response: "corrected" });
      setCorrecting(null);
      toast.success("Attribution updated — regenerating the week.");
      onReseal?.();
    } catch {
      toast.error("Couldn't update attribution.");
    }
  };

  const saveMonday = async () => {
    try {
      await actions.setNoteToMonday.mutateAsync(mondayNote);
      setShowMonday(false);
      toast.success("Saved for Monday.");
    } catch {
      toast.error("Couldn't save the note.");
    }
  };

  if (response === "dismissed") return null;

  return (
    <section data-marquee="find" className="mb-2">
      <div className="section-label mb-3">The Find</div>
      <div className="rounded-xl border border-line px-4 py-4" style={{ background: "color-mix(in srgb, var(--surface) 55%, transparent)" }}>
        <p className="serif text-lead leading-relaxed text-ink">{headline}</p>
        <p className="mt-2 text-meta leading-relaxed text-muted">{detail}</p>

        {find.receipts.length > 0 && (
          <div className="mt-3">
            <button
              onClick={() => setOpenReceipts((o) => !o)}
              className="tap fast text-micro font-medium text-slot hover:text-ink"
            >
              {openReceipts ? "Hide receipts" : `Show ${find.receipts.length} receipt${find.receipts.length === 1 ? "" : "s"}`}
            </button>
            {openReceipts && (
              <div className="mt-2 flex flex-col">
                {find.receipts.map((r) => (
                  <ReceiptRow key={`${r.kind}:${r.id}`} r={r} onCorrect={setCorrecting} />
                ))}
              </div>
            )}
          </div>
        )}

        {!response && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => void respond("confirmed")} className="tap fast rounded-full bg-accent px-4 py-2 text-label font-medium text-white">
              That's true
            </button>
            <button onClick={() => setOpenReceipts(true)} className="tap fast rounded-full border border-line px-4 py-2 text-label text-ink hover:border-line-strong">
              Not quite
            </button>
            <button onClick={() => void respond("kept")} className="tap fast rounded-full border border-line px-4 py-2 text-label text-ink hover:border-line-strong">
              Keep this
            </button>
            <button onClick={() => void respond("dismissed")} className="tap fast rounded-full px-3 py-2 text-label text-muted hover:text-ink">
              Dismiss
            </button>
          </div>
        )}

        {response && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-micro text-muted">
            <span>
              {response === "confirmed" && "Confirmed"}
              {response === "kept" && "Kept"}
              {response === "corrected" && "Corrected"}
              {kept && response !== "kept" ? " · kept" : ""}
            </span>
            {!showMonday && (
              <button onClick={() => setShowMonday(true)} className="fast font-medium text-slot hover:text-ink">
                Carry to Monday →
              </button>
            )}
          </div>
        )}

        {showMonday && (
          <div className="mt-4 border-t border-line pt-3">
            <div className="section-label mb-2">Note to Monday</div>
            <textarea
              value={mondayNote || row.data?.note_to_monday || ""}
              onChange={(e) => setMondayNote(e.target.value)}
              placeholder="A line for Monday-you…"
              rows={2}
              className="w-full resize-none rounded-md border border-line bg-transparent px-3 py-2 text-body text-ink placeholder:text-muted focus:border-accent focus:outline-none"
            />
            <div className="mt-2 flex gap-2">
              <button onClick={() => void saveMonday()} className="tap fast rounded-full bg-accent px-4 py-2 text-label font-medium text-white">
                Save for Monday
              </button>
              <button onClick={() => setShowMonday(false)} className="tap fast rounded-full px-3 py-2 text-label text-muted">
                Not now
              </button>
            </div>
          </div>
        )}
      </div>

      {correcting && (
        <CorrectSheet
          receipt={correcting}
          domains={vertical.domains}
          onClose={() => setCorrecting(null)}
          onPick={(id) => void applyCorrection(id)}
        />
      )}
    </section>
  );
}

/** Compact Find beat for WeekStory — headline only. */
export function WeekFindStoryCaption({ find }: { find: WeekFind }) {
  return (
    <>
      <div className="section-label wk-in mb-3">The Find</div>
      <p className="serif wk-in text-lead leading-relaxed text-ink" style={{ animationDelay: "0.1s" }}>
        {find.headline}
      </p>
      <p className="wk-in mx-auto mt-4 max-w-sm text-meta text-muted" style={{ animationDelay: "0.45s" }}>
        One thing the numbers noticed — receipts wait in the full week.
      </p>
    </>
  );
}
