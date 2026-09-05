import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';
import { toMoney, round2 } from '../lib/money.js';
import { monthRange } from '../lib/dates.js';

/**
 * The payroll dashboard.
 *
 * Every figure is read from records the other modules created — payslips,
 * attendance, time off, contracts. Nothing here is a constant, which is why a
 * period with no payroll shows zeroes rather than an invented number.
 *
 * The filters narrow the same underlying queries rather than each block
 * fetching its own version of "the employees", so a department filter cannot
 * apply to one card and not another.
 */

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** "2026-09" to the first and last day of that month. */
export function parsePeriod(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value ?? ''));
  const now = new Date();
  const year = match ? Number(match[1]) : now.getUTCFullYear();
  const month = match ? Number(match[2]) - 1 : now.getUTCMonth();
  return monthRange(new Date(Date.UTC(year, month, 1)));
}

function periodLabel(date) {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * Builds the whole dashboard in one call.
 *
 * One endpoint rather than eight: the blocks share the same filtered employee
 * set, and eight round trips would let them disagree while they loaded.
 */
export async function buildDashboard({ period, departmentId, structureId }) {
  const { start, end } = parsePeriod(period);

  const employeeWhere = {
    status: 'ACTIVE',
    ...(departmentId ? { departmentId } : {}),
  };

  const employees = await prisma.employee.findMany({
    where: employeeWhere,
    select: {
      id: true,
      name: true,
      bankAccount: true,
      department: { select: { id: true, name: true } },
    },
  });
  const employeeIds = employees.map((employee) => employee.id);

  const payslipWhere = {
    employeeId: { in: employeeIds },
    periodStart: { gte: start },
    periodEnd: { lte: end },
    ...(structureId ? { structureId } : {}),
  };

  const [payslips, attendance, timeOff, contracts, types] = await Promise.all([
    prisma.payslip.findMany({
      where: payslipWhere,
      select: {
        id: true,
        status: true,
        net: true,
        gross: true,
        basic: true,
        warnings: true,
        employeeId: true,
        employee: { select: { id: true, name: true, department: { select: { id: true, name: true } } } },
      },
    }),
    prisma.attendance.findMany({
      where: { employeeId: { in: employeeIds }, date: { gte: start, lte: end } },
      select: {
        status: true,
        checkIn: true,
        checkOut: true,
        overtimeHours: true,
        manuallyEdited: true,
      },
    }),
    prisma.timeOffRequest.findMany({
      where: {
        employeeId: { in: employeeIds },
        startDate: { lte: end },
        endDate: { gte: start },
      },
      select: {
        status: true,
        duration: true,
        typeId: true,
        type: { select: { id: true, name: true, unit: true } },
      },
    }),
    prisma.contract.findMany({
      where: { employeeId: { in: employeeIds }, status: 'RUNNING' },
      select: {
        id: true,
        reference: true,
        wage: true,
        endDate: true,
        employee: { select: { id: true, name: true, department: { select: { id: true, name: true } } } },
      },
    }),
    prisma.timeOffType.findMany({
      where: { active: true },
      select: { id: true, name: true, unit: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  return {
    period: { start, end, label: periodLabel(start), value: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}` },
    company: env.companyName,
    headline: headline(payslips, employees, timeOff, attendance),
    salaryByDepartment: salaryByDepartment(payslips, contracts),
    trend: await monthlyTrend({ start, departmentId, structureId, employeeIds }),
    payslipStatus: payslipStatus(payslips),
    alerts: alerts({ payslips, employees, contracts, end }),
    attendance: attendanceOverview(attendance, employeeIds.length, start, end),
    timeOff: timeOffOverview(timeOff, types),
    departments: departmentOverview(employees, contracts),
  };
}

/* --------------------------------------------------------------- the cards */

function headline(payslips, employees, timeOff, attendance) {
  const paid = payslips.filter((slip) => slip.status === 'PAID');
  const totalNet = payslips.reduce((total, slip) => total + Number(slip.net), 0);

  const approvedLeaveDays = timeOff
    .filter((request) => request.status === 'APPROVED' && request.type.unit === 'DAYS')
    .reduce((total, request) => total + Number(request.duration), 0);

  // Attendance health is the share of records that are a clean present day:
  // late arrivals and absences both count against it, which is what makes it a
  // single number worth watching.
  const clean = attendance.filter((row) => row.status === 'PRESENT' && row.checkOut).length;

  return {
    totalNetPaid: round2(totalNet),
    payslipCount: payslips.length,
    paidCount: paid.length,
    pendingCount: payslips.length - paid.length,
    averageNet: payslips.length === 0 ? 0 : round2(totalNet / payslips.length),
    employeeCount: employees.length,
    approvedLeaveDays: round2(approvedLeaveDays),
    attendanceHealth: attendance.length === 0 ? null : Math.round((clean / attendance.length) * 100),
  };
}

/**
 * Salary cost per department.
 *
 * Uses the payslips for the period when there are any, and falls back to the
 * running contracts when payroll has not been run yet — otherwise the chart
 * would be empty for the very period somebody is about to pay.
 */
function salaryByDepartment(payslips, contracts) {
  const totals = new Map();

  const add = (department, amount) => {
    const name = department?.name ?? 'No department';
    totals.set(name, round2((totals.get(name) ?? 0) + amount));
  };

  if (payslips.length > 0) {
    for (const slip of payslips) add(slip.employee.department, Number(slip.net));
  } else {
    for (const contract of contracts) add(contract.employee.department, Number(contract.wage));
  }

  return [...totals.entries()]
    .map(([department, amount]) => ({ department, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/** Net paid per month for the six months ending with the selected one. */
async function monthlyTrend({ start, departmentId, structureId, employeeIds }) {
  const months = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const monthStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - offset, 1));
    months.push(monthRange(monthStart));
  }

  const first = months[0].start;
  const last = months[months.length - 1].end;

  const payslips = await prisma.payslip.findMany({
    where: {
      employeeId: { in: employeeIds },
      periodStart: { gte: first },
      periodEnd: { lte: last },
      ...(structureId ? { structureId } : {}),
    },
    select: { net: true, periodStart: true },
  });

  return months.map((month) => {
    const total = payslips
      .filter(
        (slip) =>
          slip.periodStart.getUTCFullYear() === month.start.getUTCFullYear() &&
          slip.periodStart.getUTCMonth() === month.start.getUTCMonth()
      )
      .reduce((sum, slip) => sum + Number(slip.net), 0);

    return { label: periodLabel(month.start), amount: round2(total) };
  });
}

function payslipStatus(payslips) {
  const counts = { DRAFT: 0, DONE: 0, PAID: 0, WARNING: 0 };
  for (const slip of payslips) {
    counts[slip.status] += 1;
    if (slip.warnings.length > 0) counts.WARNING += 1;
  }
  return counts;
}

/**
 * The things needing attention right now.
 *
 * Each one names how many and links to where it is fixed, because an alert
 * nobody can act on is just a number.
 */
function alerts({ payslips, employees, contracts, end }) {
  const list = [];

  const missingBank = employees.filter((employee) => !employee.bankAccount);
  if (missingBank.length > 0) {
    list.push({
      tone: 'danger',
      text: `${missingBank.length} employee(s) have no bank account and cannot be paid.`,
      to: '/employees',
    });
  }

  const withWarnings = payslips.filter((slip) => slip.warnings.length > 0);
  if (withWarnings.length > 0) {
    list.push({
      tone: 'warning',
      text: `${withWarnings.length} payslip(s) carry a warning and block validation.`,
      to: '/payroll/payslips',
    });
  }

  const drafts = payslips.filter((slip) => slip.status === 'DRAFT');
  if (drafts.length > 0) {
    list.push({
      tone: 'warning',
      text: `${drafts.length} payslip(s) are still draft and have not been computed.`,
      to: '/payroll/payruns',
    });
  }

  // A contract ending inside the period is a payroll problem next month.
  const expiring = contracts.filter(
    (contract) => contract.endDate && contract.endDate.getTime() <= end.getTime()
  );
  if (expiring.length > 0) {
    list.push({
      tone: 'warning',
      text: `${expiring.length} running contract(s) expire in this period.`,
      to: '/contracts',
    });
  }

  const noContract = employees.filter(
    (employee) => !contracts.some((contract) => contract.employee.id === employee.id)
  );
  if (noContract.length > 0) {
    list.push({
      tone: 'warning',
      text: `${noContract.length} active employee(s) have no running contract.`,
      to: '/contracts',
    });
  }

  if (list.length === 0) {
    list.push({ tone: 'success', text: 'Nothing needs attention for this period.', to: null });
  }
  return list;
}

function attendanceOverview(records, employeeCount, start, end) {
  const present = records.filter((row) => row.status === 'PRESENT').length;
  const late = records.filter((row) => row.status === 'LATE').length;
  const absent = records.filter((row) => row.status === 'ABSENT').length;

  const missingCheckOut = records.filter((row) => row.checkIn && !row.checkOut).length;
  const manualEdits = records.filter((row) => row.manuallyEdited).length;
  const overtimeHours = round2(
    records.reduce((total, row) => total + Number(row.overtimeHours), 0)
  );

  // Coverage: how much of the period actually has attendance recorded, which
  // is what says whether the other figures can be trusted.
  //
  // Only the days that have already happened count. Measuring against the whole
  // of a month still in progress would report every current period as badly
  // covered, which says nothing about the data and hides the periods that
  // really are incomplete.
  const today = new Date();
  const measuredEnd = today.getTime() < end.getTime() ? today : end;
  const days = Math.max(0, Math.round((measuredEnd.getTime() - start.getTime()) / 86400000) + 1);
  const weekdays = Math.round((days / 7) * 5);
  const expected = employeeCount * weekdays;

  return {
    present,
    late,
    absent,
    overtimeHours,
    missingCheckOut,
    manualEdits,
    total: records.length,
    coverage: expected === 0 ? null : Math.min(100, Math.round((records.length / expected) * 100)),
  };
}

function timeOffOverview(requests, types) {
  return types.map((type) => {
    const mine = requests.filter((request) => request.typeId === type.id);
    const sum = (status) =>
      round2(
        mine
          .filter((request) => request.status === status)
          .reduce((total, request) => total + Number(request.duration), 0)
      );

    return {
      type: type.name,
      unit: type.unit,
      approved: sum('APPROVED'),
      pending: sum('TO_APPROVE'),
      refused: sum('REFUSED'),
    };
  });
}

function departmentOverview(employees, contracts) {
  const byDepartment = new Map();

  for (const employee of employees) {
    const name = employee.department?.name ?? 'No department';
    const entry = byDepartment.get(name) ?? { department: name, headcount: 0, monthlySalary: 0 };
    entry.headcount += 1;
    byDepartment.set(name, entry);
  }

  for (const contract of contracts) {
    const name = contract.employee.department?.name ?? 'No department';
    const entry = byDepartment.get(name);
    if (entry) entry.monthlySalary = round2(entry.monthlySalary + Number(contract.wage));
  }

  return [...byDepartment.values()].sort((a, b) => b.monthlySalary - a.monthlySalary);
}

/** Remaining leave balance per type, for the time off block. */
export async function leaveBalances(departmentId) {
  const allocations = await prisma.timeOffAllocation.findMany({
    where: {
      status: 'APPROVED',
      ...(departmentId ? { employee: { departmentId } } : {}),
    },
    select: { id: true, amount: true, type: { select: { id: true, name: true, unit: true } } },
  });

  const requests = await prisma.timeOffRequest.findMany({
    where: { allocationId: { in: allocations.map((row) => row.id) }, status: 'APPROVED' },
    select: { allocationId: true, duration: true },
  });

  const byType = new Map();
  for (const allocation of allocations) {
    const taken = requests
      .filter((request) => request.allocationId === allocation.id)
      .reduce((total, request) => total + Number(request.duration), 0);

    const entry = byType.get(allocation.type.name) ?? {
      type: allocation.type.name,
      unit: allocation.type.unit,
      allocated: 0,
      taken: 0,
    };
    entry.allocated = round2(entry.allocated + toMoney(allocation.amount));
    entry.taken = round2(entry.taken + taken);
    byType.set(allocation.type.name, entry);
  }

  return [...byType.values()].map((entry) => ({
    ...entry,
    remaining: round2(entry.allocated - entry.taken),
  }));
}
