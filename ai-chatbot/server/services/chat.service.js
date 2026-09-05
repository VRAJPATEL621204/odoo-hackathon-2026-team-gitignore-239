const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');

const config = require('../../config/config');
const { getAction, QUICK_ACTION_MENUS, NEXT_MENU_BY_ACTION } = require('../../ai/intents/intent-map');
const { matchNavigationTrigger } = require('../../ai/navigation-registry');
const { buildVerifiedExplanationPrompt, buildGeneralAnswerPrompt } = require('../../ai/prompts/response.prompt');
const aiProvider = require('../providers/ai.provider');
const { getTool, getValidator } = require('../tools');
const { UpstreamError } = require('../adapters/peoplepay360.adapter');
const privacy = require('./privacy.service');
const context = require('./context.service');
const intentService = require('./intent.service');
const response = require('./response.service');

const RESPONSE_TYPE_BY_ACTION = {
  'PAYROLL.compare_payslips': 'COMPARISON',
  'ATTENDANCE.get_attendance': 'TABLE',
  'LEAVE.get_leave_requests': 'TABLE',
  'EMPLOYEE.get_team': 'TABLE',
};

const CREDENTIAL_REFUSAL =
  "I can't help with passwords, OTPs, or account recovery — please use PeoplePay360's login/security settings for that.";

function loadKnowledge(fileName) {
  if (!fileName) return null;
  const filePath = path.join(__dirname, '..', '..', 'knowledge', fileName);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function findRelevantKnowledge(text) {
  const lower = (text || '').toLowerCase();
  if (/leave|vacation|time.?off|casual|sick|holiday/i.test(lower)) {
    return loadKnowledge('leave.json');
  }
  if (/attendance|clock.?in|punch|late|shift|overtime|hours/i.test(lower)) {
    return loadKnowledge('attendance.json');
  }
  if (/payroll|salary|payslip|pf|deduction|tax|ctc|tds|net salary/i.test(lower)) {
    return loadKnowledge('payroll.json');
  }
  if (/hr|policy|rules|probation|notice|contract/i.test(lower)) {
    return loadKnowledge('hr.json');
  }
  return null;
}

function rootQuickActions() {
  return QUICK_ACTION_MENUS.ROOT;
}

function nextQuickActionsFor(actionId) {
  const menuKey = NEXT_MENU_BY_ACTION[actionId];
  return menuKey ? QUICK_ACTION_MENUS[menuKey] : undefined;
}

/**
 * Verified data -> natural language. Incorporates recent multi-turn context.
 * Falls back to a plain deterministic template if AI is disabled or every provider fails.
 */
async function explainVerified(userText, actionLabel, data, conversationId) {
  if (config.aiEnabled) {
    const safeData = privacy.sanitizeForLLM(data);
    const history = context.getHistory(conversationId);
    const messages = buildVerifiedExplanationPrompt(userText, actionLabel, safeData, history);
    const result = await aiProvider.generate(messages, { temperature: 0.2 });
    if (result.ok) return { message: result.text, aiPhrased: true };
  }
  return { message: `Here is your ${actionLabel.toLowerCase()} information.`, aiPhrased: false };
}

async function runGeneralLlm(conversationId, userText, actionDef) {
  if (!config.aiEnabled) {
    return response.build({
      type: 'TEXT',
      message: 'AI-powered answers are currently unavailable. Try one of the quick actions below, or contact HR directly.',
      verified: false,
      quickActions: rootQuickActions(),
      quickLinks: response.TOP_QUICK_LINKS.slice(0, 4),
    });
  }

  const knowledgeSnippet = actionDef
    ? loadKnowledge(actionDef.knowledgeFile)
    : findRelevantKnowledge(userText);

  const history = context.getHistory(conversationId);
  const messages = buildGeneralAnswerPrompt(userText, knowledgeSnippet, history);
  const result = await aiProvider.generate(messages, { temperature: 0.4 });

  if (!result.ok) {
    return response.build({
      type: 'ERROR',
      message: "I couldn't generate an answer right now. Please try again shortly, or use one of the quick actions.",
      quickActions: rootQuickActions(),
      quickLinks: response.TOP_QUICK_LINKS.slice(0, 4),
    });
  }

  const domain = actionDef ? actionDef.domain : null;
  return response.build({
    type: 'TEXT',
    message: result.text,
    verified: false,
    sources: knowledgeSnippet ? ['Knowledge base', `AI (${result.providerUsed})`] : [`AI (${result.providerUsed}) — general guidance, not verified account data`],
    quickLinks: response.getLinksForDomain(domain),
  });
}

function missingEntities(actionDef, entities, ctxData) {
  return actionDef.requiresEntities.filter((key) => !entities[key] && !ctxData[key]);
}

async function runRegisteredAction(conversationId, userText, actionDef, actionId, entities, ctx) {
  const ctxData = context.get(conversationId);
  const mergedEntities = { period: ctxData.lastPeriod, ...entities };

  const missing = missingEntities(actionDef, mergedEntities, ctxData);
  if (missing.length) {
    return response.build({
      type: 'TEXT',
      message: `To do that, I need a bit more information: ${missing.join(', ')}.`,
      verified: false,
      quickLinks: response.getLinksForDomain(actionDef.domain),
    });
  }

  // Knowledge-only actions (org policy / concept explanations) never touch
  // the PeoplePay360 API or personal data at all.
  if (!actionDef.toolName) {
    return runGeneralLlm(conversationId, userText, actionDef);
  }

  if (actionDef.mutating) {
    return prepareConfirmation(conversationId, actionDef, actionId, mergedEntities, ctx);
  }

  const tool = getTool(actionDef.toolName);
  let data;
  try {
    data = await tool(ctx, mergedEntities);
  } catch (err) {
    return handleToolError(err, actionDef);
  }

  context.set(conversationId, {
    lastIntent: actionDef.domain,
    lastAction: actionId,
    lastPeriod: mergedEntities.period,
  });

  const { message } = await explainVerified(userText, actionDef.label, data, conversationId);
  const type = RESPONSE_TYPE_BY_ACTION[actionId] || 'CARD';
  return response.build({
    type,
    message,
    data,
    sources: [actionDef.label],
    verified: true,
    quickActions: nextQuickActionsFor(actionId),
    quickLinks: response.getLinksForDomain(actionDef.domain),
  });
}

function handleToolError(err, actionDef) {
  if (err instanceof UpstreamError && err.status === 403) {
    return response.build({
      type: 'ERROR',
      message: "You don't have access to this information.",
      quickLinks: actionDef ? response.getLinksForDomain(actionDef.domain) : response.TOP_QUICK_LINKS.slice(0, 3),
    });
  }
  if (err instanceof UpstreamError && err.status === 401) {
    return response.build({
      type: 'ERROR',
      message: 'Your session could not be verified. Please sign in again.',
    });
  }
  console.error('[ai-chatbot] tool execution failed:', privacy.redact(err.message));
  return response.build({
    type: 'ERROR',
    message: 'Something went wrong while fetching that information. Please try again in a moment.',
    quickLinks: actionDef ? response.getLinksForDomain(actionDef.domain) : response.TOP_QUICK_LINKS.slice(0, 3),
  });
}

async function prepareConfirmation(conversationId, actionDef, actionId, entities, ctx) {
  const validator = getValidator(actionDef.toolName);
  if (validator) {
    let validation;
    try {
      validation = await validator(ctx, entities);
    } catch (err) {
      return handleToolError(err, actionDef);
    }
    if (!validation.valid) {
      return response.build({ type: 'ERROR', message: describeValidationFailure(validation) });
    }
  }

  const confirmationId = uuid();
  context.setPendingConfirmation(conversationId, { actionId, entities, confirmationId });

  return response.build({
    type: 'CONFIRMATION',
    message: `Confirm: ${actionDef.label} for ${entities.startDate} to ${entities.endDate}. Proceed?`,
    data: entities,
    confirmationId,
    quickLinks: response.getLinksForDomain(actionDef.domain),
  });
}

function describeValidationFailure(validation) {
  if (validation.reason === 'INSUFFICIENT_BALANCE') {
    return `You requested ${validation.days} day(s) of ${validation.type} leave but only have ${validation.available} available.`;
  }
  if (validation.reason === 'INVALID_DATE_RANGE') {
    return 'That date range looks invalid — please provide a valid start and end date.';
  }
  return 'That request could not be validated.';
}

/**
 * Entry point for free-text messages.
 */
async function handleMessage({ conversationId = uuid(), text, ctx }) {
  if (privacy.isCredentialRequest(text)) {
    const res = response.build({
      type: 'TEXT',
      message: CREDENTIAL_REFUSAL,
      verified: true,
      quickLinks: response.TOP_QUICK_LINKS.slice(0, 3),
    });
    context.addTurn(conversationId, 'user', text);
    context.addTurn(conversationId, 'assistant', res.message);
    return { conversationId, ...res };
  }

  const navigationId = matchNavigationTrigger(text);
  if (navigationId) {
    const navLinks = response.getLinksForDomain(navigationId);
    const res = response.build({
      type: 'NAVIGATION',
      message: `Opening the ${navigationId[0]}${navigationId.slice(1).toLowerCase()} page for you.`,
      navigationId,
      quickLinks: navLinks,
    });
    context.addTurn(conversationId, 'user', text);
    context.addTurn(conversationId, 'assistant', res.message);
    return { conversationId, ...res };
  }

  const contextSummary = context.summarize(conversationId);
  const { actionId, entities } = await intentService.detectIntent(text, contextSummary);

  let result;
  if (!actionId) {
    result = await runGeneralLlm(conversationId, text, null);
  } else {
    const actionDef = getAction(actionId);
    result = await runRegisteredAction(conversationId, text, actionDef, actionId, entities, ctx);
  }

  // Record into conversational memory
  context.addTurn(conversationId, 'user', text);
  if (result.message) {
    context.addTurn(conversationId, 'assistant', result.message);
  }

  return { conversationId, ...result };
}

/**
 * Entry point for A/B/C/D quick-action selections.
 */
async function handleQuickAction({ conversationId = uuid(), actionId, entities = {}, ctx }) {
  const actionDef = getAction(actionId);
  let result;
  if (!actionDef) {
    result = await runGeneralLlm(conversationId, `(quick action) ${actionId}`, null);
  } else {
    result = await runRegisteredAction(conversationId, actionDef.label, actionDef, actionId, entities, ctx);
  }

  context.addTurn(conversationId, 'user', actionDef?.label || actionId);
  if (result.message) {
    context.addTurn(conversationId, 'assistant', result.message);
  }

  return { conversationId, ...result };
}

/**
 * User explicitly confirmed a pending mutating action.
 */
async function handleConfirm({ conversationId, confirmationId, ctx }) {
  const pending = context.popPendingConfirmation(conversationId);
  if (!pending || pending.confirmationId !== confirmationId) {
    return {
      conversationId,
      ...response.build({
        type: 'ERROR',
        message: 'This confirmation has expired or is invalid. Please try again.',
      }),
    };
  }

  const actionDef = getAction(pending.actionId);
  const tool = getTool(actionDef.toolName);
  let data;
  try {
    data = await tool(ctx, pending.entities);
  } catch (err) {
    return { conversationId, ...handleToolError(err, actionDef) };
  }

  context.set(conversationId, { lastIntent: actionDef.domain, lastAction: pending.actionId });

  const result = response.build({
    type: 'CONFIRMATION',
    message: `Done — ${actionDef.label.toLowerCase()} submitted successfully.`,
    data,
    verified: true,
    quickLinks: response.getLinksForDomain(actionDef.domain),
  });

  context.addTurn(conversationId, 'user', `Confirm ${actionDef.label}`);
  context.addTurn(conversationId, 'assistant', result.message);

  return { conversationId, ...result };
}

function getQuickActionMenu(menuKey = 'ROOT') {
  return QUICK_ACTION_MENUS[menuKey] || QUICK_ACTION_MENUS.ROOT;
}

module.exports = {
  handleMessage,
  handleQuickAction,
  handleConfirm,
  getQuickActionMenu,
};
