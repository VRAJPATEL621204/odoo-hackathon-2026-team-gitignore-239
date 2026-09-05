import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';
import { conflict, notFound, validationError } from '../lib/errors.js';
import { pageResult } from '../lib/pagination.js';
import { grantsBeyond, permissionsForRoles } from '../domain/roles.js';

/** Shape returned to the user-management screen. The hash never leaves here. */
const USER_SELECT = {
  id: true,
  email: true,
  roles: true,
  active: true,
  lastLoginAt: true,
  employee: { select: { id: true, name: true, workEmail: true, jobTitle: true } },
};

export async function listUsers({ search, role, page, pageSize, skip, take }) {
  const where = {
    ...(role ? { roles: { has: role } } : {}),
    ...(search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' } },
            { employee: { name: { contains: search, mode: 'insensitive' } } },
            { employee: { workEmail: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: USER_SELECT,
      orderBy: { employee: { name: 'asc' } },
      skip,
      take,
    }),
    prisma.user.count({ where }),
  ]);

  return pageResult(items, total, { page, pageSize });
}

export async function getUser(id) {
  const user = await prisma.user.findUnique({ where: { id }, select: USER_SELECT });
  if (!user) throw notFound('User');
  return user;
}

/**
 * Refuses a role set the actor could not grant.
 *
 * Two rules from the reference flow are enforced here: nobody may widen their
 * own access, and nobody may hand another account permissions they do not
 * themselves hold.
 */
function assertMayGrant(actor, roles, { editingSelf }) {
  if (editingSelf) {
    throw conflict(
      'SELF_ROLE_CHANGE',
      'You cannot change the roles or the status of your own account. Ask another administrator.'
    );
  }
  const excess = grantsBeyond(actor.roles, roles);
  if (excess.length > 0) {
    throw validationError(
      { roles: 'You cannot grant access wider than your own.' },
      `These roles grant permissions you do not hold: ${excess.join(', ')}.`
    );
  }
}

export async function createUser(actor, { employeeId, email, roles, active, password }) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, user: { select: { id: true } } },
  });
  if (!employee) throw validationError({ employeeId: 'Select an existing employee.' });
  if (employee.user) {
    throw validationError({ employeeId: 'This employee already has a user account.' });
  }

  assertMayGrant(actor, roles, { editingSelf: false });

  return prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      roles,
      active,
      employeeId,
    },
    select: USER_SELECT,
  });
}

/**
 * Updates an account.
 *
 * The employee link is deliberately immutable: moving an account to a different
 * person would silently reassign every record already created under it.
 */
export async function updateUser(actor, id, { email, roles, active, password }) {
  const existing = await prisma.user.findUnique({ where: { id }, select: { id: true, roles: true } });
  if (!existing) throw notFound('User');

  const editingSelf = actor.id === id;
  const rolesChanged = roles !== undefined && !sameRoleSet(existing.roles, roles);
  const statusChanged = active !== undefined;

  if (rolesChanged || statusChanged) {
    assertMayGrant(actor, roles ?? existing.roles, { editingSelf });
  }

  return prisma.user.update({
    where: { id },
    data: {
      ...(email !== undefined ? { email } : {}),
      ...(roles !== undefined ? { roles } : {}),
      ...(active !== undefined ? { active } : {}),
      ...(password ? { passwordHash: await hashPassword(password) } : {}),
    },
    select: USER_SELECT,
  });
}

function sameRoleSet(a, b) {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

/** Employees without an account yet, for the "Employee *" picker on the form. */
export async function listAssignableEmployees(currentUserId) {
  return prisma.employee.findMany({
    where: {
      status: 'ACTIVE',
      OR: [{ user: null }, ...(currentUserId ? [{ user: { id: currentUserId } }] : [])],
    },
    select: { id: true, name: true, workEmail: true, jobTitle: true },
    orderBy: { name: 'asc' },
  });
}

export { permissionsForRoles };
