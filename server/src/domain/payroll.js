import { round2 } from '../lib/money.js';
import { FormulaError, evaluateFormula } from './formula.js';

/**
 * The payslip calculation.
 *
 * Rules run in sequence order, each one able to read what the rules before it
 * produced. That ordering is the whole design: HRA is a percentage of basic
 * because basic ran first, gross sums the categories filled in by the rules
 * above it, and net subtracts the deductions below that.
 *
 * Pure — no Prisma, no clock, no configuration of its own. Everything the
 * calculation needs is passed in, which is what makes a payslip reproducible
 * from its inputs.
 */

/** Deductions are stored negative, so a rule's own sign is respected. */
const DEDUCTION = 'DEDUCTION';

/**
 * Works out one rule's amount.
 *
 * `context` carries the running totals so far, so a rule reading
 * categories['BASIC'] sees what the basic rule produced a moment ago.
 */
export function computeRule(rule, context) {
  const quantity = Number(rule.quantity ?? 1);

  let value;
  switch (rule.computation) {
    case 'FIXED':
      value = Number(rule.amount ?? 0);
      break;

    case 'PERCENTAGE': {
      const percentage = Number(rule.percentage ?? 0);
      const base = percentageBaseValue(rule.percentageBase, context);
      value = (base * percentage) / 100;
      break;
    }

    case 'FORMULA':
      value = evaluateFormula(rule.formula, {
        variables: context.variables,
        maps: { categories: context.categories, rules: context.rules },
      });
      break;

    default:
      throw new FormulaError(`Rule ${rule.code} has no computation method.`);
  }

  const amount = round2(value * quantity);

  // A deduction written as a positive number still has to reduce the net pay.
  // Taking the magnitude and applying the sign means a rule configured either
  // way behaves the same, which is what somebody entering "2000" for
  // professional tax expects.
  return rule.category === DEDUCTION ? -Math.abs(amount) : amount;
}

function percentageBaseValue(base, context) {
  switch (base) {
    case 'BASIC':
      return context.categories.BASIC ?? 0;
    case 'GROSS':
      return context.categories.GROSS ?? 0;
    case 'CONTRACT_WAGE':
    default:
      return context.variables.wage ?? 0;
  }
}

/**
 * The values a formula rule may read.
 *
 * Named in the snake_case the reference screens use, so an expression written
 * against the documentation works unchanged.
 */
export function buildVariables(inputs) {
  const totalDays = Number(inputs.totalDays ?? 0);
  const workedDays = Number(inputs.workedDays ?? 0);

  return {
    wage: Number(inputs.wage ?? 0),
    worked_days: workedDays,
    total_days: totalDays,
    unpaid_days: Number(inputs.unpaidDays ?? 0),
    leave_days: Number(inputs.leaveDays ?? 0),
    overtime_hours: Number(inputs.overtimeHours ?? 0),
    attendance_days: Number(inputs.attendanceDays ?? 0),
    // The proportion of the period actually worked, which is what an
    // attendance-based rule multiplies by. A period with no working days is
    // treated as fully worked rather than as nothing earned.
    worked_ratio: totalDays === 0 ? 1 : round2(workedDays / totalDays),
  };
}

/**
 * Runs a whole structure and returns the payslip lines and totals.
 *
 * A rule that fails is reported rather than silently skipped: a payslip missing
 * a line is worse than one that says which rule could not be worked out.
 */
export function computePayslip({ rules, inputs }) {
  const ordered = [...rules]
    .filter((rule) => rule.active !== false)
    .sort((a, b) => a.sequence - b.sequence || a.id - b.id);

  const context = {
    variables: buildVariables(inputs),
    // Null-prototype objects: a rule looking up categories['constructor'] finds
    // nothing at all rather than something inherited.
    categories: Object.assign(Object.create(null), {
      BASIC: 0,
      ALLOWANCE: 0,
      GROSS: 0,
      DEDUCTION: 0,
      NET: 0,
    }),
    rules: Object.create(null),
  };

  const lines = [];
  const errors = [];

  for (const rule of ordered) {
    let amount;
    try {
      amount = computeRule(rule, context);
    } catch (error) {
      errors.push(`${rule.code}: ${error.message}`);
      continue;
    }

    lines.push({
      code: rule.code,
      name: rule.name,
      category: rule.category,
      sequence: rule.sequence,
      quantity: Number(rule.quantity ?? 1),
      amount,
    });

    context.categories[rule.category] = round2((context.categories[rule.category] ?? 0) + amount);
    context.rules[rule.code] = amount;
  }

  return { lines, errors, ...totals(context) };
}

/**
 * The three figures every payslip screen shows.
 *
 * A structure that declares its own GROSS or NET rule wins, because that rule
 * is the definition somebody configured. Without one the totals fall back to
 * the arithmetic those categories mean, so a half-configured structure still
 * produces a usable payslip.
 */
function totals(context) {
  const { BASIC, ALLOWANCE, GROSS, DEDUCTION: deductions, NET } = context.categories;

  const gross = GROSS !== 0 ? GROSS : round2(BASIC + ALLOWANCE);
  const net = NET !== 0 ? NET : round2(gross + deductions);

  return {
    basic: round2(BASIC),
    allowances: round2(ALLOWANCE),
    deductions: round2(deductions),
    gross: round2(gross),
    net: round2(net),
  };
}

/**
 * The problems a person has to look at before payroll is finalised.
 *
 * Warnings never block computing — seeing the numbers is how somebody decides
 * what to fix — but they are carried on the payslip so the payrun can list
 * them, and the reference flow shows exactly these on screen.
 */
export function payslipWarnings({ employee, contract, duplicateOf, computationErrors = [] }) {
  const warnings = [];

  if (!contract) {
    warnings.push('No running contract covers this period, so there is no wage to compute from.');
  }
  if (!employee?.bankAccount) {
    warnings.push('Bank account missing, so this payslip cannot be paid.');
  }
  if (duplicateOf) {
    warnings.push(`Duplicate: ${duplicateOf} already covers this employee and period.`);
  }
  for (const error of computationErrors) {
    warnings.push(`Rule could not be computed — ${error}`);
  }

  return warnings;
}

/**
 * The payrun workflow.
 *
 * Declared as data so the API and the buttons agree on what is possible, and a
 * stale page cannot pay a payrun that was never validated.
 */
export const PAYRUN_TRANSITIONS = {
  DRAFT: ['COMPUTED'],
  COMPUTED: ['DRAFT', 'VALIDATED'],
  VALIDATED: ['COMPUTED', 'PAID'],
  // Paid payroll stays available as historical data and is never reopened.
  PAID: [],
};

export function canTransitionPayrun(from, to) {
  return (PAYRUN_TRANSITIONS[from] ?? []).includes(to);
}
