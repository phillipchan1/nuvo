export interface CalendarEntry {
  id: string;
  summary: string;
  color: string | null;
  visible: boolean;
  sync_token?: string | null;
  channel_id?: string | null;
  resource_id?: string | null;
  channel_expires_at?: string | null;
  last_synced_at?: string | null;
}

export interface GoogleAccount {
  id: string;
  user_id: string;
  email: string;
  refresh_token_enc: Uint8Array | null;
  refresh_token_iv: Uint8Array | null;
  key_version: number | null;
  /** In-memory only after unseal. Never mapped from the plaintext column. */
  access_token: string | null;
  access_token_enc: Uint8Array | null;
  access_token_iv: Uint8Array | null;
  access_token_expires_at: string | null;
  calendars: CalendarEntry[];
  mirror_calendar_id: string | null;
  webhook_expires_at: string | null;
  needs_reconnect: boolean;
}

export type GoogleAccountStatus = {
  id: string;
  email: string;
  needs_reconnect: boolean;
  webhook_expires_at: string | null;
  calendars: Array<{
    id: string;
    summary: string;
    visible: boolean;
    last_synced_at: string | null;
  }>;
};

export type GoogleEventListItem = {
  id: string;
  title: string;
  start_at: string | null;
  end_at: string | null;
  calendar_id: string | null;
};

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_API = "https://www.googleapis.com/calendar/v3";
export const PEOPLE_API = "https://people.googleapis.com/v1";

export const CHANNEL_RENEW_AHEAD_MS = 48 * 3600_000;
export const POLL_STALE_MS = 4 * 60_000;
export const DISPATCH_BATCH = 50;

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
].join(" ");
