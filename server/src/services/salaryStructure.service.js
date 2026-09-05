import { prisma } from '../lib/prisma.js';
import { conflict, notFound, validationError } from '../lib/errors.js';
import { pageResult } from '../lib/pagination.js';
import { toMoney } from '../lib/money.js';
import { validateFormula } from '../domain/formula.js';

/**
 * Salary structures and the rules inside them.
 *
 * A structure is the calculation a payslip is produced by, so the rules are
 * always read in sequence order and a rule's code is unique within its
 * structure: a formula referring to BASIC must have exactly one BASIC to mean.
 */

const RULE_SELECT = {
  id: true,
  name: true,
  code: true,
  category: true,
  sequence: true,
  computation: true,
  amount: true,
  percentage: true,
  percentageBase: true,
  formula: true,
  quantity: true,
  active: true,
  notes: true,
  structure: { select: { id: true, name: true } },
};

function shapeRule(row) {
  return {
    ...row,
    amount: toMoney(row.amount),
    percentage: toMoney(row.percentage),
    quantity: toMoney(row.quantity),
  };
}

const STRUCTURE_SELECT = {
  id: true,
  name: true,
  active: true,
  notes: true,
  _count: { select: { rules: true, payslips: true } },
};

function shapeStructure(row, rules) {
  const { _count, ...structure } = row;
  return {
    ...structure,
    ruleCount: _count.rules,
    payslipCount: _count.payslips,
    ...(rules ? { rules: rules.map(shapeRule) } : {}),
  };
}

export async function listStructures({ search, page, pageSize, skip, take }) {
  const where = search ? { name: { contains: search, mode: 'insensitive' } } : {};

  const [rows, total] = await Promise.all([
    prisma.salaryStructure.findMany({
      where,
      select: STRUCTURE_SELECT,
      orderBy: { name: 'asc' },
      skip,
      take,
    }),
    prisma.salaryStructure.count({ where }),
  ]);

  return pageResult(rows.map((row) => shapeStructure(row)), total, { page, pageSize });
}

export async function getStructure(id) {
  const row = await prisma.salaryStructure.findUnique({ where: { id }, select: STRUCTURE_SELECT });
  if (!row) throw notFound('Salary structure');

  const rules = await prisma.salaryRule.findMany({
    where: { structureId: id },
    select: RULE_SELECT,
    orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
  });

  return shapeStructure(row, rules);
}

export async function createStructure(data) {
  return shapeStructure(await prisma.salaryStructure.create({ data, select: STRUCTURE_SELECT }));
}

export async function updateStructure(id, data) {
  return shapeStructure(
    await prisma.salaryStructure.update({ where: { id }, data, select: STRUCTURE_SELECT })
  );
}

export function structureOptions() {
  return prisma.salaryStructure.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

/* ------------------------------------------------------------------- rules */

export async function listRules({ search, structureId, category, page, pageSize, skip, take }) {
  const where = {
    ...(structureId ? { structureId } : {}),
    ...(category ? { category } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { code: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.salaryRule.findMany({
      where,
      select: RULE_SELECT,
      orderBy: [{ structureId: 'asc' }, { sequence: 'asc' }],
      skip,
      take,
    }),
    prisma.salaryRule.count({ where }),
  ]);

  return pageResult(rows.map(shapeRule), total, { page, pageSize });
}

export async function getRule(id) {
  const row = await prisma.salaryRule.findUnique({ where: { id }, select: RULE_SELECT });
  if (!row) throw notFound('Salary rule');
  return shapeRule(row);
}

/**
 * Checks that a rule can actually be computed before it is stored.
 *
 * A rule with no amount, no percentage or an unreadable formula would fail
 * silently at payroll time, on a payslip somebody is waiting for. Catching it
 * on save puts the error where it can be fixed.
 */
function assertComputable(data) {
  const fields = {};

  if (data.computation === 'FIXED' && (data.amount === null || data.amount === undefined)) {
    fields.amount = 'A fixed rule needs an amount.';
  }

  if (data.computation === 'PERCENTAGE') {
    if (data.percentage === null || data.percentage === undefined) {
      fields.percentage = 'A percentage rule needs a percentage.';
    }
    if (!data.percentageBase) {
      fields.percentageBase = 'Choose what the percentage is taken of.';
    }
  }

  if (data.computation === 'FORMULA') {
    if (!data.formula) {
      fields.formula = 'A formula rule needs an expression.';
    } else {
      const message = validateFormula(data.formula);
      if (message) fields.formula = message;
    }
  }

  if (Object.keys(fields).length > 0) throw validationError(fields);
}

export async function createRule(data) {
  assertComputable(data);
  return shapeRule(await prisma.salaryRule.create({ data, select: RULE_SELECT }));
}

export async function updateRule(id, data) {
  const existing = await prisma.salaryRule.findUnique({
    where: { id },
    select: {
      id: true,
      computation: true,
      amount: true,
      percentage: true,
      percentageBase: true,
      formula: true,
    },
  });
  if (!existing) throw notFound('Salary rule');

  // A patch may change only the formula, so the check runs against the record
  // as it will be, not against the fields that happened to be sent.
  assertComputable({ ...existing, ...data });

  return shapeRule(await prisma.salaryRule.update({ where: { id }, data, select: RULE_SELECT }));
}

/**
 * Rules are archived rather than deleted once payslips exist.
 *
 * A payslip keeps its own lines, so deleting the rule does not change what was
 * paid — but it does remove the explanation of where a line came from.
 */
export async function deleteRule(id) {
  const rule = await prisma.salaryRule.findUnique({
    where: { id },
    select: { id: true, structureId: true, code: true },
  });
  if (!rule) throw notFound('Salary rule');

  const usedBy = await prisma.payslip.count({
    where: { structureId: rule.structureId, status: { not: 'DRAFT' } },
  });
  if (usedBy > 0) {
    throw conflict(
      'RULE_IN_USE',
      `${usedBy} payslip(s) were computed with this structure. Deactivate the rule instead, so past payslips still explain themselves.`
    );
  }

  await prisma.salaryRule.delete({ where: { id } });
}

/** The rules a payrun computes with, in the order they run. */
export function rulesForStructure(structureId) {
  return prisma.salaryRule.findMany({
    where: { structureId, active: true },
    orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
  });
}
