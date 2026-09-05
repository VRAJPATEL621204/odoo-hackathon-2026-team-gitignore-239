const { listActionsForPrompt } = require('../intents/intent-map');

/**
 * Builds the classification prompt. The LLM is constrained to the exact
 * action-id list from intent-map.js — it cannot invent a new capability.
 * chat.service still re-validates the returned actionId against the
 * registry before doing anything with it, so a malformed/hallucinated
 * response degrades safely to UNKNOWN rather than executing.
 */
function buildIntentClassificationPrompt(userText, contextSummary) {
  const actionIds = listActionsForPrompt();
  return [
    {
      role: 'system',
      content:
        'You are an intent classifier for an HR chatbot. Given a user message, ' +
        'respond with ONLY a JSON object (no prose, no markdown fences) of the shape ' +
        '{"actionId": string|null, "confidence": number (0-1), "entities": object}. ' +
        `"actionId" MUST be exactly one of this list, or null if none fit: ${actionIds.join(', ')}. ` +
        'Extract entities like startDate, endDate, period, employeeId, leaveType only if clearly present ' +
        '(dates as YYYY-MM-DD, period as "current_month"/"previous_month"). ' +
        'If the message is a general knowledge question, a greeting, or unrelated to any listed action, return actionId null with low confidence.',
    },
    {
      role: 'user',
      content: `Recent context: ${contextSummary || 'none'}\nUser message: "${userText}"`,
    },
  ];
}

module.exports = { buildIntentClassificationPrompt };
