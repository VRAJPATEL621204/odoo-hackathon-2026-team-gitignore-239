const adapter = require('../adapters/peoplepay360.adapter');

// Data-minimization: only the fields a chat answer actually needs are kept.
// TODO(real-project): adjust field names to match the real employee schema.
function pickProfileFields(record) {
  const { id, name, jobTitle, department, email } = record || {};
  return { id, name, jobTitle, department, email };
}

async function getEmployeeProfile(ctx) {
  const record = await adapter.get('EMPLOYEE_PROFILE', ctx);
  return pickProfileFields(record);
}

async function getTeam(ctx) {
  const record = await adapter.get('TEAM', ctx);
  const members = Array.isArray(record?.members) ? record.members : [];
  return { members: members.map((m) => ({ id: m.id, name: m.name, jobTitle: m.jobTitle })) };
}

async function getEmployeeDetails(ctx, entities) {
  const record = await adapter.get('EMPLOYEE_DETAILS', ctx, { employeeId: entities.employeeId });
  return pickProfileFields(record);
}

module.exports = { getEmployeeProfile, getTeam, getEmployeeDetails };
