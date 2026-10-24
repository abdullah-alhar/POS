-- Selling more than the stock is now blocked unless the owner allows it again
-- (Settings → Billing → "Allow selling items with no stock").
UPDATE "Setting"
SET "value" = jsonb_set("value"::jsonb, '{allowZeroStockSale}', 'false'::jsonb)
WHERE "key" = 'pos';
