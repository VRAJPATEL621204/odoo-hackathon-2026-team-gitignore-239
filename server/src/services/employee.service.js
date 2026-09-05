import { prisma } from '../lib/prisma.js';
import { notFound } from '../lib/errors.js';
import { pageResult } from '../lib/pagination.js';
import { toMoney } from '../lib/money.js';
import { scheduleSummary } from '../domain/schedule.js';

/** Columns the kanban and list views share. */
const LIST_SELECT = {
  id: true,
  name: true,
  workEmail: true,
  workPhone: true,
  jobTitle: true,
  status: true,
  department: { select: { id: true, name: true } },
  jobPosition: { select: { id: true, name: true } },
};

const DETAIL_SELECT = {
  ...LIST_SELECT,
  workLocation: true,
  manager: { select: { id: true, name: true } },
  workingSchedule: {
    select: {
      id: true,
      name: true,
      days: { select: { dayOfWeek: true, startMinutes: true, endMinutes: true, breakMinutes: true } },
    },
  },
  personalEmail: true,
  personalPhone: true,
  address: true,
  dateOfBirth: true,
  bankAccount: true,
  user: { select: { id: true, email: true, roles: true, active: true } },
  _count: { select: { contracts: true, attendances: true, timeOffRequests: true } },
};

export async function listEmployees({ search, departmentId, status, page, pageSize, skip, take }) {
  const where = {
    ...(departmentId ? { departmentId } : {}),
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { workEmail: { contains: search, mode: 'insensitive' } },
            { jobTitle: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.employee.findMany({ where, select: LIST_SELECT, orderBy: { name: 'asc' }, skip, take }),
    prisma.employee.count({ where }),
  ]);

  return pageResult(items, total, { page, pageSize });
}

/**
 * One employee, with the counts behind the smart buttons.
 *
 * The counts are fetched here rather than by the client so opening a record is
 * one request instead of four.
 */
export async function getEmployee(id) {
  const employee = await prisma.employee.findUnique({ where: { id }, select: DETAIL_SELECT });
  if (!employee) throw notFound('Employee');

  const runningContract = await prisma.contract.findFirst({
    where: { employeeId: id, status: 'RUNNING' },
    select: { id: true, reference: true, wage: true, startDate: true, endDate: true },
    orderBy: { startDate: 'desc' },
  });

  const { _count, workingSchedule, ...rest } = employee;

  return {
    ...rest,
    workingSchedule: workingSchedule
      ? { id: workingSchedule.id, name: workingSchedule.name, ...scheduleSummary(workingSchedule.days) }
      : null,
    runningContract: runningContract
      ? { ...runningContract, wage: toMoney(runningContract.wage) }
      : null,
    counts: {
      contracts: _count.contracts,
      attendance: _count.attendances,
      timeOff: _count.timeOffRequests,
    },
  };
}

export function createEmployee(data) {
  return prisma.employee.create({ data, select: DETAIL_SELECT }).then(stripCounts);
}

export function updateEmployee(id, data) {
  return prisma.employee.update({ where: { id }, data, select: DETAIL_SELECT }).then(stripCounts);
}

function stripCounts({ _count, ...employee }) {
  return {
    ...employee,
    counts: {
      contracts: _count.contracts,
      attendance: _count.attendances,
      timeOff: _count.timeOffRequests,
    },
  };
}

/** Names for the manager and employee pickers across the application. */
export function employeeOptions() {
  return prisma.employee.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true, workEmail: true, jobTitle: true },
    orderBy: { name: 'asc' },
  });
}
