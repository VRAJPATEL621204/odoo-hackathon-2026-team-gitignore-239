import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';
import { conflict, notFound, validationError } from '../lib/errors.js';
import { pageResult } from '../lib/pagination.js';
import { parseDateOnly } from '../lib/dates.js';
import { toMoney } from '../lib/money.js';
import { businessDate, deriveAttendance, workedHours } from '../domain/attendance.js';

const SELECT = {
  id: true,
  date: true,
  checkIn: true,
  checkOut: true,
  status: true,
  workedHours: true,
  overtimeHours: true,
  manuallyEdited: true,
  note: true,
  employee: {
    select: {
      id: true,
      name: true,
      department: { select: { id: true, name: true } },
      manager: { select: { id: true, name: true } },
    },
  },
};

/** Decimal columns become plain numbers at this boundary and nowhere else. */
function shape(row) {
  return {
    ...row,
    workedHours: toMoney(row.workedHours),
    overtimeHours: toMoney(row.overtimeHours),
  };
}

/** The employee's schedule lines, which lateness and overtime are measured against. */
async function scheduleDaysFor(employeeId) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      workingSchedule: {
        select: {
          days: { select: { dayOfWeek: true, startMinutes: true, endMinutes: true, breakMinutes: true } },
        },
      },
    },
  });

  if (!employee) throw validationError({ employeeId: 'Select an existing employee.' });
  return employee.workingSchedule?.days ?? [];
}

export async function listAttendance({
  search,
  employeeId,
  status,
  from,
  to,
  page,
  pageSize,
  skip,
  take,
}) {
  const where = {
    ...(employeeId ? { employeeId } : {}),
    ...(status ? { status } : {}),
    ...(from || to
      ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {}),
    ...(search ? { employee: { name: { contains: search, mode: 'insensitive' } } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.attendance.findMany({
      where,
      select: SELECT,
      orderBy: [{ date: 'desc' }, { checkIn: 'desc' }, { id: 'desc' }],
      skip,
      take,
    }),
    prisma.attendance.count({ where }),
  ]);

  return pageResult(rows.map(shape), total, { page, pageSize });
}

export async function getAttendance(id) {
  const row = await prisma.attendance.findUnique({ where: { id }, select: SELECT });
  if (!row) throw notFound('Attendance record');
  return shape(row);
}

/**
 * Writes a record with every derived value recomputed.
 *
 * Used by both the manual form and the check-out, so a hand-corrected time
 * produces exactly the same hours the widget would have produced.
 */
async function derivedFields({ employeeId, checkIn, checkOut, status }) {
  const scheduleDays = await scheduleDaysFor(employeeId);
  return deriveAttendance({
    checkIn,
    checkOut,
    scheduleDays,
    timezone: env.companyTimezone,
    status,
  });
}

/** The business day a record belongs to, from its check-in or from a given date. */
function businessDayFor(checkIn, fallbackDate) {
  const source = checkIn ?? fallbackDate;
  if (!source) return null;
  return parseDateOnly(businessDate(source, env.companyTimezone));
}

export async function createAttendance(data, { manuallyEdited = true } = {}) {
  if (data.checkIn && data.checkOut && data.checkOut.getTime() <= data.checkIn.getTime()) {
    throw validationError({ checkOut: 'Check out must be after check in.' });
  }

  const derived = await derivedFields(data);
  const date = businessDayFor(data.checkIn, data.date);
  if (!date) {
    throw validationError({ date: 'Enter a date, or a check-in time to take the date from.' });
  }

  const row = await prisma.attendance.create({
    data: {
      employeeId: data.employeeId,
      date,
      checkIn: data.checkIn ?? null,
      checkOut: data.checkOut ?? null,
      note: data.note ?? null,
      manuallyEdited,
      ...derived,
    },
    select: SELECT,
  });

  return shape(row);
}

export async function updateAttendance(id, data) {
  const existing = await prisma.attendance.findUnique({
    where: { id },
    select: { id: true, employeeId: true, checkIn: true, checkOut: true, status: true, date: true },
  });
  if (!existing) throw notFound('Attendance record');

  const checkIn = data.checkIn === undefined ? existing.checkIn : data.checkIn;
  const checkOut = data.checkOut === undefined ? existing.checkOut : data.checkOut;
  const status = data.status ?? existing.status;

  if (checkIn && checkOut && checkOut.getTime() <= checkIn.getTime()) {
    throw validationError({ checkOut: 'Check out must be after check in.' });
  }

  const derived = await derivedFields({ employeeId: existing.employeeId, checkIn, checkOut, status });

  const row = await prisma.attendance.update({
    where: { id },
    data: {
      checkIn,
      checkOut,
      date: businessDayFor(checkIn, data.date ?? existing.date),
      ...(data.note !== undefined ? { note: data.note } : {}),
      // Every edit through this path is a human correcting the record, which
      // the dashboard reports separately from system-generated data.
      manuallyEdited: true,
      ...derived,
    },
    select: SELECT,
  });

  return shape(row);
}

/** The session the employee has open right now, if any. */
export function openSessionFor(employeeId) {
  return prisma.attendance.findFirst({
    where: { employeeId, checkIn: { not: null }, checkOut: null },
    select: SELECT,
    orderBy: { checkIn: 'desc' },
  });
}

/**
 * What the attendance widget shows: whether a session is open, when it started,
 * and how much is already recorded for today.
 *
 * The elapsed time of the open session is deliberately not included — the
 * browser ticks that up from `checkIn` itself, so the number moves every second
 * without a request per second.
 */
export async function attendanceSummaryFor(employeeId, now = new Date()) {
  const today = parseDateOnly(businessDate(now, env.companyTimezone));

  const [open, todayRows] = await Promise.all([
    openSessionFor(employeeId),
    prisma.attendance.findMany({
      where: { employeeId, date: today },
      select: { workedHours: true, checkIn: true, checkOut: true },
    }),
  ]);

  const closedHours = todayRows
    .filter((row) => row.checkOut)
    .reduce((total, row) => total + Number(row.workedHours), 0);

  return {
    date: today,
    open: open ? shape(open) : null,
    // Hours already banked today, excluding the session still running.
    closedHours: Math.round(closedHours * 100) / 100,
    timezone: env.companyTimezone,
  };
}

/**
 * Starts a session.
 *
 * Refuses when one is already open: two open sessions would make "how long have
 * I been working" unanswerable, and the widget would have no single session to
 * close.
 */
export async function checkIn(employeeId, now = new Date()) {
  const open = await openSessionFor(employeeId);
  if (open) {
    throw conflict('ALREADY_CHECKED_IN', 'You are already checked in. Check out first.');
  }

  return createAttendance({ employeeId, checkIn: now, checkOut: null }, { manuallyEdited: false });
}

/** Closes the open session and recomputes its hours, lateness and overtime. */
export async function checkOut(employeeId, now = new Date()) {
  const open = await openSessionFor(employeeId);
  if (!open) {
    throw conflict('NOT_CHECKED_IN', 'You are not checked in, so there is nothing to check out of.');
  }

  const scheduleDays = await scheduleDaysFor(employeeId);
  const derived = deriveAttendance({
    checkIn: open.checkIn,
    checkOut: now,
    scheduleDays,
    timezone: env.companyTimezone,
  });

  const row = await prisma.attendance.update({
    where: { id: open.id },
    data: { checkOut: now, ...derived },
    select: SELECT,
  });

  return shape(row);
}

/** Worked hours of a session that is still open, for display only. */
export function elapsedHours(open, now = new Date()) {
  return open?.checkIn ? workedHours(open.checkIn, now) : 0;
}
