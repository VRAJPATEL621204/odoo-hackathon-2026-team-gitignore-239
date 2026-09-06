import bcrypt from 'bcryptjs';

import { prisma } from '../src/lib/prisma.js';
import { toUtcMidnight } from '../src/lib/dates.js';
import { requestDuration } from '../src/domain/timeoff.js';
import { createPayrun, computePayrun, setPayrunStatus } from '../src/services/payroll.service.js';

/**
 * Seeds a fresh database with enough data to actually demo the product —
 * around 200-300 rows in every table where that number means something
 * (employees, contracts, attendance, leave, payslips), and a small, realistic
 * count everywhere else (departments, job positions, salary structures — a
 * company does not have 250 departments, and pretending otherwise would just
 * be noise, not data).
 *
 * DESIGN
 * ------
 * 1. Nine hand-written "hero" employees keep their exact original identity
 *    (admin@oxp.com, Aarav, Sara, ...) because the rest of this app's demo
 *    flows, screenshots and manual test notes reference them by name/email.
 * 2. Everything past that is generated deterministically from a plain
 *    incrementing index — no randomness anywhere. Re-running this script
 *    produces the exact same names, emails and numbers every time, which is
 *    what makes the upsert-on-natural-key idempotency below actually safe:
 *    idempotent-but-random would create a new "employee" every run.
 * 3. Payroll numbers are produced by calling the app's own
 *    createPayrun/computePayrun/setPayrunStatus — the same functions the
 *    payroll UI calls — instead of hand-computing payslip totals here. That
 *    guarantees the seeded payslips are exactly as correct as a real payrun,
 *    with zero duplicated formula logic to drift out of sync.
 * 4. Every date is relative to "today" (attendance, leave, payroll periods),
 *    so the demo still looks current a year from now instead of forever
 *    showing "August 2026".
 *
 * ROBUSTNESS
 * ----------
 * Each numbered step below is wrapped so one section failing (say, a single
 * bad date computation) is logged clearly and does not take the rest of the
 * seed down with it, and — critically — does not stop the container from
 * starting: Dockerfile's CMD chains `npm run seed` before `npm start`, so an
 * uncaught failure here used to mean a healthy database with no data was a
 * broken container with no app. `main()` now always exits 0 unless a
 * *foundational* step (departments/employees, without which nothing else can
 * exist) fails.
 *
 * Run with: npm run seed
 */

const DEFAULT_PASSWORD = process.env.SEED_PASSWORD ?? 'Password@123';

/* ============================================================ reference data */

const DEPARTMENTS = [
  'Finance',
  'HR',
  'Engineering',
  'Sales',
  'Support',
  'IT',
  'Marketing',
  'Operations',
  'Legal',
  'Customer Success',
];

/** A few positions per department, each with a wage tier for generated pay. */
const JOB_POSITIONS = [
  { name: 'Payroll Specialist', department: 'Finance', tier: 'mid' },
  { name: 'Payroll Manager', department: 'Finance', tier: 'lead' },
  { name: 'Accountant', department: 'Finance', tier: 'mid' },
  { name: 'Financial Analyst', department: 'Finance', tier: 'mid' },
  { name: 'HR Officer', department: 'HR', tier: 'mid' },
  { name: 'Recruiter', department: 'HR', tier: 'mid' },
  { name: 'HR Manager', department: 'HR', tier: 'lead' },
  { name: 'Developer', department: 'Engineering', tier: 'mid' },
  { name: 'Senior Developer', department: 'Engineering', tier: 'senior' },
  { name: 'Engineering Manager', department: 'Engineering', tier: 'lead' },
  { name: 'QA Engineer', department: 'Engineering', tier: 'mid' },
  { name: 'Sales Executive', department: 'Sales', tier: 'junior' },
  { name: 'Sales Manager', department: 'Sales', tier: 'lead' },
  { name: 'Account Executive', department: 'Sales', tier: 'mid' },
  { name: 'Support Engineer', department: 'Support', tier: 'mid' },
  { name: 'Support Lead', department: 'Support', tier: 'senior' },
  { name: 'Administrator', department: 'IT', tier: 'mid' },
  { name: 'System Engineer', department: 'IT', tier: 'mid' },
  { name: 'Marketing Executive', department: 'Marketing', tier: 'junior' },
  { name: 'Marketing Manager', department: 'Marketing', tier: 'lead' },
  { name: 'Operations Analyst', department: 'Operations', tier: 'mid' },
  { name: 'Operations Manager', department: 'Operations', tier: 'lead' },
  { name: 'Legal Counsel', department: 'Legal', tier: 'senior' },
  { name: 'Customer Success Manager', department: 'Customer Success', tier: 'lead' },
  { name: 'Customer Success Associate', department: 'Customer Success', tier: 'junior' },
];

const WAGE_BY_TIER = { junior: 42000, mid: 60000, senior: 88000, lead: 115000 };

const CITIES = ['Mumbai', 'Pune', 'Delhi', 'Bangalore', 'Hyderabad', 'Chennai'];

/** 09:00-18:00 with an hour for lunch is 8 hours; five of those make 40. */
const nineToSix = (dayOfWeek) => ({
  dayOfWeek,
  startMinutes: 9 * 60,
  endMinutes: 18 * 60,
  breakMinutes: 60,
});

const SCHEDULES = [
  { name: '40 Hours / Week', timezone: 'Asia/Kolkata', days: [0, 1, 2, 3, 4].map(nineToSix) },
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
  {
    name: 'Maternity/Paternity Leave',
    unit: 'DAYS',
    requiresAllocation: true,
    approvedBy: 'OFFICER',
    workEntry: 'Leave Work Entry',
    color: 'Purple',
    description: 'Granted as a one-time allocation for the event.',
  },
];

/**
 * The salary structures, with the rules from the reference screens.
 *
 * Sequence is the calculation order: basic first, allowances against it, a
 * gross that sums them, deductions, and a net at the end.
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

/* ================================================================ hero people */

/**
 * Nine hand-written employees whose identity every other part of this app's
 * documentation, screenshots and manual test notes already depend on. These
 * are never renamed or renumbered by the generator below.
 */
const PEOPLE = [
  { name: 'Aarav Mehta', workEmail: 'aarav@oxp.com', jobTitle: 'Payroll Specialist', workPhone: '+91 98765 43210', department: 'Finance', jobPosition: 'Payroll Specialist', workLocation: 'Mumbai', schedule: '40 Hours / Week', manager: 'Sara Khan', bankAccount: 'HDFC ****4021', roles: ['PAYROLL_USER', 'EMPLOYEE'], wage: 85000 },
  { name: 'Sara Khan', workEmail: 'sara@oxp.com', jobTitle: 'HR Officer', workPhone: '+91 98765 43211', department: 'HR', jobPosition: 'HR Officer', workLocation: 'Mumbai', schedule: '40 Hours / Week', bankAccount: 'ICICI ****7789', roles: ['HR_MANAGER', 'EMPLOYEE'], wage: 95000 },
  { name: 'John Dsouza', workEmail: 'john@oxp.com', jobTitle: 'Developer', workPhone: '+91 98765 43212', department: 'Engineering', jobPosition: 'Developer', workLocation: 'Pune', schedule: '40 Hours / Week', manager: 'Sara Khan', roles: ['EMPLOYEE'], wage: 78000 },
  { name: 'Neha Patel', workEmail: 'neha@oxp.com', jobTitle: 'Recruiter', workPhone: '+91 98765 43213', department: 'HR', jobPosition: 'Recruiter', workLocation: 'Mumbai', schedule: '40 Hours / Week', manager: 'Sara Khan', bankAccount: 'SBI ****1188', roles: ['TIMEOFF_ADMIN', 'EMPLOYEE'], wage: 62000 },
  { name: 'Nisha Rao', workEmail: 'nisha@oxp.com', jobTitle: 'Payroll Manager', workPhone: '+91 98765 43214', department: 'Finance', jobPosition: 'Payroll Manager', workLocation: 'Mumbai', schedule: '40 Hours / Week', bankAccount: 'AXIS ****3390', roles: ['PAYROLL_ADMIN', 'EMPLOYEE'], wage: 120000 },
  // The bootstrap administrator. Without this account nobody could create the
  // first user, because user creation itself requires an administrator.
  { name: 'System Administrator', workEmail: 'admin@oxp.com', jobTitle: 'Administrator', department: 'IT', jobPosition: 'Administrator', workLocation: 'Mumbai', roles: ['ADMIN'] },
];

/** Employees who deliberately have no account, so the "Create User" form has
 * somebody to pick on a freshly seeded database. */
const PEOPLE_WITHOUT_ACCOUNTS = [
  { name: 'Maya Shah', workEmail: 'maya@oxp.com', jobTitle: 'Accountant', department: 'Finance', jobPosition: 'Accountant', workLocation: 'Mumbai', schedule: '40 Hours / Week', bankAccount: 'HDFC ****9021', wage: 58000 },
  { name: 'Rohan Patel', workEmail: 'rohan@oxp.com', jobTitle: 'Support Engineer', department: 'Support', jobPosition: 'Support Engineer', workLocation: 'Pune', schedule: 'Evening Shift', wage: 52000 },
  { name: 'Anita Oliver', workEmail: 'anita@oxp.com', jobTitle: 'Sales Executive', department: 'Sales', jobPosition: 'Sales Executive', workLocation: 'Delhi', schedule: '40 Hours / Week', bankAccount: 'KOTAK ****4412', wage: 67000 },
];

const HERO_COUNT = PEOPLE.length + PEOPLE_WITHOUT_ACCOUNTS.length; // 9

/* ============================================================ generated people */

const FIRST_NAMES = [
  'Aditi', 'Aisha', 'Akash', 'Alok', 'Ananya', 'Ankit', 'Arjun', 'Bhavesh', 'Chetan', 'Deepak',
  'Divya', 'Farah', 'Gaurav', 'Harsh', 'Ishaan', 'Jaya', 'Kavya', 'Kunal', 'Lakshmi', 'Manish',
  'Meera', 'Naveen', 'Om', 'Pooja', 'Priya', 'Rahul', 'Rajesh', 'Rekha', 'Sameer', 'Sanjay',
  'Shreya', 'Siddharth', 'Sneha', 'Suresh', 'Tanvi', 'Uday', 'Varun', 'Vikram', 'Yash', 'Zara',
];
const LAST_NAMES = [
  'Agarwal', 'Bhatt', 'Chopra', 'Desai', 'Gandhi', 'Gupta', 'Iyer', 'Jain', 'Kapoor', 'Khanna',
  'Kumar', 'Malhotra', 'Mehta', 'Nair', 'Pandey', 'Patel', 'Rao', 'Reddy', 'Sharma', 'Singh',
  'Sinha', 'Trivedi', 'Verma', 'Yadav', 'Bose', 'Chatterjee', 'Das', 'Ghosh', 'Joshi', 'Kaur',
  'Menon', 'Mishra', 'Naik', 'Pillai', 'Prasad', 'Saxena', 'Shah', 'Thakur', 'Tiwari', 'Vora',
];

const GENERATED_COUNT = 231; // 231 + 9 heroes = 240 employees total.

/** Every generated person is fully deterministic — no Math.random anywhere —
 * so re-running the seed against an existing database is safe. */
function generatedPerson(i) {
  const first = FIRST_NAMES[i % FIRST_NAMES.length];
  // The +13 term shifts by "which lap around FIRST_NAMES this is"
  // (floor(i/40)), so a first name that repeats every 40 employees is not
  // paired with the same last name every time it repeats. Display names are
  // cosmetic only — nothing below ever looks an employee up by name, only by
  // id — but a seed that shows five identical "Aditi Agarwal"s looks broken
  // even when it functionally isn't.
  const last = LAST_NAMES[(i * 7 + Math.floor(i / FIRST_NAMES.length) * 13 + 3) % LAST_NAMES.length];
  const name = `${first} ${last}`;
  const slug = `${first}.${last}${i}`.toLowerCase();
  const department = DEPARTMENTS[i % DEPARTMENTS.length];
  const deptPositions = JOB_POSITIONS.filter((position) => position.department === department);
  const position = deptPositions[i % deptPositions.length];
  const schedule = i % 17 === 0 ? 'Part-time 20h' : i % 11 === 0 ? 'Evening Shift' : '40 Hours / Week';
  // A handful deliberately have no bank account, so the payroll warning that a
  // real HR team hits ("can't pay this payslip") stays reachable at scale
  // instead of only existing for the two hand-written examples.
  const hasBankAccount = i % 19 !== 0;

  return {
    index: i,
    name,
    workEmail: `${slug}@oxp.com`,
    workPhone: `+91 90${String(10000000 + i).slice(0, 8)}`,
    jobTitle: position.name,
    department,
    jobPosition: position.name,
    workLocation: CITIES[i % CITIES.length],
    schedule,
    bankAccount: hasBankAccount ? `${['HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK'][i % 5]} ****${1000 + (i % 9000)}` : null,
    wage: WAGE_BY_TIER[position.tier] + (i % 6) * 1500,
    personalEmail: `${slug}@personal.example`,
    personalPhone: `+91 91${String(20000000 + i).slice(0, 8)}`,
    address: `${CITIES[i % CITIES.length]}, India`,
    dateOfBirth: relativeYears(-(22 + (i % 34))),
  };
}

/* ================================================================ date helpers */

const TODAY = toUtcMidnight(new Date());

/** A UTC date `years` away from today (negative = in the past). Used so the
 * whole seed's ages/dates stay current no matter when it is run. */
function relativeYears(years) {
  const d = new Date(TODAY);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

function relativeDays(days) {
  return new Date(TODAY.getTime() + days * 24 * 60 * 60 * 1000);
}

function firstOfMonth(offsetMonths) {
  const d = new Date(TODAY);
  d.setUTCMonth(d.getUTCMonth() + offsetMonths, 1);
  return toUtcMidnight(d);
}

function lastOfMonth(offsetMonths) {
  const d = firstOfMonth(offsetMonths + 1);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/** The `count` most recent working days (Mon-Fri) up to and including today,
 * oldest first. */
function lastWorkingDays(count) {
  const days = [];
  let cursor = new Date(TODAY);
  while (days.length < count) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.unshift(new Date(cursor));
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }
  return days;
}

/**
 * An instant on `day` at the given India time, as UTC.
 *
 * IST is UTC+5:30, so 09:05 local is 03:35 UTC.
 */
function istInstant(day, hours, minutes) {
  const utcMinutes = hours * 60 + minutes - (5 * 60 + 30);
  return new Date(day.getTime() + utcMinutes * 60 * 1000);
}

/** Hours between two instants, rounded like the domain module does. */
function hoursBetween(start, end) {
  return Math.round((end.getTime() - start.getTime()) / 36000) / 100;
}

/* ======================================================================= run */

/**
 * Runs one named step. Foundational steps (`critical: true`) rethrow, since
 * nothing after them can succeed anyway. Everything else logs the failure and
 * lets the seed carry on — a partially-seeded database beats a container that
 * refuses to start because one optional section tripped over an edge case.
 */
async function step(name, fn, { critical = false } = {}) {
  process.stdout.write(`[seed] ${name}... `);
  try {
    const result = await fn();
    console.log('done.');
    return result;
  } catch (error) {
    console.log('FAILED.');
    console.error(`[seed]   ↳ ${name}:`, error?.message ?? error);
    if (critical) throw error;
    return null;
  }
}

async function main() {
  const summary = [];
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  /* ------------------------------------------------- 1. org structure & config */

  const departments = new Map();
  await step(
    'Departments',
    async () => {
      for (const name of DEPARTMENTS) {
        const row = await prisma.department.upsert({ where: { name }, update: {}, create: { name } });
        departments.set(name, row.id);
      }
      summary.push(`${DEPARTMENTS.length} departments`);
    },
    { critical: true }
  );

  const positions = new Map();
  await step('Job positions', async () => {
    for (const position of JOB_POSITIONS) {
      const data = { name: position.name, departmentId: departments.get(position.department) };
      const row = await prisma.jobPosition.upsert({ where: { name: position.name }, update: data, create: data });
      positions.set(position.name, row.id);
    }
    summary.push(`${JOB_POSITIONS.length} job positions`);
  });

  const schedules = new Map();
  await step(
    'Working schedules',
    async () => {
      for (const schedule of SCHEDULES) {
        const { days, ...rest } = schedule;
        // Days are replaced rather than merged so re-running the seed cannot
        // double the weekly hours.
        const row = await prisma.workingSchedule.upsert({ where: { name: rest.name }, update: rest, create: rest });
        await prisma.scheduleDay.deleteMany({ where: { scheduleId: row.id } });
        await prisma.scheduleDay.createMany({ data: days.map((day) => ({ ...day, scheduleId: row.id })) });
        schedules.set(rest.name, row.id);
      }
      summary.push(`${SCHEDULES.length} working schedules`);
    },
    { critical: true }
  );

  const types = new Map();
  await step('Time off types', async () => {
    for (const type of TIME_OFF_TYPES) {
      const row = await prisma.timeOffType.upsert({ where: { name: type.name }, update: type, create: type });
      types.set(type.name, row);
    }
    summary.push(`${TIME_OFF_TYPES.length} time off types`);
  });

  let ruleCount = 0;
  const structureIds = new Map();
  await step('Salary structures and rules', async () => {
    for (const structure of STRUCTURES) {
      const { rules, ...data } = structure;
      const row = await prisma.salaryStructure.upsert({ where: { name: data.name }, update: data, create: data });
      structureIds.set(data.name, row.id);
      // Rules are replaced rather than merged so re-running the seed cannot
      // leave a rule behind under an old code.
      await prisma.salaryRule.deleteMany({ where: { structureId: row.id } });
      for (const rule of rules) {
        await prisma.salaryRule.create({ data: { ...rule, structureId: row.id } });
        ruleCount += 1;
      }
    }
    summary.push(`${STRUCTURES.length} salary structures with ${ruleCount} rules`);
  });

  /* ------------------------------------------------------------- 2. employees */

  // `employees` is keyed by name — safe only for the 9 hand-written heroes,
  // whose names are guaranteed unique by construction. Generated employees'
  // names are cosmetic and can collide (real people share names too), so
  // every generated employee's id is also recorded positionally in
  // `generatedIds[i]` — that array, and `employeeMeta`, are the only safe way
  // to look one back up.
  const employees = new Map(); // hero name -> id
  const generatedIds = []; // generation index -> employee id
  const employeeMeta = []; // { id, name, wage, hasBankAccount } in generation order

  await step(
    `Employees (${HERO_COUNT} hero + ${GENERATED_COUNT} generated = ${HERO_COUNT + GENERATED_COUNT})`,
    async () => {
      async function upsertEmployee(data) {
        return prisma.employee.upsert({
          where: { workEmail: data.workEmail },
          update: data,
          create: data,
        });
      }

      for (const person of [...PEOPLE, ...PEOPLE_WITHOUT_ACCOUNTS]) {
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
        const row = await upsertEmployee(data);
        employees.set(person.name, row.id);
        if (person.wage) {
          employeeMeta.push({ id: row.id, name: person.name, wage: person.wage, hasBankAccount: Boolean(person.bankAccount) });
        }
      }

      // Managers for the heroes, exactly as originally authored.
      for (const person of [...PEOPLE, ...PEOPLE_WITHOUT_ACCOUNTS]) {
        if (!person.manager) continue;
        await prisma.employee.update({
          where: { workEmail: person.workEmail },
          data: { managerId: employees.get(person.manager) ?? null },
        });
      }

      // Finance and HR already have an obvious head among the heroes — Nisha
      // (Payroll Manager) and Sara (HR Officer, the manager the other heroes
      // already report to) — so those two departments are seeded here rather
      // than left to whichever generated employee happens to land there first.
      await prisma.department.update({ where: { id: departments.get('Finance') }, data: { managerId: employees.get('Nisha Rao') } });
      await prisma.department.update({ where: { id: departments.get('HR') }, data: { managerId: employees.get('Sara Khan') } });

      // Every other department gets a head automatically: the first generated
      // employee who lands in it. Everyone else in that department reports
      // to them.
      const deptHeadId = new Map([
        ['Finance', employees.get('Nisha Rao')],
        ['HR', employees.get('Sara Khan')],
      ]);
      for (let i = 0; i < GENERATED_COUNT; i += 1) {
        const person = generatedPerson(i);
        const data = {
          name: person.name,
          workEmail: person.workEmail,
          workPhone: person.workPhone,
          jobTitle: person.jobTitle,
          workLocation: person.workLocation,
          bankAccount: person.bankAccount,
          personalEmail: person.personalEmail,
          personalPhone: person.personalPhone,
          address: person.address,
          dateOfBirth: person.dateOfBirth,
          departmentId: departments.get(person.department) ?? null,
          jobPositionId: positions.get(person.jobPosition) ?? null,
          workingScheduleId: schedules.get(person.schedule) ?? null,
        };
        const row = await upsertEmployee(data);
        generatedIds[i] = row.id;
        employeeMeta.push({
          id: row.id,
          name: person.name,
          index: i, // generation index, used to spread hire dates across the payroll history
          wage: person.wage,
          hasBankAccount: Boolean(person.bankAccount),
          historyExtra: i < 29, // first 29 generated also get contract history
        });

        if (!deptHeadId.has(person.department)) {
          deptHeadId.set(person.department, row.id);
          // A department without a hero manager gets one now.
          const existingManagerId = (await prisma.department.findUnique({ where: { id: departments.get(person.department) }, select: { managerId: true } }))?.managerId;
          if (!existingManagerId) {
            await prisma.department.update({ where: { id: departments.get(person.department) }, data: { managerId: row.id } });
          }
        } else if (row.managerId === null) {
          await prisma.employee.update({ where: { id: row.id }, data: { managerId: deptHeadId.get(person.department) } });
        }
      }
    },
    { critical: true }
  );

  /* ------------------------------------------------------------------ 3. users */

  const USER_ACCOUNT_TARGET_GENERATED = 201; // + 9 heroes = 210 total accounts.
  await step(`User accounts (~${HERO_COUNT + USER_ACCOUNT_TARGET_GENERATED})`, async () => {
    let created = 0;
    for (const person of PEOPLE) {
      const employeeId = employees.get(person.name);
      await prisma.user.upsert({
        where: { email: person.workEmail },
        update: { roles: person.roles, active: true, employeeId },
        create: { email: person.workEmail, passwordHash, roles: person.roles, employeeId },
      });
      created += 1;
    }
    for (let i = 0; i < USER_ACCOUNT_TARGET_GENERATED; i += 1) {
      const person = generatedPerson(i);
      const employeeId = generatedIds[i];
      if (!employeeId) continue;
      await prisma.user.upsert({
        where: { email: person.workEmail },
        update: { roles: ['EMPLOYEE'], active: true, employeeId },
        create: { email: person.workEmail, passwordHash, roles: ['EMPLOYEE'], employeeId },
      });
      created += 1;
    }
    summary.push(`${created} user accounts (password "${DEFAULT_PASSWORD}")`);
  });

  /* -------------------------------------------------------------- 4. contracts */

  await step('Contracts', async () => {
    const contractStart = relativeYears(-2);
    const priorStart = relativeYears(-2);
    priorStart.setUTCMonth(priorStart.getUTCMonth() - 6);
    const priorEnd = relativeDays(-1);
    priorEnd.setTime(contractStart.getTime() - 24 * 60 * 60 * 1000); // the day before the current contract starts

    // References use a "SEED-" marker instead of the app's own zero-padded
    // sequence format (CON/YYYY/0042), so a bulk-seeded reference can never
    // collide with one a real user creates later through the UI — no matter
    // what number the real CONTRACT sequence counter is on. That means the
    // Sequence table is deliberately left untouched here.
    let running = 0;
    let historical = 0;

    for (const person of employeeMeta) {
      const reference = `CON/${contractStart.getUTCFullYear()}/SEED-${person.id}`;
      const data = { employeeId: person.id, startDate: contractStart, endDate: null, wage: person.wage, status: 'RUNNING' };
      await prisma.contract.upsert({ where: { reference }, update: data, create: { ...data, reference } });
      running += 1;

      if (person.historyExtra) {
        const priorReference = `CON/${priorStart.getUTCFullYear()}/SEED-${person.id}-H`;
        const priorData = {
          employeeId: person.id,
          startDate: priorStart,
          endDate: priorEnd,
          wage: Math.round((person.wage * 0.85) / 500) * 500,
          status: 'EXPIRED',
          notes: 'Superseded by the current contract.',
        };
        await prisma.contract.upsert({ where: { reference: priorReference }, update: priorData, create: { ...priorData, reference: priorReference } });
        historical += 1;
      }
    }

    // Aarav's original expired contract, kept for continuity with existing
    // documentation and manual test notes — same reference scheme as above.
    const aaravId = employees.get('Aarav Mehta');
    const aaravPrevious = {
      employeeId: aaravId,
      startDate: priorStart,
      endDate: priorEnd,
      wage: 78000,
      status: 'EXPIRED',
      departmentId: departments.get('Finance'),
      jobPositionId: positions.get('Payroll Specialist'),
      workingScheduleId: schedules.get('40 Hours / Week'),
      notes: 'Superseded by the current contract.',
    };
    const aaravReference = `CON/${priorStart.getUTCFullYear()}/SEED-${aaravId}-H`;
    await prisma.contract.upsert({
      where: { reference: aaravReference },
      update: aaravPrevious,
      create: { ...aaravPrevious, reference: aaravReference },
    });
    historical += 1;

    summary.push(`${running + historical} contracts (${historical} with history)`);
  });

  /* ------------------------------------------------------------- 5. attendance */

  await step('Attendance', async () => {
    // A representative slice: every hero with a wage, plus the first batch of
    // generated employees, spread across a handful of departments.
    const subject = employeeMeta.filter((p) => p.name !== 'System Administrator').slice(0, 40);
    const workDays = lastWorkingDays(7);

    // Full refresh: attendance is recent-window data by nature, so replacing
    // it wholesale on every seed run is the correct behaviour, not a hazard —
    // there is no "history" here worth preserving across reseeds.
    await prisma.attendance.deleteMany({});

    let rows = 0;
    for (const [dayIndex, day] of workDays.entries()) {
      for (const [index, person] of subject.entries()) {
        const seed = (dayIndex + index) % 11;

        if (seed === 7) {
          await prisma.attendance.create({ data: { employeeId: person.id, date: day, status: 'ABSENT', note: 'Unplanned absence' } });
          rows += 1;
          continue;
        }

        const lateMinutes = seed === 3 ? 35 : seed === 8 ? 22 : seed % 4;
        const checkIn = istInstant(day, 9, lateMinutes);
        // The most recent day leaves one session open — "still checked in".
        const leaveOpen = dayIndex === workDays.length - 1 && index === 0;
        const checkOut = leaveOpen ? null : istInstant(day, 18, seed === 5 ? 40 : 10);
        const worked = checkOut ? hoursBetween(checkIn, checkOut) : 0;
        const overtime = checkOut ? Math.max(0, Math.round((worked - 8) * 100) / 100) : 0;

        await prisma.attendance.create({
          data: {
            employeeId: person.id,
            date: day,
            checkIn,
            checkOut,
            status: lateMinutes > 10 ? 'LATE' : 'PRESENT',
            workedHours: worked,
            overtimeHours: overtime,
          },
        });
        rows += 1;
      }
    }
    summary.push(`${rows} attendance records over the last ${workDays.length} working days`);
  });

  /* ---------------------------------------------------------------- 6. leave */

  const allocationIds = new Map(); // employeeId -> paid allocation id

  await step('Time off allocations', async () => {
    // Full refresh, same reasoning as attendance: this is a live balance, not
    // history worth preserving across a demo reseed.
    await prisma.timeOffRequest.deleteMany({});
    await prisma.timeOffAllocation.deleteMany({});

    const subject = employeeMeta.filter((p) => p.name !== 'System Administrator').slice(0, 130);
    const validFrom = firstOfMonth(-6);
    const validTo = lastOfMonth(6);
    let rows = 0;

    for (const [index, person] of subject.entries()) {
      const paid = await prisma.timeOffAllocation.create({
        data: {
          employeeId: person.id,
          typeId: types.get('Paid Time Off').id,
          amount: 20,
          status: 'APPROVED',
          approverId: employees.get('Sara Khan'),
          validFrom,
          validTo,
          description: 'Annual leave balance granted at the start of the policy year.',
        },
      });
      allocationIds.set(person.id, paid.id);
      rows += 1;

      // One allocation per subject is left awaiting approval, so the screen
      // has a decision to make rather than a list where everything is settled.
      await prisma.timeOffAllocation.create({
        data: {
          employeeId: person.id,
          typeId: types.get('Comp Off').id,
          amount: 16,
          status: index === 0 ? 'TO_APPROVE' : 'APPROVED',
          approverId: index === 0 ? null : employees.get('Nisha Rao'),
          validFrom,
          validTo,
          description: 'Compensatory hours earned against overtime.',
        },
      });
      rows += 1;
    }
    summary.push(`${rows} time off allocations`);
  });

  await step('Time off requests', async () => {
    const subject = employeeMeta.filter((p) => p.name !== 'System Administrator').slice(0, 130);
    const scheduleDays = (await prisma.workingSchedule.findUnique({
      where: { name: '40 Hours / Week' },
      select: { days: { select: { dayOfWeek: true, startMinutes: true, endMinutes: true, breakMinutes: true } } },
    }))?.days;

    const STATUS_CYCLE = ['APPROVED', 'APPROVED', 'TO_APPROVE', 'REFUSED'];
    const TYPE_CYCLE = ['Paid Time Off', 'Paid Time Off', 'Sick Leave', 'Comp Off'];
    let rows = 0;

    // Each subject gets two requests spread across a rolling window centred
    // on today, so the list always shows a mix of past, current and upcoming
    // leave regardless of when the seed is run.
    for (const [index, person] of subject.entries()) {
      for (let slot = 0; slot < 2; slot += 1) {
        const cycle = index * 2 + slot;
        const typeName = TYPE_CYCLE[cycle % TYPE_CYCLE.length];
        const type = types.get(typeName);
        const status = STATUS_CYCLE[cycle % STATUS_CYCLE.length];

        // Anchored on a Monday-ish offset so the range never lands only on a
        // weekend, which would make duration zero and the request pointless.
        const weekOffset = (cycle % 40) - 20; // -20..19 weeks around today
        const spanDays = 1 + (cycle % 4); // 1-4 days
        const startDate = mondayNear(relativeDays(weekOffset * 7));
        const endDate = relativeDays((startDate.getTime() - TODAY.getTime()) / 86400000 + spanDays - 1);

        const duration = requestDuration({ unit: type.unit, startDate, endDate, scheduleDays });
        if (duration <= 0) continue;

        const allocationId =
          status === 'APPROVED' && type.requiresAllocation ? (allocationIds.get(person.id) ?? null) : null;

        await prisma.timeOffRequest.create({
          data: {
            employeeId: person.id,
            typeId: type.id,
            startDate,
            endDate,
            duration,
            status,
            reason: `${typeName} request`,
            approverId: status === 'TO_APPROVE' ? null : employees.get('Sara Khan'),
            allocationId,
          },
        });
        rows += 1;
      }
    }
    summary.push(`${rows} time off requests`);
  });

  /* ------------------------------------------------------------- 7. payroll */

  // Twelve months of payroll history — one payrun per month, matching the
  // dashboard's 12-month period selector exactly, so every period in that
  // dropdown shows real numbers instead of "no payslips in this period yet".
  // Headcount grows month over month (a "hireMonth" per employee, earlier
  // generation index = longer tenure), so the department bars, the monthly
  // trend chart and the payslip counts are all genuinely different from one
  // month to the next — not the same total repeated twelve times.
  const PAYROLL_MONTHS = 12;

  await step(`Payroll — ${PAYROLL_MONTHS} months of history`, async () => {
    const structureId = structureIds.get('Regular Salary');
    const payable = employeeMeta.filter((p) => p.name !== 'System Administrator');

    // Heroes have been "employed" since month -11 (day one); generated
    // employees are hired on a steady ramp from month -11 up to this month,
    // so the company visibly grows from a small founding team to full size.
    const hireOffset = new Map();
    for (const p of payable) {
      if (p.index === undefined) {
        hireOffset.set(p.id, -(PAYROLL_MONTHS - 1));
      } else {
        const ramp = Math.floor((p.index / GENERATED_COUNT) * (PAYROLL_MONTHS - 1));
        hireOffset.set(p.id, -(PAYROLL_MONTHS - 1) + ramp);
      }
    }

    async function resetNamedPayrun(name) {
      const existing = await prisma.payrun.findFirst({ where: { name } });
      if (!existing) return;
      // Payslip.payrunId is SetNull on delete, so the payslips must be removed
      // explicitly first or a reseed would leave orphaned rows behind.
      await prisma.payslip.deleteMany({ where: { payrunId: existing.id } });
      await prisma.payrun.delete({ where: { id: existing.id } });
    }

    let payslipCount = 0;
    const perMonth = [];

    for (let m = -(PAYROLL_MONTHS - 1); m <= 0; m += 1) {
      const name = `${monthName(m)} Payroll`;
      await resetNamedPayrun(name);

      const hired = payable.filter((p) => hireOffset.get(p.id) <= m);
      // Every past month is a clean, fully-paid payrun — only employees with a
      // bank account are included, so it can go all the way to Paid. The
      // current month is the one still being worked on: everybody eligible so
      // far is in it, missing bank accounts and all, which is exactly what
      // gives the dashboard's alerts something real to show.
      const isCurrent = m === 0;
      const employeeIds = (isCurrent ? hired : hired.filter((p) => p.hasBankAccount)).map((p) => p.id);
      if (employeeIds.length === 0) continue;

      const payrun = await createPayrun({
        name,
        structureId,
        periodStart: firstOfMonth(m),
        periodEnd: lastOfMonth(m),
        employeeIds,
      });
      await computePayrun(payrun.id);
      if (!isCurrent) {
        await setPayrunStatus(payrun.id, 'VALIDATED');
        await setPayrunStatus(payrun.id, 'PAID');
      }

      payslipCount += employeeIds.length;
      perMonth.push(`${monthName(m)}: ${employeeIds.length}`);
    }

    summary.push(`${PAYROLL_MONTHS} payruns, ${payslipCount} payslips total (${perMonth.join(', ')})`);
  });

  /* ----------------------------------------------------------------- done */

  console.log('\n[seed] Summary:');
  for (const line of summary) console.log(`  - ${line}`);
  console.log(`\n[seed] Sign in as admin@oxp.com with the password "${DEFAULT_PASSWORD}".`);
}

/** The Monday of the week containing `date`. */
function mondayNear(date) {
  const d = new Date(date);
  const weekday = d.getUTCDay(); // 0 = Sunday
  const diff = weekday === 0 ? -6 : 1 - weekday;
  d.setUTCDate(d.getUTCDate() + diff);
  return toUtcMidnight(d);
}

/** "August 2026" style label for a payrun name, `offsetMonths` from today. */
function monthName(offsetMonths) {
  const d = firstOfMonth(offsetMonths);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

main()
  .catch((error) => {
    // Only a foundational failure (departments/schedules/employees) reaches
    // here, since every other step already catches its own errors. That is
    // the one case worth a non-zero exit: nothing else in the app can work
    // without at least the org structure and the people in it.
    console.error('[seed] A foundational step failed — the database is not usable:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
