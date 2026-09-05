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
import { env } from '../lib/env.js';
import { createConcurrencyLock } from '../lib/concurrencyLock.js';
import { createRateLimiter } from '../lib/rateLimit.js';
import { tooManyRequests } from '../lib/errors.js';
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

const bulkEmailLock = createConcurrencyLock();
const singleEmailLock = createConcurrencyLock();
const pdfLock = createConcurrencyLock();
const computeLock = createConcurrencyLock();

// Concurrency locks above stop two requests overlapping; they say nothing
// about a second click arriving right after the first one finished. These
// cooldowns close that gap: `limit: 1` per window means the first call in a
// window succeeds and starts the window, and every call inside it — even
// once the first has completed — is rejected until the window elapses.
const computeCooldown = createRateLimiter({ limit: 1, windowMs: env.actionCooldownSeconds * 1000 });
const statusCooldown = createRateLimiter({ limit: 1, windowMs: env.actionCooldownSeconds * 1000 });
const emailCooldown = createRateLimiter({ limit: 1, windowMs: env.emailCooldownSeconds * 1000 });
const pdfCooldown = createRateLimiter({ limit: 1, windowMs: env.pdfCooldownSeconds * 1000 });

const canRead = [requireAuth, requirePermission(PERMISSIONS.PAYROLL_READ)];
const canProcess = [requireAuth, requirePermission(PERMISSIONS.PAYROLL_PROCESS)];
const canConfigure = [requireAuth, requirePermission(PERMISSIONS.PAYROLL_CONFIGURE)];
function userResourceKey(req, id) {
  return `${req.user.id}:${id}`;
}

/**
 * Enforces a cooldown key, throwing 429 when it is still active.
 *
 * Cooldowns key by resource, not by user, so two different admins clicking
 * the same button back to back cannot double the work either.
 */
function enforceCooldown(limiter, key, res, message) {
  const result = limiter.check(key);
  if (!result.allowed) {
    res.setHeader('Retry-After', result.retryAfterSeconds);
    throw tooManyRequests(message, 'ACTION_COOLDOWN', result.retryAfterSeconds);
  }
}

/** Acquires a single-process lock for one user's payslip PDF generation. */
async function renderLockedPdf(key, payslip) {
  const release = pdfLock.acquire(key);
  if (!release) {
    throw conflict('PDF_GENERATION_IN_PROGRESS', 'PDF generation is already in progress.');
  }

  try {
    return await renderPayslipPdf(payslip);
  } finally {
    release();
  }
}

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
    const id = readId(req.params.id);
    const cooldownKey = `payrun:${id}`;
    enforceCooldown(
      computeCooldown,
      cooldownKey,
      res,
      'This payrun was just computed. Please wait before recomputing.'
    );

    const release = computeLock.acquire(cooldownKey);
    if (!release) {
      computeCooldown.reset(cooldownKey);
      throw conflict('COMPUTE_IN_PROGRESS', 'This payrun is already being computed.');
    }

    try {
      res.json(await computePayrun(id));
    } catch (error) {
      computeCooldown.reset(cooldownKey);
      throw error;
    } finally {
      release();
    }
  })
);

payrollRouter.post(
  '/payroll/payruns/:id/status',
  canProcess,
  asyncHandler(async (req, res) => {
    const check = validator(req.body);
    check.enum('status', ['DRAFT', 'COMPUTED', 'VALIDATED', 'PAID'], { required: true });
    const { status } = check.result();
    const id = readId(req.params.id);
    const cooldownKey = `payrun:${id}:${status}`;
    enforceCooldown(
      statusCooldown,
      cooldownKey,
      res,
      'This change was just made. Please wait before repeating it.'
    );

    try {
      res.json(await setPayrunStatus(id, status));
    } catch (error) {
      statusCooldown.reset(cooldownKey);
      throw error;
    }
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
    const payrunId = readId(req.params.id);
    const payrun = await getPayrun(payrunId);

    if (payrun.status === 'DRAFT') {
      throw conflict(
        'PAYRUN_NOT_COMPUTED',
        'Compute the payrun before sending payslips, or people would receive empty ones.'
      );
    }

    const recipients = payrun.payslips;
    if (recipients.length > env.maxBulkEmailRecipients) {
      throw conflict(
        'BULK_EMAIL_TOO_LARGE',
        `A bulk email operation is limited to ${env.maxBulkEmailRecipients} recipients.`
      );
    }

    const cooldownKey = `payrun:${payrunId}`;
    enforceCooldown(
      emailCooldown,
      cooldownKey,
      res,
      'Payslips for this payrun were just sent. Please wait before sending again.'
    );

    const accountKey = String(req.user.id);
    const releaseBulkEmail = bulkEmailLock.acquire(accountKey);
    if (!releaseBulkEmail) {
      emailCooldown.reset(cooldownKey);
      throw conflict(
        'BULK_EMAIL_IN_PROGRESS',
        'A bulk email operation is already in progress.'
      );
    }

    res.status(202).json({ queued: recipients.length });

    void (async () => {
      try {
        const batchSize = 5;
        for (let index = 0; index < recipients.length; index += batchSize) {
          const batch = recipients.slice(index, index + batchSize);
          await Promise.all(
            batch.map(async (summary) => {
              const payslip = await getPayslip(summary.id);
              const pdf = await renderPayslipPdf(payslip);
              const result = await sendPayslipEmail({
                payslip,
                pdf,
                filename: payslipFilename(payslip),
              });
              if (result.ok) await markPayslipSent(payslip.id);
            })
          );
        }
      } catch (error) {
        console.error(`Payslip email job failed for payrun ${payrunId}:`, error);
      } finally {
        releaseBulkEmail();
      }
    })();
  })
);

payrollRouter.get(
  '/payroll/payruns/:id/send-status',
  canProcess,
  asyncHandler(async (req, res) => {
    res.json({ active: bulkEmailLock.isActive(String(req.user.id)) });
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
    const id = readId(req.params.id);
    const cooldownKey = `payslip:${id}`;
    enforceCooldown(
      computeCooldown,
      cooldownKey,
      res,
      'This payslip was just computed. Please wait before recomputing.'
    );

    const release = computeLock.acquire(cooldownKey);
    if (!release) {
      computeCooldown.reset(cooldownKey);
      throw conflict('COMPUTE_IN_PROGRESS', 'This payslip is already being computed.');
    }

    try {
      res.json(await computeOnePayslip(id));
    } catch (error) {
      computeCooldown.reset(cooldownKey);
      throw error;
    } finally {
      release();
    }
  })
);

payrollRouter.post(
  '/payroll/payslips/:id/status',
  canProcess,
  asyncHandler(async (req, res) => {
    const check = validator(req.body);
    check.enum('status', ['DRAFT', 'DONE', 'PAID'], { required: true });
    const { status } = check.result();
    const id = readId(req.params.id);
    const cooldownKey = `payslip:${id}:${status}`;
    enforceCooldown(
      statusCooldown,
      cooldownKey,
      res,
      'This change was just made. Please wait before repeating it.'
    );

    try {
      res.json(await setPayslipStatus(id, status));
    } catch (error) {
      statusCooldown.reset(cooldownKey);
      throw error;
    }
  })
);

/** The payslip as a PDF, for printing or saving. */
payrollRouter.get(
  '/payroll/payslips/:id/pdf',
  canRead,
  asyncHandler(async (req, res) => {
    const payslipId = readId(req.params.id);
    const key = userResourceKey(req, payslipId);
    enforceCooldown(pdfCooldown, key, res, 'This PDF was just generated. Please wait a moment.');

    let payslip;
    let pdf;
    try {
      payslip = await getPayslip(payslipId);
      pdf = await renderLockedPdf(key, payslip);
    } catch (error) {
      pdfCooldown.reset(key);
      throw error;
    }

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
    const payslipId = readId(req.params.id);
    const lockKey = userResourceKey(req, payslipId);
    const cooldownKey = `payslip:${payslipId}`;
    enforceCooldown(
      emailCooldown,
      cooldownKey,
      res,
      'This payslip was just emailed. Please wait before sending again.'
    );

    const releaseSingleEmail = singleEmailLock.acquire(lockKey);
    if (!releaseSingleEmail) {
      emailCooldown.reset(cooldownKey);
      throw conflict('EMAIL_ALREADY_SENDING', 'This payslip email is already being sent.');
    }

    try {
      const payslip = await getPayslip(payslipId);
      const pdf = await renderLockedPdf(lockKey, payslip);
      const result = await sendPayslipEmail({ payslip, pdf, filename: payslipFilename(payslip) });

      if (!result.ok) {
        throw conflict('SEND_FAILED', `Could not send the payslip: ${result.error}`);
      }

      await markPayslipSent(payslip.id);
      res.json(result);
    } catch (error) {
      emailCooldown.reset(cooldownKey);
      throw error;
    } finally {
      releaseSingleEmail();
    }
  })
);
