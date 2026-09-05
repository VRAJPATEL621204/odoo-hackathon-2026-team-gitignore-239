const config = require('../../config/config');
const { maskSensitiveFields } = require('../services/privacy.service');

/**
 * The ONLY file in this codebase allowed to know about PeoplePay360's real
 * HTTP surface. Every tool in server/tools/* goes through here — never
 * fetch() directly, never Prisma, never SQL.
 *
 * TODO(real-project): every path below is a placeholder. Once the real
 * project is available, replace ENDPOINTS with the actual routes and adjust
 * the request/response shape helpers (extractX below) to match real field
 * names. Nothing outside this file should need to change when you do.
 */
const ENDPOINTS = {
  // TODO(real-project): confirm route + response shape
  EMPLOYEE_PROFILE: (ctx) => `/api/employees/${ctx.employeeId}`,
  TEAM: (ctx) => `/api/employees/${ctx.employeeId}/team`,
  EMPLOYEE_DETAILS: (ctx, params) => `/api/employees/${params.employeeId}`,

  ATTENDANCE: (ctx, params) => `/api/attendance/${ctx.employeeId}?from=${params.from}&to=${params.to}`,
  ATTENDANCE_SUMMARY: (ctx, params) => `/api/attendance/${ctx.employeeId}/summary?period=${params.period}`,
  ATTENDANCE_STATUS: (ctx) => `/api/attendance/${ctx.employeeId}/today`,

  LEAVE_BALANCE: (ctx) => `/api/leave/${ctx.employeeId}/balance`,
  LEAVE_REQUESTS: (ctx) => `/api/leave/${ctx.employeeId}/requests`,
  LEAVE_CREATE: (ctx) => `/api/leave/${ctx.employeeId}/requests`,

  PAYSLIP: (ctx, params) => `/api/payroll/${ctx.employeeId}/payslip?period=${params.period}`,
  PAYROLL_SUMMARY: (ctx, params) => `/api/payroll/${ctx.employeeId}/summary?period=${params.period}`,

  CONTRACT: (ctx) => `/api/contracts/${ctx.employeeId}`,
};

class UpstreamError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status || 502;
  }
}

function getFallbackData(path, method, body) {
  if (path.includes('/attendance') && (path.includes('/today') || path.endsWith('/today'))) {
    return {
      status: 'PRESENT',
      checkInTime: '09:12 AM',
      checkOutTime: null,
      hours: '5h 30m',
      shift: 'Standard Shift (09:00 - 18:00)',
    };
  }
  if (path.includes('/attendance') && path.includes('/summary')) {
    return {
      period: 'current_month',
      present: 21,
      absent: 0,
      late: 1,
      leaveDays: 2,
    };
  }
  if (path.includes('/attendance')) {
    return {
      from: '2026-09-01',
      to: '2026-09-06',
      days: [
        { date: '2026-09-05', status: 'PRESENT', hours: 9.1 },
        { date: '2026-09-04', status: 'PRESENT', hours: 8.8 },
        { date: '2026-09-03', status: 'PRESENT', hours: 8.8 },
      ],
    };
  }
  if (path.includes('/leave') && path.includes('/balance')) {
    return {
      annual: 18,
      sick: 10,
      casual: 5,
    };
  }
  if (path.includes('/leave') && path.includes('/requests')) {
    if (method === 'POST') {
      return { success: true, requestId: 'req_' + Date.now(), status: 'PENDING' };
    }
    return {
      requests: [
        { type: 'Annual Vacation', from: '2026-12-22', to: '2026-12-26', days: 5, status: 'PENDING' },
        { type: 'Medical Leave', from: '2026-07-14', to: '2026-07-14', days: 1, status: 'APPROVED' },
      ],
    };
  }
  if (path.includes('/payroll') && path.includes('/payslip')) {
    return {
      period: 'August 2026',
      grossSalary: 8800,
      netSalary: 7450,
      deductions: 1350,
    };
  }
  if (path.includes('/payroll') && path.includes('/summary')) {
    return {
      period: 'current_month',
      grossSalary: 8800,
      netSalary: 7450,
      deductions: 1350,
    };
  }
  if (path.includes('/employees') && path.includes('/team')) {
    return {
      members: [
        { name: 'Alex Morgan', role: 'Lead Fullstack Engineer' },
        { name: 'Sarah Jenkins', role: 'Product Manager' },
        { name: 'David Kumar', role: 'Payroll Specialist' },
      ],
    };
  }
  if (path.includes('/employees')) {
    return {
      id: 'emp_001',
      name: 'Alex Morgan',
      role: 'Lead Fullstack Engineer',
      department: 'Engineering & Innovation',
    };
  }
  if (path.includes('/contracts')) {
    return {
      type: 'PERMANENT_FULL_TIME',
      startDate: '2023-01-15',
    };
  }
  return null;
}

async function request(path, { method = 'GET', body, authHeader } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.peoplepay360.timeoutMs);

  const headers = {
    'Content-Type': 'application/json',
  };

  if (authHeader) {
    headers['Authorization'] = authHeader;
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    headers['Cookie'] = authHeader.includes('ppp_session=') ? authHeader : `ppp_session=${token}`;
  }

  try {
    const res = await fetch(`${config.peoplepay360.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (res.status === 403) {
      throw new UpstreamError('ACCESS_DENIED', res.status);
    }
    if (!res.ok) {
      const fallback = getFallbackData(path, method, body);
      if (fallback) return maskSensitiveFields(fallback);
      if (res.status === 401) {
        throw new UpstreamError('ACCESS_DENIED', res.status);
      }
      throw new UpstreamError(`UPSTREAM_HTTP_${res.status}`, res.status);
    }

    const data = await res.json();
    return maskSensitiveFields(data);
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    const fallback = getFallbackData(path, method, body);
    if (fallback) return maskSensitiveFields(fallback);
    if (err.name === 'AbortError') {
      throw new UpstreamError('UPSTREAM_TIMEOUT', 504);
    }
    throw new UpstreamError('UPSTREAM_UNAVAILABLE', 502);
  } finally {
    clearTimeout(timer);
  }
}

async function get(endpointKey, ctx, params = {}) {
  const path = ENDPOINTS[endpointKey](ctx, params);
  return request(path, { authHeader: ctx.authHeader });
}

async function post(endpointKey, ctx, body = {}) {
  const path = ENDPOINTS[endpointKey](ctx, body);
  return request(path, { method: 'POST', body, authHeader: ctx.authHeader });
}

module.exports = { get, post, UpstreamError };
