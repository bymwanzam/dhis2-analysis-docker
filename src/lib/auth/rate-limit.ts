/**
 * Failed sign-in attempts, counted per key (an address, an account) over a
 * window. After too many, further attempts are refused until the window
 * moves on — which also protects DHIS2 accounts from being locked out by
 * someone guessing through this site.
 *
 * Held in memory: per process, cleared on restart. Enough to stop guessing
 * on a single small server; not a substitute for a shared store.
 */
export class AttemptLimiter {
  private readonly failures = new Map<string, number[]>();
  private readonly maxFailures: number;
  private readonly windowMs: number;

  constructor(maxFailures = 8, windowMs = 15 * 60 * 1000) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
  }

  private recent(key: string, now: number): number[] {
    const kept = (this.failures.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (kept.length) this.failures.set(key, kept);
    else this.failures.delete(key);
    return kept;
  }

  /** Seconds until another attempt is allowed; 0 when one is allowed now. */
  retryAfter(keys: string[], now = Date.now()): number {
    let wait = 0;
    for (const key of keys) {
      const recent = this.recent(key, now);
      if (recent.length >= this.maxFailures) {
        wait = Math.max(wait, Math.ceil((recent[0] + this.windowMs - now) / 1000));
      }
    }
    return wait;
  }

  fail(keys: string[], now = Date.now()): void {
    for (const key of keys) this.failures.set(key, [...this.recent(key, now), now]);
    if (this.failures.size > 10_000) this.failures.clear();
  }

  succeed(keys: string[]): void {
    for (const key of keys) this.failures.delete(key);
  }
}
