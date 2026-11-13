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
import { Button, SectionHeader } from "./kit";

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
    return <p className="set-note">No address yet</p>;
  }

  return (
    <div data-marquee="inbox-address">
      <div className="set-row">
        <span className="set-acct-mark" aria-hidden>
          <Icon name="mail" size={14} />
        </span>
        <div className="set-row-label">
          <span className="set-row-title break-all" data-selectable>
            {address}
          </span>
          <div className="set-row-desc">Subject becomes an inbox task. Nothing is scheduled.</div>
        </div>
        <div className="set-row-ctl">
          <Button kind="primary" className="tap" icon={<Icon name="copy" size={13} />} onClick={() => void copyText(address, "Address copied")}>
            Copy
          </Button>
        </div>
      </div>
      {rotate &&
        (confirmRotate ? (
          <div className="set-well">
            <p className="set-note">A new address replaces this one. Mail to the old one stops landing.</p>
            <div className="flex flex-wrap gap-2">
              <Button kind="danger" className="tap" disabled={mint.isPending} onClick={() => mint.mutate()}>
                {mint.isPending ? "Minting…" : "Replace address"}
              </Button>
              <Button kind="ghost" className="tap" onClick={() => setConfirmRotate(false)}>
                Keep this one
              </Button>
            </div>
          </div>
        ) : (
          <Button kind="ghost" className="tap mt-2 -ml-2" onClick={() => setConfirmRotate(true)}>
            Get a new address
          </Button>
        ))}
    </div>
  );
}

/** Settings → Inbox address. */
export function InboxAddressPane() {
  return (
    <div>
      <PaneHeader title="Inbox address" />
      <InboxAddressCard rotate />
    </div>
  );
}

/** Empty inbox — the same door, without rotate (that's Settings). */
export function InboxAddressHint() {
  return (
    <div className="mt-6 px-3 text-left sm:px-4">
      <SectionHeader title="Or forward a mail" className="!px-0" />
      <InboxAddressCard />
    </div>
  );
}
