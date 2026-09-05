import { Router } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import { readId } from '../lib/params.js';
import { validator } from '../lib/validate.js';
import { parsePageParams, parseSearch } from '../lib/pagination.js';
import { validationError } from '../lib/errors.js';
import { env } from '../lib/env.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { PERMISSIONS } from '../domain/roles.js';
import { WEEKDAYS } from '../domain/schedule.js';
import { validatePeriod } from '../domain/contract.js';
import {
  createDepartment,
  departmentOptions,
  getDepartment,
  listDepartments,
  updateDepartment,
} from '../services/department.service.js';
import {
  createJobPosition,
  getJobPosition,
  jobPositionOptions,
  listJobPositions,
  updateJobPosition,
} from '../services/jobPosition.service.js';
import {
  createWorkingSchedule,
  getWorkingSchedule,
  listWorkingSchedules,
  updateWorkingSchedule,
  workingScheduleOptions,
} from '../services/workingSchedule.service.js';
import {
  createEmployee,
  employeeOptions,
  getEmployee,
  listEmployees,
  updateEmployee,
} from '../services/employee.service.js';
import {
  contractsForEmployee,
  createContract,
  getContract,
  listContracts,
  updateContract,
} from '../services/contract.service.js';

export const hrRouter = Router();

const canRead = [requireAuth, requirePermission(PERMISSIONS.EMPLOYEES_READ)];
const canWrite = [requireAuth, requirePermission(PERMISSIONS.EMPLOYEES_WRITE)];

/* ------------------------------------------------------------------ lookups */

/**
 * Every picker the HR forms need, in one request.
 *
 * The employee form alone needs departments, job positions, managers and
 * schedules; fetching them separately would be four round trips per form open.
 */
hrRouter.get(
  '/hr/options',
  canRead,
  asyncHandler(async (_req, res) => {
    const [departments, jobPositions, schedules, employees] = await Promise.all([
      departmentOptions(),
      jobPositionOptions(),
      workingScheduleOptions(),
      employeeOptions(),
    ]);

    res.json({
      departments,
      jobPositions,
      schedules,
      employees,
      weekdays: WEEKDAYS,
      company: env.companyName,
    });
  })
);

/* -------------------------------------------------------------- departments */

hrRouter.get(
  '/departments',
  canRead,
  asyncHandler(async (req, res) => {
    res.json(
      await listDepartments({ search: parseSearch(req.query), ...parsePageParams(req.query) })
    );
  })
);

hrRouter.get(
  '/departments/:id',
  canRead,
  asyncHandler(async (req, res) => {
    res.json(await getDepartment(readId(req.params.id)));
  })
);

/** Relations are cleared with an explicit null rather than by omission. */
function nullableIds(body, values, keys) {
  for (const key of keys) {
    if (body[key] === null || body[key] === '') values[key] = null;
  }
  return values;
}

function readDepartment(body, { required }) {
  const check = validator(body);
  check.string('name', { required, min: 2, max: 100 });
  check.id('managerId');
  return nullableIds(body, check.result(), ['managerId']);
}

hrRouter.post(
  '/departments',
  canWrite,
  asyncHandler(async (req, res) => {
    res.status(201).json(await createDepartment(readDepartment(req.body, { required: true })));
  })
);

hrRouter.patch(
  '/departments/:id',
  canWrite,
  asyncHandler(async (req, res) => {
    res.json(
      await updateDepartment(readId(req.params.id), readDepartment(req.body, { required: false }))
    );
  })
);

/* ------------------------------------------------------------ job positions */

hrRouter.get(
  '/job-positions',
  canRead,
  asyncHandler(async (req, res) => {
    res.json(
      await listJobPositions({ search: parseSearch(req.query), ...parsePageParams(req.query) })
    );
  })
);

hrRouter.get(
  '/job-positions/:id',
  canRead,
  asyncHandler(async (req, res) => {
    res.json(await getJobPosition(readId(req.params.id)));
  })
);

function readJobPosition(body, { required }) {
  const check = validator(body);
  check.string('name', { required, min: 2, max: 100 });
  check.string('description', { max: 500 });
  check.id('departmentId');
  if (body.active !== undefined) check.boolean('active', { required: true });
  return nullableIds(body, check.result(), ['departmentId']);
}

hrRouter.post(
  '/job-positions',
  canWrite,
  asyncHandler(async (req, res) => {
    res.status(201).json(await createJobPosition(readJobPosition(req.body, { required: true })));
  })
);

hrRouter.patch(
  '/job-positions/:id',
  canWrite,
  asyncHandler(async (req, res) => {
    res.json(
      await updateJobPosition(readId(req.params.id), readJobPosition(req.body, { required: false }))
    );
  })
);

/* -------------------------------------------------------- working schedules */

hrRouter.get(
  '/schedules',
  canRead,
  asyncHandler(async (req, res) => {
    res.json(
      await listWorkingSchedules({ search: parseSearch(req.query), ...parsePageParams(req.query) })
    );
  })
);

hrRouter.get(
  '/schedules/:id',
  canRead,
  asyncHandler(async (req, res) => {
    res.json(await getWorkingSchedule(readId(req.params.id)));
  })
);

/**
 * Reads the weekly pattern.
 *
 * Each line is checked as a whole by domain/schedule.js; this only confirms the
 * numbers are numbers, so the domain module stays the single definition of what
 * makes a working day valid.
 */
function readDays(body) {
  if (body.days === undefined) return undefined;
  if (!Array.isArray(body.days)) throw validationError({ days: 'Must be a list of days.' });

  return body.days.map((day, index) => {
    const check = validator(day);
    check.number('dayOfWeek', { required: true, min: 0, max: 6, integer: true });
    check.number('startMinutes', { required: true, min: 0, max: 1440, integer: true });
    check.number('endMinutes', { required: true, min: 0, max: 1440, integer: true });
    check.number('breakMinutes', { min: 0, max: 1440, integer: true });
    if (check.hasErrors) {
      throw validationError({ [`days.${index}`]: 'This day is incomplete.' });
    }
    const values = check.result();
    return { ...values, breakMinutes: values.breakMinutes ?? 0 };
  });
}

function readSchedule(body, { required }) {
  const check = validator(body);
  check.string('name', { required, min: 2, max: 100 });
  check.string('timezone', { max: 60 });
  if (body.active !== undefined) check.boolean('active', { required: true });
  return { ...check.result(), days: readDays(body) };
}

hrRouter.post(
  '/schedules',
  canWrite,
  asyncHandler(async (req, res) => {
    const { days, ...data } = readSchedule(req.body, { required: true });
    res.status(201).json(await createWorkingSchedule({ ...data, days: days ?? [] }));
  })
);

hrRouter.patch(
  '/schedules/:id',
  canWrite,
  asyncHandler(async (req, res) => {
    res.json(
      await updateWorkingSchedule(readId(req.params.id), readSchedule(req.body, { required: false }))
    );
  })
);

/* ---------------------------------------------------------------- employees */

hrRouter.get(
  '/employees',
  canRead,
  asyncHandler(async (req, res) => {
    const departmentId = Number(req.query.departmentId) || undefined;
    const status = ['ACTIVE', 'INACTIVE'].includes(req.query.status) ? req.query.status : undefined;
    res.json(
      await listEmployees({
        search: parseSearch(req.query),
        departmentId,
        status,
        ...parsePageParams(req.query),
      })
    );
  })
);

hrRouter.get(
  '/employees/:id',
  canRead,
  asyncHandler(async (req, res) => {
    res.json(await getEmployee(readId(req.params.id)));
  })
);

/** Contract history behind the employee form's Contracts smart button. */
hrRouter.get(
  '/employees/:id/contracts',
  canRead,
  asyncHandler(async (req, res) => {
    res.json({ items: await contractsForEmployee(readId(req.params.id)) });
  })
);

function readEmployee(body, { required }) {
  const check = validator(body);
  check.string('name', { required, min: 2, max: 120 });
  check.email('workEmail', { required });
  check.string('workPhone', { max: 40 });
  check.string('jobTitle', { max: 120 });
  check.string('workLocation', { max: 120 });
  check.id('departmentId');
  check.id('jobPositionId');
  check.id('managerId');
  check.id('workingScheduleId');
  check.string('personalEmail', { max: 254 });
  check.string('personalPhone', { max: 40 });
  check.string('address', { max: 300 });
  check.date('dateOfBirth');
  check.string('bankAccount', { max: 60 });
  if (body.status !== undefined) check.enum('status', ['ACTIVE', 'INACTIVE'], { required: true });

  return nullableIds(body, check.result(), [
    'departmentId',
    'jobPositionId',
    'managerId',
    'workingScheduleId',
    'dateOfBirth',
  ]);
}

hrRouter.post(
  '/employees',
  canWrite,
  asyncHandler(async (req, res) => {
    res.status(201).json(await createEmployee(readEmployee(req.body, { required: true })));
  })
);

hrRouter.patch(
  '/employees/:id',
  canWrite,
  asyncHandler(async (req, res) => {
    const id = readId(req.params.id);
    const data = readEmployee(req.body, { required: false });

    // An employee reporting to themselves would make the org chart cyclic.
    if (data.managerId === id) {
      throw validationError({ managerId: 'An employee cannot be their own manager.' });
    }

    res.json(await updateEmployee(id, data));
  })
);

/* ---------------------------------------------------------------- contracts */

hrRouter.get(
  '/contracts',
  canRead,
  asyncHandler(async (req, res) => {
    const employeeId = Number(req.query.employeeId) || undefined;
    const status = ['DRAFT', 'RUNNING', 'EXPIRED'].includes(req.query.status)
      ? req.query.status
      : undefined;
    res.json(
      await listContracts({
        search: parseSearch(req.query),
        employeeId,
        status,
        ...parsePageParams(req.query),
      })
    );
  })
);

hrRouter.get(
  '/contracts/:id',
  canRead,
  asyncHandler(async (req, res) => {
    res.json(await getContract(readId(req.params.id)));
  })
);

function readContract(body, { required }) {
  const check = validator(body);
  check.id('employeeId', { required });
  check.date('startDate', { required });
  check.date('endDate');
  check.number('wage', { required, min: 0, max: 100000000 });
  check.id('departmentId');
  check.id('jobPositionId');
  check.id('workingScheduleId');
  check.string('notes', { max: 500 });
  if (body.status !== undefined || required) {
    check.enum('status', ['DRAFT', 'RUNNING', 'EXPIRED'], { required });
  }

  const values = check.result();

  if (values.startDate && values.endDate) {
    const message = validatePeriod(values.startDate, values.endDate);
    if (message) throw validationError({ endDate: message });
  }

  return nullableIds(body, values, [
    'endDate',
    'departmentId',
    'jobPositionId',
    'workingScheduleId',
  ]);
}

hrRouter.post(
  '/contracts',
  canWrite,
  asyncHandler(async (req, res) => {
    const data = readContract(req.body, { required: true });
    res.status(201).json(await createContract({ status: 'DRAFT', ...data }));
  })
);

hrRouter.patch(
  '/contracts/:id',
  canWrite,
  asyncHandler(async (req, res) => {
    res.json(
      await updateContract(readId(req.params.id), readContract(req.body, { required: false }))
    );
  })
);
