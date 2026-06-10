import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase = createClient(
  url ?? "http://localhost:54321",
  anonKey ?? "missing-anon-key",
);

/** Invoke an edge function, fire-and-forget, logging failures to console. */
export function invokeQuiet(fn: string, body: Record<string, unknown>) {
  supabase.functions.invoke(fn, { body }).then(({ error }) => {
    if (error) console.warn(`[nuvo] edge fn ${fn} failed:`, error.message);
  });
}
