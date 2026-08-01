// Stands in for `npm:@supabase/supabase-js@2` under vitest (see vitest.config.ts).
//
// The edge functions build their service-role client at module load. Aliasing the
// package means `admin` in _shared/admin.ts *is* the in-memory fake, so the tool
// code under test is the real file, unmodified — no vi.mock, no injection seam
// carved into production code for the tests' benefit.
import { fakeClient } from "./fakeSupabase.ts";

export function createClient() {
  return fakeClient();
}
