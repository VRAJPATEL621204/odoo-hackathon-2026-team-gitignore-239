import { Router } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import { readId } from '../lib/params.js';
import { validator } from '../lib/validate.js';
import { parsePageParams, parseSearch } from '../lib/pagination.js';
import { parseDateOnly } from '../lib/dates.js';
import { conflict } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { PERMISSIONS } from '../domain/roles.js';
import { validateFormula } from '../domain/formula.js';
import { payslipFilename, renderPayslipPdf } from '../lib/payslipPdf.js';
import { sendPayslipEmail } from '../lib/mailer.js';
import {
  createRule,
  createStructure,
  deleteRule,
  getRule,
  getStructure,
  listRules,
  listStructures,
  structureOptions,
  updateRule,
  updateStructure,
} from '../services/salaryStructure.service.js';
import {
  computeOnePayslip,
  computePayrun,
  createPayrun,
  eligibleEmployees,
  getPayrun,
  getPayslip,
  listPayruns,
  listPayslips,
  markPayslipSent,
  setPayrunStatus,
  setPayslipStatus,
} from '../services/payroll.service.js';

export const payrollRouter = Router();

const canRead = [requireAuth, requirePermission(PERMISSIONS.PAYROLL_READ)];
const canProcess = [requireAuth, requirePermission(PERMISSIONS.PAYROLL_PROCESS)];
const canConfigure = [requireAuth, requirePermission(PERMISSIONS.PAYROLL_CONFIGURE)];

const CATEGORIES = ['BASIC', 'ALLOWANCE', 'GROSS', 'DEDUCTION', 'NET'];
const COMPUTATIONS = ['FIXED', 'PERCENTAGE', 'FORMULA'];
const BASES = ['CONTRACT_WAGE', 'BASIC', 'GROSS'];

/* ------------------------------------------------------ salary structures */

payrollRouter.get(
  '/payroll/structures',
  canRead,
  asyncHandler(async (req, res) => {
    res.json(await listStructures({ search: parseSearch(req.query), ...parsePageParams(req.query) }));
  })
);

/** The structure picker on the payrun wizard. */
payrollRouter.get(
  '/payroll/structure-options',
  canRead,
  asyncHandler(async (_req, res) => {
    res.json({ items: await structureOptions() });
  })
);

payrollRouter.get(
  '/payroll/structures/:id',
  canRead,
  asyncHandler(async (req, res) => {
    res.json(await getStructure(readId(req.params.id)));
  })
);

function readStructure(body, { required }) {
  const check = validator(body);
  check.string('name', { required, min: 2, max: 100 });
  check.string('notes', { max: 500 });
  if (body.active !== undefined) check.boolean('active', { required: true });
  return check.result();
}

payrollRouter.post(
  '/payroll/structures',
  canConfigure,
  asyncHandler(async (req, res) => {
    res.status(201).json(await createStructure(readStructure(req.body, { required: true })));
  })
);

payrollRouter.patch(
  '/payroll/structures/:id',
  canConfigure,
  asyncHandler(async (req, res) => {
    res.json(await updateStructure(readId(req.params.id), readStructure(req.body, { required: false })));
  })
);

/* ------------------------------------------------------------ salary rules */

payrollRouter.get(
  '/payroll/rules',
  canRead,
  asyncHandler(async (req, res) => {
    res.json(
      await listRules({
        search: parseSearch(req.query),
        structureId: Number(req.query.structureId) || undefined,
        category: CATEGORIES.includes(req.query.category) ? req.query.category : undefined,
        ...parsePageParams(req.query),
      })
    );
  })
);

/** Checks an expression from the rule form without saving anything. */
payrollRouter.post(
  '/payroll/rules/validate-formula',
  canRead,
  asyncHandler(async (req, res) => {
    const message = validateFormula(req.body?.formula);
    res.json({ valid: message === null, message });
  })
);

payrollRouter.get(
  '/payroll/rules/:id',
  canRead,
  asyncHandler(async (req, res) => {
    res.json(await getRule(readId(req.params.id)));
  })
);

function readRule(body, { required }) {
  const check = validator(body);
  check.id('structureId', { required });
  check.string('name', { required, min: 2, max: 100 });
  check.string('code', { required, min: 2, max: 30 });
  check.enum('category', CATEGORIES, { required });
  check.number('sequence', { required, min: 1, max: 9999, integer: true });
  check.enum('computation', COMPUTATIONS, { required });
  check.number('amount', { min: -10000000, max: 10000000 });
  check.number('percentage', { min: -1000, max: 1000 });
  check.enum('percentageBase', BASES);
  check.string('formula', { max: 500 });
  check.number('quantity', { min: 0, max: 1000 });
  check.string('notes', { max: 500 });
  if (body.active !== undefined) check.boolean('active', { required: true });

  const values = check.result();

  // A code is what a formula refers to, so it is stored in one form only.
  if (values.code) values.code = values.code.toUpperCase().replace(/\s+/g, '_');

  // The fields belonging to the other computation methods are cleared, so a
  // rule switched from percentage to fixed does not keep a stale percentage.
  if (values.computation === 'FIXED') {
    values.percentage = null;
    values.percentageBase = null;
    values.formula = null;
  } else if (values.computation === 'PERCENTAGE') {
    values.amount = null;
    values.formula = null;
  } else if (values.computation === 'FORMULA') {
    values.amount = null;
    values.percentage = null;
    values.percentageBase = null;
  }

  return values;
}

payrollRouter.post(
  '/payroll/rules',
  canConfigure,
  asyncHandler(async (req, res) => {
    res.status(201).json(await createRule(readRule(req.body, { required: true })));
  })
);

payrollRouter.patch(
  '/payroll/rules/:id',
  canConfigure,
  asyncHandler(async (req, res) => {
    res.json(await updateRule(readId(req.params.id), readRule(req.body, { required: false })));
  })
);

payrollRouter.delete(
  '/payroll/rules/:id',
  canConfigure,
  asyncHandler(async (req, res) => {
    await deleteRule(readId(req.params.id));
    res.status(204).end();
  })
);

/* ----------------------------------------------------------------- payruns */

payrollRouter.get(
  '/payroll/payruns',
  canRead,
  asyncHandler(async (req, res) => {
    res.json(
      await listPayruns({
        search: parseSearch(req.query),
        status: ['DRAFT', 'COMPUTED', 'VALIDATED', 'PAID'].includes(req.query.status)
          ? req.query.status
          : undefined,
        year: Number(req.query.year) || undefined,
        ...parsePageParams(req.query),
      })
    );
  })
);

/**
 * The employees the wizard offers for a period.
 *
 * Answered before the payrun exists, which is what lets the first step of the
 * wizard collect the scope without creating anything.
 */
payrollRouter.get(
  '/payroll/eligible-employees',
  canProcess,
  asyncHandler(async (req, res) => {
    const check = validator(req.query);
    check.date('periodStart', { required: true });
    check.date('periodEnd', { required: true });
    const { periodStart, periodEnd } = check.result();

    res.json({ items: await eligibleEmployees({ periodStart, periodEnd }) });
  })
);

payrollRouter.get(
  '/payroll/payruns/:id',
  canRead,
  asyncHandler(async (req, res) => {
    res.json(await getPayrun(readId(req.params.id)));
  })
);

payrollRouter.post(
  '/payroll/payruns',
  canProcess,
  asyncHandler(async (req, res) => {
    const check = validator(req.body);
    check.string('name', { required: true, min: 2, max: 100 });
    check.id('structureId', { required: true });
    check.date('periodStart', { required: true });
    check.date('periodEnd', { required: true });
    check.array('employeeIds', { required: true, min: 1, max: 500 });
    const values = check.result();

    const employeeIds = [...new Set(values.employeeIds.map(Number))].filter(Number.isInteger);
    res.status(201).json(await createPayrun({ ...values, employeeIds }));
  })
);

payrollRouter.post(
  '/payroll/payruns/:id/compute',
  canProcess,
  asyncHandler(async (req, res) => {
    res.json(await computePayrun(readId(req.params.id)));
  })
);

payrollRouter.post(
  '/payroll/payruns/:id/status',
  canProcess,
  asyncHandler(async (req, res) => {
    const check = validator(req.body);
    check.enum('status', ['DRAFT', 'COMPUTED', 'VALIDATED', 'PAID'], { required: true });
    const { status } = check.result();
    res.json(await setPayrunStatus(readId(req.params.id), status));
  })
);

/**
 * Emails every payslip in the payrun, each with its own PDF.
 *
 * One employee with a bad address must not stop the batch, so each send reports
 * its own outcome and the response says what went and what did not.
 */
payrollRouter.post(
  '/payroll/payruns/:id/send',
  canProcess,
  asyncHandler(async (req, res) => {
    const payrun = await getPayrun(readId(req.params.id));

    if (payrun.status === 'DRAFT') {
      throw conflict(
        'PAYRUN_NOT_COMPUTED',
        'Compute the payrun before sending payslips, or people would receive empty ones.'
      );
    }

    const results = [];
    for (const summary of payrun.payslips) {
      const payslip = await getPayslip(summary.id);
      const pdf = await renderPayslipPdf(payslip);
      const result = await sendPayslipEmail({
        payslip,
        pdf,
        filename: payslipFilename(payslip),
      });
      if (result.ok) await markPayslipSent(payslip.id);
      results.push(result);
    }

    const sent = results.filter((result) => result.ok).length;
    res.json({ sent, failed: results.length - sent, results });
  })
);

/* ---------------------------------------------------------------- payslips */

payrollRouter.get(
  '/payroll/payslips',
  canRead,
  asyncHandler(async (req, res) => {
    res.json(
      await listPayslips({
        search: parseSearch(req.query),
        employeeId: Number(req.query.employeeId) || undefined,
        payrunId: Number(req.query.payrunId) || undefined,
        status: ['DRAFT', 'DONE', 'PAID'].includes(req.query.status) ? req.query.status : undefined,
        from: parseDateOnly(req.query.from) ?? undefined,
        to: parseDateOnly(req.query.to) ?? undefined,
        ...parsePageParams(req.query),
      })
    );
  })
);

payrollRouter.get(
  '/payroll/payslips/:id',
  canRead,
  asyncHandler(async (req, res) => {
    res.json(await getPayslip(readId(req.params.id)));
  })
);

payrollRouter.post(
  '/payroll/payslips/:id/compute',
  canProcess,
  asyncHandler(async (req, res) => {
    res.json(await computeOnePayslip(readId(req.params.id)));
  })
);

payrollRouter.post(
  '/payroll/payslips/:id/status',
  canProcess,
  asyncHandler(async (req, res) => {
    const check = validator(req.body);
    check.enum('status', ['DRAFT', 'DONE', 'PAID'], { required: true });
    const { status } = check.result();
    res.json(await setPayslipStatus(readId(req.params.id), status));
  })
);

/** The payslip as a PDF, for printing or saving. */
payrollRouter.get(
  '/payroll/payslips/:id/pdf',
  canRead,
  asyncHandler(async (req, res) => {
    const payslip = await getPayslip(readId(req.params.id));
    const pdf = await renderPayslipPdf(payslip);

    res.setHeader('Content-Type', 'application/pdf');
    // inline, so the browser previews it rather than dropping a file into the
    // downloads folder unasked.
    res.setHeader('Content-Disposition', `inline; filename="${payslipFilename(payslip)}"`);
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  })
);

/** Emails one payslip to the employee it belongs to. */
payrollRouter.post(
  '/payroll/payslips/:id/send',
  canProcess,
  asyncHandler(async (req, res) => {
    const payslip = await getPayslip(readId(req.params.id));
    const pdf = await renderPayslipPdf(payslip);
    const result = await sendPayslipEmail({ payslip, pdf, filename: payslipFilename(payslip) });

    if (!result.ok) {
      throw conflict('SEND_FAILED', `Could not send the payslip: ${result.error}`);
    }

    await markPayslipSent(payslip.id);
    res.json(result);
  })
);
