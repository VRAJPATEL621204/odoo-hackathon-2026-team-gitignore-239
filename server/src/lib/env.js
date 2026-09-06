import dotenv from 'dotenv';

dotenv.config();

/**
 * Reads and validates every environment variable the server depends on.
 *
 * Validation happens once, at import time, so a missing or malformed value
 * crashes the process at startup with a readable message instead of surfacing
 * as a confusing runtime failure on the first request.
 */

const errors = [];

function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    errors.push(`${name} is required but not set`);
    return '';
  }
  return value.trim();
}

function optional(name, fallback) {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : fallback;
}

function integer(name, fallback) {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    errors.push(`${name} must be a positive integer, received "${raw}"`);
    return fallback;
  }
  return parsed;
}

function nonNegativeInteger(name, fallback) {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    errors.push(`${name} must be a non-negative integer, received "${raw}"`);
    return fallback;
  }
  return parsed;
}

const databaseUrl = required('DATABASE_URL');
const jwtSecret = required('JWT_SECRET');

// A short secret makes the session signature trivially brute-forceable. We
// refuse to boot rather than run with a token anyone can forge.
if (jwtSecret && jwtSecret.length < 32) {
  errors.push(`JWT_SECRET must be at least 32 characters, received ${jwtSecret.length}`);
}

const clientOrigin = optional('CLIENT_ORIGIN', 'http://localhost:5173');

// Google sign-in is optional, not required: both are read with `optional()`
// rather than `required()` so a deployment that never configures Google
// still boots and the existing email/password login is unaffected. The
// callback defaults to this same origin's /api route, which is correct
// whenever the browser reaches the API through the client's own origin (the
// Vite proxy in development, or the single served origin in production) —
// only a deployment where the API is on a different host needs to override it.
const googleClientId = optional('GOOGLE_CLIENT_ID', '');
const googleClientSecret = optional('GOOGLE_CLIENT_SECRET', '');
const googleCallbackUrl = optional('GOOGLE_CALLBACK_URL', `${clientOrigin}/api/auth/google/callback`);

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: integer('PORT', 5000),
  databaseUrl,
  jwtSecret,
  jwtExpiresInSeconds: integer('JWT_EXPIRES_IN_SECONDS', 8 * 60 * 60),
  clientOrigin,
  googleClientId,
  googleClientSecret,
  googleCallbackUrl,
  trustProxyHops: nonNegativeInteger('TRUST_PROXY_HOPS', 0),
  // Login is the only broadly rate-limited route, on three independent keys:
  // source IP (blunt cap on distributed brute force), account email (locks
  // out attempts at one account regardless of which IP they come from), and
  // an anonymous per-browser cookie (catches many accounts tried from one
  // browser even behind a shared/NAT IP). Each is checked separately so a
  // shared office IP does not throttle every employee behind it.
  rateLimitLoginMax: integer('RATE_LIMIT_LOGIN_MAX', 5),
  rateLimitLoginWindow: integer('RATE_LIMIT_LOGIN_WINDOW', 60),
  rateLimitLoginAccountMax: integer('RATE_LIMIT_LOGIN_ACCOUNT_MAX', 10),
  rateLimitLoginAccountWindow: integer('RATE_LIMIT_LOGIN_ACCOUNT_WINDOW', 900),
  rateLimitLoginDeviceMax: integer('RATE_LIMIT_LOGIN_DEVICE_MAX', 8),
  rateLimitLoginDeviceWindow: integer('RATE_LIMIT_LOGIN_DEVICE_WINDOW', 60),
  maxBulkEmailRecipients: integer('MAX_BULK_EMAIL_RECIPIENTS', 500),
  // A sitewide backstop on every write (POST/PUT/PATCH/DELETE) across the
  // whole app — HR records, attendance punches, timeoff requests, user
  // management, payroll config — anything not already covered by a more
  // specific limiter above. Two independent keys, same reasoning as login:
  // IP catches a script hammering the API from one machine, account catches
  // one compromised or scripted account regardless of which IP it uses.
  writeRateLimitIpMax: integer('WRITE_RATE_LIMIT_IP_MAX', 60),
  writeRateLimitIpWindow: integer('WRITE_RATE_LIMIT_IP_WINDOW', 60),
  writeRateLimitUserMax: integer('WRITE_RATE_LIMIT_USER_MAX', 30),
  writeRateLimitUserWindow: integer('WRITE_RATE_LIMIT_USER_WINDOW', 60),
  // Per-resource cooldowns stop a button being mashed into repeated work —
  // independent of the in-flight concurrency locks, which only stop two
  // requests overlapping, not a second one arriving right after the first
  // finished.
  actionCooldownSeconds: integer('ACTION_COOLDOWN_SECONDS', 10),
  emailCooldownSeconds: integer('EMAIL_COOLDOWN_SECONDS', 5 * 60),
  pdfCooldownSeconds: integer('PDF_COOLDOWN_SECONDS', 5),
  companyName: optional('COMPANY_NAME', 'OXP Pvt Ltd'),
  // The timezone a business day is measured in. Attendance check-ins are
  // instants; which calendar day they belong to depends on where the company
  // is, not on where the server happens to run.
  companyTimezone: optional('COMPANY_TIMEZONE', 'Asia/Kolkata'),
  smtpHost: optional('SMTP_HOST', 'localhost'),
  smtpPort: integer('SMTP_PORT', 1025),
  // SMTP credentials enable authenticated providers and TLS. They are optional
  // here so the mail test can report a useful connection error when omitted.
  smtpUser: optional('SMTP_USER', ''),
  smtpPassword: optional('SMTP_PASSWORD', ''),
  // Port 465 is TLS from the first byte; 587 starts plain and upgrades with
  // STARTTLS. Set SMTP_SECURE explicitly to override the port-based guess.
  smtpSecure: optional('SMTP_SECURE', '') === 'true' || integer('SMTP_PORT', 1025) === 465,
  mailFrom: optional('MAIL_FROM', 'payroll@peoplepay360.test'),
};

export const isProduction = env.nodeEnv === 'production';

/** Whether "Sign in with Google" is configured. Both values are required
 * together — a client id with no secret (or vice versa) cannot complete the
 * OAuth exchange, so the feature stays off rather than failing at request time. */
export const googleAuthEnabled = Boolean(env.googleClientId && env.googleClientSecret);

if (errors.length > 0) {
  console.error('Invalid environment configuration:');
  for (const message of errors) console.error(`  - ${message}`);
  console.error('\nCopy server/.env.example to server/.env and fill in the values.');
  process.exit(1);
}
