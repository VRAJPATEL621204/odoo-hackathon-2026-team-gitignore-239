import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildVariables,
  canTransitionPayrun,
  computePayslip,
  computeRule,
  payslipWarnings,
} from './payroll.js';

/**
 * A structure shaped like the reference screens: basic, allowances, a gross
 * that sums them, deductions, and a net that sums everything.
 */
const STRUCTURE = [
  {
    id: 1,
    code: 'BASIC',
    name: 'Basic Salary',
    category: 'BASIC',
    sequence: 1,
    computation: 'PERCENTAGE',
    percentage: 50,
    percentageBase: 'CONTRACT_WAGE',
    quantity: 1,
  },
  {
    id: 2,
    code: 'HRA',
    name: 'House Rent Allowance',
    category: 'ALLOWANCE',
    sequence: 10,
    computation: 'PERCENTAGE',
    percentage: 50,
    percentageBase: 'BASIC',
    quantity: 1,
  },
  {
    id: 3,
    code: 'STD',
    name: 'Standard Allowance',
    category: 'ALLOWANCE',
    sequence: 20,
    computation: 'FIXED',
    amount: 2000,
    quantity: 1,
  },
  {
    id: 4,
    code: 'GROSS',
    name: 'Gross Salary',
    category: 'GROSS',
    sequence: 60,
    computation: 'FORMULA',
    formula: "result = categories['BASIC'] + categories['ALLOWANCE']",
    quantity: 1,
  },
  {
    id: 5,
    code: 'PF',
    name: 'Provident Fund',
    category: 'DEDUCTION',
    sequence: 80,
    computation: 'PERCENTAGE',
    percentage: 12,
    percentageBase: 'BASIC',
    quantity: 1,
  },
  {
    id: 6,
    code: 'PT',
    name: 'Professional Tax',
    category: 'DEDUCTION',
    sequence: 100,
    computation: 'FIXED',
    amount: 200,
    quantity: 1,
  },
  {
    id: 7,
    code: 'NET',
    name: 'Net Salary',
    category: 'NET',
    sequence: 110,
    computation: 'FORMULA',
    formula: "result = categories['GROSS'] + categories['DEDUCTION']",
    quantity: 1,
  },
];

const INPUTS = { wage: 60000, totalDays: 22, workedDays: 22, unpaidDays: 0, overtimeHours: 0 };

test('a full structure computes basic, gross and net', () => {
  const result = computePayslip({ rules: STRUCTURE, inputs: INPUTS });

  assert.deepEqual(result.errors, []);
  assert.equal(result.basic, 30000); // 50% of 60000
  assert.equal(result.allowances, 17000); // 15000 HRA + 2000 standard
  assert.equal(result.gross, 47000);
  assert.equal(result.deductions, -3800); // 3600 PF + 200 PT
  assert.equal(result.net, 43200);
});

test('the lines sum to the totals they report', () => {
  const { lines, gross, deductions, net } = computePayslip({ rules: STRUCTURE, inputs: INPUTS });

  const sum = (category) =>
    lines.filter((line) => line.category === category).reduce((total, line) => total + line.amount, 0);

  assert.equal(sum('BASIC') + sum('ALLOWANCE'), gross);
  assert.equal(sum('DEDUCTION'), deductions);
  assert.equal(gross + deductions, net);
});

test('rules run in sequence order, whatever order they arrive in', () => {
  const shuffled = [...STRUCTURE].reverse();
  const result = computePayslip({ rules: shuffled, inputs: INPUTS });

  assert.equal(result.net, 43200);
  assert.deepEqual(
    result.lines.map((line) => line.code),
    ['BASIC', 'HRA', 'STD', 'GROSS', 'PF', 'PT', 'NET']
  );
});

test('a deduction entered as a positive number still reduces the net', () => {
  const rule = { code: 'PT', category: 'DEDUCTION', computation: 'FIXED', amount: 200, quantity: 1 };
  const context = { variables: { wage: 100 }, categories: { BASIC: 100 }, rules: {} };
  assert.equal(computeRule(rule, context), -200);
});

test('a deduction already entered negative is not flipped back to a credit', () => {
  const rule = { code: 'PT', category: 'DEDUCTION', computation: 'FIXED', amount: -200, quantity: 1 };
  const context = { variables: { wage: 100 }, categories: { BASIC: 100 }, rules: {} };
  assert.equal(computeRule(rule, context), -200);
});

test('quantity multiplies whatever the computation produced', () => {
  const rule = { code: 'X', category: 'ALLOWANCE', computation: 'FIXED', amount: 500, quantity: 3 };
  const context = { variables: {}, categories: {}, rules: {} };
  assert.equal(computeRule(rule, context), 1500);
});

test('a percentage reads the base it names', () => {
  const context = {
    variables: { wage: 60000 },
    categories: { BASIC: 30000, GROSS: 47000 },
    rules: {},
  };
  const percentage = (base) =>
    computeRule(
      { code: 'X', category: 'ALLOWANCE', computation: 'PERCENTAGE', percentage: 10, percentageBase: base, quantity: 1 },
      context
    );

  assert.equal(percentage('CONTRACT_WAGE'), 6000);
  assert.equal(percentage('BASIC'), 3000);
  assert.equal(percentage('GROSS'), 4700);
});

test('an attendance-based rule pays for the days worked', () => {
  const rules = [
    { ...STRUCTURE[0] },
    {
      id: 99,
      code: 'ATT',
      name: 'Attendance Adjustment',
      category: 'DEDUCTION',
      sequence: 90,
      computation: 'FORMULA',
      formula: "result = categories['BASIC'] * (total_days - worked_days) / total_days",
      quantity: 1,
    },
  ];

  // Two days short of a 22-day month costs two days of basic.
  const result = computePayslip({
    rules,
    inputs: { ...INPUTS, workedDays: 20 },
  });

  assert.equal(result.basic, 30000);
  assert.equal(result.deductions, -2727.27);
});

test('worked_ratio is the proportion of the period worked', () => {
  assert.equal(buildVariables({ totalDays: 22, workedDays: 11 }).worked_ratio, 0.5);
});

test('a period with no working days counts as fully worked, not as nothing', () => {
  // Otherwise a badly configured schedule would silently pay nobody.
  assert.equal(buildVariables({ totalDays: 0, workedDays: 0 }).worked_ratio, 1);
});

test('a rule that cannot be computed is reported, and the rest still run', () => {
  const broken = [
    ...STRUCTURE.slice(0, 3),
    {
      id: 50,
      code: 'BAD',
      name: 'Broken Rule',
      category: 'ALLOWANCE',
      sequence: 55,
      computation: 'FORMULA',
      formula: 'this is not an expression',
      quantity: 1,
    },
    ...STRUCTURE.slice(3),
  ];

  const result = computePayslip({ rules: broken, inputs: INPUTS });

  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /^BAD:/);
  // The payslip is still produced, without the broken line.
  assert.equal(result.net, 43200);
  assert.ok(!result.lines.some((line) => line.code === 'BAD'));
});

test('an inactive rule is skipped', () => {
  const rules = STRUCTURE.map((rule) => (rule.code === 'STD' ? { ...rule, active: false } : rule));
  const result = computePayslip({ rules, inputs: INPUTS });
  assert.equal(result.allowances, 15000);
});

test('a structure without gross and net rules still totals correctly', () => {
  const rules = STRUCTURE.filter((rule) => !['GROSS', 'NET'].includes(rule.code));
  const result = computePayslip({ rules, inputs: INPUTS });

  assert.equal(result.gross, 47000);
  assert.equal(result.net, 43200);
});

test('an empty structure produces an empty payslip rather than failing', () => {
  const result = computePayslip({ rules: [], inputs: INPUTS });
  assert.deepEqual(result.lines, []);
  assert.equal(result.net, 0);
});

test('a formula cannot reach the prototype chain through the category table', () => {
  const rules = [
    {
      id: 1,
      code: 'X',
      name: 'Probe',
      category: 'ALLOWANCE',
      sequence: 1,
      computation: 'FORMULA',
      formula: "result = categories['constructor'] + rules['__proto__']",
      quantity: 1,
    },
  ];
  const result = computePayslip({ rules, inputs: INPUTS });
  assert.deepEqual(result.errors, []);
  assert.equal(result.lines[0].amount, 0);
});

test('warnings name every problem worth looking at', () => {
  const warnings = payslipWarnings({
    employee: { bankAccount: null },
    contract: null,
    duplicateOf: 'PAY/2026/09/0003',
    computationErrors: ['BAD: broken'],
  });

  assert.equal(warnings.length, 4);
  assert.match(warnings.join(' '), /No running contract/);
  assert.match(warnings.join(' '), /Bank account missing/);
  assert.match(warnings.join(' '), /Duplicate/);
});

test('a complete payslip has nothing to warn about', () => {
  const warnings = payslipWarnings({
    employee: { bankAccount: 'HDFC ****1234' },
    contract: { id: 1 },
    duplicateOf: null,
  });
  assert.deepEqual(warnings, []);
});

test('the payrun workflow only allows the moves it defines', () => {
  assert.equal(canTransitionPayrun('DRAFT', 'COMPUTED'), true);
  assert.equal(canTransitionPayrun('DRAFT', 'PAID'), false);
  assert.equal(canTransitionPayrun('COMPUTED', 'VALIDATED'), true);
  assert.equal(canTransitionPayrun('VALIDATED', 'PAID'), true);
  // Paid payroll is history and is never reopened.
  assert.equal(canTransitionPayrun('PAID', 'VALIDATED'), false);
  assert.equal(canTransitionPayrun('PAID', 'DRAFT'), false);
});
