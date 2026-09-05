const test = require('node:test');
const assert = require('node:assert/strict');

const context = require('../server/services/context.service');
const response = require('../server/services/response.service');
const chatService = require('../server/services/chat.service');
const { matchNavigationTrigger } = require('../ai/navigation-registry');

const CTX = { employeeId: 'emp_001', authHeader: 'Bearer demo-token' };

test('context service supports multi-turn conversational history', () => {
  const convId = 'test_conv_' + Date.now();
  context.addTurn(convId, 'user', 'What is my leave balance?');
  context.addTurn(convId, 'assistant', 'You have 18 annual leave days.');

  const history = context.getHistory(convId);
  assert.equal(history.length, 2);
  assert.equal(history[0].role, 'user');
  assert.equal(history[0].content, 'What is my leave balance?');
  assert.equal(history[1].role, 'assistant');
  assert.equal(history[1].content, 'You have 18 annual leave days.');

  const summary = context.summarize(convId);
  assert.match(summary, /recentConversation/i);
});

test('response service attaches quick links to domain responses', () => {
  const links = response.getLinksForDomain('ATTENDANCE');
  assert.ok(Array.isArray(links));
  assert.ok(links.some((l) => l.id === 'ATTENDANCE'));

  const payload = response.build({
    type: 'CARD',
    message: 'Attendance recorded',
    data: { status: 'PRESENT' },
    quickLinks: links,
  });

  assert.equal(payload.success, true);
  assert.ok(Array.isArray(payload.quickLinks));
  assert.equal(payload.quickLinks[0].id, 'ATTENDANCE');
  assert.equal(payload.quickLinks[0].path, '/attendance');
});

test('navigation triggers recognize common employee page redirection phrases', () => {
  assert.equal(matchNavigationTrigger('attendance page'), 'ATTENDANCE');
  assert.equal(matchNavigationTrigger('open leave portal'), 'LEAVE');
  assert.equal(matchNavigationTrigger('take me to payroll'), 'PAYROLL');
  assert.equal(matchNavigationTrigger('show employee directory'), 'EMPLOYEES');
  assert.equal(matchNavigationTrigger('contracts section'), 'CONTRACTS');
  assert.equal(matchNavigationTrigger('open dashboard'), 'DASHBOARD');
});

test('Today attendance query returns verified attendance card and quick links', async () => {
  const result = await chatService.handleMessage({ text: "Today's Attendance", ctx: CTX });
  assert.equal(result.success, true);
  assert.ok(result.data);
  assert.ok(result.quickLinks && result.quickLinks.length > 0);
  assert.ok(result.quickLinks.some((l) => l.id === 'ATTENDANCE'));
});
