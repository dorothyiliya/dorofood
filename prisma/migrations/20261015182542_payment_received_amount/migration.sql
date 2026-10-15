-- AlterTable
ALTER TABLE "PaymentTransaction" ADD COLUMN     "receivedAmountMinor" BIGINT,
ADD COLUMN     "receivedCurrency" TEXT;
