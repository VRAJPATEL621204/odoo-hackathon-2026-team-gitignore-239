import { PrismaClient } from '@prisma/client';

/**
 * A single PrismaClient for the whole process.
 *
 * `node --watch` restarts the module graph on every file change. Without the
 * globalThis guard each restart would open a brand new connection pool and the
 * database would eventually reject connections. Storing the instance on
 * globalThis survives module re-evaluation, so we keep exactly one pool.
 */

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__peoplepay360Prisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG_QUERIES === 'true' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

globalForPrisma.__peoplepay360Prisma = prisma;
