import { validationError } from './errors.js';
import { parseDateOnly } from './dates.js';

/**
 * A small hand-written validator.
 *
 * Collects every field problem in one pass so the client can highlight all of
 * them at once, then throws a single 422 carrying `{ field: message }`.
 * Deliberately not a validation library: the checks below are primitive type,
 * range and enum tests, and the main benefit of a schema library — types
 * shared with the client — does not apply because the client is JavaScript.
 */
export class Validator {
  constructor(body) {
    this.body = body ?? {};
    this.fields = {};
    this.values = {};
  }

  #fail(field, message) {
    if (!this.fields[field]) this.fields[field] = message;
    return undefined;
  }

  #present(field) {
    const value = this.body[field];
    return value !== undefined && value !== null && value !== '';
  }

  string(field, { required = false, min = 1, max = 255, trim = true } = {}) {
    if (!this.#present(field)) {
      if (required) this.#fail(field, 'This field is required.');
      return undefined;
    }
    let value = this.body[field];
    if (typeof value !== 'string') return this.#fail(field, 'Must be text.');
    if (trim) value = value.trim();
    if (value.length < min) return this.#fail(field, `Must be at least ${min} characters.`);
    if (value.length > max) return this.#fail(field, `Must be at most ${max} characters.`);
    this.values[field] = value;
    return value;
  }

  email(field, { required = false } = {}) {
    const value = this.string(field, { required, max: 254 });
    if (value === undefined) return undefined;
    // Deliberately permissive: the only reliable proof an address works is
    // sending to it. This rejects obvious typos without excluding valid forms.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return this.#fail(field, 'Enter a valid email address.');
    }
    this.values[field] = value.toLowerCase();
    return this.values[field];
  }

  number(field, { required = false, min, max, integer = false } = {}) {
    if (!this.#present(field)) {
      if (required) this.#fail(field, 'This field is required.');
      return undefined;
    }
    const value = Number(this.body[field]);
    if (!Number.isFinite(value)) return this.#fail(field, 'Must be a number.');
    if (integer && !Number.isInteger(value)) return this.#fail(field, 'Must be a whole number.');
    if (min !== undefined && value < min) return this.#fail(field, `Must be at least ${min}.`);
    if (max !== undefined && value > max) return this.#fail(field, `Must be at most ${max}.`);
    this.values[field] = value;
    return value;
  }

  boolean(field, { required = false, fallback } = {}) {
    if (!this.#present(field) && typeof this.body[field] !== 'boolean') {
      if (required) this.#fail(field, 'This field is required.');
      this.values[field] = fallback;
      return fallback;
    }
    const raw = this.body[field];
    const value = typeof raw === 'boolean' ? raw : raw === 'true';
    this.values[field] = value;
    return value;
  }

  enum(field, allowed, { required = false } = {}) {
    if (!this.#present(field)) {
      if (required) this.#fail(field, 'This field is required.');
      return undefined;
    }
    const value = String(this.body[field]);
    if (!allowed.includes(value)) {
      return this.#fail(field, `Must be one of: ${allowed.join(', ')}.`);
    }
    this.values[field] = value;
    return value;
  }

  /** Parses a "YYYY-MM-DD" business date into a UTC-midnight Date. */
  date(field, { required = false } = {}) {
    if (!this.#present(field)) {
      if (required) this.#fail(field, 'This field is required.');
      return undefined;
    }
    const value = parseDateOnly(this.body[field]);
    if (!value) return this.#fail(field, 'Enter a valid date as YYYY-MM-DD.');
    this.values[field] = value;
    return value;
  }

  /** An ISO timestamp, used for check-in and check-out instants. */
  timestamp(field, { required = false } = {}) {
    if (!this.#present(field)) {
      if (required) this.#fail(field, 'This field is required.');
      return undefined;
    }
    const value = new Date(this.body[field]);
    if (Number.isNaN(value.getTime())) return this.#fail(field, 'Enter a valid date and time.');
    this.values[field] = value;
    return value;
  }

  id(field, { required = false } = {}) {
    return this.number(field, { required, min: 1, integer: true });
  }

  array(field, { required = false, min = 0, max = 500 } = {}) {
    const value = this.body[field];
    if (value === undefined || value === null) {
      if (required) this.#fail(field, 'This field is required.');
      return undefined;
    }
    if (!Array.isArray(value)) return this.#fail(field, 'Must be a list.');
    if (value.length < min) return this.#fail(field, `Provide at least ${min} item(s).`);
    if (value.length > max) return this.#fail(field, `Provide at most ${max} item(s).`);
    this.values[field] = value;
    return value;
  }

  /** Records a problem discovered by a cross-field rule. */
  reject(field, message) {
    this.#fail(field, message);
  }

  get hasErrors() {
    return Object.keys(this.fields).length > 0;
  }

  /** Throws a 422 when anything failed, otherwise returns the parsed values. */
  result() {
    if (this.hasErrors) throw validationError(this.fields);
    return this.values;
  }
}

export function validator(body) {
  return new Validator(body);
}
