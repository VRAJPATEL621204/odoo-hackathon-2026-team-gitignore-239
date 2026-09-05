/**
 * The single source of truth for every capability this chatbot can perform.
 * Nothing outside this file may register a new action. The LLM is only ever
 * told about the actions listed here (see ai/prompts/intent.prompt.js) and
 * chat.service refuses to execute anything whose id isn't in ACTIONS.
 *
 * toolName refers to an export from server/tools/index.js. requiresEntities
 * lists entity keys chat.service must have (from user text or context)
 * before the tool can run. mutating actions must go through the
 * confirm-before-execute flow (see server/services/chat.service.js).
 */

const ACTIONS = {
  'EMPLOYEE.get_profile': {
    domain: 'EMPLOYEE',
    action: 'get_profile',
    toolName: 'getEmployeeProfile',
    mutating: false,
    requiresEntities: [],
    triggers: [/\bmy profile\b/i, /\bwho am i\b/i, /\bmy (details|info|information)\b/i],
    label: 'My Profile',
  },
  'EMPLOYEE.get_team': {
    domain: 'EMPLOYEE',
    action: 'get_team',
    toolName: 'getTeam',
    mutating: false,
    requiresEntities: [],
    triggers: [/\bmy team\b/i, /\bwho (reports to|is on) my team\b/i, /\bdirect reports\b/i],
    label: 'My Team',
  },
  'EMPLOYEE.get_employee_details': {
    domain: 'EMPLOYEE',
    action: 'get_employee_details',
    toolName: 'getEmployeeDetails',
    mutating: false,
    requiresEntities: ['employeeId'],
    triggers: [/\bdetails for\b/i, /\bemployee (id|number)\b/i],
    label: 'Employee Details',
  },

  'ATTENDANCE.get_attendance': {
    domain: 'ATTENDANCE',
    action: 'get_attendance',
    toolName: 'getAttendance',
    mutating: false,
    requiresEntities: [],
    triggers: [/\battendance (for|on|record)\b/i, /\bmy attendance\b/i],
    label: 'Detailed Attendance',
  },
  'ATTENDANCE.attendance_summary': {
    domain: 'ATTENDANCE',
    action: 'attendance_summary',
    toolName: 'getAttendanceSummary',
    mutating: false,
    requiresEntities: [],
    triggers: [/\battendance summary\b/i, /\bhow many days (did i work|present)\b/i],
    label: "This Month's Summary",
  },
  'ATTENDANCE.attendance_status': {
    domain: 'ATTENDANCE',
    action: 'attendance_status',
    toolName: 'getAttendanceStatus',
    mutating: false,
    requiresEntities: [],
    triggers: [
      /\bam i (clocked in|checked in)\b/i,
      /\btoday'?s attendance\b/i,
      /\btoday'?s status\b/i,
      /\btoday\s+attendance\b/i,
      /\battendance\s+(today|for today)\b/i,
      /\bclock(ed)?\s*in\s*(time|status)?\b/i,
      /\bcheck(ed)?\s*in\s*(time|status)?\b/i,
      /\bdid i (clock|punch|check) in\b/i,
      /\bmy check\s*in\b/i,
    ],
    label: "Today's Status",
  },

  'LEAVE.get_leave_balance': {
    domain: 'LEAVE',
    action: 'get_leave_balance',
    toolName: 'getLeaveBalance',
    mutating: false,
    requiresEntities: [],
    triggers: [/\bleave balance\b/i, /\bhow many leaves?\b/i, /\bleaves? (left|remaining)\b/i],
    label: 'Leave Balance',
  },
  'LEAVE.get_leave_requests': {
    domain: 'LEAVE',
    action: 'get_leave_requests',
    toolName: 'getLeaveRequests',
    mutating: false,
    requiresEntities: [],
    triggers: [/\bmy leave requests?\b/i, /\bpending leaves?\b/i, /\bleave (history|status)\b/i],
    label: 'My Leave Requests',
  },
  'LEAVE.create_leave_request': {
    domain: 'LEAVE',
    action: 'create_leave_request',
    toolName: 'createLeaveRequest',
    mutating: true,
    requiresEntities: ['startDate', 'endDate'],
    triggers: [/\bapply (for )?leave\b/i, /\brequest (time off|leave)\b/i, /\bbook leave\b/i],
    label: 'Apply for Leave',
  },
  'LEAVE.leave_policy': {
    domain: 'LEAVE',
    action: 'leave_policy',
    toolName: null, // served from knowledge base, no personal data involved
    mutating: false,
    requiresEntities: [],
    triggers: [/\bleave policy\b/i, /\bhow does leave work\b/i],
    label: 'Leave Policy',
    knowledgeFile: 'leave.json',
  },

  'PAYROLL.get_payslip': {
    domain: 'PAYROLL',
    action: 'get_payslip',
    toolName: 'getPayslip',
    mutating: false,
    requiresEntities: [],
    triggers: [/\bmy payslip\b/i, /\bshow (my )?payslip\b/i, /\bsalary slip\b/i],
    label: 'Payslip',
  },
  'PAYROLL.get_payroll_summary': {
    domain: 'PAYROLL',
    action: 'get_payroll_summary',
    toolName: 'getPayrollSummary',
    mutating: false,
    requiresEntities: [],
    triggers: [/\bpayroll summary\b/i, /\bwhat was my salary last month\b/i],
    label: 'Payroll Summary',
  },
  'PAYROLL.compare_payslips': {
    domain: 'PAYROLL',
    action: 'compare_payslips',
    toolName: 'comparePayslips',
    mutating: false,
    requiresEntities: [],
    triggers: [/\bcompare (my )?payslips?\b/i, /\bwhy is my salary lower\b/i, /\bsalary (decreased|dropped|changed)\b/i],
    label: 'Compare Payslips',
  },
  'PAYROLL.explain_deductions': {
    domain: 'PAYROLL',
    action: 'explain_deductions',
    toolName: 'explainDeductions',
    mutating: false,
    requiresEntities: [],
    triggers: [/\bexplain (my )?deductions?\b/i, /\bwhat (was|is) deducted\b/i, /\bwhy (was|is) .*deducted\b/i],
    label: 'Explain Deductions',
  },

  'CONTRACT.get_contract': {
    domain: 'CONTRACT',
    action: 'get_contract',
    toolName: 'getContract',
    mutating: false,
    requiresEntities: [],
    triggers: [/\bmy contract\b/i, /\bcontract (details|document)\b/i],
    label: 'My Contract',
  },
  'CONTRACT.contract_status': {
    domain: 'CONTRACT',
    action: 'contract_status',
    toolName: 'getContractStatus',
    mutating: false,
    requiresEntities: [],
    triggers: [/\bcontract status\b/i, /\bis my contract (active|expired)\b/i, /\bcontract renewal\b/i],
    label: 'Contract Status',
  },

  'GENERAL_HR.payroll_concept': {
    domain: 'GENERAL_HR',
    action: 'payroll_concept',
    toolName: null,
    mutating: false,
    requiresEntities: [],
    triggers: [/\bwhat is (gross|net) salary\b/i, /\bwhat is pf\b/i, /\bwhat is tds\b/i, /\bwhat is ctc\b/i],
    label: 'Ask about Payroll Terms',
    knowledgeFile: 'payroll.json',
  },
  'GENERAL_HR.leave_concept': {
    domain: 'GENERAL_HR',
    action: 'leave_concept',
    toolName: null,
    mutating: false,
    requiresEntities: [],
    triggers: [/\bwhat is (paid|sick|casual) leave\b/i, /\bwhat is comp off\b/i],
    label: 'Ask about Leave Terms',
    knowledgeFile: 'leave.json',
  },
  'GENERAL_HR.attendance_concept': {
    domain: 'GENERAL_HR',
    action: 'attendance_concept',
    toolName: null,
    mutating: false,
    requiresEntities: [],
    triggers: [/\bwhat counts as (late|absent)\b/i, /\bgrace period\b/i],
    label: 'Ask about Attendance Rules',
    knowledgeFile: 'attendance.json',
  },
  'GENERAL_HR.HR_FAQ': {
    domain: 'GENERAL_HR',
    action: 'HR_FAQ',
    toolName: null,
    mutating: false,
    requiresEntities: [],
    triggers: [],
    label: 'Ask HR a Question',
    knowledgeFile: 'hr.json',
  },

  'UNKNOWN.general_llm': {
    domain: 'UNKNOWN',
    action: 'general_llm',
    toolName: null,
    mutating: false,
    requiresEntities: [],
    triggers: [],
    label: null,
  },
};

// Contextual A/B/C/D quick-action menus. Purely a UI shortcut layer over
// ACTIONS above — every entry here must reference a real ACTIONS key.
const QUICK_ACTION_MENUS = {
  ROOT: [
    { key: 'A', actionId: 'ATTENDANCE.attendance_status', label: "Today's Attendance" },
    { key: 'B', actionId: 'LEAVE.get_leave_balance', label: 'Leave Balance' },
    { key: 'C', actionId: 'PAYROLL.get_payslip', label: 'Payslip' },
    { key: 'D', actionId: 'GENERAL_HR.HR_FAQ', label: 'Ask an HR Question' },
  ],
  PAYROLL_MENU: [
    { key: 'A', actionId: 'PAYROLL.get_payslip', label: 'Current Payslip' },
    { key: 'B', actionId: 'PAYROLL.get_payroll_summary', label: 'Payroll Summary' },
    { key: 'C', actionId: 'PAYROLL.compare_payslips', label: 'Compare Payslips' },
    { key: 'D', actionId: 'PAYROLL.explain_deductions', label: 'Explain Deductions' },
  ],
  LEAVE_MENU: [
    { key: 'A', actionId: 'LEAVE.get_leave_balance', label: 'Leave Balance' },
    { key: 'B', actionId: 'LEAVE.get_leave_requests', label: 'My Leave Requests' },
    { key: 'C', actionId: 'LEAVE.create_leave_request', label: 'Apply for Leave' },
    { key: 'D', actionId: 'LEAVE.leave_policy', label: 'Leave Policy' },
  ],
  ATTENDANCE_MENU: [
    { key: 'A', actionId: 'ATTENDANCE.attendance_status', label: "Today's Status" },
    { key: 'B', actionId: 'ATTENDANCE.attendance_summary', label: 'Monthly Summary' },
    { key: 'C', actionId: 'ATTENDANCE.get_attendance', label: 'Detailed Attendance' },
  ],
};

// Which menu to show next after a given action resolves — drives "contextual"
// quick actions (spec §5, last bullet).
const NEXT_MENU_BY_ACTION = {
  'PAYROLL.get_payslip': 'PAYROLL_MENU',
  'PAYROLL.get_payroll_summary': 'PAYROLL_MENU',
  'PAYROLL.compare_payslips': 'PAYROLL_MENU',
  'PAYROLL.explain_deductions': 'PAYROLL_MENU',
  'LEAVE.get_leave_balance': 'LEAVE_MENU',
  'LEAVE.get_leave_requests': 'LEAVE_MENU',
  'LEAVE.leave_policy': 'LEAVE_MENU',
  'ATTENDANCE.get_attendance': 'ATTENDANCE_MENU',
  'ATTENDANCE.attendance_summary': 'ATTENDANCE_MENU',
  'ATTENDANCE.attendance_status': 'ATTENDANCE_MENU',
};

function getAction(actionId) {
  return ACTIONS[actionId] || null;
}

function listActionsForPrompt() {
  // What the LLM classifier is allowed to choose from — see ai/prompts/intent.prompt.js.
  return Object.keys(ACTIONS).filter((id) => id !== 'UNKNOWN.general_llm');
}

module.exports = {
  ACTIONS,
  QUICK_ACTION_MENUS,
  NEXT_MENU_BY_ACTION,
  getAction,
  listActionsForPrompt,
};
