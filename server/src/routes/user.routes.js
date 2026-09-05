import { Router } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import { readId } from '../lib/params.js';
import { validator } from '../lib/validate.js';
import { parsePageParams, parseSearch } from '../lib/pagination.js';
import { MIN_PASSWORD_LENGTH } from '../lib/password.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { PERMISSIONS, ROLE_VALUES } from '../domain/roles.js';
import {
  createUser,
  getUser,
  listAssignableEmployees,
  listUsers,
  updateUser,
} from '../services/user.service.js';

export const userRouter = Router();

// Every route below is administrator-only, matching the "ADMIN ONLY" badge on
// the user management screen in the reference flow.
userRouter.use('/users', requireAuth, requirePermission(PERMISSIONS.USERS_MANAGE));

userRouter.get(
  '/users',
  asyncHandler(async (req, res) => {
    const page = parsePageParams(req.query);
    const role = ROLE_VALUES.includes(req.query.role) ? req.query.role : null;
    res.json(await listUsers({ search: parseSearch(req.query), role, ...page }));
  })
);

/** Employees who can still be given an account. Used by the form's picker. */
userRouter.get(
  '/users/assignable-employees',
  asyncHandler(async (_req, res) => {
    res.json({ items: await listAssignableEmployees(null) });
  })
);

userRouter.get(
  '/users/:id',
  asyncHandler(async (req, res) => {
    res.json(await getUser(readId(req.params.id)));
  })
);

/** Validates the role list itself, since `enum` only checks one value. */
function readRoles(check, { required }) {
  const roles = check.array('roles', { required, min: required ? 1 : 0, max: ROLE_VALUES.length });
  if (roles === undefined) return undefined;

  const unknown = roles.filter((role) => !ROLE_VALUES.includes(role));
  if (unknown.length > 0) {
    check.reject('roles', `Unknown role(s): ${unknown.join(', ')}.`);
    return undefined;
  }
  return [...new Set(roles)];
}

userRouter.post(
  '/users',
  asyncHandler(async (req, res) => {
    const check = validator(req.body);
    check.id('employeeId', { required: true });
    check.email('email', { required: true });
    check.string('password', { required: true, min: MIN_PASSWORD_LENGTH, max: 200, trim: false });
    check.boolean('active', { fallback: true });
    const roles = readRoles(check, { required: true });
    const values = check.result();

    const user = await createUser(req.user, { ...values, roles });
    res.status(201).json(user);
  })
);

userRouter.patch(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const check = validator(req.body);
    check.email('email');
    if (req.body.password !== undefined && req.body.password !== '') {
      check.string('password', { required: true, min: MIN_PASSWORD_LENGTH, max: 200, trim: false });
    }
    if (req.body.active !== undefined) check.boolean('active', { required: true });
    const roles = req.body.roles === undefined ? undefined : readRoles(check, { required: true });
    const values = check.result();

    res.json(await updateUser(req.user, readId(req.params.id), { ...values, roles }));
  })
);
