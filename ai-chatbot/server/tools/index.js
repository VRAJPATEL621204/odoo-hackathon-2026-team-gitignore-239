/**
 * Registry of every executable tool, keyed by the toolName strings used in
 * ai/intents/intent-map.js. This is the only place chat.service is allowed
 * to look up a callable — it cannot invoke arbitrary functions by name.
 */
const employee = require('./employee.tools');
const attendance = require('./attendance.tools');
const leave = require('./leave.tools');
const payroll = require('./payroll.tools');
const contract = require('./contract.tools');

const REGISTRY = {
  getEmployeeProfile: employee.getEmployeeProfile,
  getTeam: employee.getTeam,
  getEmployeeDetails: employee.getEmployeeDetails,

  getAttendance: attendance.getAttendance,
  getAttendanceSummary: attendance.getAttendanceSummary,
  getAttendanceStatus: attendance.getAttendanceStatus,

  getLeaveBalance: leave.getLeaveBalance,
  getLeaveRequests: leave.getLeaveRequests,
  createLeaveRequest: leave.createLeaveRequest,

  getPayslip: payroll.getPayslip,
  getPayrollSummary: payroll.getPayrollSummary,
  comparePayslips: payroll.comparePayslips,
  explainDeductions: payroll.explainDeductions,

  getContract: contract.getContract,
  getContractStatus: contract.getContractStatus,
};

// Pre-execution validators for mutating tools (used to build confirmation
// messages before anything is written). Optional — only mutating tools need one.
const VALIDATORS = {
  createLeaveRequest: leave.validateLeaveRequest,
};

function getTool(toolName) {
  return REGISTRY[toolName] || null;
}

function getValidator(toolName) {
  return VALIDATORS[toolName] || null;
}

module.exports = { getTool, getValidator };
