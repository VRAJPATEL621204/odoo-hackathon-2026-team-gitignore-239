const { scanOutgoing } = require('./privacy.service');

const TYPES = ['TEXT', 'CARD', 'TABLE', 'COMPARISON', 'QUICK_ACTIONS', 'NAVIGATION', 'CONFIRMATION', 'ERROR'];

const TOP_QUICK_LINKS = [
  { id: 'LEAVE', label: 'Leave & Time Off', icon: '🌴', path: '/time-off', description: 'Apply vacation, check balances' },
  { id: 'PAYROLL', label: 'Payroll & Payslips', icon: '💳', path: '/payroll', description: 'Salary slips & tax deductions' },
  { id: 'ATTENDANCE', label: 'Attendance Tracker', icon: '⏱️', path: '/attendance', description: 'Clock in/out & punch logs' },
  { id: 'EMPLOYEES', label: 'Employee Directory', icon: '👥', path: '/employees', description: 'Team directory & contacts' },
  { id: 'CONTRACTS', label: 'Contracts & Terms', icon: '📜', path: '/contracts', description: 'Employment contract agreements' },
  { id: 'DASHBOARD', label: 'Executive Dashboard', icon: '📊', path: '/dashboard', description: 'Overview & HR KPIs' },
];

function getLinksForDomain(domainOrAction) {
  const str = String(domainOrAction || '').toUpperCase();
  if (str.includes('ATTENDANCE')) {
    return [TOP_QUICK_LINKS[2], TOP_QUICK_LINKS[0], TOP_QUICK_LINKS[1]];
  }
  if (str.includes('LEAVE')) {
    return [TOP_QUICK_LINKS[0], TOP_QUICK_LINKS[2], TOP_QUICK_LINKS[1]];
  }
  if (str.includes('PAYROLL')) {
    return [TOP_QUICK_LINKS[1], TOP_QUICK_LINKS[0], TOP_QUICK_LINKS[2]];
  }
  if (str.includes('EMPLOYEE')) {
    return [TOP_QUICK_LINKS[3], TOP_QUICK_LINKS[0], TOP_QUICK_LINKS[4]];
  }
  if (str.includes('CONTRACT')) {
    return [TOP_QUICK_LINKS[4], TOP_QUICK_LINKS[3], TOP_QUICK_LINKS[1]];
  }
  return TOP_QUICK_LINKS.slice(0, 4);
}

function build({ type, message, data, sources, verified, quickActions, navigationId, confirmationId, quickLinks }) {
  if (!TYPES.includes(type)) {
    throw new Error(`Unknown response type: ${type}`);
  }
  const payload = {
    success: type !== 'ERROR',
    type,
    message,
    data: data ?? null,
    sources: sources ?? [],
    verified: verified ?? false,
  };
  if (quickActions) payload.quickActions = quickActions;
  if (navigationId) payload.navigationId = navigationId;
  if (confirmationId) payload.confirmationId = confirmationId;
  if (quickLinks) payload.quickLinks = quickLinks;

  // Final scrub — belt-and-braces on top of adapter/tool-level masking,
  // right before anything leaves this service.
  return scanOutgoing(payload);
}

const text = (message, opts = {}) => build({ type: 'TEXT', message, ...opts });
const error = (message, opts = {}) => build({ type: 'ERROR', message, ...opts });
const card = (message, data, sources, verified, opts = {}) => build({ type: 'CARD', message, data, sources, verified, ...opts });
const table = (message, data, sources, verified, opts = {}) => build({ type: 'TABLE', message, data, sources, verified, ...opts });
const comparison = (message, data, sources, verified, opts = {}) => build({ type: 'COMPARISON', message, data, sources, verified, ...opts });
const quickActions = (message, actions, opts = {}) => build({ type: 'QUICK_ACTIONS', message, quickActions: actions, ...opts });
const navigation = (message, navigationId, opts = {}) => build({ type: 'NAVIGATION', message, navigationId, ...opts });
const confirmation = (message, data, confirmationId, opts = {}) => build({ type: 'CONFIRMATION', message, data, confirmationId, ...opts });

module.exports = {
  build,
  text,
  error,
  card,
  table,
  comparison,
  quickActions,
  navigation,
  confirmation,
  TYPES,
  TOP_QUICK_LINKS,
  getLinksForDomain,
};
