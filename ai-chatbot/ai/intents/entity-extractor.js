/**
 * Deliberately simple heuristic extraction used by the hardcoded
 * trigger-match path (server/services/intent.service.js) so it doesn't need
 * an LLM call to pull out obvious dates/periods. This is not a general NLP
 * date parser — it covers the common phrasings tested in this project
 * (ISO dates, "Month Day to Month Day", "last/this month"). The LLM
 * classification path extracts entities on its own for anything fancier.
 */

const MONTH_NAMES = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

const MONTH_INDEX = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

// Builds the ISO date from plain month/day strings — deliberately avoids
// Date/toISOString here, since that round-trip shifts the calendar day
// whenever the server's local timezone is ahead of UTC (e.g. IST).
function parseMonthDay(str, year) {
  const match = str.trim().match(/^([a-z]+)\.?\s+(\d{1,2})$/i);
  if (!match) return null;
  const prefix = match[1].slice(0, match[1].length >= 4 && match[1].toLowerCase().startsWith('sept') ? 4 : 3).toLowerCase();
  const monthIndex = MONTH_INDEX[prefix];
  const day = parseInt(match[2], 10);
  if (monthIndex === undefined || !day) return null;
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function extractDateRange(text) {
  const isoMatches = text.match(/\d{4}-\d{2}-\d{2}/g);
  if (isoMatches && isoMatches.length >= 2) return { startDate: isoMatches[0], endDate: isoMatches[1] };
  if (isoMatches && isoMatches.length === 1) return { startDate: isoMatches[0], endDate: isoMatches[0] };

  const rangeRe = new RegExp(
    `((?:${MONTH_NAMES})\\s+\\d{1,2})\\s*(?:to|-|until|through)\\s*((?:${MONTH_NAMES})?\\s*\\d{1,2})`,
    'i'
  );
  const match = text.match(rangeRe);
  if (!match) return {};

  const year = new Date().getFullYear();
  const startDate = parseMonthDay(match[1], year);
  let endPart = match[2].trim();
  if (!new RegExp(MONTH_NAMES, 'i').test(endPart)) {
    const month = match[1].match(new RegExp(MONTH_NAMES, 'i'))[0];
    endPart = `${month} ${endPart}`;
  }
  const endDate = parseMonthDay(endPart, year);

  return startDate && endDate ? { startDate, endDate } : {};
}

function extractPeriod(text) {
  if (/\blast month\b|\bprevious month\b/i.test(text)) return { period: 'previous_month' };
  if (/\bthis month\b|\bcurrent month\b/i.test(text)) return { period: 'current_month' };
  return {};
}

function extractCommonEntities(text) {
  return { ...extractDateRange(text), ...extractPeriod(text) };
}

module.exports = { extractCommonEntities };
