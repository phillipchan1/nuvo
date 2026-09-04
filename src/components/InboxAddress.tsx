// Inbox address — the forwarding door. One component, two mounts: Settings
// (copy + rotate) and an empty inbox (copy only). Not a mailbox, not a second
// inbox, not a token — those live in Apps & devices.

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { inboundAddress } from "../../supabase/functions/_shared/inboundEmail.ts";
import { useSettings } from "../hooks/useSettings";
import { supabase } from "../lib/supabase";
import { Icon } from "./Icon";
import { PaneHeader } from "./form";
import { Btn } from "./ui";

async function copyText(text: string, ok: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(ok);
  } catch {
    toast.error("Couldn't copy — select it and copy it by hand");
  }
}

/** The address itself: copy, and optionally replace. */
export function InboxAddressCard({ rotate = false }: { rotate?: boolean }) {
  const qc = useQueryClient();
  const { settings, isLoading } = useSettings();
  const [confirmRotate, setConfirmRotate] = useState(false);

  const address = settings?.inbound_token
    ? inboundAddress(settings.inbound_token, import.meta.env.VITE_INBOUND_MAIL_DOMAIN)
    : null;

  const mint = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("rotate_inbound_token");
      if (error) throw error;
      if (typeof data !== "string" || !data) throw new Error("Could not mint a new address");
      return data;
    },
    onSuccess: (token) => {
      const prev = qc.getQueryData<typeof settings>(["settings"]);
      if (prev) qc.setQueryData(["settings"], { ...prev, inbound_token: token });
      qc.invalidateQueries({ queryKey: ["settings"] });
      setConfirmRotate(false);
      toast.success("New address ready — the old one no longer receives");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return null;
  if (!address) {
    return (
      <p className="text-caption leading-snug text-muted">
        No inbox address on this account yet.
      </p>
    );
  }

  return (
    <div data-marquee="inbox-address">
      <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"
          >
            <Icon name="mail" size={16} />
          </span>
          <div className="min-w-0">
            <div className="mono break-all text-caption text-ink">{address}</div>
            <p className="text-label leading-snug text-muted">
              Subject becomes an inbox task. Nothing is scheduled.
            </p>
          </div>
        </div>
        <Btn
          kind="primary"
          className="tap shrink-0"
          onClick={() => void copyText(address, "Address copied")}
        >
          <span className="inline-flex items-center gap-1.5">
            <Icon name="copy" size={13} />
            Copy
          </span>
        </Btn>
      </div>
      {rotate &&
        (confirmRotate ? (
          <div className="mt-3 space-y-2">
            <p className="text-caption leading-snug text-muted">
              A new address replaces this one. Mail to the old address will stop
              landing in your inbox.
            </p>
            <div className="flex flex-wrap gap-2">
              <Btn
                className="tap"
                disabled={mint.isPending}
                onClick={() => mint.mutate()}
              >
                {mint.isPending ? "Minting…" : "Replace address"}
              </Btn>
              <Btn className="tap" onClick={() => setConfirmRotate(false)}>
                Keep this one
              </Btn>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="tap mt-2 min-h-[44px] text-left text-label text-muted hover:text-ink"
            onClick={() => setConfirmRotate(true)}
          >
            Get a new address
          </button>
        ))}
    </div>
  );
}

/** Settings → Inbox address. */
export function InboxAddressPane() {
  return (
    <div>
      <PaneHeader
        title="Inbox address"
        sub="Forward a mail and it lands in your inbox. The subject is the task. This is not a mailbox."
      />
      <div className="max-w-2xl">
        <InboxAddressCard rotate />
      </div>
    </div>
  );
}

/** Empty inbox — the same door, without rotate (that's Settings). */
export function InboxAddressHint() {
  return (
    <div className="mt-6 px-3 text-left sm:px-4">
      <div className="section-label">Or forward a mail</div>
      <div className="mt-2">
        <InboxAddressCard />
      </div>
    </div>
  );
}
