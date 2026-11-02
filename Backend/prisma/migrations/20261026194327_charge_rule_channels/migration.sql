-- AlterTable
ALTER TABLE "ChargeLine" ADD COLUMN     "paymentChannelId" UUID;

-- AlterTable
ALTER TABLE "ChargeRule" ADD COLUMN     "paymentChannelId" UUID;

-- CreateIndex
CREATE INDEX "ChargeLine_paymentChannelId_idx" ON "ChargeLine"("paymentChannelId");

-- CreateIndex
CREATE INDEX "ChargeRule_paymentChannelId_idx" ON "ChargeRule"("paymentChannelId");

-- AddForeignKey
ALTER TABLE "ChargeRule" ADD CONSTRAINT "ChargeRule_paymentChannelId_fkey" FOREIGN KEY ("paymentChannelId") REFERENCES "PaymentChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_paymentChannelId_fkey" FOREIGN KEY ("paymentChannelId") REFERENCES "PaymentChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
