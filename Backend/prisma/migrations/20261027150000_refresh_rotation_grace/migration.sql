-- A rotated refresh token stays usable for a short grace window (enforced in the application),
-- so a page reload or a lost response cannot sign the user out.
ALTER TABLE "RefreshSession" ADD COLUMN "rotatedAt" TIMESTAMP(3);
