import { Router } from 'express';
import { randomBytes } from 'node:crypto';

import { asyncHandler } from '../lib/asyncHandler.js';
import { validator } from '../lib/validate.js';
import { env, googleAuthEnabled } from '../lib/env.js';
import {
  clearOAuthStateCookie,
  clearSessionCookie,
  OAUTH_STATE_COOKIE,
  setOAuthStateCookie,
  setSessionCookie,
} from '../lib/cookies.js';
import { signSession } from '../lib/token.js';
import { createRateLimiter, enforceLimit, rateLimit } from '../lib/rateLimit.js';
import { authenticate, authenticateWithGoogle, sessionPayload } from '../services/auth.service.js';
import { buildGoogleAuthUrl, verifyGoogleCode } from '../lib/googleAuth.js';
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
 * Google sign-in.
 *
 * Unauthenticated and side-effect free, so the login page can call it on
 * mount to decide whether to show the button at all — a misconfigured or
 * disabled Google integration should be invisible to a user, not a dead
 * button that fails when clicked.
 */
authRouter.get('/auth/google/status', (_req, res) => {
  res.json({ enabled: googleAuthEnabled });
});

/** A safe place to send the browser back to the login screen with a reason. */
function redirectToLoginWithError(res, code) {
  const url = new URL('/login', env.clientOrigin);
  url.searchParams.set('googleError', code);
  res.redirect(url.toString());
}

authRouter.get(
  '/auth/google',
  rateLimit({
    limiter: loginIpLimiter,
    action: 'GOOGLE_LOGIN_IP',
    message: 'Too many sign-in attempts from this network. Try again later.',
  }),
  (req, res) => {
    if (!googleAuthEnabled) return redirectToLoginWithError(res, 'unavailable');

    // One-time value bound to this browser via a short-lived cookie, and
    // checked against what Google echoes back on the callback (see
    // setOAuthStateCookie's own comment for why this defeats a forged
    // callback request).
    const state = randomBytes(24).toString('hex');
    setOAuthStateCookie(res, state);
    res.redirect(buildGoogleAuthUrl(state));
  }
);

authRouter.get(
  '/auth/google/callback',
  rateLimit({
    limiter: loginIpLimiter,
    action: 'GOOGLE_CALLBACK_IP',
    message: 'Too many sign-in attempts from this network. Try again later.',
  }),
  asyncHandler(async (req, res) => {
    if (!googleAuthEnabled) return redirectToLoginWithError(res, 'unavailable');

    const { code, state, error } = req.query;
    const expectedState = req.cookies?.[OAUTH_STATE_COOKIE];
    clearOAuthStateCookie(res);

    // Google sends `error=access_denied` when the user cancels at the
    // consent screen — a normal outcome, not a failure worth logging.
    if (error) {
      return redirectToLoginWithError(res, error === 'access_denied' ? 'cancelled' : 'failed');
    }

    if (
      typeof code !== 'string' ||
      typeof state !== 'string' ||
      !expectedState ||
      state !== expectedState
    ) {
      return redirectToLoginWithError(res, 'failed');
    }

    let claims;
    try {
      claims = await verifyGoogleCode(code);
    } catch {
      // Never log the code or token themselves — only that verification
      // failed, which is all a reader of the logs needs to investigate.
      console.error('[google-auth] token exchange or verification failed');
      return redirectToLoginWithError(res, 'failed');
    }

    let user;
    try {
      user = await authenticateWithGoogle({
        email: claims?.email,
        emailVerified: claims?.email_verified === true,
      });
    } catch (authError) {
      const code =
        authError?.code === 'GOOGLE_ACCOUNT_NOT_FOUND'
          ? 'unauthorized'
          : authError?.code === 'ACCOUNT_INACTIVE'
            ? 'inactive'
            : 'failed';
      return redirectToLoginWithError(res, code);
    }

    setSessionCookie(res, signSession(user.id), env.jwtExpiresInSeconds);
    res.redirect(env.clientOrigin);
  })
);

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
