-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "trackSerial" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "warrantyDays" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "serialNo" TEXT,
ADD COLUMN     "warrantyDays" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "SaleItem_serialNo_idx" ON "SaleItem"("serialNo");
