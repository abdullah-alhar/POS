-- CreateEnum
CREATE TYPE "ExpensePaidFrom" AS ENUM ('DRAWER', 'BANK', 'OTHER');

-- AlterTable
ALTER TABLE "CustomerLedger" ADD COLUMN     "cashSessionId" UUID;

-- CreateTable
CREATE TABLE "Expense" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paidFrom" "ExpensePaidFrom" NOT NULL,
    "note" TEXT,
    "cashSessionId" UUID,
    "userId" UUID NOT NULL,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Expense_number_key" ON "Expense"("number");

-- CreateIndex
CREATE INDEX "Expense_date_idx" ON "Expense"("date");

-- CreateIndex
CREATE INDEX "CustomerLedger_cashSessionId_idx" ON "CustomerLedger"("cashSessionId");

-- AddForeignKey
ALTER TABLE "CustomerLedger" ADD CONSTRAINT "CustomerLedger_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
