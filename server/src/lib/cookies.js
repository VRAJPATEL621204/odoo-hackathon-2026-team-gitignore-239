/**
 * Cookie handling for the session.
 *
 * Parsing `Cookie` is a few lines, and keeping the flags in one place matters
 * more than the parsing itself: every place that sets or clears the session
 * uses the same httpOnly / sameSite / path combination, so they cannot drift.
 *
 * NODE_ENV is read directly rather than through lib/env.js so this module stays
 * free of startup side effects and can be unit tested without a .env file.
 */

export const SESSION_COOKIE = 'ppp_session';

const isProduction = process.env.NODE_ENV === 'production';

/** Parses a `Cookie` header into a plain object. */
export function parseCookies(header) {
  const result = {};
  if (!header) return result;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (!name) continue;
    const rawValue = part.slice(separator + 1).trim();
    try {
      result[name] = decodeURIComponent(rawValue);
    } catch {
      // A malformed percent-escape is not worth failing the request over.
      result[name] = rawValue;
    }
  }
  return result;
}

/** Express middleware that exposes parsed cookies as `req.cookies`. */
export function cookieParser(req, _res, next) {
  req.cookies = parseCookies(req.headers.cookie);
  next();
}

/**
 * httpOnly keeps the token out of reach of any script on the page, so an XSS
 * bug cannot steal the session. SameSite=Lax blocks the cookie on cross-site
 * form posts, which covers CSRF for our state-changing routes.
 */
export function setSessionCookie(res, token, maxAgeSeconds) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: maxAgeSeconds * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
  });
}

/**
 * The Google OAuth state cookie.
 *
 * A random value is stored here before redirecting to Google and compared
 * against the `state` query param Google echoes back on the callback — the
 * standard CSRF protection for a redirect-based OAuth flow, so a forged
 * callback request (missing or wrong state) is rejected before any token
 * exchange happens. Scoped to the /api/auth/google path and a short 10-minute
 * lifetime since it only needs to survive one round trip to Google and back.
 */
export const OAUTH_STATE_COOKIE = 'ppp_oauth_state';
const OAUTH_STATE_PATH = '/api/auth/google';

export function setOAuthStateCookie(res, value) {
  res.cookie(OAUTH_STATE_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 10 * 60 * 1000,
    path: OAUTH_STATE_PATH,
  });
}

export function clearOAuthStateCookie(res) {
  res.clearCookie(OAUTH_STATE_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: OAUTH_STATE_PATH,
  });
}
