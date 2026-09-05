import { prisma } from '../lib/prisma.js';
import { conflict, notFound, validationError } from '../lib/errors.js';
import { pageResult } from '../lib/pagination.js';
import { toMoney } from '../lib/money.js';
import { nextSequenceNumber } from '../lib/sequence.js';
import { clampRange, eachDateInRange } from '../lib/dates.js';
import { canTransitionPayrun, computePayslip, payslipWarnings } from '../domain/payroll.js';
import { contractForPeriod } from '../domain/contract.js';
import { workingWeekdays } from '../domain/timeoff.js';
import { rulesForStructure } from './salaryStructure.service.js';

/**
 * Payruns and payslips.
 *
 * This is where the HR modules meet payroll: the contract supplies the wage,
 * the working schedule supplies the days in the period, attendance supplies
 * overtime, and approved unpaid leave reduces the days worked. Those figures go
 * into the pure engine in domain/payroll.js, which produces the lines.
 */

const PAYSLIP_SELECT = {
  id: true,
  reference: true,
  periodStart: true,
  periodEnd: true,
  status: true,
  workedDays: true,
  totalDays: true,
  unpaidDays: true,
  leaveDays: true,
  overtimeHours: true,
  basic: true,
  gross: true,
  net: true,
  warnings: true,
  computedAt: true,
  sentAt: true,
  employee: {
    select: { id: true, name: true, workEmail: true, bankAccount: true, department: { select: { id: true, name: true } } },
  },
  structure: { select: { id: true, name: true } },
  contract: { select: { id: true, reference: true, wage: true } },
  payrun: { select: { id: true, name: true, status: true } },
};

const PAYSLIP_WITH_LINES = {
  ...PAYSLIP_SELECT,
  lines: {
    select: { id: true, code: true, name: true, category: true, sequence: true, quantity: true, amount: true },
    orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
  },
};

function shapePayslip(row) {
  return {
    ...row,
    workedDays: toMoney(row.workedDays),
    totalDays: toMoney(row.totalDays),
    unpaidDays: toMoney(row.unpaidDays),
    leaveDays: toMoney(row.leaveDays),
    overtimeHours: toMoney(row.overtimeHours),
    basic: toMoney(row.basic),
    gross: toMoney(row.gross),
    net: toMoney(row.net),
    contract: row.contract ? { ...row.contract, wage: toMoney(row.contract.wage) } : null,
    ...(row.lines
      ? {
          lines: row.lines.map((line) => ({
            ...line,
            quantity: toMoney(line.quantity),
            amount: toMoney(line.amount),
          })),
        }
      : {}),
  };
}

const PAYRUN_SELECT = {
  id: true,
  name: true,
  periodStart: true,
  periodEnd: true,
  status: true,
  paidAt: true,
  structure: { select: { id: true, name: true } },
  _count: { select: { payslips: true } },
};

/** Adds the totals and the warning count the payrun list shows. */
function shapePayrun(row, payslips = []) {
  const { _count, ...payrun } = row;
  const mine = payslips.filter((slip) => slip.payrunId === row.id);

  return {
    ...payrun,
    payslipCount: _count.payslips,
    warningCount: mine.reduce((total, slip) => total + slip.warnings.length, 0),
    netTotal: Math.round(mine.reduce((total, slip) => total + Number(slip.net), 0) * 100) / 100,
  };
}

/* ---------------------------------------------------------- payroll inputs */

/**
 * The days and hours a payslip is computed against.
 *
 * Every figure comes from a real record: the schedule says which days were
 * working days, approved unpaid leave takes days away, and attendance supplies
 * the overtime. Paid leave deliberately still counts as worked — that is what
 * makes it paid.
 */
export async function payrollInputsFor({ employee, contract, periodStart, periodEnd }) {
  const scheduleDays =
    contract?.workingSchedule?.days ?? employee.workingSchedule?.days ?? [];

  const working = new Set(workingWeekdays(scheduleDays));
  const totalDays = eachDateInRange(periodStart, periodEnd).filter((date) =>
    working.has((date.getUTCDay() + 6) % 7)
  ).length;

  const [leaves, attendance] = await Promise.all([
    prisma.timeOffRequest.findMany({
      where: {
        employeeId: employee.id,
        status: 'APPROVED',
        startDate: { lte: periodEnd },
        endDate: { gte: periodStart },
      },
      select: {
        startDate: true,
        endDate: true,
        duration: true,
        type: { select: { unit: true, unpaid: true } },
      },
    }),
    prisma.attendance.aggregate({
      where: {
        employeeId: employee.id,
        date: { gte: periodStart, lte: periodEnd },
        status: { not: 'ABSENT' },
      },
      _sum: { overtimeHours: true },
      _count: { _all: true },
    }),
  ]);

  let leaveDays = 0;
  let unpaidDays = 0;

  for (const leave of leaves) {
    // A leave that starts before the period or ends after it only counts for
    // the part that falls inside, or a January absence would be deducted from
    // February's pay.
    const overlap = clampRange(leave.startDate, leave.endDate, periodStart, periodEnd);
    if (!overlap) continue;

    const days = eachDateInRange(overlap.start, overlap.end).filter((date) =>
      working.has((date.getUTCDay() + 6) % 7)
    ).length;

    leaveDays += days;
    if (leave.type.unpaid) unpaidDays += days;
  }

  return {
    wage: contract ? Number(contract.wage) : 0,
    totalDays,
    // Unpaid leave is the only thing that reduces paid days.
    workedDays: Math.max(0, totalDays - unpaidDays),
    leaveDays,
    unpaidDays,
    attendanceDays: attendance._count._all,
    overtimeHours: Number(attendance._sum.overtimeHours ?? 0),
  };
}

/** Everything the engine needs about one employee, in one read. */
function loadEmployeeForPayroll(employeeId) {
  return prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      name: true,
      workEmail: true,
      bankAccount: true,
      workingSchedule: {
        select: {
          days: { select: { dayOfWeek: true, startMinutes: true, endMinutes: true, breakMinutes: true } },
        },
      },
      contracts: {
        select: {
          id: true,
          reference: true,
          wage: true,
          status: true,
          startDate: true,
          endDate: true,
          workingSchedule: {
            select: {
              days: { select: { dayOfWeek: true, startMinutes: true, endMinutes: true, breakMinutes: true } },
            },
          },
        },
      },
    },
  });
}

/* ------------------------------------------------------ payslip computation */

/**
 * Computes one payslip and replaces its lines.
 *
 * A paid payslip is never recomputed: it is the record of what somebody was
 * actually paid, and rerunning it against rules edited since would rewrite
 * history.
 */
export async function computeOnePayslip(payslipId) {
  const payslip = await prisma.payslip.findUnique({
    where: { id: payslipId },
    select: {
      id: true,
      employeeId: true,
      structureId: true,
      periodStart: true,
      periodEnd: true,
      status: true,
      reference: true,
    },
  });
  if (!payslip) throw notFound('Payslip');

  if (payslip.status === 'PAID') {
    throw conflict('PAYSLIP_PAID', 'A paid payslip cannot be recomputed.');
  }

  const employee = await loadEmployeeForPayroll(payslip.employeeId);
  if (!employee) throw notFound('Employee');

  const contract = contractForPeriod(employee.contracts, payslip.periodStart, payslip.periodEnd);
  const inputs = await payrollInputsFor({
    employee,
    contract,
    periodStart: payslip.periodStart,
    periodEnd: payslip.periodEnd,
  });

  const rules = contract ? await rulesForStructure(payslip.structureId) : [];
  const result = computePayslip({ rules, inputs });

  const duplicate = await prisma.payslip.findFirst({
    where: {
      employeeId: payslip.employeeId,
      periodStart: payslip.periodStart,
      periodEnd: payslip.periodEnd,
      id: { not: payslip.id },
    },
    select: { reference: true },
  });

  const warnings = payslipWarnings({
    employee,
    contract,
    duplicateOf: duplicate?.reference ?? null,
    computationErrors: result.errors,
  });

  // Lines and totals are replaced together, so a payslip is never left showing
  // last run's lines under this run's total.
  const saved = await prisma.$transaction(async (tx) => {
    await tx.payslipLine.deleteMany({ where: { payslipId: payslip.id } });

    return tx.payslip.update({
      where: { id: payslip.id },
      data: {
        contractId: contract?.id ?? null,
        status: 'DONE',
        computedAt: new Date(),
        workedDays: inputs.workedDays,
        totalDays: inputs.totalDays,
        unpaidDays: inputs.unpaidDays,
        leaveDays: inputs.leaveDays,
        overtimeHours: inputs.overtimeHours,
        basic: result.basic,
        gross: result.gross,
        net: result.net,
        warnings,
        lines: { create: result.lines },
      },
      select: PAYSLIP_WITH_LINES,
    });
  });

  return shapePayslip(saved);
}

/* ----------------------------------------------------------------- payruns */

export async function listPayruns({ search, status, year, page, pageSize, skip, take }) {
  const where = {
    ...(status ? { status } : {}),
    ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    ...(year
      ? {
          periodStart: {
            gte: new Date(Date.UTC(year, 0, 1)),
            lte: new Date(Date.UTC(year, 11, 31)),
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.payrun.findMany({
      where,
      select: PAYRUN_SELECT,
      orderBy: [{ periodStart: 'desc' }, { id: 'desc' }],
      skip,
      take,
    }),
    prisma.payrun.count({ where }),
  ]);

  const payslips = await prisma.payslip.findMany({
    where: { payrunId: { in: rows.map((row) => row.id) } },
    select: { payrunId: true, warnings: true, net: true },
  });

  return pageResult(rows.map((row) => shapePayrun(row, payslips)), total, { page, pageSize });
}

export async function getPayrun(id) {
  const row = await prisma.payrun.findUnique({ where: { id }, select: PAYRUN_SELECT });
  if (!row) throw notFound('Payrun');

  const payslips = await prisma.payslip.findMany({
    where: { payrunId: id },
    select: PAYSLIP_SELECT,
    orderBy: { id: 'asc' },
  });

  return {
    ...shapePayrun(row, payslips.map((slip) => ({ ...slip, payrunId: id }))),
    payslips: payslips.map(shapePayslip),
  };
}

/**
 * Employees who can be included in a payrun for this period.
 *
 * Only people with a contract covering the period: without one there is no wage
 * to compute from, so offering them would only produce a payslip of zeroes.
 * Their working hours and wage are shown, which is what the selection screen
 * needs to decide.
 */
export async function eligibleEmployees({ periodStart, periodEnd }) {
  const employees = await prisma.employee.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      name: true,
      workEmail: true,
      bankAccount: true,
      workingSchedule: {
        select: {
          name: true,
          days: { select: { dayOfWeek: true, startMinutes: true, endMinutes: true, breakMinutes: true } },
        },
      },
      contracts: {
        select: {
          id: true,
          reference: true,
          wage: true,
          status: true,
          startDate: true,
          endDate: true,
          workingSchedule: { select: { name: true } },
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  return employees
    .map((employee) => {
      const contract = contractForPeriod(employee.contracts, periodStart, periodEnd);
      if (!contract) return null;

      const scheduleDays = employee.workingSchedule?.days ?? [];
      const weeklyMinutes = scheduleDays.reduce(
        (total, day) => total + Math.max(0, day.endMinutes - day.startMinutes - (day.breakMinutes ?? 0)),
        0
      );

      return {
        id: employee.id,
        name: employee.name,
        workEmail: employee.workEmail,
        hasBankAccount: Boolean(employee.bankAccount),
        schedule:
          contract.workingSchedule?.name ?? employee.workingSchedule?.name ?? 'No schedule',
        weeklyHours: Math.round((weeklyMinutes / 60) * 100) / 100,
        contractReference: contract.reference,
        contractStart: contract.startDate,
        wage: toMoney(contract.wage),
      };
    })
    .filter(Boolean);
}

/**
 * Creates a payrun and one draft payslip per selected employee.
 *
 * The payrun exists only once employees are chosen, which is why the wizard's
 * first step creates nothing: a payrun with no payslips is not a payrun.
 */
export async function createPayrun({ name, structureId, periodStart, periodEnd, employeeIds }) {
  if (!employeeIds || employeeIds.length === 0) {
    throw validationError({ employeeIds: 'Select at least one employee.' });
  }
  if (periodEnd.getTime() < periodStart.getTime()) {
    throw validationError({ periodEnd: 'The period cannot end before it starts.' });
  }

  const structure = await prisma.salaryStructure.findUnique({
    where: { id: structureId },
    select: { id: true, active: true },
  });
  if (!structure) throw validationError({ structureId: 'Select an existing salary structure.' });

  // Checked before the transaction, so an id that does not exist is a readable
  // validation error rather than a foreign key violation surfacing as "this
  // record is referenced by other records".
  const found = await prisma.employee.findMany({
    where: { id: { in: employeeIds } },
    select: { id: true },
  });
  const missing = employeeIds.filter((id) => !found.some((employee) => employee.id === id));
  if (missing.length > 0) {
    throw validationError({
      employeeIds: `${missing.length} selected employee(s) no longer exist. Reload and try again.`,
    });
  }

  const year = periodStart.getUTCFullYear();
  const month = String(periodStart.getUTCMonth() + 1).padStart(2, '0');

  const payrun = await prisma.$transaction(async (tx) => {
    const created = await tx.payrun.create({
      data: { name, structureId, periodStart, periodEnd, status: 'DRAFT' },
    });

    // References are handed out one at a time inside the transaction, so two
    // payruns created at once cannot share a payslip number.
    for (const employeeId of employeeIds) {
      const number = await nextSequenceNumber(tx, `PAYSLIP-${year}-${month}`, year);
      await tx.payslip.create({
        data: {
          // PAY/2026/09/0001 — the period is part of the number, so a payslip
          // reference says which month it belongs to at a glance.
          reference: `PAY/${year}/${month}/${String(number).padStart(4, '0')}`,
          payrunId: created.id,
          employeeId,
          structureId,
          periodStart,
          periodEnd,
          status: 'DRAFT',
          warnings: [],
        },
      });
    }

    return created;
  });

  return getPayrun(payrun.id);
}

/** Computes every payslip in the payrun, then moves it to Computed. */
export async function computePayrun(id) {
  const payrun = await prisma.payrun.findUnique({
    where: { id },
    select: { id: true, status: true, payslips: { select: { id: true, status: true } } },
  });
  if (!payrun) throw notFound('Payrun');

  if (payrun.status === 'PAID') {
    throw conflict('PAYRUN_PAID', 'A paid payrun is historical data and cannot be recomputed.');
  }

  for (const payslip of payrun.payslips) {
    if (payslip.status === 'PAID') continue;
    await computeOnePayslip(payslip.id);
  }

  await prisma.payrun.update({ where: { id }, data: { status: 'COMPUTED' } });
  return getPayrun(id);
}

/**
 * Moves a payrun through the workflow.
 *
 * Validation refuses while any payslip still has a warning: warnings are the
 * things somebody has to look at, and validating past them is exactly the
 * mistake the reference flow puts them on screen to prevent.
 */
export async function setPayrunStatus(id, status) {
  const payrun = await prisma.payrun.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      payslips: { select: { id: true, status: true, warnings: true } },
    },
  });
  if (!payrun) throw notFound('Payrun');

  if (!canTransitionPayrun(payrun.status, status)) {
    throw conflict(
      'INVALID_TRANSITION',
      `A payrun cannot move from ${payrun.status} to ${status}.`
    );
  }

  if (status === 'VALIDATED') {
    const unresolved = payrun.payslips.filter((slip) => slip.warnings.length > 0);
    if (unresolved.length > 0) {
      throw conflict(
        'PAYRUN_HAS_WARNINGS',
        `${unresolved.length} payslip(s) still have warnings. Fix them and compute again before validating.`
      );
    }
    const uncomputed = payrun.payslips.filter((slip) => slip.status === 'DRAFT');
    if (uncomputed.length > 0) {
      throw conflict('PAYRUN_NOT_COMPUTED', 'Compute the payrun before validating it.');
    }
  }

  const data = { status };
  if (status === 'PAID') data.paidAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.payrun.update({ where: { id }, data });

    // A paid payrun marks its payslips paid, which is what freezes them.
    if (status === 'PAID') {
      await tx.payslip.updateMany({ where: { payrunId: id }, data: { status: 'PAID' } });
    }
    if (status === 'DRAFT') {
      await tx.payslip.updateMany({
        where: { payrunId: id, status: { not: 'PAID' } },
        data: { status: 'DRAFT' },
      });
    }
  });

  return getPayrun(id);
}

/* ---------------------------------------------------------------- payslips */

export async function listPayslips({ search, employeeId, payrunId, status, from, to, page, pageSize, skip, take }) {
  const where = {
    ...(employeeId ? { employeeId } : {}),
    ...(payrunId ? { payrunId } : {}),
    ...(status ? { status } : {}),
    ...(from ? { periodStart: { gte: from } } : {}),
    ...(to ? { periodEnd: { lte: to } } : {}),
    ...(search
      ? {
          OR: [
            { reference: { contains: search, mode: 'insensitive' } },
            { employee: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.payslip.findMany({
      where,
      select: PAYSLIP_SELECT,
      orderBy: [{ periodStart: 'desc' }, { id: 'desc' }],
      skip,
      take,
    }),
    prisma.payslip.count({ where }),
  ]);

  return pageResult(rows.map(shapePayslip), total, { page, pageSize });
}

export async function getPayslip(id) {
  const row = await prisma.payslip.findUnique({ where: { id }, select: PAYSLIP_WITH_LINES });
  if (!row) throw notFound('Payslip');
  return shapePayslip(row);
}

export async function setPayslipStatus(id, status) {
  const payslip = await prisma.payslip.findUnique({
    where: { id },
    select: { id: true, status: true, warnings: true },
  });
  if (!payslip) throw notFound('Payslip');

  if (status === 'PAID' && payslip.warnings.length > 0) {
    throw conflict(
      'PAYSLIP_HAS_WARNINGS',
      'This payslip still has warnings. Fix them and compute again before marking it paid.'
    );
  }

  await prisma.payslip.update({ where: { id }, data: { status } });
  return getPayslip(id);
}

export async function markPayslipSent(id) {
  await prisma.payslip.update({ where: { id }, data: { sentAt: new Date() } });
}
