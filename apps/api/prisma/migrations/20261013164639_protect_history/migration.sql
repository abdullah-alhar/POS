-- History tables are protected at database level, so not even a bug or a manual SQL
-- command can quietly remove a bill, a payment, a stock movement or an audit entry.

CREATE OR REPLACE FUNCTION pos_block_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Rows in "%" cannot be %d. This history is kept permanently.',
    TG_TABLE_NAME, lower(TG_OP)
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

-- Append-only: no UPDATE and no DELETE.
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION pos_block_change();

CREATE TRIGGER stock_movement_append_only
  BEFORE UPDATE OR DELETE ON "StockMovement"
  FOR EACH ROW EXECUTE FUNCTION pos_block_change();

CREATE TRIGGER customer_ledger_append_only
  BEFORE UPDATE OR DELETE ON "CustomerLedger"
  FOR EACH ROW EXECUTE FUNCTION pos_block_change();

-- Never deleted (bills are voided instead; returned quantities are updated on items).
CREATE TRIGGER sale_no_delete
  BEFORE DELETE ON "Sale"
  FOR EACH ROW EXECUTE FUNCTION pos_block_change();

CREATE TRIGGER sale_item_no_delete
  BEFORE DELETE ON "SaleItem"
  FOR EACH ROW EXECUTE FUNCTION pos_block_change();

CREATE TRIGGER payment_append_only
  BEFORE UPDATE OR DELETE ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION pos_block_change();

CREATE TRIGGER sale_return_no_delete
  BEFORE DELETE ON "SaleReturn"
  FOR EACH ROW EXECUTE FUNCTION pos_block_change();

CREATE TRIGGER sale_return_item_no_delete
  BEFORE DELETE ON "SaleReturnItem"
  FOR EACH ROW EXECUTE FUNCTION pos_block_change();

-- Fast case-insensitive product search on the billing screen.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
