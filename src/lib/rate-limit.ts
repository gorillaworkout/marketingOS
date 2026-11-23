import { NextRequest, NextResponse } from 'next/server';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const store = new Map<string, RateLimitEntry>();

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 30;

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  store.forEach((entry, key) => {
    if (now > entry.resetTime) {
      store.delete(key);
    }
  });
}, 5 * 60 * 1000).unref();

/**
 * Check rate limit for the given request.
 * Returns null if allowed, or a 429 NextResponse if rate limited.
 */
export function rateLimit(request: NextRequest, authenticatedKey?: string): NextResponse | null {
  const key = authenticatedKey ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1';

  const now = Date.now();
  let entry = store.get(key);

  if (!entry || now > entry.resetTime) {
    entry = { count: 1, resetTime: now + WINDOW_MS };
    store.set(key, entry);
    return null;
  }

  entry.count++;

  if (entry.count > MAX_REQUESTS) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((entry.resetTime - now) / 1000)),
        },
      }
    );
  }

  return null;
}

// Named buckets: each caller gets its own counters, unlike rateLimit() above,
// which shares one counter per IP across every route. Production runs one pm2
// process, so in-memory is enough.
const buckets = new Map<string, Map<string, RateLimitEntry>>();

export function consumeRateLimit(bucket: string, key: string, limit: number, windowMs: number, now: number = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
  let entries = buckets.get(bucket);
  if (!entries) {
    entries = new Map();
    buckets.set(bucket, entries);
  }
  if (entries.size > 5000) {
    for (const [k, entry] of entries) if (now >= entry.resetTime) entries.delete(k);
  }
  const entry = entries.get(key);
  if (!entry || now >= entry.resetTime) {
    entries.set(key, { count: 1, resetTime: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (entry.count >= limit) return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetTime - now) / 1000) };
  entry.count++;
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test helper. */
export function resetRateLimitBuckets(): void {
  buckets.clear();
}

/**
 * Visitor IP. Production (marketing-aws) comes through the Cloudflare tunnel
 * straight to :3021, so CF-Connecting-IP is the real one. nginx (port 80,
 * marketingos.gorillaworkout.id) sets X-Real-IP and X-Forwarded-For.
 */
export function clientIpFromHeaders(headers: Headers): string {
  return headers.get('cf-connecting-ip')?.trim()
    || headers.get('x-real-ip')?.trim()
    || headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
}
