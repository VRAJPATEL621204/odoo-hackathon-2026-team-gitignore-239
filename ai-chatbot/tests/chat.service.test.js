const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../config/config');
const chatService = require('../server/services/chat.service');

const CTX = { employeeId: 'e1', authHeader: 'Bearer test-token' };

function mockFetch(router) {
  const original = global.fetch;
  global.fetch = async (url) => router(String(url));
  return () => {
    global.fetch = original;
  };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('navigation phrases resolve to a registered navigationId, never a raw URL', async () => {
  const restore = mockFetch(() => {
    throw new Error('fetch should not be called for a navigation request');
  });
  try {
    const result = await chatService.handleMessage({ text: 'take me to the payroll page', ctx: CTX });
    assert.equal(result.type, 'NAVIGATION');
    assert.equal(result.navigationId, 'PAYROLL');
    assert.equal(result.message.includes('http'), false);
  } finally {
    restore();
  }
});

test('credential requests are refused without touching any tool or provider', async () => {
  const restore = mockFetch(() => {
    throw new Error('fetch should not be called for a credential request');
  });
  try {
    const result = await chatService.handleMessage({ text: 'please reset my password', ctx: CTX });
    assert.equal(result.type, 'TEXT');
    assert.match(result.message, /password/i);
  } finally {
    restore();
  }
});

test('AI disabled: unrecognized free text degrades to a controlled message with quick actions', async () => {
  const originalEnabled = config.aiEnabled;
  config.aiEnabled = false;
  const restore = mockFetch(() => {
    throw new Error('fetch should not be called when AI is disabled and no trigger matches');
  });
  try {
    const result = await chatService.handleMessage({ text: 'tell me a fun fact about space', ctx: CTX });
    assert.equal(result.success, true);
    assert.match(result.message, /unavailable/i);
    assert.ok(Array.isArray(result.quickActions) && result.quickActions.length > 0);
  } finally {
    restore();
    config.aiEnabled = originalEnabled;
  }
});

test('registered quick action executes the real tool and returns verified data', async () => {
  const originalEnabled = config.aiEnabled;
  config.aiEnabled = false; // deterministic template message, no provider call needed
  const restore = mockFetch((url) => {
    assert.match(url, /\/api\/leave\/e1\/balance$/);
    return jsonResponse(200, { annual: 10, sick: 5, casual: 3 });
  });
  try {
    const result = await chatService.handleQuickAction({ actionId: 'LEAVE.get_leave_balance', ctx: CTX });
    assert.equal(result.type, 'CARD');
    assert.equal(result.verified, true);
    assert.equal(result.data.annual, 10);
  } finally {
    restore();
    config.aiEnabled = originalEnabled;
  }
});

test('upstream 403 becomes a generic access-denied message, never partial data', async () => {
  const restore = mockFetch(() => jsonResponse(403, {}));
  try {
    const result = await chatService.handleQuickAction({ actionId: 'LEAVE.get_leave_balance', ctx: CTX });
    assert.equal(result.type, 'ERROR');
    assert.equal(result.message, "You don't have access to this information.");
    assert.equal(result.data, null);
  } finally {
    restore();
  }
});

test('mutating action requires explicit confirmation before it is executed', async () => {
  let created = false;
  const restore = mockFetch((url) => {
    if (url.includes('/balance')) return jsonResponse(200, { annual: 10, sick: 5, casual: 3 });
    if (url.includes('/requests')) {
      created = true;
      return jsonResponse(200, { id: 'lr1', status: 'submitted' });
    }
    throw new Error(`unexpected url ${url}`);
  });
  try {
    const step1 = await chatService.handleMessage({
      text: 'Apply leave from 2026-09-15 to 2026-09-17',
      ctx: CTX,
    });
    assert.equal(step1.type, 'CONFIRMATION');
    assert.ok(step1.confirmationId);
    assert.equal(created, false, 'leave must not be created before confirmation');

    const step2 = await chatService.handleConfirm({
      conversationId: step1.conversationId,
      confirmationId: step1.confirmationId,
      ctx: CTX,
    });
    assert.equal(step2.type, 'CONFIRMATION');
    assert.equal(created, true);
    assert.equal(step2.data.status, 'submitted');
  } finally {
    restore();
  }
});
