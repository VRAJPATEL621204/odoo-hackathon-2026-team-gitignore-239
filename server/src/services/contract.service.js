import { prisma } from '../lib/prisma.js';
import { conflict, notFound } from '../lib/errors.js';
import { pageResult } from '../lib/pagination.js';
import { toMoney } from '../lib/money.js';
import { formatReference, nextSequenceNumber } from '../lib/sequence.js';
import { overlappingContracts } from '../domain/contract.js';

const SELECT = {
  id: true,
  reference: true,
  startDate: true,
  endDate: true,
  wage: true,
  status: true,
  notes: true,
  employee: { select: { id: true, name: true, workEmail: true } },
  department: { select: { id: true, name: true } },
  jobPosition: { select: { id: true, name: true } },
  workingSchedule: { select: { id: true, name: true } },
};

/** Decimal columns become plain numbers at this boundary and nowhere else. */
function shape(row) {
  return { ...row, wage: toMoney(row.wage) };
}

export async function listContracts({ search, employeeId, status, page, pageSize, skip, take }) {
  const where = {
    ...(employeeId ? { employeeId } : {}),
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { reference: { contains: search, mode: 'insensitive' } },
            { employee: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.contract.findMany({
      where,
      select: SELECT,
      orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
      skip,
      take,
    }),
    prisma.contract.count({ where }),
  ]);

  return pageResult(rows.map(shape), total, { page, pageSize });
}

export async function getContract(id) {
  const row = await prisma.contract.findUnique({ where: { id }, select: SELECT });
  if (!row) throw notFound('Contract');
  return shape(row);
}

/**
 * Refuses a second running contract covering the same days.
 *
 * Payroll reads the contract applicable to a period; two running contracts
 * over the same period would leave it with no single wage to use.
 */
async function assertNoOverlap(candidate) {
  const existing = await prisma.contract.findMany({
    where: { employeeId: candidate.employeeId, status: 'RUNNING' },
    select: { id: true, status: true, startDate: true, endDate: true, reference: true },
  });

  const clashes = overlappingContracts(candidate, existing);
  if (clashes.length > 0) {
    throw conflict(
      'CONTRACT_OVERLAP',
      `${clashes[0].reference} is already running over this period. End it first, or save this one as a draft.`
    );
  }
}

export async function createContract(data) {
  await assertNoOverlap({ ...data, id: null });

  const year = data.startDate.getUTCFullYear();

  // The number and the row are written together, so a failure cannot burn a
  // reference or leave a contract without one.
  const row = await prisma.$transaction(async (tx) => {
    const number = await nextSequenceNumber(tx, 'CONTRACT', year);
    return tx.contract.create({
      data: { ...data, reference: formatReference('CON', year, number) },
      select: SELECT,
    });
  });

  return shape(row);
}

export async function updateContract(id, data) {
  const existing = await prisma.contract.findUnique({
    where: { id },
    select: { id: true, employeeId: true, startDate: true, endDate: true, status: true },
  });
  if (!existing) throw notFound('Contract');

  await assertNoOverlap({
    id,
    employeeId: data.employeeId ?? existing.employeeId,
    startDate: data.startDate ?? existing.startDate,
    endDate: data.endDate === undefined ? existing.endDate : data.endDate,
    status: data.status ?? existing.status,
  });

  return shape(await prisma.contract.update({ where: { id }, data, select: SELECT }));
}

/** Contract history for one employee, newest first, for the employee form. */
export async function contractsForEmployee(employeeId) {
  const rows = await prisma.contract.findMany({
    where: { employeeId },
    select: SELECT,
    orderBy: [{ startDate: 'desc' }],
  });
  return rows.map(shape);
}
