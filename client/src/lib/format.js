/**
 * Display formatting shared by every screen.
 *
 * Dates arrive from the API as ISO strings for `date` columns, which are
 * UTC-midnight instants. They are read back in UTC so a browser in IST shows
 * "01-Jan-2026" for 2026-01-01 rather than the previous day.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "01-Jan-2026", the format the reference screens use. */
export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${String(date.getUTCDate()).padStart(2, '0')}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

/** "2026-01-01", the value a date input expects. */
export function toDateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

/** Indian-format rupees, matching the payslips and the dashboard. */
export function formatMoney(value) {
  if (value === null || value === undefined || value === '') return '—';
  return `₹${Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Rupees in the compact Indian scale — "₹19.8L", "₹1.4Cr", "₹8k".
 *
 * For chart labels and column headers where the full grouped number
 * ("₹19,77,612.42") is too wide to sit above a bar. The dashboard mock writes
 * its figures this way.
 */
export function formatMoneyShort(value) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  const abs = Math.abs(number);
  const sign = number < 0 ? '-' : '';
  const trim = (n) => `${Number(n.toFixed(1))}`;

  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7)}Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5)}L`;
  if (abs >= 1e3) return `${sign}₹${Math.round(abs / 1e3)}k`;
  return `${sign}₹${Math.round(abs)}`;
}

/** Minutes from midnight as "09:00", for the working schedule table. */
export function minutesToTime(minutes) {
  if (minutes === null || minutes === undefined) return '';
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** "09:00" back to minutes from midnight, or null when unparseable. */
export function timeToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes > 1440 ? null : minutes;
}

/** Hours as "8h" or "7.5h", never "8.00h". */
export function formatHours(value) {
  if (value === null || value === undefined) return '—';
  return `${Number(value)}h`;
}

/** Initials for an avatar, at most two letters. */
export function initials(name) {
  return (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

/** Badge colour for a status value, so one status never has two colours. */
export function statusTone(status) {
  switch (status) {
    case 'ACTIVE':
    case 'RUNNING':
    case 'APPROVED':
    case 'PAID':
      return 'success';
    case 'DRAFT':
    case 'INACTIVE':
      return 'default';
    case 'EXPIRED':
    case 'REFUSED':
      return 'danger';
    default:
      return 'info';
  }
}

/** "RUNNING" reads as "Running" in every table. */
export function titleCase(value) {
  if (!value) return '—';
  return value.charAt(0) + value.slice(1).toLowerCase();
}

/**
 * Hours as the attendance widget writes them: "6h 56m", not "6.93".
 *
 * Attendance is read as a duration people compare against their working day,
 * and hours and minutes are how that is read at a glance. The unit on each
 * part (rather than "6h56") is what keeps it reading as a duration instead of
 * a clock time.
 */
export function formatDuration(hours) {
  if (hours === null || hours === undefined) return '0h 00m';
  const totalMinutes = Math.max(0, Math.round(Number(hours) * 60));
  return `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, '0')}m`;
}

/**
 * Hours as "6 hr 48 min", spelled out for the attendance card's own panel.
 *
 * `formatDuration`'s "6h48" stays everywhere else (Dashboard, the attendance
 * list, payslips) since that shorthand is already established there; this is
 * a separate function rather than a change to it for exactly that reason.
 */
export function formatWorkedDuration(hours) {
  if (hours === null || hours === undefined) return '0 hr 00 min';
  const totalMinutes = Math.max(0, Math.round(Number(hours) * 60));
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${wholeHours} hr ${String(minutes).padStart(2, '0')} min`;
}

/** An instant as "9:48 AM" in the reader's own timezone. */
export function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** An instant as "02-Sep-2026 09:05", for an attendance record. */
export function formatDateTime(value) {
  if (!value) return '—';
  return `${formatDate(value)} ${formatTime(value)}`;
}

/**
 * An instant as the value a `datetime-local` input expects.
 *
 * The input works in the browser's own timezone, so the UTC instant is shifted
 * by the local offset before the ISO string is trimmed; using toISOString
 * directly would show every time shifted by the offset.
 */
export function toDateTimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

/** A `datetime-local` value back to an ISO instant, or null when empty. */
export function fromDateTimeLocal(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
