/**
 * The App Store JWS verifier lives in `supabase/functions/_shared/appleJws.ts`
 * (zero imports, WebCrypto only) so the Worker and the Supabase edge functions
 * run the SAME chain + root-pin + signature checks. Never fork it here.
 */
export * from "../../../supabase/functions/_shared/appleJws.ts";
