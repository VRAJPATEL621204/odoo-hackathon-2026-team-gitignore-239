import { Router } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import { readId } from '../lib/params.js';
import { validator } from '../lib/validate.js';
import { parsePageParams, parseSearch } from '../lib/pagination.js';
import { parseDateOnly } from '../lib/dates.js';
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
  attendanceSummaryFor,
  checkIn,
  checkOut,
  createAttendance,
  getAttendance,
  listAttendance,
  updateAttendance,
} from '../services/attendance.service.js';

export const attendanceRouter = Router();

// The list and record routes are shared: a caller with ATTENDANCE_READ sees
// everyone, a self-service-only employee sees just their own rows (pinned by
// `attendanceScope`).
const canRead = [
  requireAuth,
  requireAnyPermission(PERMISSIONS.ATTENDANCE_READ, PERMISSIONS.SELF_SERVICE),
];
const canWrite = [requireAuth, requirePermission(PERMISSIONS.ATTENDANCE_WRITE)];

/** The employee id the read routes are pinned to, or undefined for ATTENDANCE_READ. */
function attendanceScope(req) {
  return selfScopeId(req, PERMISSIONS.ATTENDANCE_READ);
}

/* --------------------------------------------------------- the widget's own */

/**
 * The signed-in user's own attendance. Available to everybody with self
 * service, because checking yourself in is not an HR action.
 *
 * A user account always points at an employee, so `req.user.employeeId` is the
 * only identity these three routes accept — nobody can check somebody else in
 * by passing an id.
 */
const selfService = [requireAuth, requirePermission(PERMISSIONS.SELF_SERVICE)];

attendanceRouter.get(
  '/attendance/me',
  selfService,
  asyncHandler(async (req, res) => {
    res.json(await attendanceSummaryFor(req.user.employeeId));
  })
);

attendanceRouter.post(
  '/attendance/me/check-in',
  selfService,
  asyncHandler(async (req, res) => {
    const record = await checkIn(req.user.employeeId);
    res.status(201).json({ record, summary: await attendanceSummaryFor(req.user.employeeId) });
  })
);

attendanceRouter.post(
  '/attendance/me/check-out',
  selfService,
  asyncHandler(async (req, res) => {
    const record = await checkOut(req.user.employeeId);
    res.json({ record, summary: await attendanceSummaryFor(req.user.employeeId) });
  })
);

/* ------------------------------------------------------------- the module */

attendanceRouter.get(
  '/attendance',
  canRead,
  asyncHandler(async (req, res) => {
    const scopeId = attendanceScope(req);
    const employeeId = scopeId ?? (Number(req.query.employeeId) || undefined);
    const status = ['PRESENT', 'LATE', 'ABSENT'].includes(req.query.status)
      ? req.query.status
      : undefined;

    res.json(
      await listAttendance({
        search: parseSearch(req.query),
        employeeId,
        status,
        from: parseDateOnly(req.query.from) ?? undefined,
        to: parseDateOnly(req.query.to) ?? undefined,
        ...parsePageParams(req.query),
      })
    );
  })
);

attendanceRouter.get(
  '/attendance/:id',
  canRead,
  asyncHandler(async (req, res) => {
    const row = await getAttendance(readId(req.params.id));
    assertInScope(attendanceScope(req), row.employee.id);
    res.json(row);
  })
);

/**
 * Reads a manual record.
 *
 * `date` matters only for an absence: when there is a check-in, the business
 * day is taken from it, so the two can never disagree.
 */
function readAttendance(body, { required }) {
  const check = validator(body);
  check.id('employeeId', { required });
  check.timestamp('checkIn');
  check.timestamp('checkOut');
  check.date('date');
  check.string('note', { max: 300 });
  if (body.status !== undefined) {
    check.enum('status', ['PRESENT', 'LATE', 'ABSENT'], { required: true });
  }

  const values = check.result();
  // An explicit null clears a time; leaving the key out keeps what is stored.
  if (body.checkIn === null || body.checkIn === '') values.checkIn = null;
  if (body.checkOut === null || body.checkOut === '') values.checkOut = null;
  return values;
}

attendanceRouter.post(
  '/attendance',
  canWrite,
  asyncHandler(async (req, res) => {
    res.status(201).json(await createAttendance(readAttendance(req.body, { required: true })));
  })
);

attendanceRouter.patch(
  '/attendance/:id',
  canWrite,
  asyncHandler(async (req, res) => {
    res.json(await updateAttendance(readId(req.params.id), readAttendance(req.body, { required: false })));
  })
);

/**
 * Deleting an attendance record is deliberately not offered.
 *
 * Attendance feeds payroll and the dashboard; a wrong record is corrected so
 * the correction is visible as such, rather than removed so it is not.
 */
attendanceRouter.delete('/attendance/:id', canWrite, () => {
  throw forbidden(
    'Attendance records are corrected, not deleted, so the change stays visible.',
    'DELETE_NOT_ALLOWED'
  );
});
