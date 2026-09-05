import crypto from 'node:crypto';

/**
 * An anonymous per-browser identifier, used only as a secondary key for login
 * rate limiting (alongside IP and account).
 *
 * It is not an identity or a security boundary: clearing cookies or opening a
 * private window gets a fresh one for free. It exists to catch the case an IP
 * alone misses — many accounts tried from one browser behind a shared or NAT
 * IP — not to replace IP/account limiting.
 */

export const DEVICE_COOKIE = 'ppp_did';

const isProduction = process.env.NODE_ENV === 'production';
const ID_PATTERN = /^[a-f0-9]{32}$/;

/** Express middleware that ensures every request carries a device cookie. */
export function deviceId(req, res, next) {
  const existing = req.cookies?.[DEVICE_COOKIE];
  if (existing && ID_PATTERN.test(existing)) {
    req.deviceId = existing;
    return next();
  }

  const id = crypto.randomBytes(16).toString('hex');
  res.cookie(DEVICE_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 365 * 24 * 60 * 60 * 1000,
    path: '/',
  });
  req.deviceId = id;
  next();
}
