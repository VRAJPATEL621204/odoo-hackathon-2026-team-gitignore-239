const adapter = require('../adapters/peoplepay360.adapter');

// TODO(real-project): confirm real field names for attendance records.
async function getAttendance(ctx, entities) {
  const from = entities.from || defaultRangeStart();
  const to = entities.to || today();
  const record = await adapter.get('ATTENDANCE', ctx, { from, to });
  const days = Array.isArray(record?.days) ? record.days : [];
  return { from, to, days: days.map((d) => ({ date: d.date, status: d.status, hours: d.hours })) };
}

async function getAttendanceSummary(ctx, entities) {
  const period = entities.period || 'current_month';
  const record = await adapter.get('ATTENDANCE_SUMMARY', ctx, { period });
  const { present, absent, late, leaveDays } = record || {};
  return { period, present, absent, late, leaveDays };
}

async function getAttendanceStatus(ctx) {
  const record = await adapter.get('ATTENDANCE_STATUS', ctx);
  const { status, checkInTime, checkOutTime } = record || {};
  return { status, checkInTime, checkOutTime };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
function defaultRangeStart() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

module.exports = { getAttendance, getAttendanceSummary, getAttendanceStatus };
