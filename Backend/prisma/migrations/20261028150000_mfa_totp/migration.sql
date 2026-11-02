-- Time-based one-time-password sign-in. Secrets are encrypted by the application before they are stored.
ALTER TABLE "User"
  ADD COLUMN "mfaSecretEnc" TEXT,
  ADD COLUMN "mfaPendingSecretEnc" TEXT,
  ADD COLUMN "mfaEnrolledAt" TIMESTAMP(3),
  ADD COLUMN "mfaLastStep" INTEGER,
  ADD COLUMN "mfaFailedAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "mfaLockedUntil" TIMESTAMP(3);

-- An account marked as enrolled must have a secret.
ALTER TABLE "User"
  ADD CONSTRAINT "User_mfa_secret_present" CHECK ("mfaEnabled" = false OR "mfaSecretEnc" IS NOT NULL);

CREATE TABLE "MfaRecoveryCode" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "codeHash" TEXT NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MfaRecoveryCode_userId_usedAt_idx" ON "MfaRecoveryCode"("userId", "usedAt");

ALTER TABLE "MfaRecoveryCode"
  ADD CONSTRAINT "MfaRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
