/**
 * Money helpers. All money is an integer number of cents (1 rupee = 100 cents).
 * Percentages are integer basis points (1% = 100 bp, 12.5% = 1250 bp).
 * Nothing in here uses floating point arithmetic on money.
 */

export type Cents = number;

export const CENTS_PER_UNIT = 100;
export const BP_PER_WHOLE = 10_000;

/** Largest amount we accept for a single money value (fits in a Postgres INTEGER). */
export const MAX_CENTS = 2_147_483_647;

export function isCents(value: unknown): value is Cents {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function assertCents(value: number, label = 'amount'): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a whole number of cents, got ${value}`);
  }
  return value;
}

/**
 * Integer division rounded half away from zero, the way people round money.
 * Works on safe integers only.
 */
export function divRound(numerator: number, denominator: number): number {
  if (denominator === 0) throw new Error('Division by zero');
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new Error('divRound needs safe integers');
  }
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  const q = Math.floor(n / d);
  const r = n - q * d;
  const rounded = r * 2 >= d ? q + 1 : q;
  return sign * rounded;
}

/** `amount * bp / 10000`, rounded half up. */
export function percentOf(amount: Cents, bp: number): Cents {
  return divRound(amount * bp, BP_PER_WHOLE);
}

/** Round an amount to the nearest multiple of `step` cents (half away from zero). */
export function roundToStep(amount: Cents, step: number): Cents {
  if (step <= 1) return amount;
  return divRound(amount, step) * step;
}

/**
 * Split `total` across `weights` in proportion, so the parts always add up to `total` exactly.
 * Uses the largest-remainder method; ties go to the earlier item.
 */
export function allocateProportionally(total: Cents, weights: readonly number[]): Cents[] {
  if (weights.length === 0) return [];
  if (total < 0 || weights.some((w) => w < 0)) {
    throw new Error('allocateProportionally needs a non-negative total and weights');
  }
  // BigInt keeps total * weight exact even for very large bills.
  const big = weights.map((w) => BigInt(w));
  const weightSum = big.reduce((a, b) => a + b, 0n);
  if (weightSum === 0n || total === 0) return weights.map(() => 0);

  const t = BigInt(total);
  const parts = big.map((w) => (t * w) / weightSum);
  const remainders = big.map((w, i) => ({ i, r: t * w - parts[i]! * weightSum }));
  let left = t - parts.reduce((a, b) => a + b, 0n);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (left <= 0n) break;
    parts[i]! += 1n;
    left -= 1n;
  }
  return parts.map(Number);
}

const DECIMAL_RE = /^\s*(-)?(\d+)?(?:\.(\d*))?\s*$/;

/**
 * Parse a decimal string into an integer scaled by 10^decimals without floating point.
 * Returns null when the text is not a valid number or has too many decimals.
 */
function parseScaled(text: string, decimals: number): number | null {
  const cleaned = text.replace(/,/g, '');
  const m = DECIMAL_RE.exec(cleaned);
  if (!m) return null;
  const [, minus, whole = '', frac = ''] = m;
  if (whole === '' && frac === '') return null;
  if (frac.length > decimals) return null;
  const scaled = Number(whole || '0') * 10 ** decimals + Number(frac.padEnd(decimals, '0') || '0');
  if (!Number.isSafeInteger(scaled)) return null;
  return minus ? -scaled : scaled;
}

/** "1,250.50" → 125050. Returns null for invalid input. */
export function parseMoney(text: string): Cents | null {
  return parseScaled(text, 2);
}

/** "12.5" → 1250 (basis points). Returns null for invalid input. */
export function parsePercent(text: string): number | null {
  return parseScaled(text, 2);
}

/** 125050 → "1250.50" (for input fields; no grouping, no symbol). */
export function centsToInput(cents: Cents, showCents = true): string {
  if (!showCents) return String(divRound(cents, CENTS_PER_UNIT));
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / CENTS_PER_UNIT);
  const frac = abs % CENTS_PER_UNIT;
  return frac === 0 ? `${sign}${whole}` : `${sign}${whole}.${String(frac).padStart(2, '0')}`;
}

/** 1250 bp → "12.5" */
export function bpToPercentText(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const frac = Math.abs(bp % 100);
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

export interface FormatMoneyOptions {
  /** Currency symbol, default "Rs". Pass "" for none. */
  symbol?: string;
  /** Show the two cent digits. The shop UI hides them by default. */
  showCents?: boolean;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 125050 → "Rs 1,251" (default, no cents) or "Rs 1,250.50" with showCents. */
export function formatMoney(cents: Cents, options: FormatMoneyOptions = {}): string {
  const { symbol = 'Rs', showCents = false } = options;
  const value = showCents ? cents : divRound(cents, CENTS_PER_UNIT);
  const abs = Math.abs(value);
  const body = showCents
    ? `${groupThousands(String(Math.floor(abs / 100)))}.${String(abs % 100).padStart(2, '0')}`
    : groupThousands(String(abs));
  const sign = value < 0 ? '-' : '';
  const prefix = symbol ? `${symbol} ` : '';
  return `${sign}${prefix}${body}`;
}

/** 7 → "7 days", 182 → "6 months", 365 → "1 year", 730 → "2 years". */
export function warrantyLabel(days: number): string {
  if (days <= 0) return '';
  if (days % 365 === 0) return `${days / 365} year${days === 365 ? '' : 's'}`;
  const months = Math.round(days / 30.4);
  if (days >= 28 && Math.abs(months * 30.4 - days) <= 3)
    return `${months} month${months === 1 ? '' : 's'}`;
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** Last day of a warranty that starts on `from`. */
export function warrantyEnd(from: Date, days: number): Date {
  const d = new Date(from);
  if (days % 365 === 0) d.setFullYear(d.getFullYear() + days / 365);
  else {
    const months = Math.round(days / 30.4);
    if (days >= 28 && Math.abs(months * 30.4 - days) <= 3) d.setMonth(d.getMonth() + months);
    else d.setDate(d.getDate() + days);
  }
  return d;
}
