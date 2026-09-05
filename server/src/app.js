import express from 'express';
import cors from 'cors';

import { env } from './lib/env.js';
import { cookieParser } from './lib/cookies.js';
import { errorMiddleware, notFoundMiddleware } from './lib/errorMiddleware.js';
import { healthRouter } from './routes/health.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { userRouter } from './routes/user.routes.js';
import { hrRouter } from './routes/hr.routes.js';
import { attendanceRouter } from './routes/attendance.routes.js';
import { timeOffRouter } from './routes/timeoff.routes.js';
import { payrollRouter } from './routes/payroll.routes.js';
import { dashboardRouter } from './routes/dashboard.routes.js';

/**
 * Builds the Express application.
 *
 * Kept separate from index.js so tests can start the app on an ephemeral port
 * in-process, which removes any need for a HTTP testing library.
 */
export function createApp() {
  const app = express();

  // The Vite dev server proxies /api, so requests are same-origin in practice.
  // CORS stays configured for the case where the client is opened directly.
  app.use(cors({ origin: env.clientOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser);

  app.use('/api', healthRouter);
  app.use('/api', authRouter);
  app.use('/api', userRouter);
  app.use('/api', hrRouter);
  app.use('/api', attendanceRouter);
  app.use('/api', timeOffRouter);
  app.use('/api', payrollRouter);
  app.use('/api', dashboardRouter);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
