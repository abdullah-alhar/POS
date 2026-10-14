-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'CASHIER');

-- CreateEnum
CREATE TYPE "PriceMode" AS ENUM ('RETAIL', 'WHOLESALE');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('AMOUNT', 'PERCENT');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'BANK_TRANSFER', 'CREDIT');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('OPENING', 'SALE', 'SALE_VOID', 'RETURN', 'PURCHASE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "AdjustmentReason" AS ENUM ('DAMAGED', 'LOST', 'COUNT_CORRECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('RETAIL', 'WHOLESALE');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('CREDIT_SALE', 'PAYMENT', 'RETURN', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CashSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('CASH_IN', 'CASH_OUT');

-- CreateEnum
CREATE TYPE "RefundMethod" AS ENUM ('CASH', 'CARD', 'BANK_TRANSFER', 'ACCOUNT');

-- CreateEnum
CREATE TYPE "BackupKind" AS ENUM ('AUTO', 'MANUAL', 'PRE_RESTORE', 'PRE_UPDATE');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('OK', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "permissions" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "DocumentCounter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocumentCounter_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID,
    "approvedById" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "summary" TEXT,
    "before" JSONB,
    "after" JSONB,
    "meta" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Backup" (
    "id" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "kind" "BackupKind" NOT NULL,
    "status" "BackupStatus" NOT NULL,
    "error" TEXT,
    "copiedToUsb" BOOLEAN NOT NULL DEFAULT false,
    "uploadedToDrive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Backup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rateBp" INTEGER NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" UUID,
    "brandId" UUID,
    "taxRateId" UUID,
    "trackStock" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "costPrice" INTEGER NOT NULL DEFAULT 0,
    "retailPrice" INTEGER NOT NULL,
    "wholesalePrice" INTEGER NOT NULL,
    "stockQty" INTEGER NOT NULL DEFAULT 0,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Barcode" (
    "code" TEXT NOT NULL,
    "variantId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Barcode_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "qtyChange" INTEGER NOT NULL,
    "qtyAfter" INTEGER NOT NULL,
    "unitCost" INTEGER NOT NULL DEFAULT 0,
    "refType" TEXT,
    "refId" UUID,
    "note" TEXT,
    "userId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustment" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "reason" "AdjustmentReason" NOT NULL,
    "note" TEXT,
    "userId" UUID NOT NULL,
    "approvedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustmentItem" (
    "id" UUID NOT NULL,
    "adjustmentId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "qtyChange" INTEGER NOT NULL,
    "unitCost" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StockAdjustmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" UUID NOT NULL,
    "supplierInvoiceNo" TEXT,
    "invoiceDate" DATE NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" INTEGER NOT NULL DEFAULT 0,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "taxTotal" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "paidAmount" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "receivedById" UUID,
    "receivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseItem" (
    "id" UUID NOT NULL,
    "purchaseId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitCost" INTEGER NOT NULL,
    "lineTotal" INTEGER NOT NULL,

    CONSTRAINT "PurchaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "purchaseId" UUID,
    "amount" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "type" "CustomerType" NOT NULL DEFAULT 'RETAIL',
    "creditLimit" INTEGER NOT NULL DEFAULT 0,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerLedger" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "method" "PaymentMethod",
    "reference" TEXT,
    "refType" TEXT,
    "refId" UUID,
    "note" TEXT,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashSession" (
    "id" UUID NOT NULL,
    "status" "CashSessionStatus" NOT NULL DEFAULT 'OPEN',
    "openedById" UUID NOT NULL,
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingCash" INTEGER NOT NULL,
    "closedById" UUID,
    "closedAt" TIMESTAMPTZ(3),
    "expectedCash" INTEGER,
    "countedCash" INTEGER,
    "difference" INTEGER,
    "denominations" JSONB,
    "note" TEXT,

    CONSTRAINT "CashSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "approvedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "priceMode" "PriceMode" NOT NULL,
    "customerId" UUID,
    "cashierId" UUID NOT NULL,
    "cashSessionId" UUID,
    "subtotal" INTEGER NOT NULL,
    "itemDiscountTotal" INTEGER NOT NULL DEFAULT 0,
    "billDiscountType" "DiscountType",
    "billDiscountValue" INTEGER,
    "billDiscountAmount" INTEGER NOT NULL DEFAULT 0,
    "taxTotal" INTEGER NOT NULL DEFAULT 0,
    "roundingAdjustment" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "paidTotal" INTEGER NOT NULL,
    "changeGiven" INTEGER NOT NULL DEFAULT 0,
    "costTotal" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "discountApprovedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMPTZ(3),
    "voidedById" UUID,
    "voidApprovedById" UUID,
    "voidReason" TEXT,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleItem" (
    "id" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "productName" TEXT NOT NULL,
    "variantName" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "listPrice" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "priceApprovedById" UUID,
    "discountType" "DiscountType",
    "discountValue" INTEGER,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "billDiscountShare" INTEGER NOT NULL DEFAULT 0,
    "taxRateBp" INTEGER NOT NULL DEFAULT 0,
    "taxAmount" INTEGER NOT NULL DEFAULT 0,
    "lineTotal" INTEGER NOT NULL,
    "unitCost" INTEGER NOT NULL DEFAULT 0,
    "returnedQty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" INTEGER NOT NULL,
    "tendered" INTEGER,
    "reference" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeldBill" (
    "id" UUID NOT NULL,
    "label" TEXT,
    "cart" JSONB NOT NULL,
    "customerId" UUID,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeldBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleReturn" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "saleId" UUID NOT NULL,
    "customerId" UUID,
    "userId" UUID NOT NULL,
    "approvedById" UUID,
    "cashSessionId" UUID,
    "reason" TEXT NOT NULL,
    "taxTotal" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "refundMethod" "RefundMethod" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleReturnItem" (
    "id" UUID NOT NULL,
    "returnId" UUID NOT NULL,
    "saleItemId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "refundAmount" INTEGER NOT NULL,
    "taxAmount" INTEGER NOT NULL DEFAULT 0,
    "restock" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SaleReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "Backup_createdAt_idx" ON "Backup"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_name_key" ON "Brand"("name");

-- CreateIndex
CREATE UNIQUE INDEX "TaxRate_name_key" ON "TaxRate"("name");

-- CreateIndex
CREATE INDEX "Product_name_idx" ON "Product"("name");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE INDEX "Product_brandId_idx" ON "Product"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE INDEX "Barcode_variantId_idx" ON "Barcode"("variantId");

-- CreateIndex
CREATE INDEX "StockMovement_variantId_createdAt_idx" ON "StockMovement"("variantId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_refType_refId_idx" ON "StockMovement"("refType", "refId");

-- CreateIndex
CREATE INDEX "StockMovement_createdAt_idx" ON "StockMovement"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockAdjustment_number_key" ON "StockAdjustment"("number");

-- CreateIndex
CREATE INDEX "StockAdjustmentItem_adjustmentId_idx" ON "StockAdjustmentItem"("adjustmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_number_key" ON "Purchase"("number");

-- CreateIndex
CREATE INDEX "Purchase_supplierId_idx" ON "Purchase"("supplierId");

-- CreateIndex
CREATE INDEX "Purchase_invoiceDate_idx" ON "Purchase"("invoiceDate");

-- CreateIndex
CREATE INDEX "PurchaseItem_purchaseId_idx" ON "PurchaseItem"("purchaseId");

-- CreateIndex
CREATE INDEX "PurchaseItem_variantId_idx" ON "PurchaseItem"("variantId");

-- CreateIndex
CREATE INDEX "SupplierPayment_supplierId_idx" ON "SupplierPayment"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phone_key" ON "Customer"("phone");

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "Customer"("name");

-- CreateIndex
CREATE INDEX "CustomerLedger_customerId_createdAt_idx" ON "CustomerLedger"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "CashSession_status_idx" ON "CashSession"("status");

-- CreateIndex
CREATE INDEX "CashSession_openedAt_idx" ON "CashSession"("openedAt");

-- CreateIndex
CREATE INDEX "CashMovement_sessionId_idx" ON "CashMovement"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_clientId_key" ON "Sale"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_number_key" ON "Sale"("number");

-- CreateIndex
CREATE INDEX "Sale_createdAt_idx" ON "Sale"("createdAt");

-- CreateIndex
CREATE INDEX "Sale_cashierId_createdAt_idx" ON "Sale"("cashierId", "createdAt");

-- CreateIndex
CREATE INDEX "Sale_customerId_idx" ON "Sale"("customerId");

-- CreateIndex
CREATE INDEX "Sale_status_createdAt_idx" ON "Sale"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Sale_cashSessionId_idx" ON "Sale"("cashSessionId");

-- CreateIndex
CREATE INDEX "SaleItem_saleId_idx" ON "SaleItem"("saleId");

-- CreateIndex
CREATE INDEX "SaleItem_variantId_idx" ON "SaleItem"("variantId");

-- CreateIndex
CREATE INDEX "Payment_saleId_idx" ON "Payment"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "SaleReturn_number_key" ON "SaleReturn"("number");

-- CreateIndex
CREATE INDEX "SaleReturn_saleId_idx" ON "SaleReturn"("saleId");

-- CreateIndex
CREATE INDEX "SaleReturn_createdAt_idx" ON "SaleReturn"("createdAt");

-- CreateIndex
CREATE INDEX "SaleReturnItem_returnId_idx" ON "SaleReturnItem"("returnId");

-- AddForeignKey
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "TaxRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Barcode" ADD CONSTRAINT "Barcode_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustmentItem" ADD CONSTRAINT "StockAdjustmentItem_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "StockAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustmentItem" ADD CONSTRAINT "StockAdjustmentItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerLedger" ADD CONSTRAINT "CustomerLedger_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerLedger" ADD CONSTRAINT "CustomerLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CashSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_discountApprovedById_fkey" FOREIGN KEY ("discountApprovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_voidApprovedById_fkey" FOREIGN KEY ("voidApprovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_priceApprovedById_fkey" FOREIGN KEY ("priceApprovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeldBill" ADD CONSTRAINT "HeldBill_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeldBill" ADD CONSTRAINT "HeldBill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "SaleReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
