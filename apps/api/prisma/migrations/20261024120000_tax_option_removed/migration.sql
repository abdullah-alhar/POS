-- The VAT / tax option is removed from the app: bills carry no tax.
UPDATE "Setting"
SET "value" = jsonb_set("value"::jsonb, '{vatRegistered}', 'false'::jsonb)
WHERE "key" = 'tax';

UPDATE "Product" SET "taxRateId" = NULL WHERE "taxRateId" IS NOT NULL;
