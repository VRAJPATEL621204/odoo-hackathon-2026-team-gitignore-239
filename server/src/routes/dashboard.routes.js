import { Router } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { PERMISSIONS } from '../domain/roles.js';
import { buildDashboard, leaveBalances } from '../services/dashboard.service.js';

export const dashboardRouter = Router();

/**
 * The whole dashboard in one request.
 *
 * Every block shares the same filtered employee set, so a department filter
 * cannot apply to one card and not another.
 */
dashboardRouter.get(
  '/dashboard',
  requireAuth,
  requirePermission(PERMISSIONS.DASHBOARD_READ),
  asyncHandler(async (req, res) => {
    const departmentId = Number(req.query.departmentId) || undefined;
    const structureId = Number(req.query.structureId) || undefined;

    const [dashboard, balances] = await Promise.all([
      buildDashboard({ period: req.query.period, departmentId, structureId }),
      leaveBalances(departmentId),
    ]);

    res.json({ ...dashboard, leaveBalances: balances });
  })
);
