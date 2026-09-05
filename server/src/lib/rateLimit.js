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

/**
 * Checks a limiter and enforces it. This is the one enforcement path every
 * rate-limited layer in the app goes through — login, the sitewide write
 * limiter, and the payroll action cooldowns — so the response contract and
 * the audit trail are identical everywhere instead of each call site
 * rolling its own headers and logging.
 *
 * The standard `RateLimit-*` response headers (IETF draft-ietf-httpapi-
 * ratelimit-headers) are set on every call, allowed or not, so a
 * well-behaved client can see its remaining budget and back off before it
 * ever gets a 429 — not just find out after the fact. A rejection also logs
 * one structured line, so a real deployment can alert on repeated hits
 * instead of only ever seeing them in a support ticket.
 */
export function enforceLimit(res, limiter, key, { code, message, layer, actor }) {
  const result = limiter.check(key);
  res.setHeader('RateLimit-Limit', result.limit);
  res.setHeader('RateLimit-Remaining', result.remaining);
  res.setHeader('RateLimit-Reset', Math.ceil(result.resetAt / 1000));

  if (!result.allowed) {
    res.setHeader('Retry-After', result.retryAfterSeconds);
    console.warn(
      `[RATE_LIMIT] layer=${layer} key=${key} actor=${actor ?? 'unknown'} allowed=false retryAfter=${result.retryAfterSeconds}`
    );
    throw tooManyRequests(message, code, result.retryAfterSeconds);
  }

  return result;
}

/** Express middleware around the fixed-window limiter, for the simple case
 * of one limiter guarding one route on one key (e.g. login's IP layer). */
export function rateLimit({ limiter, key = (req) => req.ip ?? 'unknown', message, action = 'API' }) {
  return (req, res, next) => {
    try {
      enforceLimit(res, limiter, key(req), {
        code: 'RATE_LIMIT_EXCEEDED',
        message: message ?? 'Too many requests. Please try again later.',
        layer: action,
        actor: req.ip ?? 'unknown',
      });
      next();
    } catch (error) {
      next(error);
    }
  };
}
