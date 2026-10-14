import type { Tx } from './prisma.service';

/**
 * Next value of a running number. Must be called inside a transaction: the counter row stays
 * locked until the transaction ends, and a rollback gives the number back, so there are no gaps.
 */
export async function nextCounter(tx: Tx, key: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "DocumentCounter" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "DocumentCounter"."value" + 1
    RETURNING "value"`;
  return rows[0]!.value;
}

/** "INV", 2026, 123 → "INV-2026-000123" */
export function documentNumber(prefix: string, year: number, value: number): string {
  return `${prefix}-${year}-${String(value).padStart(6, '0')}`;
}

/** Next yearly document number, e.g. INV-2026-000123. Numbering restarts every year. */
export async function nextDocumentNumber(
  tx: Tx,
  prefix: string,
  date = new Date(),
): Promise<string> {
  const year = date.getFullYear();
  const value = await nextCounter(tx, `${prefix}-${year}`);
  return documentNumber(prefix, year, value);
}
