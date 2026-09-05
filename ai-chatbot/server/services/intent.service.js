const { ACTIONS, getAction } = require('../../ai/intents/intent-map');
const { extractCommonEntities } = require('../../ai/intents/entity-extractor');
const { buildIntentClassificationPrompt } = require('../../ai/prompts/intent.prompt');
const aiProvider = require('../providers/ai.provider');

const HIGH_CONFIDENCE = 0.85; // keyword/trigger match
const MEDIUM_CONFIDENCE_MIN = 0.5; // below this -> treat as UNKNOWN

/**
 * Stage 1 — hardcoded, deterministic. Runs against the trigger regexes in
 * intent-map.js. No network call, can't fail, can't hallucinate. This is
 * what makes quick-action-equivalent free text ("how many leaves do I have")
 * resolve without ever touching an LLM.
 */
function matchByTriggers(text) {
  for (const [actionId, def] of Object.entries(ACTIONS)) {
    for (const trigger of def.triggers) {
      if (trigger.test(text)) {
        return { actionId, confidence: HIGH_CONFIDENCE, entities: extractCommonEntities(text), source: 'trigger' };
      }
    }
  }
  return null;
}

/**
 * Stage 2 — LLM classification, constrained to the registered action list.
 * Only reached when stage 1 finds nothing. Result is still validated by the
 * caller (chat.service) against the registry before use.
 */
async function classifyWithLLM(text, contextSummary) {
  const messages = buildIntentClassificationPrompt(text, contextSummary);
  const result = await aiProvider.generate(messages, { temperature: 0 });
  if (!result.ok) {
    return { actionId: null, confidence: 0, entities: {}, source: 'llm_unavailable' };
  }
  try {
    const parsed = JSON.parse(extractJson(result.text));
    const actionId = typeof parsed.actionId === 'string' ? parsed.actionId : null;
    // Guard against a hallucinated action id that isn't actually registered.
    const valid = actionId && getAction(actionId) ? actionId : null;
    const llmEntities = parsed.entities && typeof parsed.entities === 'object' ? parsed.entities : {};
    return {
      actionId: valid,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      entities: { ...extractCommonEntities(text), ...llmEntities },
      source: 'llm',
    };
  } catch {
    return { actionId: null, confidence: 0, entities: {}, source: 'llm_parse_error' };
  }
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end >= start ? text.slice(start, end + 1) : '{}';
}

/**
 * Full detection pipeline used by chat.service for free-text messages.
 * Quick-action selections skip this entirely and go straight to the
 * registry lookup (see chat.service.handleQuickAction).
 */
async function detectIntent(text, contextSummary) {
  const triggerMatch = matchByTriggers(text);
  if (triggerMatch) return triggerMatch;

  const llmMatch = await classifyWithLLM(text, contextSummary);
  if (llmMatch.actionId && llmMatch.confidence >= MEDIUM_CONFIDENCE_MIN) {
    return llmMatch;
  }
  return { actionId: null, confidence: llmMatch.confidence, entities: {}, source: llmMatch.source };
}

module.exports = { detectIntent, HIGH_CONFIDENCE, MEDIUM_CONFIDENCE_MIN };
