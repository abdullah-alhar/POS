/**
 * EAN-13 helpers. Barcodes we create ourselves start with "2", the range GS1 reserves
 * for in-store use, so they never clash with a manufacturer's barcode.
 */

export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new Error('EAN-13 needs 12 digits before the check digit');
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** Turn a running number into an in-store EAN-13, e.g. 42 → "2000000000428". */
export function makeInternalEan13(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 99_999_999_999) {
    throw new Error('Barcode sequence out of range');
  }
  const first12 = `2${String(sequence).padStart(11, '0')}`;
  return `${first12}${ean13CheckDigit(first12)}`;
}

/** Barcodes are compared without surrounding spaces; scanners sometimes add them. */
export function normalizeBarcode(code: string): string {
  return code.trim();
}
