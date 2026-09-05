/**
 * Client-side field validation.
 *
 * Every form here is a plain controlled input with `noValidate` on the
 * `<form>`, so nothing blocks submission unless we check it ourselves. These
 * mirror the rules in `server/src/lib/validate.js` so a bad value is caught
 * before the round trip instead of only after a 422 comes back.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** +91 followed by a 10-digit mobile number starting 6-9; spaces/hyphens ignored. */
const INDIA_PHONE_PATTERN = /^\+91[6-9]\d{9}$/;
const BANK_ACCOUNT_PATTERN = /^[A-Za-z0-9\s-]+$/;

/** Returns an error message, or null when the value is fine. */
export function validateEmail(value, { required = false } = {}) {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return required ? 'This field is required.' : null;
  if (trimmed.length > 254 || !EMAIL_PATTERN.test(trimmed)) {
    return 'Enter a valid email address.';
  }
  return null;
}

/** Indian numbers only: +91 followed by a 10-digit mobile number starting 6-9. */
export function validatePhone(value, { required = false } = {}) {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return required ? 'This field is required.' : null;
  const compact = trimmed.replace(/[\s-]/g, '');
  if (!INDIA_PHONE_PATTERN.test(compact)) {
    return 'Enter a valid Indian phone number, e.g. +91 98765 43210.';
  }
  return null;
}

export function validateBankAccount(value, { required = false } = {}) {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return required ? 'This field is required.' : null;
  if (trimmed.length < 5 || trimmed.length > 60 || !BANK_ACCOUNT_PATTERN.test(trimmed)) {
    return 'Enter a valid bank account number (letters, numbers, spaces or hyphens, 5-60 characters).';
  }
  return null;
}

/**
 * Runs `checks` (each `[field, validatorFn, options]`) against `form` and
 * returns a `{ field: message }` map for whatever failed.
 */
export function runValidation(form, checks) {
  const errors = {};
  for (const [field, check, options] of checks) {
    const message = check(form[field], options);
    if (message) errors[field] = message;
  }
  return errors;
}
