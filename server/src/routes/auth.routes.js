import { Router } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import { validator } from '../lib/validate.js';
import { env } from '../lib/env.js';
import { clearSessionCookie, setSessionCookie } from '../lib/cookies.js';
import { signSession } from '../lib/token.js';
import { createRateLimiter, enforceLimit, rateLimit } from '../lib/rateLimit.js';
import { authenticate, sessionPayload } from '../services/auth.service.js';
import { requireAuth } from '../middleware/auth.js';
import { ROLE_DEFINITIONS } from '../domain/roles.js';

export const authRouter = Router();

// Three independent keys, each catching a different attack shape:
//  - IP: a blunt cap on distributed brute force from one network. Never
//    reset, since the point is to slow total attempt volume regardless of
//    whether any one attempt happened to succeed.
//  - account (email alone, not mixed with IP): locks out attacks on one
//    account even when the attacker rotates source IPs. Reset on success so
//    it never penalizes a legitimate user for earlier typos.
//  - device (anonymous browser cookie): catches many accounts tried from one
//    browser behind a shared or NAT IP, where the IP layer alone would treat
//    every desk in the office as one attacker. Reset on success.
const loginIpLimiter = createRateLimiter({
  limit: env.rateLimitLoginMax,
  windowMs: env.rateLimitLoginWindow * 1000,
});
const loginAccountLimiter = createRateLimiter({
  limit: env.rateLimitLoginAccountMax,
  windowMs: env.rateLimitLoginAccountWindow * 1000,
});
const loginDeviceLimiter = createRateLimiter({
  limit: env.rateLimitLoginDeviceMax,
  windowMs: env.rateLimitLoginDeviceWindow * 1000,
});

authRouter.post(
  '/auth/login',
  rateLimit({
    limiter: loginIpLimiter,
    action: 'LOGIN_IP',
    message: 'Too many login attempts from this network. Try again later.',
  }),
  asyncHandler(async (req, res) => {
    const check = validator(req.body);
    check.email('email', { required: true });
    check.string('password', { required: true, min: 1, max: 200, trim: false });
    const { email, password } = check.result();

    const deviceKey = req.deviceId ?? 'unknown';

    enforceLimit(res, loginAccountLimiter, email, {
      code: 'ACCOUNT_RATE_LIMIT',
      message: 'Too many sign-in attempts for this account. Try again shortly.',
      layer: 'LOGIN_ACCOUNT',
      actor: email,
    });

    enforceLimit(res, loginDeviceLimiter, deviceKey, {
      code: 'DEVICE_RATE_LIMIT',
      message: 'Too many sign-in attempts from this browser. Try again shortly.',
      layer: 'LOGIN_DEVICE',
      actor: deviceKey,
    });

    const user = await authenticate(email, password);
    loginAccountLimiter.reset(email);
    loginDeviceLimiter.reset(deviceKey);

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
