import { tooManyAttempts } from '../../common/app-exception';

/**
 * Slows down PIN/password guessing: after `maxFailures` wrong tries the key is locked
 * for `lockMs`. Kept in memory; one server, one shop.
 */
export class AttemptLimiter {
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    private readonly maxFailures = 5,
    private readonly lockMs = 5 * 60_000,
  ) {}

  assertAllowed(key: string, now = Date.now()) {
    const entry = this.failures.get(key);
    if (entry && entry.lockedUntil > now) {
      throw tooManyAttempts((entry.lockedUntil - now) / 1000);
    }
  }

  fail(key: string, now = Date.now()) {
    const entry = this.failures.get(key) ?? { count: 0, lockedUntil: 0 };
    if (entry.lockedUntil && entry.lockedUntil <= now) entry.count = 0;
    entry.count += 1;
    entry.lockedUntil = entry.count >= this.maxFailures ? now + this.lockMs : 0;
    this.failures.set(key, entry);
  }

  reset(key: string) {
    this.failures.delete(key);
  }
}
