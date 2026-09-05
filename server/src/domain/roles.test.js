import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PERMISSIONS,
  ROLE_DEFINITIONS,
  ROLE_VALUES,
  grantsBeyond,
  permissionsForRoles,
  roleLabel,
} from './roles.js';

test('every role definition grants at least one permission', () => {
  for (const role of ROLE_DEFINITIONS) {
    assert.ok(role.permissions.length > 0, `${role.value} grants nothing`);
  }
});

test('admin grants every permission the application defines', () => {
  const admin = permissionsForRoles(['ADMIN']);
  for (const permission of Object.values(PERMISSIONS)) {
    assert.ok(admin.includes(permission), `admin is missing ${permission}`);
  }
});

test('only admin can manage users', () => {
  const managers = ROLE_VALUES.filter((role) =>
    permissionsForRoles([role]).includes(PERMISSIONS.USERS_MANAGE)
  );
  assert.deepEqual(managers, ['ADMIN']);
});

test('permissions of several roles are merged without duplicates', () => {
  const merged = permissionsForRoles(['PAYROLL_USER', 'EMPLOYEE']);
  assert.equal(new Set(merged).size, merged.length);
  assert.ok(merged.includes(PERMISSIONS.PAYROLL_READ));
  assert.ok(merged.includes(PERMISSIONS.SELF_SERVICE));
});

test('unknown roles contribute nothing rather than throwing', () => {
  assert.deepEqual(permissionsForRoles(['NOT_A_ROLE']), []);
  assert.deepEqual(permissionsForRoles(), []);
});

test('roleLabel falls back to the raw value', () => {
  assert.equal(roleLabel('HR_MANAGER'), 'HR Manager');
  assert.equal(roleLabel('NOT_A_ROLE'), 'NOT_A_ROLE');
});

test('grantsBeyond reports the permissions a granter does not hold', () => {
  // A time off admin handing out payroll processing is granting beyond itself.
  const excess = grantsBeyond(['TIMEOFF_ADMIN'], ['PAYROLL_ADMIN']);
  assert.ok(excess.includes(PERMISSIONS.PAYROLL_PROCESS));
});

test('grantsBeyond allows a granter to hand out a subset of its own access', () => {
  assert.deepEqual(grantsBeyond(['ADMIN'], ['HR_MANAGER', 'PAYROLL_ADMIN']), []);
  assert.deepEqual(grantsBeyond(['HR_MANAGER'], ['EMPLOYEE']), []);
});
