import test from 'node:test';
import assert from 'node:assert/strict';

import { FormulaError, evaluateFormula, validateFormula } from './formula.js';

const context = {
  variables: { wage: 50000, worked_days: 20, total_days: 22, overtime_hours: 6, unpaid_days: 2 },
  maps: {
    categories: { BASIC: 25000, ALLOWANCE: 12000, GROSS: 37000, DEDUCTION: -4000 },
    rules: { BASIC: 25000, HRA: 12500 },
  },
};

const run = (source) => evaluateFormula(source, context);

test('arithmetic follows precedence and brackets', () => {
  assert.equal(run('2 + 3 * 4'), 14);
  assert.equal(run('(2 + 3) * 4'), 20);
  assert.equal(run('10 - 2 - 3'), 5);
});

test('a leading "result =" is accepted, as the reference screens write it', () => {
  assert.equal(run("result = categories['BASIC']"), 25000);
  assert.equal(run("categories['BASIC']"), 25000);
});

test('variables and category lookups read from the context', () => {
  assert.equal(run('wage / 2'), 25000);
  assert.equal(run("rules['HRA']"), 12500);
  assert.equal(run("categories['BASIC'] + categories['ALLOWANCE']"), 37000);
});

test('a rule that has not run yet contributes nothing rather than failing', () => {
  assert.equal(run("categories['NOT_YET']"), 0);
});

test('an attendance-proportioned salary computes as written', () => {
  // The case the reference notes give: pay for the days actually worked.
  assert.equal(run("categories['BASIC'] * worked_days / total_days"), 25000 * (20 / 22));
});

test('an unpaid leave deduction computes as written', () => {
  assert.equal(run("-1 * categories['BASIC'] / total_days * unpaid_days"), -(25000 / 22) * 2);
});

test('overtime at 1.5 times the hourly rate computes as written', () => {
  assert.equal(
    run("round(categories['BASIC'] / total_days / 8 * 1.5 * overtime_hours, 2)"),
    Math.round((25000 / 22 / 8) * 1.5 * 6 * 100) / 100
  );
});

test('functions are available and nest', () => {
  assert.equal(run('max(1, 2, 3)'), 3);
  assert.equal(run('min(10, wage)'), 10);
  assert.equal(run('round(2.567, 2)'), 2.57);
  assert.equal(run('abs(0 - 5)'), 5);
  assert.equal(run('max(0, min(wage, 30000))'), 30000);
});

test('unary minus works on values and on lookups', () => {
  assert.equal(run('-5 + 10'), 5);
  assert.equal(run("-categories['BASIC']"), -25000);
});

test('dividing by zero yields nothing rather than infinity', () => {
  // A zero-day month must not turn the net pay into Infinity.
  assert.equal(evaluateFormula('wage / total_days', { variables: { wage: 100, total_days: 0 } }), 0);
});

test('an unknown name is a clear error, not a silent zero', () => {
  assert.throws(() => run('salary_of_someone_else'), FormulaError);
  assert.throws(() => run('unknownFunction(1)'), FormulaError);
  assert.throws(() => run("unknownTable['X']"), FormulaError);
});

test('malformed expressions are rejected', () => {
  assert.throws(() => run('2 +'), FormulaError);
  assert.throws(() => run('(2 + 3'), FormulaError);
  assert.throws(() => run('2 3'), FormulaError);
  assert.throws(() => run(''), FormulaError);
});

test('the evaluator cannot reach anything outside its context', () => {
  // These are the expressions that would matter if this were eval().
  assert.throws(() => run('process'), FormulaError);
  assert.throws(() => run('globalThis'), FormulaError);
  assert.throws(() => run('require("fs")'), FormulaError);
  assert.throws(() => run('constructor'), FormulaError);
  // Property access is not part of the grammar at all.
  assert.throws(() => run('wage.constructor'), FormulaError);
});

test('a lookup cannot reach an inherited property of the table', () => {
  assert.equal(run("categories['toString']"), 0);
  assert.equal(run("categories['__proto__']"), 0);
});

test('validateFormula reports a problem without running the expression', () => {
  assert.equal(validateFormula("categories['BASIC'] * 0.5"), null);
  assert.equal(validateFormula('result = wage * 2'), null);
  assert.match(validateFormula('2 +'), /ended unexpectedly|Expected/);
  assert.match(validateFormula('@@@'), /Unexpected character/);
});
