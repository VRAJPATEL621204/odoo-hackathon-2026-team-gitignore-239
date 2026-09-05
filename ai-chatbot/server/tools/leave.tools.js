const adapter = require('../adapters/peoplepay360.adapter');

// TODO(real-project): confirm real field names for leave balance/requests.
async function getLeaveBalance(ctx) {
  const record = await adapter.get('LEAVE_BALANCE', ctx);
  const { annual, sick, casual } = record || {};
  return { annual, sick, casual };
}

async function getLeaveRequests(ctx) {
  const record = await adapter.get('LEAVE_REQUESTS', ctx);
  const requests = Array.isArray(record?.requests) ? record.requests : [];
  return { requests: requests.map((r) => ({ id: r.id, startDate: r.startDate, endDate: r.endDate, status: r.status, type: r.type })) };
}

/**
 * Read-only pre-check used to build the confirmation message in chat.service
 * BEFORE anything is written. Never mutates data.
 */
async function validateLeaveRequest(ctx, entities) {
  const balance = await getLeaveBalance(ctx);
  const days = countBusinessDays(entities.startDate, entities.endDate);
  const type = entities.leaveType || 'annual';
  const available = balance[type] ?? 0;

  if (days <= 0) {
    return { valid: false, reason: 'INVALID_DATE_RANGE', days };
  }
  if (days > available) {
    return { valid: false, reason: 'INSUFFICIENT_BALANCE', days, available, type };
  }
  return { valid: true, days, available, type };
}

async function createLeaveRequest(ctx, entities) {
  const body = {
    startDate: entities.startDate,
    endDate: entities.endDate,
    type: entities.leaveType || 'annual',
    reason: entities.reason || undefined,
  };
  const record = await adapter.post('LEAVE_CREATE', ctx, body);
  return { id: record?.id, status: record?.status || 'submitted', startDate: body.startDate, endDate: body.endDate };
}

function countBusinessDays(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

module.exports = { getLeaveBalance, getLeaveRequests, validateLeaveRequest, createLeaveRequest };
