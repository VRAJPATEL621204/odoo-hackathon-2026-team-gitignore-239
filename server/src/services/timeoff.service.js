import { prisma } from '../lib/prisma.js';
import { conflict, notFound, validationError } from '../lib/errors.js';
import { pageResult } from '../lib/pagination.js';
import { toMoney } from '../lib/money.js';
import {
  ALLOCATION_TRANSITIONS,
  REQUEST_TRANSITIONS,
  allocationBalance,
  canTransition,
  chooseAllocation,
  overlappingRequests,
  requestDuration,
  validateDates,
} from '../domain/timeoff.js';

/* ------------------------------------------------------------------- types */

const TYPE_SELECT = {
  id: true,
  name: true,
  unit: true,
  requiresAllocation: true,
  approvedBy: true,
  workEntry: true,
  color: true,
  description: true,
  active: true,
  _count: { select: { requests: true, allocations: true } },
};

function shapeType(row) {
  const { _count, ...type } = row;
  return { ...type, requestCount: _count.requests, allocationCount: _count.allocations };
}

export async function listTypes({ search, page, pageSize, skip, take }) {
  const where = search ? { name: { contains: search, mode: 'insensitive' } } : {};

  const [rows, total] = await Promise.all([
    prisma.timeOffType.findMany({ where, select: TYPE_SELECT, orderBy: { name: 'asc' }, skip, take }),
    prisma.timeOffType.count({ where }),
  ]);

  return pageResult(rows.map(shapeType), total, { page, pageSize });
}

export async function getType(id) {
  const row = await prisma.timeOffType.findUnique({ where: { id }, select: TYPE_SELECT });
  if (!row) throw notFound('Time off type');
  return shapeType(row);
}

export async function createType(data) {
  return shapeType(await prisma.timeOffType.create({ data, select: TYPE_SELECT }));
}

/**
 * Updates a type, refusing a unit change once the type is in use.
 *
 * Durations are recorded in the unit the type had when the request was made.
 * Switching hours to days afterwards would silently reinterpret every existing
 * record — an 8-hour comp off would read as 8 days — so the change is refused
 * while any request or allocation exists rather than rewriting history.
 */
export async function updateType(id, data) {
  const existing = await prisma.timeOffType.findUnique({
    where: { id },
    select: { id: true, unit: true, _count: { select: { requests: true, allocations: true } } },
  });
  if (!existing) throw notFound('Time off type');

  if (data.unit && data.unit !== existing.unit) {
    const inUse = existing._count.requests + existing._count.allocations;
    if (inUse > 0) {
      throw conflict(
        'UNIT_IN_USE',
        `This type already has ${inUse} request(s) and allocation(s) recorded in ${existing.unit === 'HOURS' ? 'hours' : 'days'}. Changing the unit would reinterpret them, so create a new type instead.`
      );
    }
  }

  return shapeType(await prisma.timeOffType.update({ where: { id }, data, select: TYPE_SELECT }));
}

export function typeOptions() {
  return prisma.timeOffType.findMany({
    where: { active: true },
    select: { id: true, name: true, unit: true, requiresAllocation: true, color: true },
    orderBy: { name: 'asc' },
  });
}

/* ------------------------------------------------------------- allocations */

const ALLOCATION_SELECT = {
  id: true,
  amount: true,
  status: true,
  validFrom: true,
  validTo: true,
  description: true,
  employee: { select: { id: true, name: true } },
  type: { select: { id: true, name: true, unit: true, requiresAllocation: true } },
  approver: { select: { id: true, name: true } },
};

/**
 * Adds the balance figures the screens read.
 *
 * Taken and remaining are summed from the requests that consumed the
 * allocation, never stored, so refusing an approved request puts its days back
 * without any extra bookkeeping.
 */
function shapeAllocation(row, requests = []) {
  return {
    ...row,
    amount: toMoney(row.amount),
    ...allocationBalance({ id: row.id, amount: row.amount }, requests),
  };
}

/** Requests linked to any of the given allocations, in one query. */
function requestsForAllocations(allocationIds) {
  if (allocationIds.length === 0) return Promise.resolve([]);
  return prisma.timeOffRequest.findMany({
    where: { allocationId: { in: allocationIds } },
    select: { id: true, allocationId: true, status: true, duration: true },
  });
}

export async function listAllocations({ search, employeeId, typeId, status, page, pageSize, skip, take }) {
  const where = {
    ...(employeeId ? { employeeId } : {}),
    ...(typeId ? { typeId } : {}),
    ...(status ? { status } : {}),
    ...(search ? { employee: { name: { contains: search, mode: 'insensitive' } } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.timeOffAllocation.findMany({
      where,
      select: ALLOCATION_SELECT,
      orderBy: [{ status: 'asc' }, { id: 'desc' }],
      skip,
      take,
    }),
    prisma.timeOffAllocation.count({ where }),
  ]);

  const requests = await requestsForAllocations(rows.map((row) => row.id));
  return pageResult(
    rows.map((row) => shapeAllocation(row, requests)),
    total,
    { page, pageSize }
  );
}

export async function getAllocation(id) {
  const row = await prisma.timeOffAllocation.findUnique({
    where: { id },
    select: ALLOCATION_SELECT,
  });
  if (!row) throw notFound('Allocation');
  return shapeAllocation(row, await requestsForAllocations([id]));
}

export async function createAllocation(data) {
  const row = await prisma.timeOffAllocation.create({ data, select: ALLOCATION_SELECT });
  return shapeAllocation(row, []);
}

export async function updateAllocation(id, data) {
  const existing = await prisma.timeOffAllocation.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!existing) throw notFound('Allocation');

  if (data.status && data.status !== existing.status) {
    if (!canTransition(ALLOCATION_TRANSITIONS, existing.status, data.status)) {
      throw conflict(
        'INVALID_TRANSITION',
        `An allocation cannot move from ${existing.status} to ${data.status}.`
      );
    }
  }

  const row = await prisma.timeOffAllocation.update({
    where: { id },
    data,
    select: ALLOCATION_SELECT,
  });
  return shapeAllocation(row, await requestsForAllocations([id]));
}

/**
 * Refusing an allocation that requests are already drawing on would leave those
 * requests pointing at a balance that no longer exists.
 */
async function assertAllocationNotInUse(id) {
  const inUse = await prisma.timeOffRequest.count({
    where: { allocationId: id, status: 'APPROVED' },
  });
  if (inUse > 0) {
    throw conflict(
      'ALLOCATION_IN_USE',
      `${inUse} approved request(s) already draw on this allocation. Refuse those first.`
    );
  }
}

export async function setAllocationStatus(id, status, approverId) {
  if (status === 'REFUSED') await assertAllocationNotInUse(id);
  return updateAllocation(id, { status, approverId: status === 'TO_APPROVE' ? null : approverId });
}

/** Every approved balance an employee holds, with what is left on each. */
export async function balancesForEmployee(employeeId) {
  const allocations = await prisma.timeOffAllocation.findMany({
    where: { employeeId, status: 'APPROVED' },
    select: ALLOCATION_SELECT,
    orderBy: { id: 'asc' },
  });

  const requests = await requestsForAllocations(allocations.map((row) => row.id));
  return allocations.map((row) => shapeAllocation(row, requests));
}

/* ---------------------------------------------------------------- requests */

const REQUEST_SELECT = {
  id: true,
  startDate: true,
  endDate: true,
  duration: true,
  status: true,
  reason: true,
  createdAt: true,
  employee: {
    select: { id: true, name: true, manager: { select: { id: true, name: true } } },
  },
  type: { select: { id: true, name: true, unit: true, requiresAllocation: true, color: true } },
  approver: { select: { id: true, name: true } },
  allocation: {
    select: { id: true, amount: true, validFrom: true, validTo: true, description: true },
  },
};

function shapeRequest(row) {
  return {
    ...row,
    duration: toMoney(row.duration),
    allocation: row.allocation ? { ...row.allocation, amount: toMoney(row.allocation.amount) } : null,
  };
}

export async function listRequests({
  search,
  employeeId,
  typeId,
  status,
  managerId,
  page,
  pageSize,
  skip,
  take,
}) {
  const where = {
    ...(employeeId ? { employeeId } : {}),
    ...(typeId ? { typeId } : {}),
    ...(status ? { status } : {}),
    // "My Team": the requests of everybody reporting to the signed-in user.
    ...(managerId ? { employee: { managerId } } : {}),
    ...(search
      ? {
          employee: {
            ...(managerId ? { managerId } : {}),
            name: { contains: search, mode: 'insensitive' },
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.timeOffRequest.findMany({
      where,
      select: REQUEST_SELECT,
      orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
      skip,
      take,
    }),
    prisma.timeOffRequest.count({ where }),
  ]);

  return pageResult(rows.map(shapeRequest), total, { page, pageSize });
}

export async function getRequest(id) {
  const row = await prisma.timeOffRequest.findUnique({ where: { id }, select: REQUEST_SELECT });
  if (!row) throw notFound('Time off request');
  return shapeRequest(row);
}

/** The employee's working schedule lines, which the duration is measured against. */
async function scheduleDaysFor(employeeId) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      workingSchedule: {
        select: {
          days: {
            select: { dayOfWeek: true, startMinutes: true, endMinutes: true, breakMinutes: true },
          },
        },
      },
    },
  });
  if (!employee) throw validationError({ employeeId: 'Select an existing employee.' });
  return employee.workingSchedule?.days ?? [];
}

/**
 * Works out how long the request is, from the type's unit and the employee's
 * schedule. Weekends and non-working days inside the range are not charged.
 */
async function derivedDuration({ employeeId, typeId, startDate, endDate }) {
  const type = await prisma.timeOffType.findUnique({
    where: { id: typeId },
    select: { id: true, unit: true, active: true },
  });
  if (!type) throw validationError({ typeId: 'Select an existing time off type.' });
  if (!type.active) throw validationError({ typeId: 'This time off type is no longer active.' });

  const scheduleDays = await scheduleDaysFor(employeeId);
  const duration = requestDuration({ unit: type.unit, startDate, endDate, scheduleDays });

  if (duration <= 0) {
    throw validationError({
      startDate: 'These dates contain no working days for this employee.',
    });
  }
  return duration;
}

export async function createRequest(data) {
  const message = validateDates(data.startDate, data.endDate);
  if (message) throw validationError({ endDate: message });

  const duration = await derivedDuration(data);

  const row = await prisma.timeOffRequest.create({
    data: { ...data, duration, status: 'TO_APPROVE' },
    select: REQUEST_SELECT,
  });
  return shapeRequest(row);
}

export async function updateRequest(id, data) {
  const existing = await prisma.timeOffRequest.findUnique({
    where: { id },
    select: { id: true, employeeId: true, typeId: true, startDate: true, endDate: true, status: true },
  });
  if (!existing) throw notFound('Time off request');

  if (existing.status === 'APPROVED') {
    throw conflict(
      'REQUEST_APPROVED',
      'An approved request cannot be edited. Refuse it first, then change it.'
    );
  }

  const next = {
    employeeId: data.employeeId ?? existing.employeeId,
    typeId: data.typeId ?? existing.typeId,
    startDate: data.startDate ?? existing.startDate,
    endDate: data.endDate ?? existing.endDate,
  };

  const message = validateDates(next.startDate, next.endDate);
  if (message) throw validationError({ endDate: message });

  const duration = await derivedDuration(next);

  const row = await prisma.timeOffRequest.update({
    where: { id },
    data: { ...data, ...next, duration },
    select: REQUEST_SELECT,
  });
  return shapeRequest(row);
}

/**
 * Moves a request through the approval flow.
 *
 * Approval is where the balance rule bites: a type that requires an allocation
 * is only approvable against an approved allocation with enough left, and the
 * allocation used is recorded on the request so the screen can say which
 * balance it came out of.
 */
export async function setRequestStatus(id, status, approverId) {
  const request = await prisma.timeOffRequest.findUnique({
    where: { id },
    select: {
      id: true,
      employeeId: true,
      typeId: true,
      startDate: true,
      endDate: true,
      duration: true,
      status: true,
      type: { select: { requiresAllocation: true, name: true, unit: true } },
    },
  });
  if (!request) throw notFound('Time off request');

  if (!canTransition(REQUEST_TRANSITIONS, request.status, status)) {
    throw conflict(
      'INVALID_TRANSITION',
      `A request cannot move from ${request.status} to ${status}.`
    );
  }

  if (status !== 'APPROVED') {
    // Letting go of the allocation returns the days to the balance, which is
    // simply the sum no longer counting this request.
    const row = await prisma.timeOffRequest.update({
      where: { id },
      data: {
        status,
        approverId: status === 'TO_APPROVE' ? null : approverId,
        allocationId: null,
      },
      select: REQUEST_SELECT,
    });
    return shapeRequest(row);
  }

  const clashes = await prisma.timeOffRequest.findMany({
    where: { employeeId: request.employeeId, status: 'APPROVED' },
    select: { id: true, employeeId: true, status: true, startDate: true, endDate: true },
  });

  const overlaps = overlappingRequests(request, clashes);
  if (overlaps.length > 0) {
    throw conflict(
      'LEAVE_OVERLAP',
      'This employee already has approved leave covering some of these days.'
    );
  }

  let allocationId = null;

  if (request.type.requiresAllocation) {
    const [allocations, allocationRequests] = await Promise.all([
      prisma.timeOffAllocation.findMany({
        where: { employeeId: request.employeeId, typeId: request.typeId },
        select: {
          id: true,
          employeeId: true,
          typeId: true,
          amount: true,
          status: true,
          validFrom: true,
          validTo: true,
        },
      }),
      prisma.timeOffRequest.findMany({
        where: { employeeId: request.employeeId, typeId: request.typeId },
        select: { id: true, allocationId: true, status: true, duration: true },
      }),
    ]);

    const chosen = chooseAllocation({
      request: { ...request, duration: Number(request.duration) },
      allocations,
      requests: allocationRequests,
    });

    if (!chosen) {
      throw conflict(
        'NO_BALANCE',
        `${request.type.name} needs an approved allocation with at least ${Number(request.duration)} ${
          request.type.unit === 'HOURS' ? 'hours' : 'days'
        } left, covering these dates.`
      );
    }
    allocationId = chosen.id;
  }

  const row = await prisma.timeOffRequest.update({
    where: { id },
    data: { status, approverId, allocationId },
    select: REQUEST_SELECT,
  });
  return shapeRequest(row);
}

/** Requests for one employee, for the Time Off smart button. */
export function requestsForEmployee(employeeId) {
  return prisma.timeOffRequest
    .findMany({ where: { employeeId }, select: REQUEST_SELECT, orderBy: { startDate: 'desc' } })
    .then((rows) => rows.map(shapeRequest));
}
