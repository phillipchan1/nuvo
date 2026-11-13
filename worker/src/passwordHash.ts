// Password verify that also accepts legacy Supabase hashes. Supabase GoTrue
// stored bcrypt ($2a$, cost 10) in auth.users.encrypted_password; the cutover
// copies those into account.password for credential users. New passwords keep
// Better Auth's default scrypt hashing (no hash override), so bcrypt is
// verify-only and rows naturally move to scrypt on the next password reset.
import bcrypt from "bcryptjs";
import { verifyPassword as betterAuthVerify } from "better-auth/crypto";

const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export function isBcryptHash(hash: string): boolean {
  return typeof hash === "string" && BCRYPT_HASH.test(hash);
}

export async function verifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  try {
    if (isBcryptHash(hash)) return await bcrypt.compare(password, hash);
    return await betterAuthVerify({ hash, password });
  } catch {
    return false;
  }
}
