import bcrypt from 'bcryptjs';

/**
 * Password hashing.
 *
 * bcrypt with a work factor of 10, which is around 60ms per hash on a laptop:
 * slow enough to make an offline guessing attack expensive, fast enough that a
 * login still feels instant.
 */

const SALT_ROUNDS = 10;

/** The minimum an administrator may set. Enforced by the validator too. */
export const MIN_PASSWORD_LENGTH = 8;

export function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/**
 * Verifies a password against a stored hash.
 *
 * Always compares, even when the hash is missing, so the response time does
 * not reveal whether the email exists.
 */
export function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin');
}
