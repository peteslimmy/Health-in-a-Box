-- A rule can state that a department or channel is exempt from the service charge. An exempt rule
-- always has a zero rate, so an exemption can never quietly carry a charge.
ALTER TABLE "ChargeRule" ADD COLUMN "isExempt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChargeRule" ADD CONSTRAINT "ChargeRule_exempt_zero_rate" CHECK (NOT "isExempt" OR "rate" = 0);
