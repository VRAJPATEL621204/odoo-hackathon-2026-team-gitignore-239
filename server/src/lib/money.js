/**
 * Money helpers.
 *
 * Every amount in the database is Decimal(12,2). Payroll arithmetic runs in
 * plain JavaScript numbers and is rounded to 2 decimals at each rule boundary,
 * which keeps results deterministic and makes payslip lines sum exactly to the
 * payslip totals.
 */

/**
 * Multiplies by a power of ten using the number's decimal string form.
 *
 * Multiplying by 100 directly reintroduces binary error: `1.005 * 100` is
 * 100.49999999999999, which rounds down to the wrong paisa. Re-parsing
 * "1.005e2" instead asks the runtime for the nearest double to 100.5, which is
 * exact. Splitting on "e" keeps values already in exponential form working.
 */
function shiftDecimal(value, exponent) {
  const [mantissa, currentExponent] = value.toString().split('e');
  const nextExponent = currentExponent ? Number(currentExponent) + exponent : exponent;
  return Number(`${mantissa}e${nextExponent}`);
}

/**
 * Rounds to 2 decimals, half away from zero.
 *
 * `Math.round` rounds half towards +Infinity, so `Math.round(-2.345 * 100)`
 * gives -234 instead of -235. Deductions are stored negative, so that bias
 * would systematically under-deduct. Rounding the magnitude and re-applying
 * the sign fixes it.
 */
export function round2(value) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`round2 expected a finite number, received ${value}`);
  }
  const sign = value < 0 ? -1 : 1;
  const rounded = shiftDecimal(Math.round(shiftDecimal(Math.abs(value), 2)), -2);
  return sign * rounded;
}

/**
 * Converts a Prisma Decimal (or number, or null) into a plain JSON number.
 *
 * Prisma returns Decimal objects that serialise to `{"s":1,"e":4,"d":[...]}`,
 * which would render as garbage in the UI. This is the single boundary where
 * that conversion happens.
 */
export function toMoney(value) {
  if (value === null || value === undefined) return null;
  return Number(value);
}

/** Formats a number as Indian-Rupee text for the web UI. */
export function formatMoney(value) {
  if (value === null || value === undefined) return '—';
  return Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
