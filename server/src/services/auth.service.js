import { prisma } from '../lib/prisma.js';
import { verifyPassword } from '../lib/password.js';
import { unauthorized, forbidden } from '../lib/errors.js';
import { permissionsForRoles } from '../domain/roles.js';

/**
 * The session payload every screen relies on.
 *
 * `permissions` is derived server-side so the client can hide menus it cannot
 * use without duplicating the role table.
 */
export function sessionPayload(user) {
  return {
    id: user.id,
    email: user.email,
    roles: user.roles,
    permissions: permissionsForRoles(user.roles),
    employee: user.employee
      ? { id: user.employee.id, name: user.employee.name, jobTitle: user.employee.jobTitle ?? null }
      : null,
  };
}

/**
 * Checks credentials and returns the user, or throws.
 *
 * A wrong email and a wrong password produce the same 401 with the same
 * message: telling the two apart would let anyone enumerate which addresses
 * have accounts.
 */
export async function authenticate(email, password) {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { employee: { select: { id: true, name: true, jobTitle: true } } },
  });

  const matches = await verifyPassword(password, user?.passwordHash);
  if (!user || !matches) {
    throw unauthorized('Incorrect email or password.', 'INVALID_CREDENTIALS');
  }

  if (!user.active) {
    throw forbidden('This account has been deactivated. Contact an administrator.', 'ACCOUNT_INACTIVE');
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return user;
}

/**
 * Google sign-in, on the same account lookup password login uses.
 *
 * There is no separate "linked Google account" concept and no new column:
 * the existing unique User.email is already the identity link, so a Google
 * sign-in either matches an existing, active account by its verified email —
 * and is let in with exactly the roles and permissions that account already
 * has — or it does not, and is refused. This is deliberate for an HR/payroll
 * system: Google proves who somebody is, never what they are allowed to see,
 * and it must never create an account of its own accord.
 */
export async function authenticateWithGoogle({ email, emailVerified }) {
  if (!email || !emailVerified) {
    throw unauthorized('Unable to sign in with Google. Please try again.', 'GOOGLE_UNVERIFIED');
  }

  const normalizedEmail = email.toLowerCase().trim();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: { employee: { select: { id: true, name: true, jobTitle: true } } },
  });

  if (!user) {
    throw unauthorized(
      'This Google account is not associated with an authorized account. Please contact your administrator.',
      'GOOGLE_ACCOUNT_NOT_FOUND'
    );
  }
  if (!user.active) {
    throw forbidden('This account has been deactivated. Contact an administrator.', 'ACCOUNT_INACTIVE');
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return user;
}
