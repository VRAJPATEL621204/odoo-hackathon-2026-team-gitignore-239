import { tooManyRequests } from './errors.js';

/** A small fixed-window limiter isolated for easy replacement with Redis later. */
export function createRateLimiter({ limit, windowMs }) {
  const hits = new Map();

  function prune(now) {
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }

  return {
    /** Records an attempt and exposes standard rate-limit metadata. */
    check(key) {
      const now = Date.now();
      prune(now);

      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        return {
          allowed: true,
          limit,
          remaining: Math.max(0, limit - 1),
          resetAt: now + windowMs,
          retryAfterSeconds: 0,
        };
      }

      entry.count += 1;
      if (entry.count > limit) {
        return {
          allowed: false,
          limit,
          remaining: 0,
          resetAt: entry.resetAt,
          retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
        };
      }
      return {
        allowed: true,
        limit,
        remaining: Math.max(0, limit - entry.count),
        resetAt: entry.resetAt,
        retryAfterSeconds: 0,
      };
    },

    /** Clears the counter for a key after a successful attempt. */
    reset(key) {
      hits.delete(key);
    },
  };
}

/** Express middleware around the fixed-window limiter. */
export function rateLimit({ limiter, key = (req) => req.ip ?? 'unknown', message, action = 'API' }) {
  return (req, res, next) => {
    const result = limiter.check(key(req));
    res.setHeader('RateLimit-Limit', result.limit);
    res.setHeader('RateLimit-Remaining', result.remaining);
    res.setHeader('RateLimit-Reset', Math.ceil(result.resetAt / 1000));
    if (!result.allowed) {
      res.setHeader('Retry-After', result.retryAfterSeconds);
      console.warn(
        `[RATE_LIMIT] IP=${req.ip ?? 'unknown'} route=${req.originalUrl} action=${action} allowed=false retryAfter=${result.retryAfterSeconds}`
      );
      return next(
        tooManyRequests(
          message ?? 'Too many requests. Please try again later.',
          'RATE_LIMIT_EXCEEDED',
          result.retryAfterSeconds
        )
      );
    }
    next();
  };
}
