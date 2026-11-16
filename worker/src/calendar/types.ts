import { asJsonArray } from "../lib/jsonbShape.ts";

export interface CalendarAccount {
  id: string;
  user_id: string;
  provider: string;
  email: string;
  refresh_token_secret_id: string | null;
  refresh_token_enc: Uint8Array | null;
  refresh_token_iv: Uint8Array | null;
  key_version: number | null;
  access_token: string | null;
  access_token_expires_at: string | null;
  sync_direction: string;
  calendars: unknown;
  delta_link: string | null;
  mirror_calendar_id: string | null;
  needs_reconnect: boolean;
  next_sync_at: string | null;
  sync_failures: number;
}

export function asBytes(value: unknown): Uint8Array | null {
  if (value == null) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (typeof value === "string") {
    // `to_jsonb(row)` (getOwnedEvent) renders bytea as "\\x<hex>", not base64.
    // Reading that as base64 returned null, so every iCloud event edit said
    // "iCloud credential missing" while sync (plain SELECT, real bytes) worked.
    if (value.startsWith("\\x")) {
      const hex = value.slice(2);
      if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      return out;
    }
    try {
      const bin = atob(value);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch {
      return null;
    }
  }
  return null;
}

export function mapAccount(row: Record<string, unknown>): CalendarAccount {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    provider: String(row.provider),
    email: String(row.email),
    refresh_token_secret_id: row.refresh_token_secret_id == null ? null : String(row.refresh_token_secret_id),
    refresh_token_enc: asBytes(row.refresh_token_enc),
    refresh_token_iv: asBytes(row.refresh_token_iv),
    key_version: row.key_version == null ? null : Number(row.key_version),
    access_token: row.access_token == null ? null : String(row.access_token),
    access_token_expires_at: row.access_token_expires_at == null ? null : String(row.access_token_expires_at),
    sync_direction: String(row.sync_direction ?? "read_only"),
    calendars: asJsonArray(row.calendars),
    delta_link: row.delta_link == null ? null : String(row.delta_link),
    mirror_calendar_id: row.mirror_calendar_id == null ? null : String(row.mirror_calendar_id),
    needs_reconnect: Boolean(row.needs_reconnect),
    next_sync_at: row.next_sync_at == null ? null : String(row.next_sync_at),
    sync_failures: Number(row.sync_failures ?? 0),
  };
}
