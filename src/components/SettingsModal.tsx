import { useState } from "react";
import { supabase } from "../lib/supabase";
import type { CalendarAccount, UserSettings } from "../lib/types";
import { useLabels } from "../hooks/useCalendar";
import { Btn, Modal, SectionLabel } from "./ui";

export default function SettingsModal({
  settings,
  updateSettings,
  accounts,
  onClose,
}: {
  settings: UserSettings | undefined;
  updateSettings: (patch: Partial<UserSettings>) => void;
  accounts: CalendarAccount[];
  onClose: () => void;
}) {
  const { labels, createLabel, updateLabel, deleteLabel } = useLabels();
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState("#2563EB");

  const connect = async (provider: "google" | "m365") => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const base = import.meta.env.VITE_SUPABASE_URL;
    const redirect = encodeURIComponent(window.location.origin);
    window.location.href = `${base}/functions/v1/${provider === "google" ? "google-oauth" : "m365-oauth"}?action=start&token=${token}&redirect=${redirect}`;
  };

  const disconnect = async (id: string) => {
    await supabase.from("calendar_accounts").delete().eq("id", id);
  };

  const hidden = new Set(settings?.hidden_calendar_ids ?? []);
  const toggleCalendar = (calId: string) => {
    const next = new Set(hidden);
    next.has(calId) ? next.delete(calId) : next.add(calId);
    updateSettings({ hidden_calendar_ids: [...next] });
  };

  return (
    <Modal onClose={onClose} width="max-w-2xl">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="text-[14px] font-semibold">Settings</div>
        <button onClick={onClose} className="keycap">esc</button>
      </div>

      <div className="max-h-[70vh] space-y-6 overflow-y-auto p-4">
        {/* Connections */}
        <section>
          <SectionLabel>Calendar connections</SectionLabel>
          <div className="space-y-2 px-3">
            {accounts.map((a) => (
              <div key={a.id} className="border border-line">
                <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                  <span className="text-[13px] font-medium">
                    {a.provider === "google" ? "Google" : "Microsoft 365"}
                  </span>
                  <span className="mono text-[11px] text-muted">{a.email}</span>
                  <span className="mono text-[10px] text-muted">
                    {a.sync_direction === "two_way" ? "two-way" : "read-only"}
                  </span>
                  <div className="flex-1" />
                  {a.needs_reconnect && (
                    <Btn kind="signal" onClick={() => connect(a.provider)}>
                      Reconnect
                    </Btn>
                  )}
                  <Btn onClick={() => disconnect(a.id)}>Disconnect</Btn>
                </div>
                <div className="space-y-1 px-3 py-2">
                  {(a.calendars ?? []).map((c) => (
                    <label key={c.id} className="flex cursor-pointer items-center gap-2 text-[12px]">
                      <input
                        type="checkbox"
                        checked={!hidden.has(c.id)}
                        onChange={() => toggleCalendar(c.id)}
                      />
                      <span
                        className="inline-block h-2 w-2"
                        style={{ background: c.color ?? "var(--muted)" }}
                      />
                      {c.summary}
                    </label>
                  ))}
                  {(a.calendars ?? []).length === 0 && (
                    <div className="text-[12px] text-muted">No calendars synced yet.</div>
                  )}
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              {!accounts.some((a) => a.provider === "google") && (
                <Btn kind="primary" onClick={() => connect("google")}>
                  Connect Google
                </Btn>
              )}
              {!accounts.some((a) => a.provider === "m365") && (
                <Btn onClick={() => connect("m365")}>Connect Microsoft 365</Btn>
              )}
            </div>
          </div>
        </section>

        {/* Labels */}
        <section>
          <SectionLabel>Labels</SectionLabel>
          <div className="space-y-1.5 px-3">
            {labels.map((l) => (
              <div key={l.id} className="flex items-center gap-2">
                <input
                  type="color"
                  value={l.color}
                  onChange={(e) => updateLabel({ id: l.id, color: e.target.value })}
                  className="h-6 w-8 cursor-pointer border border-line bg-surface"
                />
                <input
                  defaultValue={l.name}
                  onBlur={(e) =>
                    e.target.value.trim() &&
                    e.target.value !== l.name &&
                    updateLabel({ id: l.id, name: e.target.value.trim() })
                  }
                  className="flex-1 border border-line bg-bg px-2 py-1 text-[13px] outline-none focus:border-accent"
                />
                <Btn kind="signal" onClick={() => deleteLabel(l.id)}>
                  Delete
                </Btn>
              </div>
            ))}
            <form
              className="flex items-center gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newLabel.trim()) return;
                await createLabel({ name: newLabel.trim(), color: newColor });
                setNewLabel("");
              }}
            >
              <input
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                className="h-6 w-8 cursor-pointer border border-line bg-surface"
              />
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="New label…"
                className="flex-1 border border-line bg-bg px-2 py-1 text-[13px] outline-none focus:border-accent"
              />
              <Btn kind="primary">Add</Btn>
            </form>
          </div>
        </section>

        {/* Day boundaries + appearance */}
        <section className="grid grid-cols-2 gap-4">
          <div>
            <SectionLabel>Calendar day boundaries</SectionLabel>
            <div className="flex items-center gap-2 px-3">
              <select
                value={settings?.day_start_hour ?? 6}
                onChange={(e) => updateSettings({ day_start_hour: Number(e.target.value) })}
                className="mono border border-line bg-bg px-2 py-1 text-[12px]"
              >
                {Array.from({ length: 12 }, (_, h) => (
                  <option key={h} value={h}>{`${h}:00`}</option>
                ))}
              </select>
              <span className="text-[12px] text-muted">to</span>
              <select
                value={settings?.day_end_hour ?? 23}
                onChange={(e) => updateSettings({ day_end_hour: Number(e.target.value) })}
                className="mono border border-line bg-bg px-2 py-1 text-[12px]"
              >
                {Array.from({ length: 12 }, (_, i) => i + 13).map((h) => (
                  <option key={h} value={h}>{`${h}:00`}</option>
                ))}
              </select>
            </div>
            <div className="px-3 pt-2 text-[11px] text-muted">Week starts Monday.</div>
          </div>
          <div>
            <SectionLabel>Appearance</SectionLabel>
            <div className="flex gap-1 px-3">
              {(["system", "light", "dark"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => updateSettings({ theme: t })}
                  className={`fast flex-1 border px-2 py-1 text-[12px] ${
                    (settings?.theme ?? "system") === t
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line text-muted hover:text-ink"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-line pt-3">
          <Btn onClick={() => supabase.auth.signOut()}>Sign out</Btn>
        </section>
      </div>
    </Modal>
  );
}
