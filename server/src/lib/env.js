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

const databaseUrl = required('DATABASE_URL');
const jwtSecret = required('JWT_SECRET');

// A short secret makes the session signature trivially brute-forceable. We
// refuse to boot rather than run with a token anyone can forge.
if (jwtSecret && jwtSecret.length < 32) {
  errors.push(`JWT_SECRET must be at least 32 characters, received ${jwtSecret.length}`);
}

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: integer('PORT', 5000),
  databaseUrl,
  jwtSecret,
  jwtExpiresInSeconds: integer('JWT_EXPIRES_IN_SECONDS', 8 * 60 * 60),
  clientOrigin: optional('CLIENT_ORIGIN', 'http://localhost:5173'),
  companyName: optional('COMPANY_NAME', 'OXP Pvt Ltd'),
  // The timezone a business day is measured in. Attendance check-ins are
  // instants; which calendar day they belong to depends on where the company
  // is, not on where the server happens to run.
  companyTimezone: optional('COMPANY_TIMEZONE', 'Asia/Kolkata'),
  smtpHost: optional('SMTP_HOST', 'localhost'),
  smtpPort: integer('SMTP_PORT', 1025),
  // Credentials are optional because Mailpit needs none. When they are set the
  // connection authenticates and upgrades to TLS, which every real provider
  // requires. Leaving them unset keeps local development working unchanged.
  smtpUser: optional('SMTP_USER', ''),
  smtpPassword: optional('SMTP_PASSWORD', ''),
  // Port 465 is TLS from the first byte; 587 starts plain and upgrades with
  // STARTTLS. Set SMTP_SECURE explicitly to override the port-based guess.
  smtpSecure: optional('SMTP_SECURE', '') === 'true' || integer('SMTP_PORT', 1025) === 465,
  mailFrom: optional('MAIL_FROM', 'payroll@peoplepay360.test'),
};

export const isProduction = env.nodeEnv === 'production';

if (errors.length > 0) {
  console.error('Invalid environment configuration:');
  for (const message of errors) console.error(`  - ${message}`);
  console.error('\nCopy server/.env.example to server/.env and fill in the values.');
  process.exit(1);
}
