import { Router } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import { readId } from '../lib/params.js';
import { validator } from '../lib/validate.js';
import { parsePageParams, parseSearch } from '../lib/pagination.js';
import { forbidden } from '../lib/errors.js';
import {
  requireAuth,
  requirePermission,
  requireAnyPermission,
  selfScopeId,
  assertInScope,
} from '../middleware/auth.js';
import { PERMISSIONS } from '../domain/roles.js';
import {
  balancesForEmployee,
  createAllocation,
  createRequest,
  createType,
  getAllocation,
  getRequest,
  getType,
  listAllocations,
  listRequests,
  listTypes,
  setAllocationStatus,
  setRequestStatus,
  typeOptions,
  updateAllocation,
  updateRequest,
  updateType,
} from '../services/timeoff.service.js';

export const timeOffRouter = Router();

// Read routes are shared: an approver sees every employee, a plain self-service
// employee (and a read-only Time Off User) is confined to their own records by
// `scopeId` below. TIMEOFF_APPROVE is the line between the two.
const canRead = [
  requireAuth,
  requireAnyPermission(PERMISSIONS.TIMEOFF_READ, PERMISSIONS.SELF_SERVICE),
];
const canApprove = [requireAuth, requirePermission(PERMISSIONS.TIMEOFF_APPROVE)];
const canConfigure = [requireAuth, requirePermission(PERMISSIONS.TIMEOFF_CONFIGURE)];

/** The employee id these read routes are pinned to, or undefined for an approver. */
function timeOffScope(req) {
  return selfScopeId(req, PERMISSIONS.TIMEOFF_APPROVE);
}

const STATUSES = ['TO_APPROVE', 'APPROVED', 'REFUSED', 'CANCELLED'];

/** Reads a status from the query string, ignoring anything unrecognised. */
function statusFilter(query) {
  return STATUSES.includes(query.status) ? query.status : undefined;
}

/* --------------------------------------------------------------- the types */

timeOffRouter.get(
  '/time-off/types',
  canRead,
  asyncHandler(async (req, res) => {
    res.json(await listTypes({ search: parseSearch(req.query), ...parsePageParams(req.query) }));
  })
);

/** The pickers on the request and allocation forms. */
timeOffRouter.get(
  '/time-off/type-options',
  canRead,
  asyncHandler(async (_req, res) => {
    res.json({ items: await typeOptions() });
  })
);

timeOffRouter.get(
  '/time-off/types/:id',
  canRead,
  asyncHandler(async (req, res) => {
    res.json(await getType(readId(req.params.id)));
  })
);

function readType(body, { required }) {
  const check = validator(body);
  check.string('name', { required, min: 2, max: 100 });
  check.enum('unit', ['DAYS', 'HOURS'], { required });
  check.enum('approvedBy', ['MANAGER', 'OFFICER'], { required });
  check.string('workEntry', { max: 100 });
  check.string('color', { max: 30 });
  check.string('description', { max: 500 });
  if (body.requiresAllocation !== undefined) check.boolean('requiresAllocation', { required: true });
  if (body.active !== undefined) check.boolean('active', { required: true });
  return check.result();
}

timeOffRouter.post(
  '/time-off/types',
  canConfigure,
  asyncHandler(async (req, res) => {
    res.status(201).json(await createType(readType(req.body, { required: true })));
  })
);

timeOffRouter.patch(
  '/time-off/types/:id',
  canConfigure,
  asyncHandler(async (req, res) => {
    res.json(await updateType(readId(req.params.id), readType(req.body, { required: false })));
  })
);

/* --------------------------------------------------------- the allocations */

timeOffRouter.get(
  '/time-off/allocations',
  canRead,
  asyncHandler(async (req, res) => {
    const scopeId = timeOffScope(req);
    res.json(
      await listAllocations({
        search: parseSearch(req.query),
        employeeId: scopeId ?? (Number(req.query.employeeId) || undefined),
        typeId: Number(req.query.typeId) || undefined,
        status: statusFilter(req.query),
        ...parsePageParams(req.query),
      })
    );
  })
);

/** Approved balances for one employee, shown on the request form. */
timeOffRouter.get(
  '/time-off/balances/:employeeId',
  canRead,
  asyncHandler(async (req, res) => {
    const employeeId = readId(req.params.employeeId);
    assertInScope(timeOffScope(req), employeeId);
    res.json({ items: await balancesForEmployee(employeeId) });
  })
);

timeOffRouter.get(
  '/time-off/allocations/:id',
  canRead,
  asyncHandler(async (req, res) => {
    const row = await getAllocation(readId(req.params.id));
    assertInScope(timeOffScope(req), row.employee.id);
    res.json(row);
  })
);

function readAllocation(body, { required }) {
  const check = validator(body);
  check.id('employeeId', { required });
  check.id('typeId', { required });
  check.number('amount', { required, min: 0.5, max: 5000 });
  check.date('validFrom');
  check.date('validTo');
  check.string('description', { max: 300 });

  const values = check.result();
  if (body.validFrom === null || body.validFrom === '') values.validFrom = null;
  if (body.validTo === null || body.validTo === '') values.validTo = null;

  if (values.validFrom && values.validTo && values.validTo < values.validFrom) {
    check.reject('validTo', 'Validity cannot end before it starts.');
    check.result();
  }
  return values;
}

timeOffRouter.post(
  '/time-off/allocations',
  canConfigure,
  asyncHandler(async (req, res) => {
    res.status(201).json(await createAllocation(readAllocation(req.body, { required: true })));
  })
);

timeOffRouter.patch(
  '/time-off/allocations/:id',
  canConfigure,
  asyncHandler(async (req, res) => {
    res.json(await updateAllocation(readId(req.params.id), readAllocation(req.body, { required: false })));
  })
);

/** Approve or refuse an allocation. Only an approved one creates balance. */
timeOffRouter.post(
  '/time-off/allocations/:id/status',
  canApprove,
  asyncHandler(async (req, res) => {
    const check = validator(req.body);
    check.enum('status', STATUSES, { required: true });
    const { status } = check.result();
    res.json(await setAllocationStatus(readId(req.params.id), status, req.user.employeeId));
  })
);

/* ------------------------------------------------------------- the requests */

timeOffRouter.get(
  '/time-off/requests',
  canRead,
  asyncHandler(async (req, res) => {
    const scopeId = timeOffScope(req);

    // "My Team" is resolved from the session rather than from a query
    // parameter, so it cannot be pointed at somebody else's team. A
    // self-scoped caller has no team view, only their own requests.
    const managerId =
      scopeId === undefined && req.query.myTeam === 'true' ? req.user.employeeId : undefined;

    res.json(
      await listRequests({
        search: parseSearch(req.query),
        employeeId: scopeId ?? (Number(req.query.employeeId) || undefined),
        typeId: Number(req.query.typeId) || undefined,
        status: statusFilter(req.query),
        managerId,
        ...parsePageParams(req.query),
      })
    );
  })
);

timeOffRouter.get(
  '/time-off/requests/:id',
  canRead,
  asyncHandler(async (req, res) => {
    const row = await getRequest(readId(req.params.id));
    assertInScope(timeOffScope(req), row.employee.id);
    res.json(row);
  })
);

function readRequest(body, { required }) {
  const check = validator(body);
  check.id('employeeId', { required });
  check.id('typeId', { required });
  check.date('startDate', { required });
  check.date('endDate', { required });
  check.string('reason', { max: 300 });
  return check.result();
}

/**
 * Anybody with self service may ask for leave, but only for themselves.
 * Filing on behalf of somebody else is a time off officer's action.
 */
timeOffRouter.post(
  '/time-off/requests',
  requireAuth,
  requirePermission(PERMISSIONS.SELF_SERVICE),
  asyncHandler(async (req, res) => {
    const data = readRequest(req.body, { required: true });

    const filingForSomebodyElse = data.employeeId !== req.user.employeeId;
    const mayFileForOthers = req.user.permissions.includes(PERMISSIONS.TIMEOFF_CONFIGURE);

    if (filingForSomebodyElse && !mayFileForOthers) {
      throw forbidden('You can only request time off for yourself.');
    }

    res.status(201).json(await createRequest(data));
  })
);

timeOffRouter.patch(
  '/time-off/requests/:id',
  canConfigure,
  asyncHandler(async (req, res) => {
    res.json(await updateRequest(readId(req.params.id), readRequest(req.body, { required: false })));
  })
);

/** Approve, refuse, cancel or send a request back for approval. */
timeOffRouter.post(
  '/time-off/requests/:id/status',
  canApprove,
  asyncHandler(async (req, res) => {
    const check = validator(req.body);
    check.enum('status', STATUSES, { required: true });
    const { status } = check.result();
    res.json(await setRequestStatus(readId(req.params.id), status, req.user.employeeId));
  })
);
