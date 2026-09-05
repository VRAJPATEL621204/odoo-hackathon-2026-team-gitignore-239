const adapter = require('../adapters/peoplepay360.adapter');

// TODO(real-project): confirm real field names for payslip/payroll records.
// Note: bank account / tax-ID style fields are masked upstream by the
// adapter (privacy.service.maskSensitiveFields) before they ever reach here.
async function getPayslip(ctx, entities) {
  const period = entities.period || 'current_month';
  const record = await adapter.get('PAYSLIP', ctx, { period });
  return pickPayslipFields(record, period);
}

async function getPayrollSummary(ctx, entities) {
  const period = entities.period || 'current_month';
  const record = await adapter.get('PAYROLL_SUMMARY', ctx, { period });
  return pickPayslipFields(record, period);
}

async function comparePayslips(ctx, entities) {
  const currentPeriod = entities.period || 'current_month';
  const previousPeriod = entities.comparePeriod || 'previous_month';

  const [current, previous] = await Promise.all([
    getPayslip(ctx, { period: currentPeriod }),
    getPayslip(ctx, { period: previousPeriod }),
  ]);

  const difference = round2((current.netSalary ?? 0) - (previous.netSalary ?? 0));
  return { previous, current, difference };
}

async function explainDeductions(ctx, entities) {
  const period = entities.period || 'current_month';
  const record = await adapter.get('PAYSLIP', ctx, { period });
  const deductions = Array.isArray(record?.deductions) ? record.deductions : [];
  return {
    period,
    deductions: deductions.map((d) => ({ label: d.label, amount: d.amount })),
    totalDeductions: round2(deductions.reduce((sum, d) => sum + (d.amount || 0), 0)),
  };
}

function pickPayslipFields(record, period) {
  const { grossSalary, netSalary, deductions } = record || {};
  return {
    period,
    grossSalary,
    netSalary,
    totalDeductions: Array.isArray(deductions)
      ? round2(deductions.reduce((sum, d) => sum + (d.amount || 0), 0))
      : undefined,
  };
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

module.exports = { getPayslip, getPayrollSummary, comparePayslips, explainDeductions };
