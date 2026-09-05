import { prisma } from '../lib/prisma.js';
import { SESSION_COOKIE } from '../lib/cookies.js';
import { readSession } from '../lib/token.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { permissionsForRoles } from '../domain/roles.js';
import { asyncHandler } from '../lib/asyncHandler.js';

/**
 * Turns the session cookie into `req.user`.
 *
 * The account is loaded from the database on every request rather than trusted
 * from the token, so a role change or a deactivation applies to the very next
 * request instead of waiting for the token to expire.
 */
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const userId = readSession(req.cookies?.[SESSION_COOKIE]);
  if (!userId) throw unauthorized();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      roles: true,
      active: true,
      employeeId: true,
      employee: { select: { id: true, name: true, workEmail: true, jobTitle: true } },
    },
  });

  if (!user) throw unauthorized('Your account no longer exists.', 'SESSION_INVALID');
  if (!user.active) {
    throw forbidden('This account has been deactivated. Contact an administrator.', 'ACCOUNT_INACTIVE');
  }

  req.user = { ...user, permissions: permissionsForRoles(user.roles) };
  next();
});

/**
 * Guards a route with a permission from domain/roles.js.
 *
 * Always used after requireAuth. The message names the permission so a
 * misconfigured account is diagnosable from the response alone.
 */
export function requirePermission(permission) {
  return function permissionGuard(req, _res, next) {
    if (!req.user) return next(unauthorized());
    if (!req.user.permissions.includes(permission)) {
      return next(forbidden(`Your roles do not grant "${permission}".`));
    }
    next();
  };
}
