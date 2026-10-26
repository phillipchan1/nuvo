import { workersEnabled } from "./backend";
import { supabase } from "./supabase";

type AuthErr = { message: string } | null;

export async function signInWithPassword(email: string, password: string): Promise<{ error: AuthErr }> {
  if (workersEnabled) {
    const { createNuvoAuthClient } = await import("./authClient");
    const res = await createNuvoAuthClient().signIn.email({ email, password });
    return { error: res.error ? { message: res.error.message || "Sign-in failed" } : null };
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: error ? { message: error.message } : null };
}

export async function requestEmailOtp(email: string): Promise<{ error: AuthErr }> {
  if (workersEnabled) {
    const { createNuvoAuthClient } = await import("./authClient");
    const res = await createNuvoAuthClient().emailOtp.sendVerificationOtp({
      email,
      type: "sign-in",
    });
    return { error: res.error ? { message: res.error.message || "Could not send code" } : null };
  }
  const { error } = await supabase.auth.signInWithOtp({ email });
  return { error: error ? { message: error.message } : null };
}

export async function verifyEmailOtp(email: string, token: string): Promise<{ error: AuthErr }> {
  if (workersEnabled) {
    const { createNuvoAuthClient } = await import("./authClient");
    const res = await createNuvoAuthClient().signIn.emailOtp({ email, otp: token });
    return { error: res.error ? { message: res.error.message || "Invalid code" } : null };
  }
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  return { error: error ? { message: error.message } : null };
}

export async function signOut(): Promise<{ error: AuthErr }> {
  if (workersEnabled) {
    const { createNuvoAuthClient } = await import("./authClient");
    const res = await createNuvoAuthClient().signOut();
    return { error: res.error ? { message: res.error.message || "Sign-out failed" } : null };
  }
  const { error } = await supabase.auth.signOut();
  if (error) {
    const local = await supabase.auth.signOut({ scope: "local" });
    return { error: local.error ? { message: local.error.message } : null };
  }
  return { error: null };
}
