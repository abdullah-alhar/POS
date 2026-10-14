-- Use the generic "raise_exception" error code (P0001) so the readable message reaches the app.
-- (The "restrict_violation" code was reported by the database driver as a foreign key error.)
CREATE OR REPLACE FUNCTION pos_block_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Rows in "%" cannot be %d. This history is kept permanently.',
    TG_TABLE_NAME, lower(TG_OP);
END;
$$ LANGUAGE plpgsql;
