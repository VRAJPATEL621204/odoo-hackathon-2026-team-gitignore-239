import { createRateLimiter, enforceLimit } from './rateLimit.js';
import { readSession } from './token.js';
import { SESSION_COOKIE } from './cookies.js';
import { env } from './env.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Reads (GET) are deliberately left uncapped here — a busy page firing a
// handful of GETs on load is normal traffic, not abuse, and an earlier,
// blunter version of this limiter that covered every method learned that
// lesson the hard way (real navigation was tripping it). Writes are where
// abuse actually costs something: DB rows, emails, PDF renders.
const ipLimiter = createRateLimiter({
  limit: env.writeRateLimitIpMax,
  windowMs: env.writeRateLimitIpWindow * 1000,
});
const userLimiter = createRateLimiter({
  limit: env.writeRateLimitUserMax,
  windowMs: env.writeRateLimitUserWindow * 1000,
});

/**
 * Sitewide backstop on write traffic, mounted once in app.js ahead of every
 * router. Login has its own dedicated three-layer limiter (see
 * auth.routes.js) and is excluded here; specific payroll actions
 * (compute/send/pdf) additionally carry their own tighter per-resource
 * cooldowns on top of this — this middleware is just the generic ceiling
 * that catches everything else (HR records, attendance punches, timeoff
 * requests, user management, payroll config writes, ...).
 *
 * Keyed two ways, checked independently: IP first (catches a script hitting
 * the API from one machine, regardless of which account it's using), then
 * account (catches one compromised or scripted account regardless of which
 * IP it comes from). The session cookie is decoded directly here rather than
 * relying on `requireAuth`, since this middleware runs before any router —
 * an unauthenticated request just falls back to an IP-only key.
 */
export function writeRateLimit(req, res, next) {
  if (!MUTATING_METHODS.has(req.method)) return next();
  if (req.path === '/auth/login' || req.path === '/auth/logout') return next();

  try {
    const ip = req.ip ?? 'unknown';
    enforceLimit(res, ipLimiter, ip, {
      code: 'WRITE_RATE_LIMIT_IP',
      message: 'Too many requests from this network. Please slow down.',
      layer: 'WRITE_IP',
      actor: ip,
    });

    const userId = readSession(req.cookies?.[SESSION_COOKIE]);
    const userKey = userId ? `user:${userId}` : `anon:${ip}`;
    enforceLimit(res, userLimiter, userKey, {
      code: 'WRITE_RATE_LIMIT_USER',
      message: 'Too many changes in a short time. Please slow down and try again.',
      layer: 'WRITE_USER',
      actor: userKey,
    });

    next();
  } catch (error) {
    next(error);
  }
}
