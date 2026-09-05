import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';

export const healthRouter = Router();

/**
 * Liveness and database reachability in one call.
 *
 * The frontend shell uses this to show whether the stack is wired up, and it
 * is the first thing to check when the app misbehaves locally.
 */
healthRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', db: 'connected', company: env.companyName });
    } catch (error) {
      // A database that is still starting is an expected local condition, not
      // a server defect, so it gets its own readable response.
      res.status(503).json({
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message:
            'Cannot reach the database. Run "docker compose up -d" and wait for the container to report healthy.',
          detail: error?.message ?? 'Unknown database error',
        },
      });
    }
  })
);
