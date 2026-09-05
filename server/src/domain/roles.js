/**
 * Roles and the permissions they grant.
 *
 * A pure module: no Prisma, no Express. The server derives a user's permission
 * set here and sends that set to the client with the session, so the menu the
 * browser draws and the checks the API enforces are computed from exactly one
 * table. The client never re-implements this mapping.
 */

/** Every permission the application checks. Grouped by module for readability. */
export const PERMISSIONS = {
  USERS_MANAGE: 'users.manage',

  EMPLOYEES_READ: 'employees.read',
  EMPLOYEES_WRITE: 'employees.write',

  ATTENDANCE_READ: 'attendance.read',
  ATTENDANCE_WRITE: 'attendance.write',

  TIMEOFF_READ: 'timeoff.read',
  TIMEOFF_APPROVE: 'timeoff.approve',
  TIMEOFF_CONFIGURE: 'timeoff.configure',

  PAYROLL_READ: 'payroll.read',
  PAYROLL_PROCESS: 'payroll.process',
  PAYROLL_CONFIGURE: 'payroll.configure',

  DASHBOARD_READ: 'dashboard.read',

  /** Acting on one's own records: check in/out, request leave, read own payslip. */
  SELF_SERVICE: 'self.service',
};

const P = PERMISSIONS;

/**
 * Role definitions in the order the user-management screen lists them.
 *
 * `label` is what the UI shows, so role names are never spelled out twice.
 */
export const ROLE_DEFINITIONS = [
  {
    value: 'ADMIN',
    label: 'Admin',
    description: 'Full access, including creating users and assigning roles.',
    permissions: Object.values(P),
  },
  {
    value: 'HR_MANAGER',
    label: 'HR Manager',
    description: 'Employee records, attendance and the time off policy.',
    permissions: [
      P.EMPLOYEES_READ,
      P.EMPLOYEES_WRITE,
      P.ATTENDANCE_READ,
      P.ATTENDANCE_WRITE,
      P.TIMEOFF_READ,
      P.TIMEOFF_APPROVE,
      P.TIMEOFF_CONFIGURE,
      P.DASHBOARD_READ,
      P.SELF_SERVICE,
    ],
  },
  {
    value: 'PAYROLL_ADMIN',
    label: 'Payroll Admin',
    description: 'Runs payroll and configures salary structures and rules.',
    permissions: [
      P.EMPLOYEES_READ,
      P.ATTENDANCE_READ,
      P.TIMEOFF_READ,
      P.PAYROLL_READ,
      P.PAYROLL_PROCESS,
      P.PAYROLL_CONFIGURE,
      P.DASHBOARD_READ,
      P.SELF_SERVICE,
    ],
  },
  {
    value: 'PAYROLL_USER',
    label: 'Payroll User',
    description: 'Reads payruns, payslips and the payroll dashboard.',
    permissions: [P.EMPLOYEES_READ, P.PAYROLL_READ, P.DASHBOARD_READ, P.SELF_SERVICE],
  },
  {
    value: 'TIMEOFF_ADMIN',
    label: 'Time Off Admin',
    description: 'Approves leave and maintains time off types and allocations.',
    permissions: [
      P.EMPLOYEES_READ,
      P.TIMEOFF_READ,
      P.TIMEOFF_APPROVE,
      P.TIMEOFF_CONFIGURE,
      P.SELF_SERVICE,
    ],
  },
  {
    value: 'TIMEOFF_USER',
    label: 'Time Off User',
    description: 'Reads time off records without approving them.',
    permissions: [P.EMPLOYEES_READ, P.TIMEOFF_READ, P.SELF_SERVICE],
  },
  {
    value: 'EMPLOYEE',
    label: 'Employee',
    description: 'Self service only: own attendance, leave and payslips.',
    permissions: [P.SELF_SERVICE],
  },
];

export const ROLE_VALUES = ROLE_DEFINITIONS.map((role) => role.value);

const BY_VALUE = new Map(ROLE_DEFINITIONS.map((role) => [role.value, role]));

export function roleLabel(value) {
  return BY_VALUE.get(value)?.label ?? value;
}

/** The union of every permission granted by the given roles. */
export function permissionsForRoles(roles = []) {
  const granted = new Set();
  for (const role of roles) {
    for (const permission of BY_VALUE.get(role)?.permissions ?? []) granted.add(permission);
  }
  return [...granted];
}

export function hasPermission(permissions, permission) {
  return permissions.includes(permission);
}

/**
 * True when `roles` contains a role the granter does not itself hold.
 *
 * This is the check behind "users must not be able to assign or elevate their
 * own roles": a non-admin editing an account can never hand out access wider
 * than their own. Admins hold every role's permissions and so are unaffected.
 */
export function grantsBeyond(granterRoles, requestedRoles) {
  const granted = new Set(permissionsForRoles(granterRoles));
  const requested = permissionsForRoles(requestedRoles);
  return requested.filter((permission) => !granted.has(permission));
}
