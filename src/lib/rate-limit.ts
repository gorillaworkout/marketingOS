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
export function rateLimit(request: NextRequest): NextResponse | null {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1';

  const now = Date.now();
  let entry = store.get(ip);

  if (!entry || now > entry.resetTime) {
    entry = { count: 1, resetTime: now + WINDOW_MS };
    store.set(ip, entry);
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
