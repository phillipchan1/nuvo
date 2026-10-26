/**
 * Better Auth logical fields are camelCase. Our Neon tables are snake_case.
 * Without this map, OTP send fails with "Database schema mismatch".
 */
export const authUser = {
  modelName: "user",
  fields: {
    emailVerified: "email_verified",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
} as const;

export const authSession = {
  modelName: "session",
  fields: {
    expiresAt: "expires_at",
    createdAt: "created_at",
    updatedAt: "updated_at",
    ipAddress: "ip_address",
    userAgent: "user_agent",
    userId: "user_id",
  },
} as const;

export const authAccount = {
  modelName: "account",
  fields: {
    accountId: "account_id",
    providerId: "provider_id",
    userId: "user_id",
    accessToken: "access_token",
    refreshToken: "refresh_token",
    idToken: "id_token",
    accessTokenExpiresAt: "access_token_expires_at",
    refreshTokenExpiresAt: "refresh_token_expires_at",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
} as const;

export const authVerification = {
  modelName: "verification",
  fields: {
    expiresAt: "expires_at",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
} as const;
