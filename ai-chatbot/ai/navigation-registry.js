/**
 * The ONLY destinations the chatbot may ever point the frontend to. The LLM
 * and any service in this codebase can reference a navigationId, never a
 * raw URL — the frontend resolves navigationId -> route itself.
 */
const NAVIGATION = {
  DASHBOARD: '/dashboard',
  EMPLOYEES: '/employees',
  ATTENDANCE: '/attendance',
  LEAVE: '/time-off',
  PAYROLL: '/payroll',
  CONTRACTS: '/contracts',
  USERS: '/users',
};

function isValidNavigationId(id) {
  return Object.prototype.hasOwnProperty.call(NAVIGATION, id);
}

// Hardcoded phrase -> navigationId matching, checked before intent detection
// Supports rich employee phrasings to immediately open portal pages
const NAV_TRIGGERS = [
  {
    re: /\b(open|go to|take me to|show|navigate to|redirect to|view)\s+(the\s+)?dashboard\b|^dashboard(\s+page)?$/i,
    id: 'DASHBOARD',
  },
  {
    re: /\b(open|go to|take me to|show|navigate to|redirect to|view)\s+(the\s+)?(employees?|employee list|staff|team directory)\b|^(employees?|directory)(\s+page)?$/i,
    id: 'EMPLOYEES',
  },
  {
    re: /\b(open|go to|take me to|show|navigate to|redirect to|view)\s+(the\s+)?attendance(\s+(page|portal|tracker))?\b|^(attendance|punch logs?)(\s+page)?$/i,
    id: 'ATTENDANCE',
  },
  {
    re: /\b(open|go to|take me to|show|navigate to|redirect to|view)\s+(the\s+)?(leave|time.?off|vacation)(\s+(page|portal|requests?))?\b|^(leave|time.?off)(\s+page)?$/i,
    id: 'LEAVE',
  },
  {
    re: /\b(open|go to|take me to|show|navigate to|redirect to|view)\s+(the\s+)?(payroll|payslips?|salary slips?)(\s+(page|portal|section))?\b|^(payroll|payslips?)(\s+page)?$/i,
    id: 'PAYROLL',
  },
  {
    re: /\b(open|go to|take me to|show|navigate to|redirect to|view)\s+(the\s+)?(contracts?|agreement)(\s+(page|section|document))?\b|^(contracts?|agreement)(\s+(page|section|document))?$/i,
    id: 'CONTRACTS',
  },
  {
    re: /\b(open|go to|take me to|show|navigate to|redirect to|view)\s+(the\s+)?users?(\s+page)?\b|^users(\s+page)?$/i,
    id: 'USERS',
  },
];

function matchNavigationTrigger(text) {
  const trimmed = (text || '').trim();
  for (const { re, id } of NAV_TRIGGERS) {
    if (re.test(trimmed)) return id;
  }
  return null;
}

module.exports = { NAVIGATION, isValidNavigationId, matchNavigationTrigger };
