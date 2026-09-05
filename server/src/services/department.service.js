import { prisma } from '../lib/prisma.js';
import { notFound } from '../lib/errors.js';
import { pageResult } from '../lib/pagination.js';

const SELECT = {
  id: true,
  name: true,
  manager: { select: { id: true, name: true } },
  _count: { select: { employees: true } },
};

export async function listDepartments({ search, page, pageSize, skip, take }) {
  const where = search ? { name: { contains: search, mode: 'insensitive' } } : {};

  const [rows, total] = await Promise.all([
    prisma.department.findMany({ where, select: SELECT, orderBy: { name: 'asc' }, skip, take }),
    prisma.department.count({ where }),
  ]);

  return pageResult(rows.map(shape), total, { page, pageSize });
}

/** Flattens Prisma's `_count` into the field name the UI reads. */
function shape(row) {
  return {
    id: row.id,
    name: row.name,
    manager: row.manager,
    employeeCount: row._count.employees,
  };
}

export async function getDepartment(id) {
  const row = await prisma.department.findUnique({ where: { id }, select: SELECT });
  if (!row) throw notFound('Department');
  return shape(row);
}

export async function createDepartment(data) {
  const row = await prisma.department.create({ data, select: SELECT });
  return shape(row);
}

export async function updateDepartment(id, data) {
  const row = await prisma.department.update({ where: { id }, data, select: SELECT });
  return shape(row);
}

/** Options for the pickers on the employee and contract forms. */
export function departmentOptions() {
  return prisma.department.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
}
