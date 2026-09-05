import jwt from 'jsonwebtoken';
import { env } from './env.js';

/**
 * Session tokens.
 *
 * The token carries only the user id and a version of the role set. Everything
 * else — the current roles, whether the account is still active — is read from
 * the database on each request, so deactivating an account takes effect
 * immediately instead of at token expiry.
 */

export function signSession(userId) {
  return jwt.sign({ sub: String(userId) }, env.jwtSecret, {
    expiresIn: env.jwtExpiresInSeconds,
  });
}

/** Returns the user id, or null when the token is missing, forged or expired. */
export function readSession(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    const userId = Number(payload.sub);
    return Number.isInteger(userId) ? userId : null;
  } catch {
    return null;
  }
}
