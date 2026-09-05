import { prisma } from '../lib/prisma.js';
import { notFound, validationError } from '../lib/errors.js';
import { pageResult } from '../lib/pagination.js';
import { scheduleSummary, validateDay } from '../domain/schedule.js';

const SELECT = {
  id: true,
  name: true,
  timezone: true,
  active: true,
  days: {
    select: { id: true, dayOfWeek: true, startMinutes: true, endMinutes: true, breakMinutes: true },
    orderBy: [{ dayOfWeek: 'asc' }, { startMinutes: 'asc' }],
  },
  _count: { select: { employees: true, contracts: true } },
};

/** Adds the derived totals so no caller recomputes them. */
function shape(row) {
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    active: row.active,
    days: row.days,
    ...scheduleSummary(row.days),
    employeeCount: row._count.employees,
    contractCount: row._count.contracts,
  };
}

export async function listWorkingSchedules({ search, page, pageSize, skip, take }) {
  const where = search ? { name: { contains: search, mode: 'insensitive' } } : {};

  const [rows, total] = await Promise.all([
    prisma.workingSchedule.findMany({ where, select: SELECT, orderBy: { name: 'asc' }, skip, take }),
    prisma.workingSchedule.count({ where }),
  ]);

  return pageResult(rows.map(shape), total, { page, pageSize });
}

export async function getWorkingSchedule(id) {
  const row = await prisma.workingSchedule.findUnique({ where: { id }, select: SELECT });
  if (!row) throw notFound('Working schedule');
  return shape(row);
}

/**
 * Checks every line before any of them is written.
 *
 * Reporting the first bad line by index lets the form highlight the row the
 * user has to fix instead of showing one message for the whole table.
 */
function assertDaysValid(days) {
  const fields = {};
  days.forEach((day, index) => {
    const message = validateDay(day);
    if (message) fields[`days.${index}`] = message;
  });
  if (Object.keys(fields).length > 0) {
    throw validationError(fields, 'Some days in the weekly schedule are not valid.');
  }
}

export async function createWorkingSchedule({ days = [], ...data }) {
  assertDaysValid(days);
  const row = await prisma.workingSchedule.create({
    data: { ...data, days: { create: days } },
    select: SELECT,
  });
  return shape(row);
}

/**
 * Replaces the whole weekly pattern in one transaction.
 *
 * The form edits the days as a table, so a diff would be more code and more
 * ways to be wrong than deleting and recreating them; the row count is tiny.
 */
export async function updateWorkingSchedule(id, { days, ...data }) {
  if (days) assertDaysValid(days);

  const row = await prisma.$transaction(async (tx) => {
    if (days) {
      await tx.scheduleDay.deleteMany({ where: { scheduleId: id } });
    }
    return tx.workingSchedule.update({
      where: { id },
      data: { ...data, ...(days ? { days: { create: days } } : {}) },
      select: SELECT,
    });
  });

  return shape(row);
}

export function workingScheduleOptions() {
  return prisma.workingSchedule.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}
