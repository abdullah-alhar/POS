-- Serial numbers / IMEI are no longer recorded.
-- DropIndex
DROP INDEX IF EXISTS "SaleItem_serialNo_idx";

-- AlterTable
ALTER TABLE "SaleItem" DROP COLUMN IF EXISTS "serialNo";

-- AlterTable
ALTER TABLE "Product" DROP COLUMN IF EXISTS "trackSerial";
