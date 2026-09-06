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

/**
 * Guards a route that any one of several permissions may open.
 *
 * Used where one screen is shared between a manager view (the module read
 * permission) and a self-service view (`self.service`). The data each caller
 * sees is still narrowed by `selfScopeId` below — this only opens the door.
 */
export function requireAnyPermission(...permissions) {
  return function anyPermissionGuard(req, _res, next) {
    if (!req.user) return next(unauthorized());
    if (permissions.some((permission) => req.user.permissions.includes(permission))) return next();
    return next(forbidden(`Your roles grant none of: ${permissions.join(', ')}.`));
  };
}

/**
 * The employee id a list or record request must be confined to, or `undefined`
 * for unrestricted access.
 *
 * A caller holding `elevatedPermission` (an approver, a payroll processor, an
 * admin) sees every employee's records. Everyone else — a plain self-service
 * employee, or a read-only role that is not an approver — is pinned to their
 * own employee row regardless of any `employeeId` in the query string. A
 * non-elevated caller with no linked employee is pinned to `-1`, which matches
 * nothing, so a misconfigured account leaks no data.
 */
export function selfScopeId(req, elevatedPermission) {
  if (req.user?.permissions.includes(elevatedPermission)) return undefined;
  return req.user?.employeeId ?? -1;
}

/**
 * Throws unless the caller may see records belonging to `employeeId`.
 * `scopeId` is the value returned by `selfScopeId`.
 */
export function assertInScope(scopeId, employeeId) {
  if (scopeId !== undefined && employeeId !== scopeId) {
    throw forbidden('This record belongs to another employee.');
  }
}
