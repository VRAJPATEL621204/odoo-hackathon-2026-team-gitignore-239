import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Seeds the data the application needs to be usable on a fresh database:
 * departments, job positions, working schedules, employees, their contracts,
 * and the accounts to sign in with.
 *
 * There has to be a way into an application whose accounts are only created by
 * an administrator, and this is it. The seed is idempotent — everything is
 * upserted on a natural key — so running it again after a schema change
 * refreshes the demo data instead of failing on a duplicate.
 *
 * Run with: npm run seed
 */

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = process.env.SEED_PASSWORD ?? 'Password@123';

const DEPARTMENTS = ['Finance', 'HR', 'Engineering', 'Sales', 'Support', 'IT'];

const JOB_POSITIONS = [
  { name: 'Payroll Specialist', department: 'Finance' },
  { name: 'Payroll Manager', department: 'Finance' },
  { name: 'HR Officer', department: 'HR' },
  { name: 'Recruiter', department: 'HR' },
  { name: 'Developer', department: 'Engineering' },
  { name: 'Support Engineer', department: 'Support' },
  { name: 'Sales Executive', department: 'Sales' },
  { name: 'Accountant', department: 'Finance' },
  { name: 'Administrator', department: 'IT' },
];

/** 09:00–18:00 with an hour for lunch is 8 hours; five of those make 40. */
const nineToSix = (dayOfWeek) => ({
  dayOfWeek,
  startMinutes: 9 * 60,
  endMinutes: 18 * 60,
  breakMinutes: 60,
});

const SCHEDULES = [
  {
    name: '40 Hours / Week',
    timezone: 'Asia/Kolkata',
    days: [0, 1, 2, 3, 4].map(nineToSix),
  },
  // Times are minutes from midnight within one day, so a shift is written
  // inside a single calendar day rather than crossing midnight.
  {
    name: 'Evening Shift',
    timezone: 'Asia/Kolkata',
    days: [0, 1, 2, 3, 4].map((dayOfWeek) => ({
      dayOfWeek,
      startMinutes: 14 * 60,
      endMinutes: 23 * 60,
      breakMinutes: 60,
    })),
  },
  {
    name: 'Part-time 20h',
    timezone: 'Asia/Kolkata',
    active: false,
    days: [0, 1, 2, 3, 4].map((dayOfWeek) => ({
      dayOfWeek,
      startMinutes: 10 * 60,
      endMinutes: 14 * 60,
      breakMinutes: 0,
    })),
  },
];

const PEOPLE = [
  {
    name: 'Aarav Mehta',
    workEmail: 'aarav@oxp.com',
    jobTitle: 'Payroll Specialist',
    workPhone: '+91 98765 43210',
    department: 'Finance',
    jobPosition: 'Payroll Specialist',
    workLocation: 'Mumbai',
    schedule: '40 Hours / Week',
    manager: 'Sara Khan',
    bankAccount: 'HDFC ****4021',
    roles: ['PAYROLL_USER', 'EMPLOYEE'],
    wage: 85000,
  },
  {
    name: 'Sara Khan',
    workEmail: 'sara@oxp.com',
    jobTitle: 'HR Officer',
    workPhone: '+91 98765 43211',
    department: 'HR',
    jobPosition: 'HR Officer',
    workLocation: 'Mumbai',
    schedule: '40 Hours / Week',
    bankAccount: 'ICICI ****7789',
    roles: ['HR_MANAGER', 'EMPLOYEE'],
    wage: 95000,
  },
  {
    name: 'John Dsouza',
    workEmail: 'john@oxp.com',
    jobTitle: 'Developer',
    workPhone: '+91 98765 43212',
    department: 'Engineering',
    jobPosition: 'Developer',
    workLocation: 'Pune',
    schedule: '40 Hours / Week',
    manager: 'Sara Khan',
    roles: ['EMPLOYEE'],
    wage: 78000,
  },
  {
    name: 'Neha Patel',
    workEmail: 'neha@oxp.com',
    jobTitle: 'Recruiter',
    workPhone: '+91 98765 43213',
    department: 'HR',
    jobPosition: 'Recruiter',
    workLocation: 'Mumbai',
    schedule: '40 Hours / Week',
    manager: 'Sara Khan',
    bankAccount: 'SBI ****1188',
    roles: ['TIMEOFF_ADMIN', 'EMPLOYEE'],
    wage: 62000,
  },
  {
    name: 'Nisha Rao',
    workEmail: 'nisha@oxp.com',
    jobTitle: 'Payroll Manager',
    workPhone: '+91 98765 43214',
    department: 'Finance',
    jobPosition: 'Payroll Manager',
    workLocation: 'Mumbai',
    schedule: '40 Hours / Week',
    bankAccount: 'AXIS ****3390',
    roles: ['PAYROLL_ADMIN', 'EMPLOYEE'],
    wage: 120000,
  },
  // The bootstrap administrator. Without this account nobody could create the
  // first user, because user creation itself requires an administrator.
  {
    name: 'System Administrator',
    workEmail: 'admin@oxp.com',
    jobTitle: 'Administrator',
    department: 'IT',
    jobPosition: 'Administrator',
    workLocation: 'Mumbai',
    roles: ['ADMIN'],
  },
];

/**
 * Employees who deliberately have no account, so the "Create User" form has
 * somebody to pick on a freshly seeded database.
 */
const PEOPLE_WITHOUT_ACCOUNTS = [
  {
    name: 'Maya Shah',
    workEmail: 'maya@oxp.com',
    jobTitle: 'Accountant',
    department: 'Finance',
    jobPosition: 'Accountant',
    workLocation: 'Mumbai',
    schedule: '40 Hours / Week',
    bankAccount: 'HDFC ****9021',
    wage: 58000,
  },
  {
    name: 'Rohan Patel',
    workEmail: 'rohan@oxp.com',
    jobTitle: 'Support Engineer',
    department: 'Support',
    jobPosition: 'Support Engineer',
    workLocation: 'Pune',
    schedule: 'Evening Shift',
    wage: 52000,
  },
  {
    name: 'Anita Oliver',
    workEmail: 'anita@oxp.com',
    jobTitle: 'Sales Executive',
    department: 'Sales',
    jobPosition: 'Sales Executive',
    workLocation: 'Delhi',
    schedule: '40 Hours / Week',
    bankAccount: 'KOTAK ****4412',
    wage: 67000,
  },
];

const TIME_OFF_TYPES = [
  {
    name: 'Paid Time Off',
    unit: 'DAYS',
    requiresAllocation: true,
    approvedBy: 'MANAGER',
    workEntry: 'Leave Work Entry',
    color: 'Blue',
    description: 'Standard annual leave. Balance comes from approved allocations.',
  },
  {
    name: 'Sick Leave',
    unit: 'DAYS',
    requiresAllocation: false,
    approvedBy: 'MANAGER',
    workEntry: 'Leave Work Entry',
    color: 'Red',
    description: 'Taken as needed, so no allocation is required before requesting it.',
  },
  {
    name: 'Comp Off',
    unit: 'HOURS',
    requiresAllocation: true,
    approvedBy: 'OFFICER',
    workEntry: 'Compensatory Work Entry',
    color: 'Green',
    description: 'Earned against overtime and granted in hours.',
  },
  {
    name: 'Unpaid Leave',
    unit: 'DAYS',
    requiresAllocation: false,
    approvedBy: 'OFFICER',
    unpaid: true,
    workEntry: 'Unpaid Work Entry',
    color: 'Grey',
    description: 'Deducted from salary by the payroll rules.',
  },
];

/**
 * The salary structures, with the rules from the reference screens.
 *
 * Sequence is the calculation order: basic first, allowances against it, a
 * gross that sums them, deductions, and a net at the end. The formula rules
 * show what the expression language is for — attendance-based pay, overtime and
 * unpaid leave, none of which a fixed amount or a percentage can express.
 */
const STRUCTURES = [
  {
    name: 'Regular Salary',
    notes: 'Standard monthly salary for permanent employees.',
    rules: [
      { name: 'Basic Salary', code: 'BASIC', category: 'BASIC', sequence: 1, computation: 'PERCENTAGE', percentage: 50, percentageBase: 'CONTRACT_WAGE', notes: 'Half of the contract wage.' },
      { name: 'House Rent Allowance', code: 'HRA', category: 'ALLOWANCE', sequence: 10, computation: 'PERCENTAGE', percentage: 40, percentageBase: 'BASIC' },
      { name: 'Standard Allowance', code: 'STD', category: 'ALLOWANCE', sequence: 20, computation: 'FIXED', amount: 4000 },
      { name: 'Performance Bonus', code: 'BONUS', category: 'ALLOWANCE', sequence: 30, computation: 'PERCENTAGE', percentage: 5, percentageBase: 'BASIC' },
      { name: 'Leave Travel Allowance', code: 'LTA', category: 'ALLOWANCE', sequence: 40, computation: 'FIXED', amount: 2500 },
      { name: 'Overtime Pay', code: 'OT', category: 'ALLOWANCE', sequence: 45, computation: 'FORMULA', formula: "result = round(categories['BASIC'] / max(total_days, 1) / 8 * 1.5 * overtime_hours, 2)", notes: 'Overtime hours at 1.5 times the hourly rate derived from basic.' },
      { name: 'Gross Salary', code: 'GROSS', category: 'GROSS', sequence: 60, computation: 'FORMULA', formula: "result = categories['BASIC'] + categories['ALLOWANCE']" },
      { name: 'Unpaid Leave Deduction', code: 'UNPAID', category: 'DEDUCTION', sequence: 70, computation: 'FORMULA', formula: "result = categories['GROSS'] / max(total_days, 1) * unpaid_days", notes: 'Days of unpaid leave, at the daily rate of the gross salary.' },
      { name: 'Provident Fund', code: 'PF', category: 'DEDUCTION', sequence: 80, computation: 'PERCENTAGE', percentage: 12, percentageBase: 'BASIC' },
      { name: 'Professional Tax', code: 'PT', category: 'DEDUCTION', sequence: 100, computation: 'FIXED', amount: 200 },
      { name: 'Net Salary', code: 'NET', category: 'NET', sequence: 110, computation: 'FORMULA', formula: "result = categories['GROSS'] + categories['DEDUCTION']" },
    ],
  },
  {
    name: 'Intern Salary',
    notes: 'Stipend paid for the days actually worked, with no statutory deductions.',
    rules: [
      { name: 'Stipend', code: 'BASIC', category: 'BASIC', sequence: 1, computation: 'FORMULA', formula: 'result = round(wage * worked_days / max(total_days, 1), 2)', notes: 'The stipend, proportioned to the days worked.' },
      { name: 'Gross Salary', code: 'GROSS', category: 'GROSS', sequence: 60, computation: 'FORMULA', formula: "result = categories['BASIC'] + categories['ALLOWANCE']" },
      { name: 'Professional Tax', code: 'PT', category: 'DEDUCTION', sequence: 100, computation: 'FIXED', amount: 200 },
      { name: 'Net Salary', code: 'NET', category: 'NET', sequence: 110, computation: 'FORMULA', formula: "result = categories['GROSS'] + categories['DEDUCTION']" },
    ],
  },
  {
    name: 'Contractor',
    notes: 'Flat contract fee, no allowances and no provident fund.',
    rules: [
      { name: 'Contract Fee', code: 'BASIC', category: 'BASIC', sequence: 1, computation: 'PERCENTAGE', percentage: 100, percentageBase: 'CONTRACT_WAGE' },
      { name: 'Gross Salary', code: 'GROSS', category: 'GROSS', sequence: 60, computation: 'FORMULA', formula: "result = categories['BASIC'] + categories['ALLOWANCE']" },
      { name: 'Tax Deducted at Source', code: 'TDS', category: 'DEDUCTION', sequence: 90, computation: 'PERCENTAGE', percentage: 10, percentageBase: 'GROSS' },
      { name: 'Net Salary', code: 'NET', category: 'NET', sequence: 110, computation: 'FORMULA', formula: "result = categories['GROSS'] + categories['DEDUCTION']" },
    ],
  },
];

const date = (value) => new Date(`${value}T00:00:00.000Z`);

/**
 * An instant on `day` at the given India time, as UTC.
 *
 * The seed writes check-ins the same way the application reads them: as
 * instants, with the business day derived in the company timezone. IST is
 * UTC+5:30, so 09:05 local is 03:35 UTC.
 */
function istInstant(day, hours, minutes) {
  const utcMinutes = hours * 60 + minutes - (5 * 60 + 30);
  return new Date(day.getTime() + utcMinutes * 60 * 1000);
}

/** Hours between two instants, rounded like the domain module does. */
function hoursBetween(start, end) {
  return Math.round((end.getTime() - start.getTime()) / 36000) / 100;
}

async function main() {
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  const departments = new Map();
  for (const name of DEPARTMENTS) {
    const row = await prisma.department.upsert({ where: { name }, update: {}, create: { name } });
    departments.set(name, row.id);
  }

  const positions = new Map();
  for (const position of JOB_POSITIONS) {
    const data = { name: position.name, departmentId: departments.get(position.department) };
    const row = await prisma.jobPosition.upsert({
      where: { name: position.name },
      update: data,
      create: data,
    });
    positions.set(position.name, row.id);
  }

  const schedules = new Map();
  for (const schedule of SCHEDULES) {
    const { days, ...rest } = schedule;
    // The days are replaced rather than merged so re-running the seed cannot
    // double the weekly hours.
    const row = await prisma.workingSchedule.upsert({
      where: { name: rest.name },
      update: rest,
      create: rest,
    });
    await prisma.scheduleDay.deleteMany({ where: { scheduleId: row.id } });
    await prisma.scheduleDay.createMany({
      data: days.map((day) => ({ ...day, scheduleId: row.id })),
    });
    schedules.set(rest.name, row.id);
  }

  const employees = new Map();

  /** Creates or refreshes one employee. Managers are linked in a second pass. */
  async function upsertPerson(person) {
    const data = {
      name: person.name,
      workEmail: person.workEmail,
      workPhone: person.workPhone ?? null,
      jobTitle: person.jobTitle ?? null,
      workLocation: person.workLocation ?? null,
      bankAccount: person.bankAccount ?? null,
      departmentId: departments.get(person.department) ?? null,
      jobPositionId: positions.get(person.jobPosition) ?? null,
      workingScheduleId: schedules.get(person.schedule) ?? null,
    };

    const row = await prisma.employee.upsert({
      where: { workEmail: person.workEmail },
      update: data,
      create: data,
    });
    employees.set(person.name, row.id);
    return row;
  }

  for (const person of [...PEOPLE, ...PEOPLE_WITHOUT_ACCOUNTS]) {
    await upsertPerson(person);
  }

  // Managers are set after every employee exists, because a manager is an
  // employee too and may be seeded after the person reporting to them.
  for (const person of [...PEOPLE, ...PEOPLE_WITHOUT_ACCOUNTS]) {
    if (!person.manager) continue;
    await prisma.employee.update({
      where: { workEmail: person.workEmail },
      data: { managerId: employees.get(person.manager) ?? null },
    });
  }

  for (const person of PEOPLE) {
    const employeeId = employees.get(person.name);
    await prisma.user.upsert({
      where: { employeeId },
      update: { roles: person.roles, active: true, email: person.workEmail },
      create: { email: person.workEmail, passwordHash, roles: person.roles, employeeId },
    });
  }

  // One running contract per employee who has a wage, plus one expired
  // contract for Aarav so the history has something to show.
  let contractNumber = 0;
  for (const person of [...PEOPLE, ...PEOPLE_WITHOUT_ACCOUNTS]) {
    if (!person.wage) continue;
    const employeeId = employees.get(person.name);

    const reference = `CON/2026/${String(++contractNumber).padStart(4, '0')}`;
    const data = {
      employeeId,
      startDate: date('2026-01-01'),
      endDate: null,
      wage: person.wage,
      status: 'RUNNING',
      departmentId: departments.get(person.department) ?? null,
      jobPositionId: positions.get(person.jobPosition) ?? null,
      workingScheduleId: schedules.get(person.schedule) ?? null,
    };

    await prisma.contract.upsert({
      where: { reference },
      update: data,
      create: { ...data, reference },
    });
  }

  const previous = {
    employeeId: employees.get('Aarav Mehta'),
    startDate: date('2025-07-01'),
    endDate: date('2025-12-31'),
    wage: 78000,
    status: 'EXPIRED',
    departmentId: departments.get('Finance'),
    jobPositionId: positions.get('Payroll Specialist'),
    workingScheduleId: schedules.get('40 Hours / Week'),
    notes: 'Superseded by the 2026 contract.',
  };
  await prisma.contract.upsert({
    where: { reference: 'CON/2025/0001' },
    update: previous,
    create: { ...previous, reference: 'CON/2025/0001' },
  });

  // The sequence must not hand out a number already used above, or the next
  // contract created in the UI would collide on the unique reference.
  await prisma.sequence.upsert({
    where: { key_year: { key: 'CONTRACT', year: 2026 } },
    update: { lastNumber: contractNumber },
    create: { key: 'CONTRACT', year: 2026, lastNumber: contractNumber },
  });
  await prisma.sequence.upsert({
    where: { key_year: { key: 'CONTRACT', year: 2025 } },
    update: { lastNumber: 1 },
    create: { key: 'CONTRACT', year: 2025, lastNumber: 1 },
  });

  // Attendance for the last three working weeks, so the list, the employee
  // smart button and the phase 6 dashboard all have real data to read. The
  // pattern is deliberately imperfect: some late arrivals, one absence and one
  // missing check-out, which are exactly the cases the screens must handle.
  const attendancePeople = [...PEOPLE, ...PEOPLE_WITHOUT_ACCOUNTS].filter((person) => person.wage);
  let attendanceRows = 0;

  await prisma.attendance.deleteMany({});

  const today = new Date();
  const todayUtcMidnight = date(today.toISOString().slice(0, 10));

  for (let daysAgo = 20; daysAgo >= 0; daysAgo -= 1) {
    const day = new Date(todayUtcMidnight.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) continue; // Saturday and Sunday are not worked.

    for (const [index, person] of attendancePeople.entries()) {
      const employeeId = employees.get(person.name);
      const seed = (daysAgo + index) % 11;

      // One person is absent on one day rather than everybody being present.
      if (seed === 7) {
        await prisma.attendance.create({
          data: { employeeId, date: day, status: 'ABSENT', note: 'Unplanned absence' },
        });
        attendanceRows += 1;
        continue;
      }

      const lateMinutes = seed === 3 ? 35 : seed === 8 ? 22 : seed % 4;
      const checkIn = istInstant(day, 9, lateMinutes);

      // The most recent day leaves one session open, which is what the widget
      // shows as "still checked in" and the dashboard counts as a missing
      // check-out.
      const leaveOpen = daysAgo === 0 && index === 0;
      const checkOut = leaveOpen ? null : istInstant(day, 18, seed === 5 ? 40 : 10);

      const worked = checkOut ? hoursBetween(checkIn, checkOut) : 0;
      const overtime = checkOut ? Math.max(0, Math.round((worked - 8) * 100) / 100) : 0;

      await prisma.attendance.create({
        data: {
          employeeId,
          date: day,
          checkIn,
          checkOut,
          status: lateMinutes > 10 ? 'LATE' : 'PRESENT',
          workedHours: worked,
          overtimeHours: overtime,
        },
      });
      attendanceRows += 1;
    }
  }

  // Time off: the policy types, an annual balance for everybody, and a handful
  // of requests in each state so the approval flow has something to act on.
  const types = new Map();
  for (const type of TIME_OFF_TYPES) {
    const row = await prisma.timeOffType.upsert({
      where: { name: type.name },
      update: type,
      create: type,
    });
    types.set(type.name, row);
  }

  await prisma.timeOffRequest.deleteMany({});
  await prisma.timeOffAllocation.deleteMany({});

  const allocationIds = new Map();
  const allocationPeople = [...PEOPLE, ...PEOPLE_WITHOUT_ACCOUNTS].filter((person) => person.wage);

  for (const [index, person] of allocationPeople.entries()) {
    const employeeId = employees.get(person.name);

    const paid = await prisma.timeOffAllocation.create({
      data: {
        employeeId,
        typeId: types.get('Paid Time Off').id,
        amount: 20,
        status: 'APPROVED',
        approverId: employees.get('Sara Khan'),
        validFrom: date('2026-01-01'),
        validTo: date('2026-12-31'),
        description: 'Annual leave balance granted at the start of the policy year.',
      },
    });
    allocationIds.set(`${person.name}:paid`, paid.id);

    // One allocation is left awaiting approval, so the screen has a decision to
    // make rather than a list where everything is already settled.
    await prisma.timeOffAllocation.create({
      data: {
        employeeId,
        typeId: types.get('Comp Off').id,
        amount: 16,
        status: index === 0 ? 'TO_APPROVE' : 'APPROVED',
        approverId: index === 0 ? null : employees.get('Nisha Rao'),
        validFrom: date('2026-01-01'),
        validTo: date('2026-12-31'),
        description: 'Compensatory hours earned against overtime.',
      },
    });
  }

  const REQUESTS = [
    {
      person: 'Aarav Mehta',
      type: 'Paid Time Off',
      startDate: '2026-09-14',
      endDate: '2026-09-16',
      status: 'APPROVED',
      reason: 'Family vacation',
    },
    {
      person: 'Aarav Mehta',
      type: 'Paid Time Off',
      startDate: '2026-06-01',
      endDate: '2026-06-05',
      status: 'APPROVED',
      reason: 'Summer break',
    },
    {
      person: 'Sara Khan',
      type: 'Sick Leave',
      startDate: '2026-09-18',
      endDate: '2026-09-18',
      status: 'APPROVED',
      reason: 'Unwell',
    },
    {
      person: 'John Dsouza',
      type: 'Comp Off',
      startDate: '2026-09-25',
      endDate: '2026-09-25',
      status: 'TO_APPROVE',
      reason: 'Worked the release weekend',
    },
    {
      person: 'Neha Patel',
      type: 'Paid Time Off',
      startDate: '2026-10-05',
      endDate: '2026-10-09',
      status: 'TO_APPROVE',
      reason: 'Festival week',
    },
    {
      person: 'Maya Shah',
      type: 'Paid Time Off',
      startDate: '2026-07-20',
      endDate: '2026-07-21',
      status: 'REFUSED',
      reason: 'Clashes with the quarter close',
    },
  ];

  let requestRows = 0;
  for (const request of REQUESTS) {
    const employeeId = employees.get(request.person);
    const type = types.get(request.type);
    const startDate = date(request.startDate);
    const endDate = date(request.endDate);

    // Duration is derived exactly as the API derives it: working days for a day
    // type, scheduled hours for an hour type, weekends excluded.
    const days = [];
    for (let cursor = new Date(startDate); cursor <= endDate; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const weekday = (cursor.getUTCDay() + 6) % 7;
      if (weekday < 5) days.push(new Date(cursor));
    }
    const duration = type.unit === 'HOURS' ? days.length * 8 : days.length;
    if (duration === 0) continue;

    await prisma.timeOffRequest.create({
      data: {
        employeeId,
        typeId: type.id,
        startDate,
        endDate,
        duration,
        status: request.status,
        reason: request.reason,
        approverId: request.status === 'TO_APPROVE' ? null : employees.get('Sara Khan'),
        allocationId:
          request.status === 'APPROVED' && type.requiresAllocation
            ? (allocationIds.get(`${request.person}:paid`) ?? null)
            : null,
      },
    });
    requestRows += 1;
  }

  // Salary structures. Rules are replaced rather than merged so re-running the
  // seed cannot leave a rule behind under an old code.
  let ruleCount = 0;
  for (const structure of STRUCTURES) {
    const { rules, ...data } = structure;
    const row = await prisma.salaryStructure.upsert({
      where: { name: data.name },
      update: data,
      create: data,
    });

    await prisma.salaryRule.deleteMany({ where: { structureId: row.id } });
    for (const rule of rules) {
      await prisma.salaryRule.create({ data: { ...rule, structureId: row.id } });
      ruleCount += 1;
    }
  }

  console.log(`Seeded ${STRUCTURES.length} salary structures with ${ruleCount} rules.`);
  console.log(
    `Seeded ${TIME_OFF_TYPES.length} time off types, ${allocationPeople.length * 2} allocations and ${requestRows} requests.`
  );
  console.log(`Seeded ${attendanceRows} attendance records over the last three weeks.`);
  console.log(`Seeded ${DEPARTMENTS.length} departments and ${JOB_POSITIONS.length} job positions.`);
  console.log(`Seeded ${SCHEDULES.length} working schedules.`);
  console.log(`Seeded ${PEOPLE.length} employees with accounts, ${PEOPLE_WITHOUT_ACCOUNTS.length} without.`);
  console.log(`Seeded ${contractNumber + 1} contracts.`);
  console.log(`Sign in as admin@oxp.com with the password "${DEFAULT_PASSWORD}".`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
