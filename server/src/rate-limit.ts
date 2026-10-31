import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

interface WindowEntry {
  windowStart: number;
  count: number;
}

export class FixedWindowLimiter {
  private readonly entries = new Map<string, WindowEntry>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxEntries = 20_000
  ) {
    if (limit < 1 || windowMs < 1) throw new Error('Invalid rate limit configuration.');
  }

  take(key: string, now = Date.now()): boolean {
    if (key.length === 0) return false;
    const windowStart = Math.floor(now / this.windowMs) * this.windowMs;
    const existing = this.entries.get(key);
    const next = !existing || existing.windowStart !== windowStart
      ? { windowStart, count: 1 }
      : { windowStart, count: existing.count + 1 };
    this.entries.set(key, next);
    if (this.entries.size > this.maxEntries) this.prune(now);
    return next.count <= this.limit;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.windowStart + this.windowMs <= now) this.entries.delete(key);
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}

export function getClientAddress(request: IncomingMessage, trustProxy: boolean): string {
  const remote = normalizeAddress(request.socket.remoteAddress) ?? 'unknown';
  if (!trustProxy) return remote;

  const forwardedHeader = request.headers['x-forwarded-for'];
  const forwarded = Array.isArray(forwardedHeader) ? forwardedHeader[0] : forwardedHeader;
  const candidate = forwarded?.split(',')[0]?.trim();
  return candidate && isIP(candidate) !== 0 ? candidate : remote;
}

function normalizeAddress(value: string | undefined): string | null {
  if (!value) return null;
  const address = value.startsWith('::ffff:') ? value.slice(7) : value;
  return isIP(address) !== 0 ? address : null;
}
