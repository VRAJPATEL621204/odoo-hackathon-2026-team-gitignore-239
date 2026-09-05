import { Router } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import { validator } from '../lib/validate.js';
import { env } from '../lib/env.js';
import { clearSessionCookie, setSessionCookie } from '../lib/cookies.js';
import { signSession } from '../lib/token.js';
import { createRateLimiter } from '../lib/rateLimit.js';
import { tooManyRequests } from '../lib/errors.js';
import { authenticate, sessionPayload } from '../services/auth.service.js';
import { requireAuth } from '../middleware/auth.js';
import { ROLE_DEFINITIONS } from '../domain/roles.js';

export const authRouter = Router();

// Ten attempts per address per fifteen minutes. Generous enough that a person
// mistyping their password is never locked out, tight enough that guessing a
// password over HTTP is not practical.
const loginLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000 });

authRouter.post(
  '/auth/login',
  asyncHandler(async (req, res) => {
    const check = validator(req.body);
    check.email('email', { required: true });
    check.string('password', { required: true, min: 1, max: 200, trim: false });
    const { email, password } = check.result();

    const limit = loginLimiter.check(email);
    if (!limit.allowed) {
      throw tooManyRequests(
        `Too many sign-in attempts. Try again in ${limit.retryAfterSeconds} seconds.`
      );
    }

    const user = await authenticate(email, password);
    loginLimiter.reset(email);

    setSessionCookie(res, signSession(user.id), env.jwtExpiresInSeconds);
    res.json({ user: sessionPayload(user) });
  })
);

authRouter.post('/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

/**
 * The current session.
 *
 * The client calls this once on start-up to decide between the login screen
 * and the application, so a 401 here is an expected answer rather than an
 * error worth showing.
 */
authRouter.get(
  '/auth/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: sessionPayload(req.user) });
  })
);

/** The role catalogue the user form renders. Served so it is defined once. */
authRouter.get('/auth/roles', (_req, res) => {
  res.json({
    items: ROLE_DEFINITIONS.map(({ value, label, description }) => ({
      value,
      label,
      description,
    })),
  });
});
