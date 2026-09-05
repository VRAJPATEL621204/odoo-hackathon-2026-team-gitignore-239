import { prisma } from '../lib/prisma.js';
import { notFound } from '../lib/errors.js';
import { pageResult } from '../lib/pagination.js';

const SELECT = {
  id: true,
  name: true,
  description: true,
  active: true,
  department: { select: { id: true, name: true } },
  _count: { select: { employees: true } },
};

function shape(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    active: row.active,
    department: row.department,
    employeeCount: row._count.employees,
  };
}

export async function listJobPositions({ search, page, pageSize, skip, take }) {
  const where = search ? { name: { contains: search, mode: 'insensitive' } } : {};

  const [rows, total] = await Promise.all([
    prisma.jobPosition.findMany({ where, select: SELECT, orderBy: { name: 'asc' }, skip, take }),
    prisma.jobPosition.count({ where }),
  ]);

  return pageResult(rows.map(shape), total, { page, pageSize });
}

export async function getJobPosition(id) {
  const row = await prisma.jobPosition.findUnique({ where: { id }, select: SELECT });
  if (!row) throw notFound('Job position');
  return shape(row);
}

export async function createJobPosition(data) {
  return shape(await prisma.jobPosition.create({ data, select: SELECT }));
}

export async function updateJobPosition(id, data) {
  return shape(await prisma.jobPosition.update({ where: { id }, data, select: SELECT }));
}

export function jobPositionOptions() {
  return prisma.jobPosition.findMany({
    where: { active: true },
    select: { id: true, name: true, departmentId: true },
    orderBy: { name: 'asc' },
  });
}
